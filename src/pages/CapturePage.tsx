import { Camera, CircleStop, Save, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { UnityAvatarStage, type UnityAvatarStageHandle } from '../components/UnityAvatarStage';
import { createId, getErrorDetail, putVideoBlob, saveEpisode, updateEpisode } from '../db';
import { createReplayClipPlaceholder } from '../lib/encoding';
import {
  CatExpression,
  createFaceTracker,
  FaceTracker,
  neutralExpression,
  smoothExpression,
  toFaceSample
} from '../lib/faceTracking';
import { formatDuration, getSupportedVideoMimeType, getVideoDurationFromBlob, stopStream } from '../lib/media';
import { FaceSample } from '../types';
import { APP_VERSION_LABEL, UNITY_VERSION_LABEL } from '../version';

interface CapturePageProps {
  onSaved(): void;
}

export function CapturePage({ onSaved }: CapturePageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const avatarRef = useRef<UnityAvatarStageHandle | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const avatarRecordingStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | undefined>();
  const faceTimerRef = useRef<number | undefined>();
  const faceBusyRef = useRef(false);
  const trackingRef = useRef(false);
  const trackerInitRef = useRef<Promise<FaceTracker> | null>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const expressionRef = useRef<CatExpression>(neutralExpression);
  const startedAtRef = useRef(0);
  const lastFaceSampleAtRef = useRef(0);
  const lastFaceVideoTimeRef = useRef(-1);
  const faceTraceRef = useRef<FaceSample[]>([]);
  const recordingRef = useRef(false);

  const [title, setTitle] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [notes, setNotes] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [status, setStatus] = useState('Camera off');
  const [trackerStatus, setTrackerStatus] = useState('Face tracking idle');
  const [expression, setExpression] = useState<CatExpression>(neutralExpression);
  const [isEncoding, setIsEncoding] = useState(false);
  const [encodingProgress, setEncodingProgress] = useState(0);

  useEffect(() => {
    if (!videoRef.current || !stream) {
      return;
    }
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => setStatus('Tap video to preview'));
  }, [stream]);

  useEffect(() => {
    if (!recordedBlob) {
      setRecordedUrl('');
      return undefined;
    }

    const url = URL.createObjectURL(recordedBlob);
    setRecordedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recordedBlob]);

  useEffect(() => {
    return () => {
      stopRecording();
      cleanupAvatarRecordingStream();
      stopFaceLoop();
      stopStream(streamRef.current);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  async function enableCamera() {
    if (stream) {
      return stream;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Camera not available');
      throw new Error('getUserMedia unavailable');
    }

    const nextStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 360, max: 480 },
        height: { ideal: 480, max: 640 },
        frameRate: { ideal: 24, max: 30 }
      },
      audio: true
    });

    streamRef.current = nextStream;
    setStream(nextStream);
    setStatus('Tracking preview');
    void startFaceLoop();
    return nextStream;
  }

  async function startRecording() {
    if (!title.trim()) {
      setStatus('Add a title');
      return;
    }

    const mediaStream = await enableCamera();
    const mimeType = getSupportedVideoMimeType();
    if (!('MediaRecorder' in window)) {
      setStatus('Recorder not supported');
      return;
    }

    let recordingStream: MediaStream;
    try {
      recordingStream = createAvatarRecordingStream(mediaStream);
      avatarRecordingStreamRef.current = recordingStream;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Avatar recorder unavailable');
      return;
    }

    chunksRef.current = [];
    faceTraceRef.current = [];
    setRecordedBlob(null);
    setElapsedSec(0);

    const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = async () => {
      cleanupAvatarRecordingStream();
      const firstChunk = chunksRef.current[0] as Blob | undefined;
      const blob = new Blob(chunksRef.current, { type: mimeType || firstChunk?.type || 'video/webm' });
      setRecordedBlob(blob);
      const duration = await getVideoDurationFromBlob(blob);
      if (duration > 0) {
        setElapsedSec(duration);
      }
      setStatus('Avatar ready');
    };

    startedAtRef.current = performance.now();
    lastFaceSampleAtRef.current = 0;
    lastFaceVideoTimeRef.current = -1;
    recordingRef.current = true;
    setIsRecording(true);
    setStatus('Recording avatar');
    recorder.start(2000);

    timerRef.current = window.setInterval(() => {
      setElapsedSec((performance.now() - startedAtRef.current) / 1000);
    }, 500);

    void startFaceLoop();
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    } else {
      cleanupAvatarRecordingStream();
    }
    recordingRef.current = false;
    setIsRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  }

  function createAvatarRecordingStream(micStream: MediaStream) {
    if (!avatarRef.current?.isReady()) {
      throw new Error('Wait for Unity ready');
    }

    const canvas = avatarRef.current.getCanvas();
    if (!canvas || typeof canvas.captureStream !== 'function') {
      throw new Error('Avatar recording not supported');
    }

    const canvasStream = canvas.captureStream(30);
    const videoTracks = canvasStream.getVideoTracks();
    if (videoTracks.length === 0) {
      throw new Error('Avatar video unavailable');
    }

    return new MediaStream([...videoTracks, ...micStream.getAudioTracks()]);
  }

  function cleanupAvatarRecordingStream() {
    avatarRecordingStreamRef.current?.getVideoTracks().forEach((track) => track.stop());
    avatarRecordingStreamRef.current = null;
  }

  function stopFaceLoop() {
    trackingRef.current = false;
    if (faceTimerRef.current) {
      window.clearTimeout(faceTimerRef.current);
      faceTimerRef.current = undefined;
    }
    faceBusyRef.current = false;
    trackerRef.current?.close();
    trackerRef.current = null;
    trackerInitRef.current = null;
  }

  async function startFaceLoop() {
    trackingRef.current = true;
    if (!trackerRef.current) {
      setTrackerStatus('Starting tracker');
      trackerInitRef.current ??= createFaceTracker();
      trackerRef.current = await trackerInitRef.current;
      setTrackerStatus(
        trackerRef.current.source === 'fallback'
          ? 'Tracking fallback'
          : trackerRef.current.hands
            ? 'Face + hands on'
            : 'Face tracking on'
      );
    }

    if (faceTimerRef.current) {
      return;
    }

    const tick = () => {
      const video = videoRef.current;
      const tracker = trackerRef.current;
      if (!trackingRef.current || !video || !tracker) {
        faceBusyRef.current = false;
        return;
      }

      if (
        !faceBusyRef.current &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.currentTime !== lastFaceVideoTimeRef.current
      ) {
        lastFaceVideoTimeRef.current = video.currentTime;
        faceBusyRef.current = true;
        try {
          const detected = tracker.detect(video, performance.now());
          if (detected) {
            const smoothed = smoothExpression(expressionRef.current, detected, 0.34);
            expressionRef.current = smoothed;
            setExpression(smoothed);

            const elapsed = performance.now() - startedAtRef.current;
            if (recordingRef.current && elapsed - lastFaceSampleAtRef.current > 250 && faceTraceRef.current.length < 260) {
              faceTraceRef.current.push(toFaceSample(smoothed, elapsed));
              lastFaceSampleAtRef.current = elapsed;
            }
          }
        } finally {
          faceBusyRef.current = false;
        }
      }

      faceTimerRef.current = window.setTimeout(tick, 48);
    };

    tick();
  }

  async function saveCurrentEpisode() {
    if (!recordedBlob || !title.trim()) {
      setStatus('Missing recording');
      return;
    }

    try {
      setIsEncoding(true);
      setEncodingProgress(0.08);
      setStatus('Encoding...');

      const duration = (await getVideoDurationFromBlob(recordedBlob)) || elapsedSec;
      const rawVideoBlobId = await putVideoBlob(recordedBlob, 'raw-video');
      const id = createId('episode');

      await saveEpisode({
        id,
        createdAt: new Date().toISOString(),
        title: title.trim(),
        tags: parseTags(tagsInput),
        notes: notes.trim() || undefined,
        rawVideoBlobId,
        replayVideoBlobId: rawVideoBlobId,
        durationSec: Math.round(duration),
        transcriptText: '',
        encodingStatus: 'encoding',
        replayLabel: 'raw capture',
        faceTrace: faceTraceRef.current
      });

      const encoded = await createReplayClipPlaceholder({
        rawVideoBlobId,
        durationSec: duration,
        onProgress: setEncodingProgress
      });

      await updateEpisode(id, {
        replayVideoBlobId: encoded.replayVideoBlobId,
        replayLabel: encoded.replayLabel,
        replayStartSec: encoded.replayStartSec,
        replayEndSec: encoded.replayEndSec,
        encodingStatus: 'ready'
      });

      setEncodingProgress(1);
      setStatus('Saved');
      setTitle('');
      setTagsInput('');
      setNotes('');
      setRecordedBlob(null);
      faceTraceRef.current = [];
      onSaved();
    } catch (error) {
      console.warn('Rewind capture save failed.', error);
      setStatus(`Local save failed: ${getErrorDetail(error)}`);
    } finally {
      setIsEncoding(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel form-panel">
        <label>
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Regret episode" required />
        </label>
        <label>
          <span>Tags</span>
          <input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="snack, scrolling" />
        </label>
        <label>
          <span>Notes</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" rows={2} />
        </label>
      </section>

      <section className="capture-grid">
        <div className="camera-panel">
          <video ref={videoRef} className="camera-preview" muted playsInline />
          {!stream && (
            <button className="camera-enable" type="button" onClick={() => void enableCamera()}>
              <Camera size={19} aria-hidden="true" />
              Enable Camera
            </button>
          )}
          <div className="media-chip">Tracking only</div>
        </div>

        <UnityAvatarStage
          ref={avatarRef}
          expression={expression}
          label={isRecording ? 'Recording cat avatar' : 'Unity cat avatar'}
        />
      </section>

      <section className="panel compact-panel">
        <div>
          <h2>{formatDuration(elapsedSec)}</h2>
          <p>{status}</p>
        </div>
        <div className="status-chip-stack">
          <span className="soft-pill">App {APP_VERSION_LABEL} · Unity {UNITY_VERSION_LABEL}</span>
          <span className="soft-pill">{trackerStatus}</span>
          {trackerStatus !== 'Face tracking idle' && trackerStatus !== 'Starting tracker' && (
            <span className="soft-pill">
              S{expression.smile.toFixed(2)} B{Math.round(expression.blinkLeft * 10)}/
              {Math.round(expression.blinkRight * 10)} M{Math.round(expression.mouthOpen * 10)}
              {' '}Z{expression.faceScale.toFixed(2)} · G {handGestureLabel(expression, 'left')}/{handGestureLabel(expression, 'right')}
            </span>
          )}
        </div>
      </section>

      {recordedUrl && (
        <section className="panel">
          <h2>Preview</h2>
          <video className="replay-video" src={recordedUrl} controls playsInline />
        </section>
      )}

      {isEncoding && (
        <section className="panel">
          <div className="progress-header">
            <span>Encoding...</span>
            <span>{Math.round(encodingProgress * 100)}%</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${Math.round(encodingProgress * 100)}%` }} />
          </div>
        </section>
      )}

      <section className="action-row">
        {!isRecording ? (
          <button className="primary-button" type="button" onClick={() => void startRecording()} disabled={isEncoding}>
            <Video size={19} aria-hidden="true" />
            Record Avatar
          </button>
        ) : (
          <button className="danger-button" type="button" onClick={stopRecording}>
            <CircleStop size={19} aria-hidden="true" />
            Stop
          </button>
        )}
        <button
          className="secondary-button"
          type="button"
          onClick={() => void saveCurrentEpisode()}
          disabled={!recordedBlob || isRecording || isEncoding}
        >
          <Save size={19} aria-hidden="true" />
          Save Episode
        </button>
      </section>
    </div>
  );
}

function handGestureLabel(expression: CatExpression, side: 'left' | 'right') {
  const scores: Array<[string, number]> =
    side === 'left'
      ? [
          ['M', expression.leftCoverMouth],
          ['E', expression.leftCoverEyes],
          ['H', expression.leftCoverHead]
        ]
      : [
          ['M', expression.rightCoverMouth],
          ['E', expression.rightCoverEyes],
          ['H', expression.rightCoverHead]
        ];
  const [label, score] = scores.reduce((best, item) => (item[1] > best[1] ? item : best));
  return score > 0.42 ? label : '-';
}

function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
