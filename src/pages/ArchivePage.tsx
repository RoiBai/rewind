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
        <p>Start a new episode first.</p>
      </section>
    );
  }

  return (
    <div className="page-stack review-page">
      <section className="review-heading">
        <span className="soft-pill">Review</span>
        <h2>Previous Episodes</h2>
      </section>

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
            <em>{episode.aiSummary?.topic ?? (episode.tags.length ? episode.tags.join(', ') : 'untagged')}</em>
          </button>
        ))}
      </section>

      {selected && (
        <section className="panel detail-panel">
          <div className="detail-heading">
            <div>
              <h2>{selected.title}</h2>
              <p>{selected.aiSummary?.summary ?? selected.replayLabel}</p>
            </div>
            <span className="soft-pill">{selected.encodingStatus}</span>
          </div>

          <div className="short-video-frame">
            {videoUrl ? (
              <video className="replay-video" src={videoUrl} controls playsInline />
            ) : (
              <div className="video-placeholder">Loading replay...</div>
            )}
            {selected.aiSummary && (
              <div className="short-caption">
                <strong>{selected.aiSummary.topic}</strong>
                <span>{selected.aiSummary.moments[0]?.quote}</span>
              </div>
            )}
          </div>

          <div className="metadata-row">
            <span>{formatDuration(selected.durationSec)}</span>
            <span>{selected.faceTrace?.length ?? 0} face samples</span>
          </div>

          {selected.replaySegments && selected.replaySegments.length > 0 && (
            <div className="moment-list" aria-label="AI clip plan">
              {selected.replaySegments.map((moment) => (
                <div key={moment.id}>
                  <span>{moment.label}</span>
                  <p>{moment.quote}</p>
                  <small>
                    {formatDuration(moment.startSec)}-{formatDuration(moment.endSec)}
                  </small>
                </div>
              ))}
            </div>
          )}

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
            Review Episode
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
  const [loadedDurationSec, setLoadedDurationSec] = useState(0);
  const [clipIndex, setClipIndex] = useState(0);

  const effectiveReplayEndSec = getEffectiveReplayEndSec(episode, loadedDurationSec);
  const clipTimeline = useMemo(() => createReplayTimeline(episode, loadedDurationSec), [episode, loadedDurationSec]);
  const activeClip = clipTimeline[clipIndex];

  useEffect(() => {
    if (step === 'watch' && videoRef.current) {
      setClipIndex(0);
      setWatchedFull(false);
      videoRef.current.currentTime = clipTimeline[0]?.startSec ?? episode.replayStartSec ?? 0;
      void videoRef.current.play().catch(() => {
        // Some mobile browsers require one more tap on the video controls.
      });
    }
  }, [clipTimeline, episode.replayStartSec, step]);

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

  function handleReplayTime() {
    const video = videoRef.current;
    const end = activeClip?.endSec ?? effectiveReplayEndSec;
    if (video && end && video.currentTime >= end) {
      advanceClip();
    }
  }

  function handleReplayMetadata() {
    const duration = videoRef.current?.duration ?? 0;
    setLoadedDurationSec(Number.isFinite(duration) ? duration : 0);
  }

  function advanceClip() {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const nextIndex = clipIndex + 1;
    if (clipTimeline[nextIndex]) {
      const nextClip = clipTimeline[nextIndex];
      setClipIndex(nextIndex);
      video.currentTime = nextClip.startSec;
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
    setWatchedFull(true);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Episode review">
      <section className="replay-modal">
        {step === 'pre' && (
          <>
            <h2>Before Review</h2>
            <Slider label="Desire now" value={preUrge} onChange={setPreUrge} />
            <button className="primary-button full-width" type="button" onClick={() => setStep('watch')}>
              <Play size={19} aria-hidden="true" />
              Watch
            </button>
          </>
        )}

        {step === 'watch' && (
          <>
            <h2>{episode.title}</h2>
            <div className="short-video-frame is-modal">
              <video
                ref={videoRef}
                className="replay-video"
                src={videoUrl}
                controls
                playsInline
                onLoadedMetadata={handleReplayMetadata}
                onTimeUpdate={handleReplayTime}
                onEnded={advanceClip}
              />
              {activeClip && (
                <div className="short-caption remix-caption">
                  <strong>{activeClip.label}</strong>
                  <span>{activeClip.quote}</span>
                  <small>
                    Clip {Math.min(clipIndex + 1, clipTimeline.length)}/{clipTimeline.length}
                  </small>
                </div>
              )}
            </div>
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
                  Skip to Feedback
                </>
              )}
            </button>
          </>
        )}

        {step === 'post' && (
          <>
            <h2>After Review</h2>
            <Slider label="Desire now" value={postUrge} onChange={setPostUrge} />
            <button className="primary-button full-width" type="button" onClick={() => void saveLog()} disabled={isSaving}>
              <Check size={19} aria-hidden="true" />
              Save Feedback
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
            <h2>Feedback Saved</h2>
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

function getEffectiveReplayEndSec(episode: Episode, loadedDurationSec: number) {
  const plannedEnd = episode.replayEndSec ?? 0;
  const knownDuration = Math.max(
    Number.isFinite(loadedDurationSec) ? loadedDurationSec : 0,
    Number.isFinite(episode.durationSec) ? episode.durationSec : 0
  );

  if (!plannedEnd) {
    return knownDuration > 0 ? Math.min(knownDuration, 35) : undefined;
  }

  if (plannedEnd < 5) {
    return knownDuration >= 5 ? Math.min(knownDuration, 35) : undefined;
  }

  return plannedEnd;
}

interface ReplayClip {
  id: string;
  startSec: number;
  endSec: number;
  label: string;
  quote: string;
  intensity: number;
}

function createReplayTimeline(episode: Episode, loadedDurationSec: number): ReplayClip[] {
  const duration = Math.max(
    Number.isFinite(loadedDurationSec) ? loadedDurationSec : 0,
    Number.isFinite(episode.durationSec) ? episode.durationSec : 0
  );
  const maxEnd = duration > 0 ? duration : Math.max(episode.replayEndSec ?? 0, 0);
  const moments = episode.replaySegments ?? [];

  const clips = moments
    .map((moment) => {
      const startSec = clampNumber(moment.startSec, 0, Math.max(maxEnd - 0.8, 0));
      const endSec = clampNumber(moment.endSec, startSec + 1.2, maxEnd || startSec + 8);
      return {
        id: moment.id,
        startSec: roundClipTime(startSec),
        endSec: roundClipTime(Math.min(endSec, startSec + 8)),
        label: moment.label,
        quote: moment.quote,
        intensity: moment.intensity
      };
    })
    .filter((clip) => clip.endSec - clip.startSec >= 1);

  if (clips.length === 0) {
    const fallbackEnd = getEffectiveReplayEndSec(episode, loadedDurationSec) ?? Math.min(maxEnd || 12, 35);
    return [
      {
        id: 'fallback-replay',
        startSec: maxEnd > 8 ? 2 : 0,
        endSec: Math.max(2, fallbackEnd),
        label: episode.aiSummary?.topic ?? 'Replay',
        quote: episode.aiSummary?.summary ?? episode.title,
        intensity: 0.6
      }
    ];
  }

  const strongestIndex = clips.reduce(
    (bestIndex, clip, index) => (clip.intensity > clips[bestIndex].intensity ? index : bestIndex),
    0
  );
  const timeline: ReplayClip[] = [];

  clips.slice(0, 3).forEach((clip, index) => {
    timeline.push(clip);
    if (index === strongestIndex) {
      timeline.push({
        ...clip,
        id: `${clip.id}-repeat`,
        label: `${clip.label} · Repeat`
      });
    }
  });

  return timeline.slice(0, 4);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (max <= min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function roundClipTime(value: number) {
  return Math.round(value * 10) / 10;
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
