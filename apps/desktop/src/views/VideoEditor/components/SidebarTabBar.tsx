/**
 * SidebarTabBar - Tab navigation for the video editor sidebar.
 */

export type PropertiesTab = 'style' | 'audio' | 'background' | 'captions';

export interface SidebarTabBarProps {
  activeTab: PropertiesTab;
  onTabChange: (tab: PropertiesTab) => void;
}

interface TabConfig {
  id: PropertiesTab;
  label: string;
}

const TABS: readonly TabConfig[] = [
  { id: 'style', label: 'Style' },
  { id: 'audio', label: 'Audio' },
  { id: 'background', label: 'Background' },
  { id: 'captions', label: 'Captions' },
];

export function SidebarTabBar({ activeTab, onTabChange }: SidebarTabBarProps) {
  const getTabClassName = (isActive: boolean) =>
    `video-sidebar-tab min-w-0 px-2 text-[12px] font-medium ${
      isActive ? 'video-sidebar-tab--active' : ''
    }`;

  return (
    <div className="video-sidebar-tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={getTabClassName(activeTab === tab.id)}
        >
          <span className="min-w-0 truncate">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
