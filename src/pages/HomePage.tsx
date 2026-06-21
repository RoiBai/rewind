import { Archive, ChevronRight, Video } from 'lucide-react';
import { TabId } from '../components/TabBar';
import { AppSettings, Episode } from '../types';
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
      <section className="home-sketch-card" aria-label="Rewind start">
        <div className="home-sketch-card__topline">
          <span>Research prototype</span>
          <span className={`condition-pill ${settings.rewardEnabled ? 'is-reward' : ''}`}>
            {settings.rewardEnabled ? 'Reward ON' : 'Reward OFF'}
          </span>
        </div>

        <div className="home-sketch-card__title">
          <h1>Rewind</h1>
          <p>Capture regret. Replay it later.</p>
        </div>

        <div className="home-sketch-card__actions" aria-label="Primary actions">
          <button className="home-choice-button is-primary" type="button" onClick={() => onNavigate('capture')}>
            <span>
              <Video size={20} aria-hidden="true" />
              Start a New Episode
            </span>
            <ChevronRight size={19} aria-hidden="true" />
          </button>
          <button className="home-choice-button" type="button" onClick={() => onNavigate('archive')}>
            <span>
              <Archive size={20} aria-hidden="true" />
              Review
            </span>
            <ChevronRight size={19} aria-hidden="true" />
          </button>
        </div>

        <div className="home-sketch-card__footer">
          <span>{episodes.length} saved</span>
          {latest ? <span>Latest: {latest.title}</span> : <span>No episodes yet</span>}
        </div>
      </section>

      <section className="home-version-line" aria-label="Prototype version">
        <span className="soft-pill">App {APP_VERSION_LABEL} · Unity {UNITY_VERSION_LABEL}</span>
      </section>
    </div>
  );
}
