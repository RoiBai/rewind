import type { EpisodeAiSummary, EpisodeMoment, FaceSample } from '../types';

export interface TranscriptCue {
  text: string;
  tSec: number;
}

export interface EncodingResult {
  replayVideoBlobId: string;
  replayLabel: string;
  replayStartSec: number;
  replayEndSec: number;
}

interface PlaceholderEncodingInput {
  rawVideoBlobId: string;
  durationSec: number;
  targetDurationSec?: number;
  onProgress?: (progress: number) => void;
}

interface EpisodeDraftInput {
  transcriptText: string;
  transcriptCues?: TranscriptCue[];
  faceTrace?: FaceSample[];
  durationSec: number;
  createdAt: Date;
  onProgress?: (progress: number) => void;
}

export interface EpisodeDraft {
  title: string;
  tags: string[];
  aiSummary: EpisodeAiSummary;
  replaySegments: EpisodeMoment[];
  replayStartSec: number;
  replayEndSec: number;
}

export async function createReplayClipPlaceholder(input: PlaceholderEncodingInput): Promise<EncodingResult> {
  for (const progress of [0.18, 0.42, 0.7, 1]) {
    await wait(220);
    input.onProgress?.(progress);
  }

  const target = input.targetDurationSec ?? 35;
  const end = Math.min(Math.max(input.durationSec, 1), target);

  return {
    replayVideoBlobId: input.rawVideoBlobId,
    replayLabel: input.durationSec > target ? `avatar remix plan, 0-${Math.round(end)}s` : 'avatar capture',
    replayStartSec: 0,
    replayEndSec: end
  };
}

export async function createEpisodeDraft(input: EpisodeDraftInput): Promise<EpisodeDraft> {
  for (const progress of [0.2, 0.46, 0.74, 1]) {
    await wait(170);
    input.onProgress?.(progress);
  }

  const transcript = normalizeTranscript(
    input.transcriptText || input.transcriptCues?.map((cue) => cue.text).join(' ') || ''
  );
  const durationSec = Math.max(input.durationSec, 1);
  const language = detectLanguage(transcript);
  const topic = inferTopic(transcript, language);
  const title = inferTitle(topic, input.createdAt, language);
  const tags = inferTags(transcript, topic, language);
  const replayEndSec = Math.min(durationSec, 35);
  const moments = createMoments(
    transcript,
    durationSec,
    replayEndSec,
    language,
    input.transcriptCues ?? [],
    input.faceTrace ?? []
  );

  return {
    title,
    tags,
    replaySegments: moments,
    replayStartSec: 0,
    replayEndSec,
    aiSummary: {
      title,
      topic,
      summary: createSummary(topic, transcript, language),
      language,
      suggestedTags: tags,
      moments,
      generatedAt: new Date().toISOString(),
      pipeline: 'local-stub'
    }
  };
}

export async function transcribeStub(title: string) {
  await wait(520);
  return `Draft transcript for "${title}". TODO: connect approved speech-to-text and LLM clip selection.`;
}

function normalizeTranscript(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function detectLanguage(transcript: string): EpisodeAiSummary['language'] {
  if (!transcript) {
    return 'unknown';
  }
  const hasChinese = /[\u3400-\u9fff]/.test(transcript);
  const hasLatin = /[a-z]/i.test(transcript);
  if (hasChinese && hasLatin) {
    return 'mixed';
  }
  if (hasChinese) {
    return 'zh';
  }
  if (hasLatin) {
    return 'en';
  }
  return 'unknown';
}

function inferTitle(topic: string, createdAt: Date, language: EpisodeAiSummary['language']) {
  const time = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (language === 'zh' || language === 'mixed') {
    return `${topic} ${time}`;
  }
  return topic === 'Regret moment' ? `Regret note ${time}` : `${topic} ${time}`;
}

function inferTopic(transcript: string, language: EpisodeAiSummary['language']) {
  const lower = transcript.toLowerCase();
  const checks: Array<[string, string, RegExp]> = [
    ['Scrolling', '刷手机', /scroll|phone|tiktok|instagram|手机|短视频|刷/],
    ['Snack', '零食冲动', /snack|eat|food|sugar|零食|吃|奶茶|甜/],
    ['Study', '学习压力', /study|work|deadline|class|lab|学习|作业|论文|实验室/],
    ['Sleep', '熬夜', /sleep|late|bed|熬夜|睡/],
    ['Money', '消费冲动', /buy|spend|shopping|钱|买|消费/]
  ];
  const match = checks.find(([, , pattern]) => pattern.test(lower));
  if (!match) {
    return language === 'zh' || language === 'mixed' ? '后悔时刻' : 'Regret moment';
  }
  return language === 'zh' || language === 'mixed' ? match[1] : match[0];
}

function inferTags(transcript: string, topic: string, language: EpisodeAiSummary['language']) {
  const tags = new Set<string>();
  tags.add(language === 'zh' || language === 'mixed' ? 'AI草稿' : 'AI draft');
  tags.add(topic);

  const lower = transcript.toLowerCase();
  if (/again|重复|再/.test(lower)) {
    tags.add(language === 'zh' || language === 'mixed' ? '重复' : 'repeat');
  }
  if (/tempt|urge|想要|冲动/.test(lower)) {
    tags.add(language === 'zh' || language === 'mixed' ? '冲动' : 'urge');
  }
  if (/regret|后悔|不该/.test(lower)) {
    tags.add(language === 'zh' || language === 'mixed' ? '后悔' : 'regret');
  }

  return [...tags].slice(0, 5);
}

function createSummary(topic: string, transcript: string, language: EpisodeAiSummary['language']) {
  if (transcript) {
    const excerpt = transcript.length > 90 ? `${transcript.slice(0, 90)}...` : transcript;
    return language === 'zh' || language === 'mixed'
      ? `主题：${topic}。草稿摘要：${excerpt}`
      : `Topic: ${topic}. Draft summary: ${excerpt}`;
  }

  return language === 'zh' || language === 'mixed'
    ? `主题：${topic}。等待真实转写和 LLM 剪辑。`
    : `Topic: ${topic}. Waiting for speech-to-text and LLM clip selection.`;
}

function createMoments(
  transcript: string,
  durationSec: number,
  replayEndSec: number,
  language: EpisodeAiSummary['language'],
  transcriptCues: TranscriptCue[] = [],
  faceTrace: FaceSample[] = []
) {
  const cueMoments = createCueMoments(transcriptCues, durationSec, language, faceTrace);
  if (cueMoments.length > 0) {
    return cueMoments;
  }

  const sentences = splitTranscript(transcript);
  const labels =
    language === 'zh' || language === 'mixed'
      ? ['开头', '最后悔的一句', '下一次选择']
      : ['Opening', 'Regret line', 'Next choice'];

  const slots = createFallbackSlots(durationSec, replayEndSec);
  return slots.map((slot, index) => ({
    id: `moment-${index + 1}`,
    startSec: roundTime(slot.start),
    endSec: roundTime(slot.end),
    label: labels[index] ?? labels[0],
    quote: sentences[index] ?? defaultMomentQuote(index, language),
    intensity: index === 1 ? 0.92 : index === 0 ? 0.68 : 0.74
  }));
}

function createCueMoments(
  transcriptCues: TranscriptCue[],
  durationSec: number,
  language: EpisodeAiSummary['language'],
  faceTrace: FaceSample[]
): EpisodeMoment[] {
  const duration = Math.max(durationSec, 1);
  const seen = new Set<string>();
  const candidates = transcriptCues
    .map((cue, index) => ({
      cue,
      index,
      score: scoreCue(cue.text, language) + expressionScoreNear(faceTrace, cue.tSec)
    }))
    .filter(({ cue }) => {
      const text = normalizeTranscript(cue.text);
      if (text.length <= 1 || !Number.isFinite(cue.tSec) || seen.has(text)) {
        return false;
      }
      seen.add(text);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.cue.tSec - b.cue.tSec);

  return candidates.map(({ cue, score }, index) => {
    const start = clamp(cue.tSec - 2.2, 0, Math.max(duration - 1.5, 0));
    const end = clamp(cue.tSec + (score > 2 ? 6.8 : 5.4), start + 2.2, duration);
    return {
      id: `moment-${index + 1}`,
      startSec: roundTime(start),
      endSec: roundTime(end),
      label: score > 2 ? labelFor(language, 'Regret line') : labelFor(language, index === 0 ? 'Opening' : 'Next choice'),
      quote: normalizeTranscript(cue.text),
      intensity: Math.min(0.98, 0.58 + score * 0.1)
    };
  });
}

function createFallbackSlots(durationSec: number, replayEndSec: number) {
  const duration = Math.max(durationSec, 1);
  const end = Math.min(Math.max(replayEndSec, 1), duration);
  const slots = [
    { start: duration > 10 ? 2 : 0, end: Math.min(duration > 10 ? 8 : duration, end) },
    {
      start: clamp(duration * 0.38, 0, Math.max(end - 2, 0)),
      end: clamp(duration * 0.38 + 8, 1, end)
    },
    { start: Math.max(end - 7, 0), end }
  ];

  return slots.filter((slot) => slot.end - slot.start >= 1);
}

function scoreCue(text: string, language: EpisodeAiSummary['language']) {
  const normalized = normalizeTranscript(text).toLowerCase();
  let score = Math.min(normalized.length / 80, 1);
  const regretPattern =
    language === 'zh' || language === 'mixed'
      ? /后悔|不该|不要|停下|忍住|下次|重复|冲动|难受|浪费/
      : /regret|shouldn't|should not|stop|pause|urge|again|next time|waste|tempt|sorry/;
  if (regretPattern.test(normalized)) {
    score += 1.8;
  }
  if (/[!?！？]/.test(normalized)) {
    score += 0.4;
  }
  return score;
}

function expressionScoreNear(faceTrace: FaceSample[], tSec: number) {
  if (!faceTrace.length || !Number.isFinite(tSec)) {
    return 0;
  }
  const centerMs = tSec * 1000;
  const nearby = faceTrace.filter((sample) => Math.abs(sample.t - centerMs) < 2200);
  if (!nearby.length) {
    return 0;
  }
  return nearby.reduce((best, sample) => {
    const intensity =
      sample.mouthOpen * 0.7 +
      Math.abs(sample.yaw) * 0.18 +
      Math.abs(sample.pitch) * 0.18 +
      Math.max(sample.blinkLeft, sample.blinkRight) * 0.08;
    return Math.max(best, intensity);
  }, 0);
}

function labelFor(language: EpisodeAiSummary['language'], label: string) {
  if (language !== 'zh' && language !== 'mixed') {
    return label;
  }
  if (label === 'Regret line') {
    return '关键句';
  }
  if (label === 'Next choice') {
    return '下一次';
  }
  return '开头';
}

function splitTranscript(transcript: string) {
  if (!transcript) {
    return [];
  }
  return transcript
    .split(/(?<=[。！？!?])\s+|[。！？!?]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function defaultMomentQuote(index: number, language: EpisodeAiSummary['language']) {
  if (language === 'zh' || language === 'mixed') {
    return ['我正在记录这个后悔感。', '这里会放最关键的一句话。', '回放时提醒自己暂停一下。'][index];
  }
  return ['I am capturing this regret now.', 'The strongest regret line will appear here.', 'Replay this before repeating it.'][index];
}

function clamp(value: number, min: number, max: number) {
  if (max <= min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function roundTime(value: number) {
  return Math.round(value * 10) / 10;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
