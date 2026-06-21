import { Camera, CircleStop, Loader2, Play, RotateCcw, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { UnityAvatarStage, type UnityAvatarStageHandle } from '../components/UnityAvatarStage';
import { createId, getErrorDetail, putVideoBlob, saveEpisode, updateEpisode } from '../db';
import { createEpisodeDraft, createReplayClipPlaceholder } from '../lib/encoding';
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
  onSaved(episodeId?: string): void | Promise<void>;
  onReview(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

export function CapturePage({ onSaved, onReview }: CapturePageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const avatarRef = useRef<UnityAvatarStageHandle | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const avatarRecordingStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
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
  const transcriptRef = useRef('');

  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastEpisodeId, setLastEpisodeId] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [status, setStatus] = useState('Ready for a new episode');
  const [trackerStatus, setTrackerStatus] = useState('Tracking idle');
  const [speechStatus, setSpeechStatus] = useState('Voice draft idle');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [expression, setExpression] = useState<CatExpression>(neutralExpression);

  useEffect(() => {
    if (!videoRef.current || !cameraStream) {
      return;
    }
    videoRef.current.srcObject = cameraStream;
    videoRef.current.play().catch(() => setStatus('Tap Connect Camera'));
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      stopRecording();
      stopSpeechDraft();
      cleanupAvatarRecordingStream();
      stopFaceLoop();
      stopStream(cameraStreamRef.current);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  async function enableCamera() {
    if (cameraStreamRef.current) {
      return cameraStreamRef.current;
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

    cameraStreamRef.current = nextStream;
    setCameraStream(nextStream);
    setStatus('Camera connected');
    void startFaceLoop();
    return nextStream;
  }

  async function startRecording() {
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
    transcriptRef.current = '';
    setElapsedSec(0);
    setLastEpisodeId('');
    setProcessingProgress(0);
    setIsProcessing(false);
    startSpeechDraft();

    const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = async () => {
      stopSpeechDraft();
      cleanupAvatarRecordingStream();
      const firstChunk = chunksRef.current[0] as Blob | undefined;
      const blob = new Blob(chunksRef.current, { type: mimeType || firstChunk?.type || 'video/webm' });
      const duration = (await getVideoDurationFromBlob(blob)) || elapsedSec;
      if (duration > 0) {
        setElapsedSec(duration);
      }
      await processAndSaveEpisode(blob, duration || elapsedSec);
    };

    startedAtRef.current = performance.now();
    lastFaceSampleAtRef.current = 0;
    lastFaceVideoTimeRef.current = -1;
    recordingRef.current = true;
    setIsRecording(true);
    setStatus('Recording cat + voice');
    recorder.start(1000);

    timerRef.current = window.setInterval(() => {
      setElapsedSec((performance.now() - startedAtRef.current) / 1000);
    }, 300);

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

  async function processAndSaveEpisode(recordedBlob: Blob, durationSec: number) {
    try {
      setIsProcessing(true);
      setProcessingProgress(0.05);
      setStatus('Processing episode');

      const createdAt = new Date();
      const transcriptText = transcriptRef.current.trim();
      const rawVideoBlobId = await putVideoBlob(recordedBlob, 'raw-video');
      const id = createId('episode');

      await saveEpisode({
        id,
        createdAt: createdAt.toISOString(),
        title: 'Processing episode',
        tags: ['processing'],
        rawVideoBlobId,
        replayVideoBlobId: rawVideoBlobId,
        durationSec: Math.round(durationSec),
        transcriptText,
        encodingStatus: 'encoding',
        replayLabel: 'processing avatar capture',
        faceTrace: faceTraceRef.current
      });

      const draft = await createEpisodeDraft({
        transcriptText,
        durationSec,
        createdAt,
        onProgress: (progress) => setProcessingProgress(0.08 + progress * 0.38)
      });

      const encoded = await createReplayClipPlaceholder({
        rawVideoBlobId,
        durationSec,
        targetDurationSec: draft.replayEndSec,
        onProgress: (progress) => setProcessingProgress(0.5 + progress * 0.46)
      });

      await updateEpisode(id, {
        title: draft.title,
        tags: draft.tags,
        replayVideoBlobId: encoded.replayVideoBlobId,
        replayLabel: encoded.replayLabel,
        replayStartSec: draft.replayStartSec,
        replayEndSec: draft.replayEndSec,
        aiSummary: draft.aiSummary,
        replaySegments: draft.replaySegments,
        encodingStatus: 'ready'
      });

      setProcessingProgress(1);
      setStatus('Episode ready');
      setLastEpisodeId(id);
      await onSaved(id);
    } catch (error) {
      console.warn('Rewind capture save failed.', error);
      setStatus(`Local save failed: ${getErrorDetail(error)}`);
    } finally {
      setIsProcessing(false);
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

  function startSpeechDraft() {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setSpeechStatus('Voice draft unavailable');
      return;
    }

    try {
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';
      recognition.onresult = (event) => {
        const parts: string[] = [];
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result?.isFinal) {
            parts.push(result[0].transcript);
          }
        }
        if (parts.length) {
          transcriptRef.current = `${transcriptRef.current} ${parts.join(' ')}`.trim();
          setSpeechStatus('Voice draft on');
        }
      };
      recognition.onerror = () => setSpeechStatus('Voice draft skipped');
      recognition.onend = () => {
        if (recordingRef.current) {
          try {
            recognition.start();
          } catch {
            setSpeechStatus('Voice draft paused');
          }
        }
      };
      recognition.start();
      recognitionRef.current = recognition;
      setSpeechStatus('Voice draft on');
    } catch {
      setSpeechStatus('Voice draft skipped');
    }
  }

  function stopSpeechDraft() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) {
      return;
    }
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      // Speech recognition stop is best-effort across mobile browsers.
    }
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

  function resetForAnotherEpisode() {
    setLastEpisodeId('');
    setElapsedSec(0);
    setProcessingProgress(0);
    setStatus(cameraStreamRef.current ? 'Camera connected' : 'Ready for a new episode');
    transcriptRef.current = '';
    faceTraceRef.current = [];
  }

  return (
    <div className="page-stack capture-flow">
      <section className="capture-start panel">
        <div>
          <h2>New Episode</h2>
          <p>Cat avatar + your voice.</p>
        </div>
        <span className="soft-pill">No face video saved</span>
      </section>

      <section className="avatar-capture-shell">
        <video ref={videoRef} className="tracking-video-hidden" muted playsInline aria-hidden="true" />
        <UnityAvatarStage
          ref={avatarRef}
          className="capture-avatar-stage"
          expression={expression}
          label={isRecording ? 'Recording cat avatar' : 'Cat avatar recording view'}
        />
      </section>

      <section className="panel capture-status-panel">
        <div>
          <h2>{formatDuration(elapsedSec)}</h2>
          <p>{status}</p>
        </div>
        <div className="status-chip-stack">
          <span className="soft-pill">App {APP_VERSION_LABEL} · Unity {UNITY_VERSION_LABEL}</span>
          <span className="soft-pill">{trackerStatus}</span>
          <span className="soft-pill">{speechStatus}</span>
          {trackerStatus !== 'Tracking idle' && trackerStatus !== 'Starting tracker' && (
            <span className="soft-pill">
              S{expression.smile.toFixed(2)} B{Math.round(expression.blinkLeft * 10)}/
              {Math.round(expression.blinkRight * 10)} M{Math.round(expression.mouthOpen * 10)}
              {' '}Z{expression.faceScale.toFixed(2)}
            </span>
          )}
        </div>
      </section>

      {isProcessing && (
        <section className="panel">
          <div className="progress-header">
            <span>Processing</span>
            <span>{Math.round(processingProgress * 100)}%</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${Math.round(processingProgress * 100)}%` }} />
          </div>
          <p>Draft title, theme, and 30s replay plan.</p>
        </section>
      )}

      {lastEpisodeId && !isProcessing && (
        <section className="panel capture-ready-card">
          <h2>Episode Ready</h2>
          <p>Saved locally. Review anytime.</p>
          <button className="primary-button full-width" type="button" onClick={onReview}>
            <Play size={19} aria-hidden="true" />
            Review Episode
          </button>
        </section>
      )}

      <section className="capture-actions">
        {!cameraStream ? (
          <button className="primary-button full-width" type="button" onClick={() => void enableCamera()}>
            <Camera size={19} aria-hidden="true" />
            Connect Camera
          </button>
        ) : !isRecording ? (
          <button
            className="primary-button full-width"
            type="button"
            onClick={() => void startRecording()}
            disabled={isProcessing}
          >
            {isProcessing ? <Loader2 size={19} aria-hidden="true" /> : <Video size={19} aria-hidden="true" />}
            Start Recording
          </button>
        ) : (
          <button className="danger-button full-width" type="button" onClick={stopRecording}>
            <CircleStop size={19} aria-hidden="true" />
            Stop
          </button>
        )}
        <button className="secondary-button full-width" type="button" onClick={resetForAnotherEpisode} disabled={isRecording || isProcessing}>
          <RotateCcw size={18} aria-hidden="true" />
          New
        </button>
      </section>
    </div>
  );
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}
