import { useState } from 'react';
import SandboxTerminal from './sandbox-terminal';
import TerminalTabsHeader from './terminal-tabs-header';

export default function TerminalTabsManager({ workspaceId, onWorkspaceCreate, onSyncComplete }) {
  const [tabs, setTabs] = useState([
    { id: 'terminal-1', title: 'Terminal 1' }
  ]);
  const [activeTabId, setActiveTabId] = useState('terminal-1');
  const [splits, setSplits] = useState([]); // array of tab ids for split view

  const handleNewTab = () => {
    const newId = `terminal-${tabs.length + 1}`;
    setTabs([...tabs, { id: newId, title: `Terminal ${tabs.length + 1}` }]);
    setActiveTabId(newId);
  };

  const handleTabClick = (id) => setActiveTabId(id);
  const handleTabClose = (id) => {
    const idx = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id && newTabs.length > 0) {
      setActiveTabId(newTabs[Math.max(0, idx - 1)].id);
    }
  };

  const handleSplit = () => {
    if (!splits.includes(activeTabId)) {
      setSplits([...splits, activeTabId]);
    }
  };

  const handleUnsplit = (id) => {
    setSplits(splits.filter(s => s !== id));
  };

  return (
    <div className="h-full flex flex-col">
      <TerminalTabsHeader
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onNewTab={handleNewTab}
        onSplit={handleSplit}
      />
      <div className={`flex-1 flex ${splits.length > 0 ? 'gap-2' : ''}`}>
        <div className="flex-1 min-w-0">
          <SandboxTerminal
            key={activeTabId}
            workspaceId={workspaceId}
            onWorkspaceCreate={onWorkspaceCreate}
            onSyncComplete={onSyncComplete}
          />
        </div>
        {splits.map(splitId => (
          <div className="flex-1 min-w-0 border-l border-[#2d2d2d] relative" key={splitId}>
            <button
              className="absolute top-1 right-2 z-10 text-xs text-[#cccccc] hover:text-[#f48771]"
              onClick={() => handleUnsplit(splitId)}
              title="Close Split"
            >
              ×
            </button>
            <SandboxTerminal
              key={splitId}
              workspaceId={workspaceId}
              onWorkspaceCreate={onWorkspaceCreate}
              onSyncComplete={onSyncComplete}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
