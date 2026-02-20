'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import SandboxTerminal, { type SandboxTerminalHandle } from './sandbox-terminal';
import TerminalTabsHeader from './terminal-tabs-header';
import { FolderSync, RefreshCw, Trash2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TerminalTab {
  id: string;
  title: string;
}

interface TerminalState {
  isConnected: boolean;
  initStage: 'idle' | 'creating' | 'syncing' | 'ready';
  workspaceId?: string;
}

interface TerminalTabsManagerProps {
  workspaceId?: string;
  onWorkspaceCreate?: (workspaceId: string) => void;
  onSyncComplete?: (workspaceId: string) => void;
}

// Module-level counter ensures unique IDs regardless of tab close/reopen cycles
let tabCounter = 1;

export default function TerminalTabsManager({
  workspaceId,
  onWorkspaceCreate,
  onSyncComplete,
}: TerminalTabsManagerProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([{ id: 'terminal-1', title: 'Terminal 1' }]);
  const [activeTabId, setActiveTabId] = useState('terminal-1');
  const [splits, setSplits] = useState<string[]>([]);

  const terminalRefs = useRef<Map<string, SandboxTerminalHandle>>(new Map());
  const terminalStatesRef = useRef<Map<string, TerminalState>>(new Map());
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const [activeTerminalState, setActiveTerminalState] = useState<TerminalState>({
    isConnected: false,
    initStage: 'idle',
    workspaceId: undefined,
  });

  // Sync displayed state when the active tab changes
  useEffect(() => {
    const state = terminalStatesRef.current.get(activeTabId);
    setActiveTerminalState(state ?? { isConnected: false, initStage: 'idle', workspaceId: undefined });
  }, [activeTabId]);

  const handleNewTab = () => {
    tabCounter++;
    const newId = `terminal-${tabCounter}`;
    setTabs(prev => [...prev, { id: newId, title: `Terminal ${tabCounter}` }]);
    setActiveTabId(newId);
  };

  const handleTabClick = (id: string) => setActiveTabId(id);

  const handleTabClose = (id: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (activeTabId === id && next.length > 0) {
        setActiveTabId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
    terminalRefs.current.delete(id);
    terminalStatesRef.current.delete(id);
  };

  const handleSplit = () => {
    if (!splits.includes(activeTabId)) {
      setSplits(prev => [...prev, activeTabId]);
    }
  };

  const handleUnsplit = (id: string) => setSplits(prev => prev.filter(s => s !== id));

  // Stable state-change handler — uses ref so it never recreates on re-render
  const handleStateChange = useCallback((tabId: string, state: TerminalState) => {
    terminalStatesRef.current.set(tabId, state);
    if (tabId === activeTabIdRef.current) {
      setActiveTerminalState(state);
    }
  }, []);

  const activeRef = terminalRefs.current.get(activeTabId);
  const isInitializing =
    activeTerminalState.initStage === 'creating' || activeTerminalState.initStage === 'syncing';

  const rightSlot = (
    <>
      {isInitializing && (
        <span className="text-xs text-[#ce9178] flex items-center gap-1.5 px-1">
          <Loader2 size={12} className="animate-spin" />
          {activeTerminalState.initStage === 'creating' ? 'Creating…' : 'Syncing…'}
        </span>
      )}
      {activeTerminalState.workspaceId && (
        <span
          className={`text-[10px] px-2 py-0.5 font-medium rounded-sm ${
            activeTerminalState.isConnected
              ? 'bg-[#0e639c] text-white'
              : 'bg-[#3e3e42] text-[#858585]'
          }`}
        >
          {activeTerminalState.isConnected ? 'Connected' : 'Disconnected'}
        </span>
      )}
      {activeTerminalState.workspaceId && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white transition-colors"
          onClick={() => activeRef?.resync()}
          disabled={isInitializing}
          title="Re-sync project files"
        >
          <FolderSync size={13} />
        </Button>
      )}
      {activeTerminalState.workspaceId && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white transition-colors"
          onClick={() => activeRef?.reset()}
          disabled={isInitializing}
          title="Reset sandbox"
        >
          <RefreshCw size={13} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-[#cccccc] hover:bg-[#2a2d2e] hover:text-[#f48771] transition-colors"
        onClick={() => activeRef?.clear()}
        title="Clear terminal"
      >
        <Trash2 size={13} />
      </Button>
    </>
  );

  return (
    <div className="h-full flex flex-col">
      <TerminalTabsHeader
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onNewTab={handleNewTab}
        onSplit={handleSplit}
        rightSlot={rightSlot}
      />
      <div className={`flex-1 flex min-h-0 ${splits.length > 0 ? 'divide-x divide-[#2d2d2d]' : ''}`}>
        {/* Primary tab pane */}
        <div className="flex-1 min-w-0 relative">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
            >
              <SandboxTerminal
                ref={handle => {
                  if (handle) terminalRefs.current.set(tab.id, handle);
                  else terminalRefs.current.delete(tab.id);
                }}
                workspaceId={workspaceId}
                onWorkspaceCreate={onWorkspaceCreate}
                onSyncComplete={onSyncComplete}
                isActive={tab.id === activeTabId}
                showHeader={false}
                onStateChange={state => handleStateChange(tab.id, state)}
              />
            </div>
          ))}
        </div>

        {/* Split panes */}
        {splits.map(splitId => (
          <div className="flex-1 min-w-0 relative" key={splitId}>
            <button
              type="button"
              className="absolute top-1 right-2 z-10 flex items-center text-[#cccccc] hover:text-[#f48771]"
              onClick={() => handleUnsplit(splitId)}
              title="Close split"
            >
              <X size={12} />
            </button>
            <SandboxTerminal
              workspaceId={workspaceId}
              onWorkspaceCreate={onWorkspaceCreate}
              onSyncComplete={onSyncComplete}
              isActive={true}
              showHeader={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
