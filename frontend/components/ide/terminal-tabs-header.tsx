import { X, Plus, Split } from 'lucide-react';

interface TerminalTabsHeaderProps {
  tabs: { id: string; title: string }[];
  activeTabId: string;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: () => void;
  onSplit: () => void;
  rightSlot?: React.ReactNode;
}

export default function TerminalTabsHeader({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  onSplit,
  rightSlot,
}: TerminalTabsHeaderProps) {
  return (
    <div className="flex items-center bg-black border-b border-white/[0.06] h-8 min-w-0 flex-shrink-0">
      <div className="flex items-center flex-1 min-w-0 overflow-x-auto">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`flex items-center px-3 h-full cursor-pointer text-[11px] font-mono border-r border-white/[0.06] shrink-0 transition-colors ${
              tab.id === activeTabId
                ? 'bg-[#0e0e0e] text-white/70'
                : 'text-white/30 hover:text-white/50 hover:bg-white/[0.03]'
            }`}
            onClick={() => onTabClick(tab.id)}
          >
            <span>{tab.title}</span>
            <button
              type="button"
              className="ml-2 flex items-center text-white/20 hover:text-red-400/70 transition-colors cursor-pointer"
              onClick={e => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
              title="Close terminal"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ml-1 px-2 h-full flex items-center text-white/25 hover:text-white/60 hover:bg-white/[0.04] transition-colors cursor-pointer"
          onClick={onNewTab}
          title="New Terminal Tab"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          className="px-2 h-full flex items-center text-white/25 hover:text-white/60 hover:bg-white/[0.04] transition-colors cursor-pointer"
          onClick={onSplit}
          title="Split Terminal"
        >
          <Split size={13} />
        </button>
      </div>
      {rightSlot && (
        <div className="flex items-center gap-1 px-2 border-l border-white/[0.06] h-full flex-shrink-0">
          {rightSlot}
        </div>
      )}
    </div>
  );
}
