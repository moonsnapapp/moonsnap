/**
 * SidebarTabBar - Tab navigation for the video editor sidebar.
 */

export type PropertiesTab = 'project' | 'cursor' | 'webcam' | 'captions' | 'background' | 'export';

export interface SidebarTabBarProps {
  activeTab: PropertiesTab;
  onTabChange: (tab: PropertiesTab) => void;
  hasCursor: boolean;
  hasWebcam: boolean;
}

interface TabConfig {
  id: PropertiesTab;
  label: string;
  condition?: boolean;
}

export function SidebarTabBar({ activeTab, onTabChange, hasCursor, hasWebcam }: SidebarTabBarProps) {
  const tabs: TabConfig[] = [
    { id: 'project', label: 'Project' },
    { id: 'cursor', label: 'Cursor', condition: hasCursor },
    { id: 'webcam', label: 'Webcam', condition: hasWebcam },
    { id: 'captions', label: 'Captions' },
    { id: 'background', label: 'Style' },
    { id: 'export', label: 'Export' },
  ];

  const getTabClassName = (isActive: boolean) =>
    `flex-shrink-0 px-2.5 py-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
      isActive
        ? 'text-[var(--ink-black)] border-b-2 border-[var(--coral-400)] bg-[var(--coral-50)]'
        : 'text-[var(--ink-muted)] hover:text-[var(--ink-dark)] hover:bg-[var(--glass-highlight)]'
    }`;

  return (
    <div className="flex overflow-x-auto border-b border-[var(--glass-border)] scrollbar-none">
      {tabs.map((tab) => {
        // Skip tabs that have a condition that is false
        if (tab.condition === false) return null;

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={getTabClassName(activeTab === tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
