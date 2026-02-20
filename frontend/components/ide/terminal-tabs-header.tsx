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
    <div className="flex items-center bg-[#252526] border-b border-[#2d2d2d] h-8 min-w-0">
      <div className="flex items-center flex-1 min-w-0 overflow-x-auto">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`flex items-center px-3 h-full cursor-pointer text-xs font-mono border-r border-[#2d2d2d] shrink-0 ${
              tab.id === activeTabId ? 'bg-[#1e1e1e] text-white' : 'text-[#cccccc] hover:bg-[#23272e]'
            }`}
            onClick={() => onTabClick(tab.id)}
          >
            <span>{tab.title}</span>
            <button
              type="button"
              className="ml-2 flex items-center text-[#858585] hover:text-[#f48771]"
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
          className="ml-2 px-2 h-full flex items-center text-[#cccccc] hover:text-white hover:bg-[#23272e]"
          onClick={onNewTab}
          title="New Terminal Tab"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className="ml-1 px-2 h-full flex items-center text-[#cccccc] hover:text-white hover:bg-[#23272e]"
          onClick={onSplit}
          title="Split Terminal"
        >
          <Split size={14} />
        </button>
      </div>
      {rightSlot && (
        <div className="flex items-center gap-1 px-2 border-l border-[#2d2d2d] h-full flex-shrink-0">
          {rightSlot}
        </div>
      )}
    </div>
  );
}
