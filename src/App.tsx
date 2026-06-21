import { useCallback, useEffect, useState } from 'react';
import {
  defaultSettings,
  getErrorDetail,
  listEpisodes,
  loadInitialDataWithRecovery,
  resetLocalDatabase,
  saveSettings,
  withTimeout
} from './db';
import { TabBar, TabId } from './components/TabBar';
import { AppSettings, Episode } from './types';
import { HomePage } from './pages/HomePage';
import { CapturePage } from './pages/CapturePage';
import { ArchivePage } from './pages/ArchivePage';
import { SettingsPage } from './pages/SettingsPage';
import { RigLabPage } from './pages/RigLabPage';
import { APP_VERSION_LABEL, UNITY_VERSION_LABEL } from './version';

const initialSettings: AppSettings = {
  rewardEnabled: false,
  forceFullWatch: true,
  treats: 0
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>(getInitialTab());
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [settings, setSettingsState] = useState<AppSettings>(initialSettings);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const [isRecovering, setIsRecovering] = useState(false);
  const canOpenWithoutStorage = activeTab === 'capture' || activeTab === 'rig';

  const refreshEpisodes = useCallback(async () => {
    try {
      setEpisodes(await listEpisodes());
    } catch (error) {
      setLoadError(getStartupErrorMessage(error));
      setEpisodes([]);
    }
  }, []);

  const updateSettings = useCallback(async (next: AppSettings) => {
    setSettingsState(next);
    await saveSettings(next);
  }, []);

  const changeTab = useCallback((nextTab: TabId) => {
    setActiveTab(nextTab);
    const nextHash = nextTab === 'home' ? '' : `#${nextTab}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }, []);

  const loadAppData = useCallback(async () => {
    setLoadError('');
    setIsReady(false);

    try {
      const data = await withTimeout(loadInitialDataWithRecovery(), 8500, 'Local data did not respond.');
      setSettingsState(data.settings);
      setEpisodes(data.episodes);
      setStorageNotice(
        data.recovered ? 'Started with a fresh local archive. Old local data is isolated.' : ''
      );
      setIsReady(true);
    } catch (error) {
      setSettingsState(defaultSettings);
      setEpisodes([]);
      setLoadError(getStartupErrorMessage(error));
    }
  }, []);

  const recoverLocalData = useCallback(async () => {
    const confirmed = window.confirm('Reset local Rewind data on this device?');
    if (!confirmed) {
      return;
    }

    setIsRecovering(true);
    setLoadError('');

    try {
      await resetLocalDatabase();
      await loadAppData();
    } catch (error) {
      setLoadError(getStartupErrorMessage(error));
    } finally {
      setIsRecovering(false);
    }
  }, [loadAppData]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await withTimeout(loadInitialDataWithRecovery(), 8500, 'Local data did not respond.');
        if (cancelled) {
          return;
        }
        setSettingsState(data.settings);
        setEpisodes(data.episodes);
        setStorageNotice(
          data.recovered ? 'Started with a fresh local archive. Old local data is isolated.' : ''
        );
        setIsReady(true);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSettingsState(defaultSettings);
        setEpisodes([]);
        setLoadError(getStartupErrorMessage(error));
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setActiveTab(getInitialTab());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Research Prototype</p>
          <h1>Rewind</h1>
        </div>
        <div className="app-header__actions">
          <span className={`condition-pill ${settings.rewardEnabled ? 'is-reward' : ''}`}>
            {settings.rewardEnabled ? 'Reward ON' : 'Reward OFF'}
          </span>
          <span className="soft-pill">App {APP_VERSION_LABEL} · Unity {UNITY_VERSION_LABEL}</span>
        </div>
      </header>

      <main className="app-main">
        {!isReady && !canOpenWithoutStorage ? (
          <section className="empty-state">
            <h2>{loadError ? 'Local Data Issue' : 'Loading local data...'}</h2>
            {loadError && (
              <>
                <p>{loadError}</p>
                <div className="empty-actions">
                  <button className="secondary-button" type="button" onClick={() => changeTab('capture')}>
                    Open Capture
                  </button>
                  <button className="secondary-button" type="button" onClick={() => changeTab('rig')}>
                    Rig Lab
                  </button>
                  <button className="primary-button" type="button" onClick={() => void loadAppData()} disabled={isRecovering}>
                    Retry
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => void recoverLocalData()}
                    disabled={isRecovering}
                  >
                    Reset Data
                  </button>
                </div>
              </>
            )}
          </section>
        ) : (
          <>
            {!isReady && canOpenWithoutStorage && (
              <section className="storage-notice">
                {activeTab === 'capture'
                  ? 'Capture preview is available. Saving needs local data.'
                  : 'Rig Lab only. Local data is not loaded.'}
              </section>
            )}
            {storageNotice && <section className="storage-notice">{storageNotice}</section>}
            {activeTab === 'home' && (
              <HomePage episodes={episodes} settings={settings} onNavigate={changeTab} />
            )}
            {activeTab === 'capture' && <CapturePage onSaved={refreshEpisodes} />}
            {activeTab === 'archive' && (
              <ArchivePage
                episodes={episodes}
                settings={settings}
                onEpisodesChanged={refreshEpisodes}
                onSettingsChanged={setSettingsState}
              />
            )}
            {activeTab === 'rig' && <RigLabPage />}
            {activeTab === 'settings' && (
              <SettingsPage
                settings={settings}
                onSettingsChanged={updateSettings}
                onDataChanged={refreshEpisodes}
              />
            )}
          </>
        )}
      </main>

      <TabBar active={activeTab} onChange={changeTab} />
    </div>
  );
}

function getInitialTab(): TabId {
  const hashTab = window.location.hash.replace('#', '');
  return isTabId(hashTab) ? hashTab : 'home';
}

function isTabId(value: string): value is TabId {
  return ['home', 'capture', 'archive', 'rig', 'settings'].includes(value);
}

function getStartupErrorMessage(error: unknown) {
  const detail = getErrorDetail(error);
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('did not respond') || message.includes('timed out')) {
    return `Local storage is busy. Close other Rewind tabs, then retry. Details: ${detail}`;
  }

  if (message.includes('denied') || message.includes('blocked')) {
    return `Local storage is blocked in this browser mode. Details: ${detail}`;
  }

  return `Local storage could not open. Retry or reset local data. Details: ${detail}`;
}
