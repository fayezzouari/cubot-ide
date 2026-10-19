'use client';

import { Plus, Tags, Trash2 } from 'lucide-react';
import type { Category } from '@/lib/fleet/types';
import type { CategoryCreate, CategoryUpdate } from '@/lib/api/fleet';
import { ENTITY_PALETTE } from '@/lib/fleet/constants';
import { EmptyHint, PanelShell } from './PanelShell';
import { chipBtnCls, iconBtnCls } from './theme';

interface Props {
  categories: Category[];
  onAdd: (body: CategoryCreate) => Promise<void>;
  onEdit: (id: string, body: CategoryUpdate) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function CategoriesPanel({ categories, onAdd, onEdit, onDelete }: Props) {
  const add = () =>
    void onAdd({
      name: `Category ${categories.length + 1}`,
      color: ENTITY_PALETTE[categories.length % ENTITY_PALETTE.length],
    });

  return (
    <PanelShell
      title="Categories"
      icon={<Tags size={12} />}
      actions={
        <button onClick={add} className={chipBtnCls} title="Add category">
          <Plus size={11} /> <span className="@max-[220px]:hidden">Add</span>
        </button>
      }
    >
      {categories.length === 0 ? (
        <EmptyHint>No categories yet. Add one to specialise robots and tasks.</EmptyHint>
      ) : (
        <ul>
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-2.5 last:border-0 hover:bg-white/[0.02]">
              <input
                type="color"
                value={c.color}
                onChange={(e) => void onEdit(c.id, { color: e.target.value })}
                className="h-4 w-4 cursor-pointer rounded-full border-0 bg-transparent p-0"
                title="Colour"
              />
              <input
                key={`${c.id}-${c.name}`}
                defaultValue={c.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== c.name) void onEdit(c.id, { name: v });
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-white/85 outline-none"
              />
              <button onClick={() => void onDelete(c.id)} className={`${iconBtnCls} hover:text-red-400`} aria-label="Delete category">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
