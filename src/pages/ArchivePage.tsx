import { Check, Gift, Play, SkipForward, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatAvatar } from '../components/CatAvatar';
import { addReplayLog, createId, getVideoBlob, incrementTreats, updateEpisode } from '../db';
import { transcribeStub } from '../lib/encoding';
import { formatDuration } from '../lib/media';
import { AppSettings, Episode } from '../types';

interface ArchivePageProps {
  episodes: Episode[];
  settings: AppSettings;
  onEpisodesChanged(): void;
  onSettingsChanged(settings: AppSettings): void;
}

export function ArchivePage({ episodes, settings, onEpisodesChanged, onSettingsChanged }: ArchivePageProps) {
  const [selectedId, setSelectedId] = useState(episodes[0]?.id ?? '');
  const [videoUrl, setVideoUrl] = useState('');
  const [isReplayOpen, setIsReplayOpen] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const selected = useMemo(() => {
    return episodes.find((episode) => episode.id === selectedId) ?? episodes[0];
  }, [episodes, selectedId]);

  useEffect(() => {
    if (!selectedId && episodes[0]) {
      setSelectedId(episodes[0].id);
    }
  }, [episodes, selectedId]);

  useEffect(() => {
    let cancelled = false;
    let url = '';

    async function loadVideo() {
      if (!selected) {
        setVideoUrl('');
        return;
      }

      const blob = await getVideoBlob(selected.replayVideoBlobId);
      if (!blob || cancelled) {
        return;
      }
      url = URL.createObjectURL(blob);
      setVideoUrl(url);
    }

    void loadVideo();

    return () => {
      cancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [selected]);

  async function transcribeSelected() {
    if (!selected) {
      return;
    }
    setIsTranscribing(true);
    const transcriptText = await transcribeStub(selected.title);
    await updateEpisode(selected.id, { transcriptText });
    setIsTranscribing(false);
    onEpisodesChanged();
  }

  if (episodes.length === 0) {
    return (
      <section className="empty-state">
        <h2>No episodes yet</h2>
        <p>Create one in Capture.</p>
      </section>
    );
  }

  return (
    <div className="page-stack">
      <section className="episode-list" aria-label="Episodes">
        {episodes.map((episode) => (
          <button
            className={`episode-card ${selected?.id === episode.id ? 'is-selected' : ''}`}
            type="button"
            key={episode.id}
            onClick={() => setSelectedId(episode.id)}
          >
            <span>{episode.title}</span>
            <small>
              {formatDuration(episode.durationSec)} · {new Date(episode.createdAt).toLocaleDateString()}
            </small>
            <em>{episode.tags.length ? episode.tags.join(', ') : 'untagged'}</em>
          </button>
        ))}
      </section>

      {selected && (
        <section className="panel detail-panel">
          <div className="detail-heading">
            <div>
              <h2>{selected.title}</h2>
              <p>{selected.replayLabel}</p>
            </div>
            <span className="soft-pill">{selected.encodingStatus}</span>
          </div>

          {videoUrl ? (
            <video className="replay-video" src={videoUrl} controls playsInline />
          ) : (
            <div className="video-placeholder">Loading replay...</div>
          )}

          <div className="metadata-row">
            <span>{formatDuration(selected.durationSec)}</span>
            <span>{selected.faceTrace?.length ?? 0} face samples</span>
          </div>

          {selected.transcriptText ? (
            <p className="transcript-preview">{selected.transcriptText}</p>
          ) : (
            <button className="secondary-button full-width" type="button" onClick={() => void transcribeSelected()}>
              <Wand2 size={18} aria-hidden="true" />
              {isTranscribing ? 'Transcribing...' : 'Transcribe Stub'}
            </button>
          )}

          <button className="primary-button full-width" type="button" onClick={() => setIsReplayOpen(true)}>
            <Play size={19} aria-hidden="true" />
            Temptation Replay
          </button>
        </section>
      )}

      {isReplayOpen && selected && videoUrl && (
        <ReplayFlow
          episode={selected}
          videoUrl={videoUrl}
          settings={settings}
          onClose={() => setIsReplayOpen(false)}
          onSettingsChanged={onSettingsChanged}
        />
      )}
    </div>
  );
}

interface ReplayFlowProps {
  episode: Episode;
  videoUrl: string;
  settings: AppSettings;
  onClose(): void;
  onSettingsChanged(settings: AppSettings): void;
}

function ReplayFlow({ episode, videoUrl, settings, onClose, onSettingsChanged }: ReplayFlowProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [step, setStep] = useState<'pre' | 'watch' | 'post' | 'reward' | 'saved'>('pre');
  const [preUrge, setPreUrge] = useState(5);
  const [postUrge, setPostUrge] = useState(5);
  const [watchedFull, setWatchedFull] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [rewardTreats, setRewardTreats] = useState(settings.treats);

  useEffect(() => {
    if (step === 'watch' && videoRef.current) {
      videoRef.current.currentTime = episode.replayStartSec ?? 0;
    }
  }, [episode.replayStartSec, step]);

  async function saveLog() {
    setIsSaving(true);
    await addReplayLog({
      id: createId('log'),
      episodeId: episode.id,
      createdAt: new Date().toISOString(),
      preUrge,
      postUrge,
      condition: settings.rewardEnabled ? 'reward' : 'baseline',
      watchedFull
    });

    if (settings.rewardEnabled) {
      const next = await incrementTreats();
      setRewardTreats(next.treats);
      onSettingsChanged(next);
      setStep('reward');
    } else {
      setStep('saved');
    }
    setIsSaving(false);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Temptation replay">
      <section className="replay-modal">
        {step === 'pre' && (
          <>
            <h2>Before Replay</h2>
            <Slider label="Urge now" value={preUrge} onChange={setPreUrge} />
            <button className="primary-button full-width" type="button" onClick={() => setStep('watch')}>
              <Play size={19} aria-hidden="true" />
              Start Replay
            </button>
          </>
        )}

        {step === 'watch' && (
          <>
            <h2>{episode.title}</h2>
            <video
              ref={videoRef}
              className="replay-video"
              src={videoUrl}
              controls
              playsInline
              onEnded={() => setWatchedFull(true)}
            />
            <button
              className={settings.forceFullWatch ? 'primary-button full-width' : 'secondary-button full-width'}
              type="button"
              disabled={settings.forceFullWatch && !watchedFull}
              onClick={() => setStep('post')}
            >
              {settings.forceFullWatch ? (
                <>
                  <Check size={19} aria-hidden="true" />
                  Continue
                </>
              ) : (
                <>
                  <SkipForward size={19} aria-hidden="true" />
                  Skip to Post
                </>
              )}
            </button>
          </>
        )}

        {step === 'post' && (
          <>
            <h2>After Replay</h2>
            <Slider label="Urge now" value={postUrge} onChange={setPostUrge} />
            <button className="primary-button full-width" type="button" onClick={() => void saveLog()} disabled={isSaving}>
              <Check size={19} aria-hidden="true" />
              Save Log
            </button>
          </>
        )}

        {step === 'reward' && (
          <>
            <h2>Treat Earned</h2>
            <CatAvatar mood="reward" />
            <div className="reward-count">
              <Gift size={18} aria-hidden="true" />
              {rewardTreats} treats
            </div>
            <button className="primary-button full-width" type="button" onClick={onClose}>
              Done
            </button>
          </>
        )}

        {step === 'saved' && (
          <>
            <h2>Log Saved</h2>
            <p className="modal-note">Local only.</p>
            <button className="primary-button full-width" type="button" onClick={onClose}>
              Done
            </button>
          </>
        )}

        <button className="text-button full-width" type="button" onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  onChange(value: number): void;
}

function Slider({ label, value, onChange }: SliderProps) {
  return (
    <label className="slider-label">
      <span>
        {label}: <strong>{value}</strong>
      </span>
      <input
        type="range"
        min="1"
        max="10"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
