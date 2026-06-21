import { Archive, ChevronRight, Database, Video } from 'lucide-react';
import { AppSettings, Episode } from '../types';
import { TabId } from '../components/TabBar';
import { APP_VERSION_LABEL, UNITY_VERSION_LABEL } from '../version';

interface HomePageProps {
  episodes: Episode[];
  settings: AppSettings;
  onNavigate(tab: TabId): void;
}

const assetPath = `${import.meta.env.BASE_URL}illustrations/mechanism_overview.png`;

export function HomePage({ episodes, settings, onNavigate }: HomePageProps) {
  return (
    <div className="page-stack home-page">
      <section className="home-hero">
        <div className="home-hero__header">
          <div className="home-meta-row">
            <span className="soft-pill">Mechanism</span>
            <span className="soft-pill">App {APP_VERSION_LABEL}</span>
            <span className="soft-pill">Unity {UNITY_VERSION_LABEL}</span>
          </div>
          <h2>Capture. Encode. Replay.</h2>
          <p>Capture regret. Replay it at temptation.</p>
        </div>
        <div className="mechanism-frame" aria-label="Mechanism overview">
          <img src={assetPath} alt="Mechanism overview" />
        </div>
      </section>

      <section className="home-actions" aria-label="Primary actions">
        <button className="home-action is-primary" type="button" onClick={() => onNavigate('capture')}>
          <span>
            <Video size={19} aria-hidden="true" />
            Capture
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <button className="home-action" type="button" onClick={() => onNavigate('archive')}>
          <span>
            <Archive size={19} aria-hidden="true" />
            Archive
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </section>

      <section className="flow-strip" aria-label="Study flow">
        <div>
          <span>01</span>
          <strong>Capture</strong>
        </div>
        <div>
          <span>02</span>
          <strong>Encode</strong>
        </div>
        <div>
          <span>03</span>
          <strong>Replay</strong>
        </div>
      </section>

      <section className="home-status">
        <div className="status-tile">
          <Database size={18} aria-hidden="true" />
          <span>{episodes.length}</span>
          <small>Episodes</small>
        </div>
        <div className="status-tile">
          <span className="treat-dot" aria-hidden="true" />
          <span>{settings.treats}</span>
          <small>Treats</small>
        </div>
        <div className="study-card">
          <small>Study Mode</small>
          <strong>{settings.rewardEnabled ? 'Reward' : 'Baseline'}</strong>
          <span className={`condition-pill ${settings.rewardEnabled ? 'is-reward' : ''}`}>
            {settings.rewardEnabled ? 'ON' : 'OFF'}
          </span>
        </div>
      </section>
    </div>
  );
}
