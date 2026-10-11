'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ChevronDown,
  Download,
  Home,
  Loader2,
  Magnet,
  Maximize,
  Move3d,
  Redo2,
  Rotate3d,
  Undo2,
  Upload,
} from 'lucide-react';
import {
  cadApi,
  type CadAssembly,
  type CadEvent,
  type CadInstance,
  type CadMessage,
  type CadPart,
  type CadSnapshot,
  type CadState,
  type CadVersion,
  type ExportFormat,
  type FaceInfo,
  type TrashedPart,
  type Vec3,
} from '@/lib/api/cad';
import AssistantPanel, { type LogEntry, type PlanRow } from '@/components/cad/assistant-panel';
import PartsPanel from '@/components/cad/parts-panel';
import InspectorPanel from '@/components/cad/inspector-panel';
import HistoryPanel from '@/components/cad/history-panel';
import type { TransformMode, ViewportHandle } from '@/components/cad/studio-viewport';

const StudioViewport = dynamic(() => import('@/components/cad/studio-viewport'), { ssr: false });

const IMPORT_ACCEPT = '.step,.stp,.iges,.igs,.stl,.obj,.3mf,.dxf';

const EXPORTS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: 'step', label: 'STEP assembly', hint: 'Fusion, SolidWorks, FreeCAD, Onshape' },
  { format: 'stl', label: 'STL (merged)', hint: '3D printing, one mesh' },
  { format: '3mf', label: '3MF', hint: 'Modern slicers' },
  { format: 'stl-zip', label: 'STL per part (zip)', hint: 'Print parts separately' },
  { format: 'glb', label: 'GLB', hint: 'Web, AR, Blender' },
  { format: 'urdf', label: 'URDF package (zip)', hint: 'ROS 2 / simulators' },
];

const uid = () => Math.random().toString(36).slice(2, 10);

const UNDO_LIMIT = 100;
const COALESCE_MS = 800; // typing in a field is one undo step

const toEntry = (m: CadMessage): LogEntry => ({ id: m.id, role: m.role, text: m.text });

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function CadPageContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('project') || searchParams.get('session') || '';

  const [state, setState] = useState<CadState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [face, setFace] = useState<FaceInfo | null>(null);
  const [mode, setMode] = useState<TransformMode>('translate');
  const [snap, setSnap] = useState(true);
  const [tab, setTab] = useState<'assistant' | 'parts' | 'history'>('assistant');
  const [snapshots, setSnapshots] = useState<CadSnapshot[] | null>(null);
  const [trash, setTrash] = useState<TrashedPart[] | null>(null);
  const [undoDepth, setUndoDepth] = useState({ past: 0, future: 0 });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [interfaces, setInterfaces] = useState<Record<string, number | string> | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [versions, setVersions] = useState<CadVersion[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const viewport = useRef<ViewportHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Undo/redo of assembly edits (placement, colour, visibility, names, copies).
  const stateRef = useRef<CadState | null>(null);
  const past = useRef<CadAssembly[]>([]);
  const future = useRef<CadAssembly[]>([]);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const resetUndo = useCallback(() => {
    past.current = [];
    future.current = [];
    lastEdit.current = null;
    setUndoDepth({ past: 0, future: 0 });
  }, []);

  const say = useCallback((role: LogEntry['role'], text: string) => {
    setLog((l) => [...l, { id: uid(), role, text }]);
  }, []);

  const flash = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 4000);
  }, []);

  useEffect(() => {
    if (!projectId) {
      setLoadError('Open CAD Studio from a project on the dashboard.');
      return;
    }
    cadApi
      .state(projectId)
      .then((s) => {
        setState(s);
        resetUndo();
        return cadApi.messages(projectId).then((m) => setLog(m.map(toEntry)));
      })
      .catch((e) => setLoadError(e?.message || 'Could not load the project'));
  }, [projectId, resetUndo]);

  const refreshHistory = useCallback(() => {
    if (!projectId) return;
    cadApi.snapshots(projectId).then(setSnapshots).catch(() => setSnapshots([]));
    cadApi.trash(projectId).then(setTrash).catch(() => setTrash([]));
  }, [projectId]);

  useEffect(() => {
    if (tab === 'history') refreshHistory();
  }, [tab, refreshHistory]);

  const parts = useMemo(() => state?.parts ?? [], [state]);
  const instances = useMemo(() => state?.assembly.instances ?? [], [state]);
  const selected = instances.find((i) => i.id === selectedId) ?? null;
  const selectedPart = selected ? parts.find((p) => p.id === selected.part_id) ?? null : null;

  // A picked face belongs to one version of one part.
  useEffect(() => {
    setVersions(null);
    setFace(null);
  }, [selectedPart?.id, selectedPart?.version?.id]);

  // ── Persistence ─────────────────────────────────────────────────────────

  const scheduleSave = useCallback(
    (next: CadState) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        cadApi.saveAssembly(projectId, next.assembly).catch((e) => flash(`Not saved: ${e.message}`));
      }, 400);
    },
    [projectId, flash],
  );

  /** Change the assembly as one undoable step. Edits with the same
   *  `coalesce` key in quick succession (typing) merge into one step. */
  const updateAssembly = useCallback(
    (fn: (instances: CadInstance[]) => CadInstance[], name?: string, coalesce?: string) => {
      const s = stateRef.current;
      if (!s) return;
      const next = { ...s, assembly: { name: name ?? s.assembly.name, instances: fn(s.assembly.instances) } };
      const now = Date.now();
      const merge = coalesce && lastEdit.current?.key === coalesce && now - lastEdit.current.at < COALESCE_MS;
      if (!merge) {
        past.current = [...past.current, s.assembly].slice(-UNDO_LIMIT);
      }
      future.current = [];
      lastEdit.current = coalesce ? { key: coalesce, at: now } : null;
      setUndoDepth({ past: past.current.length, future: 0 });
      stateRef.current = next;
      setState(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  const patchInstance = useCallback(
    (id: string, patch: Partial<CadInstance>, coalesce?: string) =>
      updateAssembly((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)), undefined, coalesce),
    [updateAssembly],
  );

  const stepHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      const s = stateRef.current;
      const from = direction === 'undo' ? past.current : future.current;
      const to = direction === 'undo' ? future.current : past.current;
      if (!s || !from.length) return;
      const target = from[from.length - 1];
      from.splice(from.length - 1, 1);
      to.push(s.assembly);
      lastEdit.current = null;
      const known = new Set(s.parts.map((p) => p.id));
      const next = { ...s, assembly: { ...target, instances: target.instances.filter((i) => known.has(i.part_id)) } };
      setUndoDepth({ past: past.current.length, future: future.current.length });
      stateRef.current = next;
      setState(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  const replacePart = useCallback((part: CadPart) => {
    setState((s) => (s ? { ...s, parts: s.parts.some((p) => p.id === part.id) ? s.parts.map((p) => (p.id === part.id ? part : p)) : [...s.parts, part] } : s));
  }, []);

  const patchPart = useCallback(
    (part: CadPart, fields: { name?: string; color?: string }) => {
      replacePart({ ...part, ...fields });
      const timers = partTimers.current;
      clearTimeout(timers.get(part.id));
      timers.set(
        part.id,
        setTimeout(() => cadApi.updatePart(projectId, part.id, fields).catch((e) => flash(`Not saved: ${e.message}`)), 500),
      );
    },
    [projectId, replacePart, flash],
  );

  // ── Assistant ───────────────────────────────────────────────────────────

  const onEvent = useCallback(
    (e: CadEvent) => {
      switch (e.type) {
        case 'planning':
          setPlan([{ id: '__plan', name: 'Planning parts…', status: 'running' }]);
          break;
        case 'plan':
          setPlan(e.parts.map((p) => ({ ...p, status: 'pending' })));
          setInterfaces(e.interfaces ?? null);
          break;
        case 'agent': {
          const label =
            e.action === 'build' ? `Building (${e.detail})` : e.action === 'view' ? 'Inspecting its render' : e.action === 'error' ? `Fixing: ${e.detail}` : 'Handing in';
          setPlan((rows) => rows.map((r) => (r.id === (e.plan_id ?? e.part_id) ? { ...r, detail: label } : r)));
          break;
        }
        case 'part_started':
          setPlan((rows) =>
            rows.length
              ? rows.map((r) => (r.id === (e.plan_id ?? e.part_id) ? { ...r, status: 'running' } : r))
              : [{ id: e.part_id!, name: selectedPart?.name ?? 'Part', status: 'running' }],
          );
          break;
        case 'part_retry':
          setPlan((rows) => rows.map((r) => (r.id === (e.plan_id ?? e.part_id) ? { ...r, attempt: e.attempt, error: e.error } : r)));
          break;
        case 'part_failed':
          setPlan((rows) => rows.map((r) => (r.id === e.plan_id ? { ...r, status: 'failed', error: e.error.split('\n')[0] } : r)));
          break;
        case 'part_done':
          setPlan((rows) => rows.map((r) => (r.id === (e.plan_id ?? e.part_id) ? { ...r, status: 'done', error: undefined } : r)));
          replacePart(e.part);
          if (e.instances?.length) {
            setState((s) => (s ? { ...s, assembly: { ...s.assembly, instances: [...s.assembly.instances, ...e.instances!] } } : s));
          }
          break;
        case 'state':
        case 'complete':
          setState(e.state);
          resetUndo();
          break;
        case 'message':
          setLog((l) => (l.some((x) => x.id === e.message.id) ? l : [...l, toEntry(e.message)]));
          break;
        case 'reviewing':
          setPlan((rows) => [
            ...rows,
            { id: `__review${e.round}`, name: e.round > 1 ? `Reviewing again (${e.round})` : 'Reviewing the result', status: 'running' },
          ]);
          break;
        case 'review':
          setPlan((rows) =>
            rows.map((r) =>
              r.id === `__review${e.round}`
                ? {
                    ...r,
                    status: 'done',
                    name: e.note ?? (e.ok ? 'Review: looks right' : `Review: fixed ${e.fixed} issue${e.fixed === 1 ? '' : 's'}`),
                  }
                : r,
            ),
          );
          break;
      }
    },
    [replacePart, resetUndo, selectedPart?.name],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !projectId) return;
    setInput('');
    setBusy(true);
    setPlan([]);
    setInterfaces(null);
    const controller = new AbortController();
    abort.current = controller;
    // The server saves and sends the conversation messages (user prompt,
    // result, review findings, errors) as `message` events.
    try {
      if (selectedPart) {
        const { start: _s, count: _c, ...faceRef } = face ?? ({} as FaceInfo);
        await cadApi.edit(projectId, selectedPart.id, text, face ? faceRef : null, onEvent, controller.signal);
      } else {
        await cadApi.generate(projectId, text, onEvent, controller.signal);
        setTimeout(() => viewport.current?.fit(), 300);
      }
      if (tab === 'history') refreshHistory();
    } catch (e: any) {
      if (e?.name !== 'AbortError') say('error', e?.message || 'Request failed');
      else say('assistant', 'Stopped.');
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }, [input, busy, projectId, face, selectedPart, onEvent, say, tab, refreshHistory]);

  // ── Part actions ────────────────────────────────────────────────────────

  const withWork = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setWorking(label);
      try {
        await fn();
      } catch (e: any) {
        flash(e?.message || `${label} failed`);
      } finally {
        setWorking(null);
      }
    },
    [flash],
  );

  const addInstance = (part: CadPart, at?: Vec3) => {
    const offset = (part.version?.bbox?.size?.[0] ?? 50) + 10;
    const count = instances.filter((i) => i.part_id === part.id).length;
    const inst: CadInstance = {
      id: uid() + uid(),
      part_id: part.id,
      name: count ? `${part.name} ${count + 1}` : part.name,
      position: at ?? [count * offset, 0, 0],
      rotation: [0, 0, 0],
      color: null,
      visible: true,
    };
    updateAssembly((list) => [...list, inst]);
    setSelectedId(inst.id);
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      await withWork(`Importing ${file.name}`, async () => {
        const { part, instance } = await cadApi.importFile(projectId, file);
        replacePart(part);
        setState((s) => (s ? { ...s, assembly: { ...s.assembly, instances: [...s.assembly.instances, instance] } } : s));
        setSelectedId(instance.id);
        setTimeout(() => viewport.current?.fit(), 300);
      });
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const runExport = (format: ExportFormat) => {
    setExportOpen(false);
    void withWork('Exporting', async () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (state) await cadApi.saveAssembly(projectId, state.assembly);
      }
      const { blob, name } = await cadApi.export(projectId, format);
      download(blob, name);
    });
  };

  // ── Keyboard ────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return; // keep the fields' own undo
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        stepHistory(e.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        stepHistory('redo');
        return;
      }
      if (mod) return;
      if (e.key === 'Escape') {
        if (face) setFace(null);
        else setSelectedId(null);
      } else if (e.key === 'g' || e.key === 'w') setMode('translate');
      else if (e.key === 'r' || e.key === 'e') setMode('rotate');
      else if (e.key === 'f') viewport.current?.fit();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        updateAssembly((list) => list.filter((i) => i.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [face, selectedId, updateAssembly, stepHistory]);

  if (loadError) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 bg-black text-white/70 text-sm">
        <p>{loadError}</p>
        <Link href="/dashboard" className="text-white underline underline-offset-4">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-black text-white font-sans">
      <header className="h-11 border-b border-white/[0.06] flex items-center gap-3 px-3 shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2 group">
          <img src="/cubot.svg" alt="CuBot" className="w-7 h-7 object-contain" />
          <span className="text-sm font-semibold text-white/80 group-hover:text-white">CuBot</span>
        </Link>
        <span className="text-white/15">/</span>
        <span className="text-[11px] font-mono text-white/35">CAD Studio</span>
        <span className="text-white/15">/</span>
        <input
          value={state?.assembly.name ?? ''}
          onChange={(e) => updateAssembly((l) => l, e.target.value, 'assembly-name')}
          className="bg-transparent text-[12.5px] text-white/80 focus:outline-none border-b border-transparent focus:border-white/20 w-56"
          placeholder="Assembly"
        />

        <div className="ml-auto flex items-center gap-1.5">
          {working && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-white/45 mr-2">
              <Loader2 size={11} className="animate-spin" /> {working}…
            </span>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={IMPORT_ACCEPT}
            className="hidden"
            onChange={(e) => importFiles(e.target.files)}
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11.5px] text-white/70 hover:text-white hover:bg-white/[0.06]"
          >
            <Upload size={12} /> Import
          </button>
          <div className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              disabled={!instances.length}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white text-black text-[11.5px] font-medium disabled:opacity-30"
            >
              <Download size={12} /> Export <ChevronDown size={11} />
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-9 z-30 w-60 rounded-md border border-white/[0.1] bg-[#0e0e0e] shadow-xl py-1">
                  {EXPORTS.map((x) => (
                    <button
                      key={x.format}
                      onClick={() => runExport(x.format)}
                      className="w-full text-left px-3 py-1.5 hover:bg-white/[0.06]"
                    >
                      <span className="block text-[12px] text-white/85">{x.label}</span>
                      <span className="block text-[10.5px] text-white/35">{x.hint}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <Link href="/dashboard" className="p-1.5 rounded-md text-white/35 hover:text-white hover:bg-white/[0.06]" title="Dashboard">
            <Home size={13} />
          </Link>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <aside className="w-[300px] shrink-0 border-r border-white/[0.06] flex flex-col min-h-0 bg-[#070707]">
          <div className="flex border-b border-white/[0.06] text-[11px]">
            {(['assistant', 'parts', 'history'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 capitalize ${tab === t ? 'text-white border-b border-white' : 'text-white/40 hover:text-white/70'}`}
              >
                {t === 'parts' ? `Parts (${parts.length})` : t === 'history' ? 'History' : 'Assistant'}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0">
            {tab === 'assistant' ? (
              <AssistantPanel
                interfaces={interfaces}
                input={input}
                busy={busy}
                editTarget={selectedPart ? { name: selectedPart.name } : null}
                face={face}
                plan={plan}
                log={log}
                onInput={setInput}
                onSend={send}
                onStop={() => abort.current?.abort()}
                onClearFace={() => setFace(null)}
              />
            ) : tab === 'history' ? (
              <HistoryPanel
                snapshots={snapshots}
                trash={trash}
                busy={busy || !!working}
                onSave={async (label) => {
                  try {
                    const snap = await cadApi.saveSnapshot(projectId, label);
                    setSnapshots((list) => [snap, ...(list ?? [])]);
                  } catch (e: any) {
                    flash(e?.message || 'Could not save');
                  }
                }}
                onRestore={(snap) =>
                  withWork('Restoring', async () => {
                    if (saveTimer.current) {
                      clearTimeout(saveTimer.current);
                      if (stateRef.current) await cadApi.saveAssembly(projectId, stateRef.current.assembly);
                    }
                    setState(await cadApi.restoreSnapshot(projectId, snap.id));
                    resetUndo();
                    setSelectedId(null);
                    refreshHistory();
                    flash(`Restored “${snap.label}”. The previous state was saved as a snapshot.`);
                  })
                }
                onDelete={(snap) =>
                  withWork('Deleting snapshot', async () => {
                    await cadApi.deleteSnapshot(projectId, snap.id);
                    setSnapshots((list) => (list ?? []).filter((x) => x.id !== snap.id));
                  })
                }
                onRestorePart={(p) =>
                  withWork('Restoring part', async () => {
                    const { part, instances: copies } = await cadApi.restorePart(projectId, p.id);
                    setState((s) =>
                      s
                        ? {
                            parts: [...s.parts, part],
                            assembly: { ...s.assembly, instances: [...s.assembly.instances, ...copies] },
                          }
                        : s,
                    );
                    resetUndo();
                    refreshHistory();
                  })
                }
              />
            ) : (
              <PartsPanel
                parts={parts}
                instances={instances}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setFace(null);
                }}
                onAddInstance={(p) => addInstance(p)}
                onDuplicatePart={(p) =>
                  withWork('Duplicating', async () => {
                    const copy = await cadApi.duplicate(projectId, p.id);
                    replacePart(copy);
                    addInstance(copy);
                  })
                }
                onDeletePart={(p) =>
                  withWork('Deleting', async () => {
                    await cadApi.deletePart(projectId, p.id);
                    setState((s) =>
                      s
                        ? {
                            parts: s.parts.filter((x) => x.id !== p.id),
                            assembly: { ...s.assembly, instances: s.assembly.instances.filter((i) => i.part_id !== p.id) },
                          }
                        : s,
                    );
                    if (selected?.part_id === p.id) setSelectedId(null);
                    resetUndo();
                    flash(`Deleted ${p.name}. Restore it from History for 30 days.`);
                  })
                }
                onToggleVisible={(i) => patchInstance(i.id, { visible: !i.visible })}
                onRemoveInstance={(i) => {
                  updateAssembly((list) => list.filter((x) => x.id !== i.id));
                  if (selectedId === i.id) setSelectedId(null);
                }}
                onImport={() => fileInput.current?.click()}
              />
            )}
          </div>
        </aside>

        <main className="flex-1 min-w-0 relative">
          {state ? (
            <StudioViewport
              controlRef={viewport}
              parts={parts}
              instances={instances}
              selectedId={selectedId}
              face={face}
              mode={mode}
              snap={snap}
              onSelect={(id) => {
                setSelectedId(id);
                if (!id) setFace(null);
              }}
              onFace={setFace}
              onTransform={(id, position, rotation) => patchInstance(id, { position, rotation })}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-white/30">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}

          <div className="absolute top-3 left-3 flex gap-1 rounded-md border border-white/[0.08] bg-black/70 backdrop-blur p-1">
            {[
              { id: 'translate', icon: Move3d, title: 'Move (G)' },
              { id: 'rotate', icon: Rotate3d, title: 'Rotate (R)' },
            ].map(({ id, icon: Icon, title }) => (
              <button
                key={id}
                onClick={() => setMode(id as TransformMode)}
                title={title}
                className={`p-1.5 rounded ${mode === id ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white'}`}
              >
                <Icon size={14} />
              </button>
            ))}
            <span className="w-px bg-white/10 mx-0.5" />
            <button
              onClick={() => setSnap((v) => !v)}
              title={snap ? 'Snapping on (5 mm, 15°)' : 'Snapping off'}
              className={`p-1.5 rounded ${snap ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white'}`}
            >
              <Magnet size={14} />
            </button>
            <button onClick={() => viewport.current?.fit()} title="Frame all (F)" className="p-1.5 rounded text-white/45 hover:text-white">
              <Maximize size={14} />
            </button>
            <span className="w-px bg-white/10 mx-0.5" />
            <button
              onClick={() => stepHistory('undo')}
              disabled={!undoDepth.past}
              title="Undo (⌘Z)"
              className="p-1.5 rounded text-white/45 hover:text-white disabled:opacity-25"
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={() => stepHistory('redo')}
              disabled={!undoDepth.future}
              title="Redo (⇧⌘Z)"
              className="p-1.5 rounded text-white/45 hover:text-white disabled:opacity-25"
            >
              <Redo2 size={14} />
            </button>
          </div>

          {state && instances.length === 0 && !busy && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-[13px] text-white/50">Empty assembly</p>
                <p className="text-[11.5px] text-white/30 mt-1">Describe a part in the assistant, or import STEP / STL / DXF.</p>
              </div>
            </div>
          )}

          {toast && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded-md border border-white/10 bg-[#111] text-[12px] text-white/80 shadow-lg">
              {toast}
            </div>
          )}
        </main>

        {selected && selectedPart && (
          <aside className="w-[290px] shrink-0 border-l border-white/[0.06] bg-[#070707] min-h-0">
            <InspectorPanel
              instance={selected}
              part={selectedPart}
              face={face}
              busy={busy || !!working}
              versions={versions}
              onInstance={(patch) =>
                // Typing a name or dragging the colour picker is one undo step.
                patchInstance(selected.id, patch, 'name' in patch || 'color' in patch ? `${Object.keys(patch)[0]}:${selected.id}` : undefined)
              }
              onDropToGround={() => {
                const dz = viewport.current?.dropToGround(selected.id);
                if (dz != null && Math.abs(dz) > 1e-6) {
                  const [x, y, z] = selected.position;
                  patchInstance(selected.id, { position: [x, y, Math.round((z + dz) * 1000) / 1000] });
                }
              }}
              onPart={(fields) => patchPart(selectedPart, fields)}
              onParams={async (params) => {
                setWorking('Rebuilding');
                try {
                  replacePart(await cadApi.setParams(projectId, selectedPart.id, params));
                } finally {
                  setWorking(null);
                }
              }}
              onCode={async (code) => {
                setWorking('Building');
                try {
                  replacePart(await cadApi.setCode(projectId, selectedPart.id, code));
                } finally {
                  setWorking(null);
                }
              }}
              onLoadVersions={() => cadApi.versions(projectId, selectedPart.id).then(setVersions).catch(() => setVersions([]))}
              onRevert={(v) =>
                withWork('Reverting', async () => {
                  replacePart(await cadApi.revert(projectId, selectedPart.id, v.id));
                })
              }
              onDownload={(name) =>
                selectedPart.version &&
                withWork('Downloading', async () => {
                  const blob = await cadApi.partFile(selectedPart.version!.key, name);
                  download(blob, `${selectedPart.name.replace(/[^\w-]+/g, '_')}.${name.split('.')[1]}`);
                })
              }
            />
          </aside>
        )}
      </div>
    </div>
  );
}
