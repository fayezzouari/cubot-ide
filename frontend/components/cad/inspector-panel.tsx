'use client';

import { useEffect, useState } from 'react';
import { ArrowDownToLine, Code2, Download, History, Loader2, RotateCcw } from 'lucide-react';
import type { CadInstance, CadParam, CadPart, CadVersion, FaceInfo, Vec3 } from '@/lib/api/cad';

interface Props {
  instance: CadInstance;
  part: CadPart;
  face: FaceInfo | null;
  busy: boolean;
  versions: CadVersion[] | null;
  onInstance: (patch: Partial<CadInstance>) => void;
  onDropToGround: () => void;
  onPart: (fields: { name?: string; color?: string }) => void;
  onParams: (params: Record<string, number | boolean>) => Promise<void>;
  onCode: (code: string) => Promise<void>;
  onLoadVersions: () => void;
  onRevert: (version: CadVersion) => void;
  onDownload: (name: 'part.step' | 'part.stl') => void;
}

const label = (name: string) => name.replace(/_/g, ' ');

function NumberField({
  value,
  onCommit,
  step = 1,
  suffix,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <label className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.07] rounded px-1.5 focus-within:border-white/25">
      <input
        value={text}
        inputMode="decimal"
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setText(String(value));
        }}
        className="w-full min-w-0 bg-transparent py-1 text-[11.5px] font-mono text-white/85 focus:outline-none"
      />
      {suffix && <span className="text-[9.5px] text-white/30">{suffix}</span>}
    </label>
  );
}

function Vec3Row({ title, value, suffix, onCommit }: { title: string; value: Vec3; suffix: string; onCommit: (v: Vec3) => void }) {
  return (
    <div>
      <p className="text-[10px] text-white/40 mb-1">{title}</p>
      <div className="grid grid-cols-3 gap-1">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <div key={axis} className="relative">
            <span className="absolute -top-0 left-1 text-[8px] text-white/25">{axis}</span>
            <NumberField
              value={value[i]}
              suffix={suffix}
              onCommit={(v) => {
                const next = [...value] as Vec3;
                next[i] = v;
                onCommit(next);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InspectorPanel({
  instance,
  part,
  face,
  busy,
  versions,
  onInstance,
  onDropToGround,
  onPart,
  onParams,
  onCode,
  onLoadVersions,
  onRevert,
  onDownload,
}: Props) {
  const version = part.version;
  const params = Object.entries(version?.params ?? {}) as [string, CadParam][];
  const [draft, setDraft] = useState<Record<string, number | boolean>>({});
  const [applying, setApplying] = useState(false);
  const [paramError, setParamError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState(version?.code ?? '');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setDraft({});
    setParamError(null);
    setCode(version?.code ?? '');
    setCodeError(null);
  }, [version?.id, version?.code]);

  const dirty = Object.keys(draft).length > 0;
  const applyParams = async () => {
    setApplying(true);
    setParamError(null);
    try {
      await onParams(draft);
      setDraft({});
    } catch (e: any) {
      setParamError(e?.message || 'Could not apply');
    } finally {
      setApplying(false);
    }
  };

  const size = version?.bbox?.size;

  return (
    <div className="h-full min-h-0 overflow-y-auto text-white/80">
      <section className="p-3 space-y-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={instance.color || part.color}
            onChange={(e) => onInstance({ color: e.target.value })}
            className="w-5 h-5 bg-transparent border-0 p-0 cursor-pointer"
            title="Colour of this copy"
          />
          <input
            value={instance.name}
            onChange={(e) => onInstance({ name: e.target.value })}
            className="flex-1 min-w-0 bg-transparent text-[13px] font-medium focus:outline-none border-b border-transparent focus:border-white/20"
          />
        </div>
        <Vec3Row title="Position" value={instance.position} suffix="mm" onCommit={(position) => onInstance({ position })} />
        <Vec3Row title="Rotation" value={instance.rotation} suffix="°" onCommit={(rotation) => onInstance({ rotation })} />
        <button
          onClick={onDropToGround}
          className="inline-flex items-center gap-1 text-[10.5px] text-white/50 hover:text-white"
        >
          <ArrowDownToLine size={11} /> Rest on ground
        </button>
      </section>

      <section className="p-3 space-y-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] uppercase tracking-wider text-white/40">Part</h3>
          <span className="ml-auto text-[10px] font-mono text-white/30">
            v{version?.number} · {part.kind === 'mesh' ? 'mesh' : 'solid'}
          </span>
        </div>
        <input
          value={part.name}
          onChange={(e) => onPart({ name: e.target.value })}
          className="w-full bg-white/[0.04] border border-white/[0.07] rounded px-2 py-1 text-[11.5px] focus:outline-none focus:border-white/25"
        />
        {size && (
          <p className="text-[10.5px] font-mono text-white/40">
            {size.map((n) => n.toFixed(1)).join(' × ')} mm
            {version?.volume ? ` · ${(version.volume / 1000).toFixed(1)} cm³` : ''}
            {version?.valid === false && <span className="text-amber-300/80"> · not watertight</span>}
          </p>
        )}
        {face && (
          <p className="text-[10.5px] text-amber-300/80">
            Face {face.id}: {face.type.toLowerCase()}, {face.area.toFixed(1)} mm², at ({face.center.map((v) => v.toFixed(1)).join(', ')})
          </p>
        )}
      </section>

      {params.length > 0 && (
        <section className="p-3 space-y-1.5 border-b border-white/[0.06]">
          <h3 className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Parameters</h3>
          {params.map(([name, p]) => {
            const value = draft[name] ?? p.value;
            return (
              <div key={name} className="grid grid-cols-[1fr_96px] items-center gap-2">
                <span className="text-[11px] text-white/60 truncate" title={name}>
                  {label(name)}
                </span>
                {typeof p.default === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.checked }))}
                  />
                ) : (
                  <NumberField
                    value={Number(value)}
                    suffix={p.unit === 'mm' ? 'mm' : p.unit}
                    onCommit={(v) => setDraft((d) => ({ ...d, [name]: v }))}
                  />
                )}
              </div>
            );
          })}
          {paramError && <p className="text-[10.5px] text-red-300/80">{paramError}</p>}
          {dirty && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={applyParams}
                disabled={applying || busy}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white text-black text-[11px] font-medium disabled:opacity-40"
              >
                {applying && <Loader2 size={11} className="animate-spin" />} Rebuild
              </button>
              <button onClick={() => setDraft({})} className="px-2 py-1 text-[11px] text-white/50 hover:text-white">
                Reset
              </button>
            </div>
          )}
        </section>
      )}

      <section className="p-3 space-y-2 border-b border-white/[0.06]">
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10.5px]">
          <button
            onClick={() => {
              setShowHistory((v) => !v);
              if (!showHistory) onLoadVersions();
            }}
            className="inline-flex items-center gap-1 text-white/50 hover:text-white"
          >
            <History size={11} /> History
          </button>
          <button onClick={() => setShowCode((v) => !v)} className="inline-flex items-center gap-1 text-white/50 hover:text-white">
            <Code2 size={11} /> Code
          </button>
          <button onClick={() => onDownload('part.step')} className="inline-flex items-center gap-1 text-white/50 hover:text-white">
            <Download size={11} /> STEP
          </button>
          <button onClick={() => onDownload('part.stl')} className="inline-flex items-center gap-1 text-white/50 hover:text-white">
            <Download size={11} /> STL
          </button>
        </div>

        {showHistory && (
          <div className="space-y-px">
            {!versions && <Loader2 size={12} className="animate-spin text-white/30" />}
            {versions?.map((v) => (
              <div
                key={v.id}
                className={`flex items-start gap-2 px-1.5 py-1 rounded ${v.id === version?.id ? 'bg-white/[0.05]' : ''}`}
              >
                <span className="text-[10px] font-mono text-white/35 mt-px">v{v.number}</span>
                <span className="text-[10.5px] text-white/60 flex-1 line-clamp-2">{v.prompt || '—'}</span>
                {v.id !== version?.id && (
                  <button onClick={() => onRevert(v)} title="Use this version" className="text-white/35 hover:text-white">
                    <RotateCcw size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {showCode && (
          <div className="space-y-1.5">
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              rows={14}
              className="w-full bg-black border border-white/[0.08] rounded p-2 text-[10.5px] font-mono text-white/75 leading-relaxed focus:outline-none focus:border-white/25"
            />
            {codeError && <p className="text-[10.5px] text-red-300/80 font-mono whitespace-pre-wrap">{codeError}</p>}
            {code !== (version?.code ?? '') && (
              <button
                disabled={busy}
                onClick={async () => {
                  setCodeError(null);
                  try {
                    await onCode(code);
                  } catch (e: any) {
                    setCodeError(e?.message || 'Build failed');
                  }
                }}
                className="px-2.5 py-1 rounded bg-white text-black text-[11px] font-medium disabled:opacity-40"
              >
                Build code
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
