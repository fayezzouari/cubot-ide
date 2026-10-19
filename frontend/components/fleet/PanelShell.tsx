'use client';

import type { ReactNode } from 'react';

export function PanelShell({ title, icon, actions, children }: { title: string; icon: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="@container flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
          {icon}
          {title}
        </span>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="px-3 py-4 text-[11px] text-white/30">{children}</p>;
}
