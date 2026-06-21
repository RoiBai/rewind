export type EncodingStatus = 'raw' | 'encoding' | 'ready';
export type RewardCondition = 'baseline' | 'reward';

export interface FaceSample {
  t: number;
  mouthOpen: number;
  blinkLeft: number;
  blinkRight: number;
  yaw: number;
  pitch: number;
  faceScale?: number;
}

export interface EpisodeMoment {
  id: string;
  startSec: number;
  endSec: number;
  label: string;
  quote: string;
  intensity: number;
}

export interface EpisodeAiSummary {
  title: string;
  topic: string;
  summary: string;
  language: 'zh' | 'en' | 'mixed' | 'unknown';
  suggestedTags: string[];
  moments: EpisodeMoment[];
  generatedAt: string;
  pipeline: 'local-stub' | 'openai-stt-llm' | 'openai-stt-local-plan' | 'remote-fallback';
}

export interface Episode {
  id: string;
  createdAt: string;
  title: string;
  tags: string[];
  notes?: string;
  rawVideoBlobId: string;
  replayVideoBlobId: string;
  durationSec: number;
  transcriptText?: string;
  encodingStatus: EncodingStatus;
  replayLabel: string;
  replayStartSec?: number;
  replayEndSec?: number;
  aiSummary?: EpisodeAiSummary;
  replaySegments?: EpisodeMoment[];
  faceTrace?: FaceSample[];
}

export interface ReplayLog {
  id: string;
  episodeId: string;
  createdAt: string;
  preUrge: number;
  postUrge: number;
  condition: RewardCondition;
  watchedFull: boolean;
  notes?: string;
}

export interface AppSettings {
  rewardEnabled: boolean;
  forceFullWatch: boolean;
  treats: number;
}

export interface StoredBlob {
  id: string;
  blob: Blob;
  kind: 'raw-video' | 'replay-video';
  createdAt: string;
}
