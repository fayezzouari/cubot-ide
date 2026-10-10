'use client';

import { useState } from 'react';
import { Factory, GraduationCap } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TEMPLATES, type Template } from '@/lib/blocks/templates';

export function TemplateGallery({
  open,
  onOpenChange,
  onLoad,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoad: (t: Template) => void;
}) {
  const [audience, setAudience] = useState<Template['audience']>('industry');
  const list = TEMPLATES.filter((t) => t.audience === audience);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden border-white/10 bg-[#0c0c0d] p-0 text-white">
        <DialogHeader className="border-b border-white/[0.08] px-6 pb-4 pt-5">
          <DialogTitle>Start from a use case</DialogTitle>
          <DialogDescription className="text-white/50">
            Each template is a complete, runnable program for the simulated cell. Loading one replaces the current
            canvas, poses, scene and environment.
          </DialogDescription>
          <div className="flex gap-1 pt-3">
            {(
              [
                ['industry', 'Industry', Factory],
                ['education', 'Education', GraduationCap],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setAudience(id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs ${audience === id ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'}`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        </DialogHeader>
        <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-6 md:grid-cols-2">
          {list.map((t) => (
            <div key={t.id} className="flex flex-col rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">{t.sector}</div>
              <div className="mt-1 text-sm font-semibold">{t.title}</div>
              <p className="mt-1.5 text-xs leading-relaxed text-white/55">{t.summary}</p>
              <ul className="mt-3 space-y-1">
                {t.highlights.map((h) => (
                  <li key={h} className="flex gap-2 text-[11px] text-white/65">
                    <span className="text-emerald-400">•</span>
                    {h}
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-l-2 border-white/10 pl-2 text-[11px] italic leading-relaxed text-white/40">{t.context}</p>
              <div className="mt-auto pt-4">
                <Button size="sm" className="h-7 text-xs" onClick={() => onLoad(t)}>
                  Load template
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
