import { Download, Trash2 } from 'lucide-react';
import { deleteAllLocalData, getExportBundle, listEpisodes, listReplayLogs } from '../db';
import { downloadJson } from '../lib/media';
import { AppSettings } from '../types';

interface SettingsPageProps {
  settings: AppSettings;
  onSettingsChanged(settings: AppSettings): void;
  onDataChanged(): void;
}

export function SettingsPage({ settings, onSettingsChanged, onDataChanged }: SettingsPageProps) {
  async function patchSettings(patch: Partial<AppSettings>) {
    await onSettingsChanged({ ...settings, ...patch });
  }

  async function exportLogs() {
    const replayLogs = await listReplayLogs();
    downloadJson('rewind-replay-logs.json', {
      exportedAt: new Date().toISOString(),
      replayLogs
    });
  }

  async function exportEpisodes() {
    const episodes = await listEpisodes();
    downloadJson('rewind-episode-metadata.json', {
      exportedAt: new Date().toISOString(),
      episodes
    });
  }

  async function exportBundle() {
    downloadJson('rewind-local-export.json', await getExportBundle());
  }

  async function deleteData() {
    const confirmed = window.confirm('Delete all local Rewind data?');
    if (!confirmed) {
      return;
    }
    await deleteAllLocalData();
    onSettingsChanged({ rewardEnabled: false, forceFullWatch: true, treats: 0 });
    onDataChanged();
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <h2>Study Mode</h2>
        <div className="segmented-control" role="group" aria-label="Reward variant">
          <button
            type="button"
            className={!settings.rewardEnabled ? 'is-active' : ''}
            onClick={() => void patchSettings({ rewardEnabled: false })}
          >
            Reward OFF
          </button>
          <button
            type="button"
            className={settings.rewardEnabled ? 'is-active' : ''}
            onClick={() => void patchSettings({ rewardEnabled: true })}
          >
            Reward ON
          </button>
        </div>

        <label className="switch-row">
          <span>Force full watch</span>
          <input
            type="checkbox"
            checked={settings.forceFullWatch}
            onChange={(event) => void patchSettings({ forceFullWatch: event.target.checked })}
          />
        </label>

        <div className="treat-counter">
          <span>{settings.treats}</span>
          <small>Treats</small>
        </div>
      </section>

      <section className="panel">
        <h2>Data</h2>
        <button className="secondary-button full-width" type="button" onClick={() => void exportLogs()}>
          <Download size={18} aria-hidden="true" />
          Export Logs
        </button>
        <button className="secondary-button full-width" type="button" onClick={() => void exportEpisodes()}>
          <Download size={18} aria-hidden="true" />
          Export Metadata
        </button>
        <button className="secondary-button full-width" type="button" onClick={() => void exportBundle()}>
          <Download size={18} aria-hidden="true" />
          Export Study JSON
        </button>
        <button className="danger-button full-width" type="button" onClick={() => void deleteData()}>
          <Trash2 size={18} aria-hidden="true" />
          Delete Local Data
        </button>
      </section>

      <section className="privacy-note">Data stored locally. Export only when you choose.</section>
    </div>
  );
}
