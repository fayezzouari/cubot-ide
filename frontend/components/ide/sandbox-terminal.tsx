'use client';

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useSession } from 'next-auth/react';
import { FolderSync, RefreshCw, Trash2, Loader2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/components/ui/button';
import { daytonaApi } from '@/lib/api/daytona';
import { useProject } from '@/contexts/project-context';
import { toast } from 'sonner';

export interface SandboxTerminalHandle {
  resync: () => void;
  reset: () => void;
  clear: () => void;
}

interface SandboxTerminalProps {
  workspaceId?: string;
  onWorkspaceCreate?: (workspaceId: string) => void;
  /** Called after a project→sandbox sync completes so the parent can pull new sandbox files back. */
  onSyncComplete?: (workspaceId: string) => void;
  /** Whether this terminal is the currently visible tab. Used to re-fit on reveal. */
  isActive?: boolean;
  /** When false, suppresses the built-in header (actions are owned by the parent). */
  showHeader?: boolean;
  /** Called whenever connection state, init stage, or workspace ID changes. */
  onStateChange?: (state: { isConnected: boolean; initStage: InitStage; workspaceId?: string }) => void;
}

type InitStage = 'idle' | 'creating' | 'syncing' | 'ready';

const SandboxTerminal = forwardRef<SandboxTerminalHandle, SandboxTerminalProps>(function SandboxTerminal(
  { workspaceId: workspaceIdProp, onWorkspaceCreate, onSyncComplete, isActive, showHeader = true, onStateChange },
  ref,
) {
  const { currentProject } = useProject();
  const { data: session } = useSession();
  const isRosProject = currentProject?.project_type === 'ros';

  const terminalDivRef = useRef<HTMLDivElement>(null);
  // Using `any` to avoid importing xterm types at module level (SSR safety)
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const onDataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | undefined>(workspaceIdProp);
  const [initStage, setInitStage] = useState<InitStage>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const [isTerminalReady, setIsTerminalReady] = useState(false);

  // ── 1. Initialise xterm inside useEffect (browser-only) ──────────────────
  useEffect(() => {
    if (!terminalDivRef.current || !isRosProject) return;

    let disposed = false;
    let term: any;
    let fitAddon: any;

    (async () => {
      const [{ Terminal }, { FitAddon }, { WebglAddon }] = await Promise.all([
        import('@xterm/xterm') as any,
        import('@xterm/addon-fit') as any,
        import('@xterm/addon-webgl') as any,
      ]);

      if (disposed || !terminalDivRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        scrollback: 5000,
        scrollSensitivity: 3,
        fastScrollSensitivity: 10,
        fastScrollModifier: 'alt',
        theme: {
          background: '#1e1e1e',
          foreground: '#cccccc',
          cursor: '#4ec9b0',
          selectionBackground: '#264f78',
          black: '#1e1e1e',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#e5e5e5',
        },
        fontFamily: '"JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.2,
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalDivRef.current);

      // WebGL renderer — GPU-accelerated, dramatically faster for bursty output.
      // Falls back silently to the default canvas renderer if WebGL is unavailable.
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => webglAddon.dispose());
        term.loadAddon(webglAddon);
      } catch {
        // WebGL unavailable — default renderer is used automatically
      }

      fitAddon.fit();

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
      setIsTerminalReady(true);
    })();

    return () => {
      disposed = true;
      term?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      setIsTerminalReady(false);
    };
  }, [isRosProject]);

  // ── 2. Connect to the PTY WebSocket ──────────────────────────────────────
  const connectToTerminal = useCallback((wsId: string) => {
    if (wsRef.current) return; // already connected

    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
    const wsBase = apiBase.startsWith('/')
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${apiBase}`
      : apiBase.replace(/^http/, 'ws');
    const token = (session as any)?.backendToken;
    const wsUrl = `${wsBase}/ws/pty/${wsId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    // ── Write batching: accumulate incoming chunks and flush once per rAF ──
    // Avoids a repaint for every individual WebSocket message during bursty output.
    let pendingChunks: (string | Uint8Array)[] = [];
    let rafId: number | null = null;
    const flushWrites = () => {
      rafId = null;
      if (pendingChunks.length === 0) return;
      const term = xtermRef.current;
      if (!term) { pendingChunks = []; return; }
      const chunks = pendingChunks;
      pendingChunks = [];
      for (const chunk of chunks) term.write(chunk);
    };

    ws.onopen = () => {
      setIsConnected(true);
      // Fit once and send initial size
      const fitAddon = fitAddonRef.current;
      const term = xtermRef.current;
      if (fitAddon && term) {
        fitAddon.fit();
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }

      // Wire xterm keystrokes → WebSocket (dispose previous listener if any)
      onDataDisposableRef.current?.dispose();
      if (term) {
        onDataDisposableRef.current = term.onData((data: string) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        });
      }

      // ResizeObserver → debounced fit + resize to avoid thrashing during panel drag
      if (terminalDivRef.current && fitAddon) {
        resizeObserverRef.current?.disconnect();
        let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
        const observer = new ResizeObserver(() => {
          if (resizeDebounce) clearTimeout(resizeDebounce);
          resizeDebounce = setTimeout(() => {
            resizeDebounce = null;
            fitAddon.fit();
            const t = xtermRef.current;
            if (t && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'resize', cols: t.cols, rows: t.rows }));
            }
          }, 50);
        });
        observer.observe(terminalDivRef.current);
        resizeObserverRef.current = observer;
      }
    };

    ws.onmessage = (event) => {
      // Buffer the chunk and schedule a single rAF flush instead of writing immediately.
      // This batches bursts of messages (e.g. build logs) into one render frame.
      const chunk = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : (event.data as string);
      pendingChunks.push(chunk);
      if (rafId === null) rafId = requestAnimationFrame(flushWrites);
    };

    ws.onclose = () => {
      setIsConnected(false);
      // Flush any remaining buffered output before showing the closed message
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      flushWrites();
      xtermRef.current?.write('\r\n\x1b[33m[Connection closed]\x1b[0m\r\n');
      wsRef.current = null;
      resizeObserverRef.current?.disconnect();
    };

    ws.onerror = () => {
      setIsConnected(false);
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      xtermRef.current?.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n');
    };
  }, [session]);

  // ── 3. Create workspace then connect ─────────────────────────────────────
  const ensureWorkspace = useCallback(async (): Promise<string | null> => {
    if (currentWorkspaceId) return currentWorkspaceId;

    if (!isRosProject) {
      xtermRef.current?.write('\r\n\x1b[31mDaytona sandboxes are only available for ROS projects\x1b[0m\r\n');
      return null;
    }

    const projectId = currentProject?.id;
    if (!projectId) return null;

    setInitStage('creating');
    xtermRef.current?.write('\x1b[33mCreating sandbox environment…\x1b[0m\r\n');

    try {
      setInitStage('syncing');
      xtermRef.current?.write('\x1b[33mSyncing project files…\x1b[0m\r\n');

      const workspace = await daytonaApi.createWorkspace(projectId);
      const wsId = workspace.workspace_id;

      setCurrentWorkspaceId(wsId);
      onWorkspaceCreate?.(wsId);

      if (workspace.files_synced > 0) {
        xtermRef.current?.write(
          `\x1b[32m✓ Synced ${workspace.files_synced} file${workspace.files_synced !== 1 ? 's' : ''}\x1b[0m\r\n`
        );
      }

      setInitStage('ready');
      return wsId;
    } catch (error) {
      xtermRef.current?.write(`\r\n\x1b[31mFailed to create sandbox: ${error}\x1b[0m\r\n`);
      toast.error('Failed to create sandbox');
      return null;
    } finally {
      setInitStage('idle');
    }
  }, [currentWorkspaceId, currentProject?.id, onWorkspaceCreate, isRosProject]);

  // ── Re-fit when this tab becomes the active/visible one ──────────────────
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      // Use rAF so the browser has painted the visible container first
      const id = requestAnimationFrame(() => fitAddonRef.current?.fit());
      return () => cancelAnimationFrame(id);
    }
  }, [isActive]);

  // ── 4. Auto-init: create workspace once terminal is ready ─────────────────
  useEffect(() => {
    if (!isTerminalReady || !isRosProject) return;
    ensureWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTerminalReady, isRosProject]);

  // ── 5. Connect PTY once workspace ID is set ───────────────────────────────
  useEffect(() => {
    if (!currentWorkspaceId || !isTerminalReady || wsRef.current) return;
    connectToTerminal(currentWorkspaceId);
  }, [currentWorkspaceId, isTerminalReady, connectToTerminal]);

  // ── 6. Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      resizeObserverRef.current?.disconnect();
      onDataDisposableRef.current?.dispose();
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    };
  }, []);

  // ── 7. Notify parent of state changes ────────────────────────────────────
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  useEffect(() => {
    onStateChangeRef.current?.({ isConnected, initStage, workspaceId: currentWorkspaceId });
  }, [isConnected, initStage, currentWorkspaceId]);

  // ── 8. Expose imperative actions (via ref so no ordering issues) ──────────
  const actionsRef = useRef({ resync: () => {}, reset: () => {}, clear: () => {} });
  useImperativeHandle(ref, () => ({
    resync: () => actionsRef.current.resync(),
    reset: () => actionsRef.current.reset(),
    clear: () => actionsRef.current.clear(),
  }));

  // ── Actions ───────────────────────────────────────────────────────────────
  const resyncFiles = async () => {
    if (!currentWorkspaceId || !currentProject?.id) {
      toast.error('No active sandbox or project');
      return;
    }
    setInitStage('syncing');
    xtermRef.current?.write('\r\n\x1b[33mRe-syncing project files…\x1b[0m\r\n');
    try {
      const result = await daytonaApi.syncFiles(currentWorkspaceId, currentProject.id);
      xtermRef.current?.write(
        `\x1b[32m✓ Synced ${result.files_synced} file${result.files_synced !== 1 ? 's' : ''}\x1b[0m\r\n`
      );
      // Notify parent so it can pull any new sandbox files back into the project
      onSyncComplete?.(currentWorkspaceId);
    } catch (error) {
      xtermRef.current?.write(`\x1b[31mSync failed: ${error}\x1b[0m\r\n`);
      toast.error('File sync failed');
    } finally {
      setInitStage('idle');
    }
  };

  const clearTerminal = () => xtermRef.current?.clear();

  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetSandbox = async () => {
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
    if (currentWorkspaceId) {
      try { await daytonaApi.stopWorkspace(currentWorkspaceId); } catch { /* ignore */ }
    }
    setCurrentWorkspaceId(undefined);
    setInitStage('idle');
    xtermRef.current?.write('\r\n\x1b[33mSandbox reset. Reconnecting…\x1b[0m\r\n');
    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    resetTimeoutRef.current = setTimeout(() => ensureWorkspace(), 500);
  };

  // Keep actionsRef in sync so useImperativeHandle always delegates to the latest versions
  actionsRef.current = { resync: resyncFiles, reset: resetSandbox, clear: clearTerminal };

  const isInitializing = initStage === 'creating' || initStage === 'syncing';

  if (!isRosProject) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1e1e1e] text-[#858585] font-mono text-sm">
        Terminal available for ROS projects only
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e] font-mono">
      {showHeader && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#2d2d2d] bg-[#252526] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-[#cccccc]">Sandbox Terminal</span>
            </div>
            {currentWorkspaceId && (
              <>
                <div className="h-4 w-px bg-[#3e3e42]" />
                <span className="text-xs text-[#858585]">{currentWorkspaceId.slice(0, 12)}…</span>
                <span
                  className={`text-[10px] px-2 py-0.5 font-medium rounded-sm ${
                    isConnected ? 'bg-[#0e639c] text-white' : 'bg-[#3e3e42] text-[#858585]'
                  }`}
                >
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isInitializing && (
              <span className="text-xs text-[#ce9178] flex items-center gap-1.5 px-2 py-1">
                <Loader2 size={12} className="animate-spin" />
                {initStage === 'creating' ? 'Creating…' : 'Syncing…'}
              </span>
            )}
            {currentWorkspaceId && currentProject?.id && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white transition-colors" onClick={resyncFiles} disabled={isInitializing} title="Re-sync project files">
                <FolderSync size={14} />
              </Button>
            )}
            {currentWorkspaceId && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white transition-colors" onClick={resetSandbox} disabled={isInitializing} title="Reset sandbox">
                <RefreshCw size={14} />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-[#cccccc] hover:bg-[#2a2d2e] hover:text-[#f48771] transition-colors" onClick={clearTerminal} title="Clear terminal">
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* xterm.js mount point */}
      <div
        ref={terminalDivRef}
        className="flex-1 overflow-hidden"
        style={{ padding: '4px 8px' }}
      />
    </div>
  );
});

export default SandboxTerminal;
