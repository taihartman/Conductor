import React from 'react';

export type DetailTab = 'feed' | 'tools' | 'tokens';

interface DetailTabsProps {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'feed', label: 'Feed' },
  { id: 'tools', label: 'Tools' },
  { id: 'tokens', label: 'Tokens' },
];

export function DetailTabs({ activeTab, onTabChange }: DetailTabsProps): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        gap: '1px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        flexShrink: 0,
      }}
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          style={{
            padding: '4px 12px',
            fontSize: '11px',
            fontWeight: activeTab === tab.id ? 600 : 400,
            color: activeTab === tab.id ? 'var(--fg-primary)' : 'var(--fg-muted)',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
