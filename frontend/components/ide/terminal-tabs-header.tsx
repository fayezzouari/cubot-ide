import { useState } from 'react';
import { Plus, Split } from 'lucide-react';

interface TerminalTabsHeaderProps {
  tabs: { id: string; title: string }[];
  activeTabId: string;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: () => void;
  onSplit: () => void;
}

export default function TerminalTabsHeader({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  onSplit,
}: TerminalTabsHeaderProps) {
  return (
    <div className="flex items-center bg-[#252526] border-b border-[#2d2d2d] h-8">
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={`flex items-center px-3 h-full cursor-pointer text-xs font-mono border-r border-[#2d2d2d] ${
            tab.id === activeTabId ? 'bg-[#1e1e1e] text-white' : 'text-[#cccccc] hover:bg-[#23272e]'
          }`}
          onClick={() => onTabClick(tab.id)}
        >
          <span>{tab.title}</span>
          <button
            className="ml-2 text-[#858585] hover:text-[#f48771]"
            onClick={e => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
            title="Close terminal"
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="ml-2 px-2 h-full flex items-center text-[#cccccc] hover:text-white hover:bg-[#23272e]"
        onClick={onNewTab}
        title="New Terminal Tab"
      >
        <Plus size={14} />
      </button>
      <button
        className="ml-1 px-2 h-full flex items-center text-[#cccccc] hover:text-white hover:bg-[#23272e]"
        onClick={onSplit}
        title="Split Terminal"
      >
        <Split size={14} />
      </button>
    </div>
  );
}
