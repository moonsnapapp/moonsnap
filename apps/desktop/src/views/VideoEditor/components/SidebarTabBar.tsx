/**
 * SidebarTabBar - Tab navigation for the video editor sidebar.
 */

export type PropertiesTab = 'project' | 'background' | 'captions' | 'export';

export interface SidebarTabBarProps {
  activeTab: PropertiesTab;
  onTabChange: (tab: PropertiesTab) => void;
}

interface TabConfig {
  id: PropertiesTab;
  label: string;
  condition?: boolean;
}

export function SidebarTabBar({ activeTab, onTabChange }: SidebarTabBarProps) {
  const tabs: TabConfig[] = [
    { id: 'project', label: 'Project' },
    { id: 'background', label: 'Style' },
    { id: 'captions', label: 'Captions' },
    { id: 'export', label: 'Export' },
  ];

  const getTabClassName = (isActive: boolean) =>
    `video-sidebar-tab min-w-0 px-2 py-2 text-[11px] font-medium transition-colors ${
      isActive
        ? 'video-sidebar-tab--active text-[var(--ink-black)]'
        : 'text-[var(--ink-muted)] hover:text-[var(--ink-dark)]'
    }`;

  return (
    <div className="video-sidebar-tabs">
      {tabs.map((tab) => {
        // Skip tabs that have a condition that is false
        if (tab.condition === false) return null;

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={getTabClassName(activeTab === tab.id)}
          >
            <span className="min-w-0 truncate">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
