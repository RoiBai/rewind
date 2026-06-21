import { Archive, ChevronRight, Clock, Database, Video } from 'lucide-react';
import { TabId } from '../components/TabBar';
import { AppSettings, Episode } from '../types';
import { formatDuration } from '../lib/media';
import { APP_VERSION_LABEL, UNITY_VERSION_LABEL } from '../version';

interface HomePageProps {
  episodes: Episode[];
  settings: AppSettings;
  onNavigate(tab: TabId): void;
}

export function HomePage({ episodes, settings, onNavigate }: HomePageProps) {
  const latest = episodes[0];

  return (
    <div className="page-stack home-page">
      <section className="home-launch">
        <div className="home-launch__copy">
          <span className="soft-pill">Research prototype</span>
          <h2>What do you need now?</h2>
          <p>Capture regret. Replay it at temptation.</p>
        </div>

        <div className="home-launch__actions" aria-label="Primary actions">
          <button className="home-action is-primary" type="button" onClick={() => onNavigate('capture')}>
            <span>
              <Video size={20} aria-hidden="true" />
              Start New Episode
            </span>
            <ChevronRight size={19} aria-hidden="true" />
          </button>
          <button className="home-action" type="button" onClick={() => onNavigate('archive')}>
            <span>
              <Archive size={20} aria-hidden="true" />
              Review Episode
            </span>
            <ChevronRight size={19} aria-hidden="true" />
          </button>
        </div>
      </section>

      {latest && (
        <section className="panel latest-episode">
          <div>
            <span className="muted-label">Latest</span>
            <h2>{latest.title}</h2>
            <p>{latest.aiSummary?.topic ?? latest.tags[0] ?? 'Saved episode'}</p>
          </div>
          <button className="secondary-button compact-button" type="button" onClick={() => onNavigate('archive')}>
            Review
          </button>
        </section>
      )}

      <section className="home-status">
        <div className="status-tile">
          <Database size={18} aria-hidden="true" />
          <span>{episodes.length}</span>
          <small>Episodes</small>
        </div>
        <div className="status-tile">
          <Clock size={18} aria-hidden="true" />
          <span>{latest ? formatDuration(latest.durationSec) : '0:00'}</span>
          <small>Latest</small>
        </div>
        <div className="study-card">
          <small>Study Mode</small>
          <strong>{settings.rewardEnabled ? 'Reward' : 'Baseline'}</strong>
          <span className={`condition-pill ${settings.rewardEnabled ? 'is-reward' : ''}`}>
            {settings.rewardEnabled ? 'ON' : 'OFF'}
          </span>
        </div>
      </section>

      <section className="panel install-note">
        <span className="muted-label">Home screen</span>
        <p>Add Rewind from Safari or Chrome share menu.</p>
        <span className="soft-pill">App {APP_VERSION_LABEL} · Unity {UNITY_VERSION_LABEL}</span>
      </section>
    </div>
  );
}
