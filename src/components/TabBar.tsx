import { Archive, FlaskConical, Home, Settings, Video } from 'lucide-react';

export type TabId = 'home' | 'capture' | 'archive' | 'rig' | 'settings';

interface TabBarProps {
  active: TabId;
  onChange(tab: TabId): void;
}

const tabs = [
  { id: 'home' as const, label: 'Home', icon: Home },
  { id: 'capture' as const, label: 'Capture', icon: Video },
  { id: 'archive' as const, label: 'Archive', icon: Archive },
  { id: 'rig' as const, label: 'Rig', icon: FlaskConical },
  { id: 'settings' as const, label: 'Settings', icon: Settings }
];

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Main">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            className={`tab-bar__item ${active === tab.id ? 'is-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            <Icon aria-hidden="true" size={21} strokeWidth={2.2} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
