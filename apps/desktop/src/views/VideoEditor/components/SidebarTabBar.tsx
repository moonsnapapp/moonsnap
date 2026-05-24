/**
 * SidebarTabBar - Tab navigation for the video editor sidebar.
 */

export type PropertiesTab = 'style' | 'background' | 'captions' | 'export';

export interface SidebarTabBarProps {
  activeTab: PropertiesTab;
  onTabChange: (tab: PropertiesTab) => void;
  showStyleTab?: boolean;
}

interface TabConfig {
  id: PropertiesTab;
  label: string;
  condition?: boolean;
}

export function SidebarTabBar({ activeTab, onTabChange, showStyleTab = true }: SidebarTabBarProps) {
  const tabs: TabConfig[] = [
    { id: 'style', label: 'Style', condition: showStyleTab },
    { id: 'background', label: 'Background' },
    { id: 'captions', label: 'Captions' },
    { id: 'export', label: 'Export' },
  ];

  const getTabClassName = (isActive: boolean) =>
    `video-sidebar-tab min-w-0 px-2 text-[12px] font-medium ${
      isActive ? 'video-sidebar-tab--active' : ''
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
