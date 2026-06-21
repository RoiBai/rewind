import { EpisodeAiSummary, EpisodeMoment } from '../types';

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
    replayLabel: input.durationSec > target ? `avatar cut plan, 0-${Math.round(end)}s` : 'avatar capture',
    replayStartSec: 0,
    replayEndSec: end
  };
}

export async function createEpisodeDraft(input: EpisodeDraftInput): Promise<EpisodeDraft> {
  for (const progress of [0.2, 0.46, 0.74, 1]) {
    await wait(170);
    input.onProgress?.(progress);
  }

  const transcript = normalizeTranscript(input.transcriptText);
  const language = detectLanguage(transcript);
  const topic = inferTopic(transcript, language);
  const title = inferTitle(topic, input.createdAt, language);
  const tags = inferTags(transcript, topic, language);
  const replayEndSec = Math.min(Math.max(input.durationSec, 1), 35);
  const moments = createMoments(transcript, input.durationSec, replayEndSec, language);

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
    return topic === 'Regret moment' ? `后悔片段 ${time}` : `${topic} · ${time}`;
  }
  return topic === 'Regret moment' ? `Regret note ${time}` : `${topic} · ${time}`;
}

function inferTopic(transcript: string, language: EpisodeAiSummary['language']) {
  const lower = transcript.toLowerCase();
  const checks: Array<[string, RegExp]> = [
    ['Scrolling', /scroll|phone|tiktok|instagram|刷|手机|短视频|视频/],
    ['Snack', /snack|eat|food|sugar|甜|零食|吃|奶茶/],
    ['Study', /study|work|deadline|class|lab|学习|作业|论文|实验室/],
    ['Sleep', /sleep|late|bed|熬夜|睡|困/],
    ['Money', /buy|spend|shopping|钱|买|消费/]
  ];
  const match = checks.find(([, pattern]) => pattern.test(lower));
  if (!match) {
    return language === 'zh' || language === 'mixed' ? '后悔时刻' : 'Regret moment';
  }
  if ((language === 'zh' || language === 'mixed') && match[0] === 'Scrolling') {
    return '刷手机';
  }
  if ((language === 'zh' || language === 'mixed') && match[0] === 'Snack') {
    return '零食冲动';
  }
  if ((language === 'zh' || language === 'mixed') && match[0] === 'Study') {
    return '学习压力';
  }
  if ((language === 'zh' || language === 'mixed') && match[0] === 'Sleep') {
    return '熬夜';
  }
  if ((language === 'zh' || language === 'mixed') && match[0] === 'Money') {
    return '消费冲动';
  }
  return match[0];
}

function inferTags(transcript: string, topic: string, language: EpisodeAiSummary['language']) {
  const tags = new Set<string>();
  tags.add(language === 'zh' || language === 'mixed' ? 'AI草稿' : 'AI draft');
  tags.add(topic);

  const lower = transcript.toLowerCase();
  if (/again|重复|又/.test(lower)) {
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
  language: EpisodeAiSummary['language']
) {
  const sentences = splitTranscript(transcript);
  const labels =
    language === 'zh' || language === 'mixed'
      ? ['开头', '最后悔的一句', '下次选择']
      : ['Opening', 'Regret line', 'Next choice'];

  const slots = [
    { start: 0, end: Math.min(8, replayEndSec) },
    { start: Math.min(Math.max(durationSec * 0.35, 8), Math.max(replayEndSec - 12, 0)), end: Math.min(Math.max(durationSec * 0.35 + 10, 18), replayEndSec) },
    { start: Math.max(replayEndSec - 8, 0), end: replayEndSec }
  ];

  return slots
    .filter((slot) => slot.end > slot.start)
    .map((slot, index) => ({
      id: `moment-${index + 1}`,
      startSec: roundTime(slot.start),
      endSec: roundTime(slot.end),
      label: labels[index] ?? labels[0],
      quote: sentences[index] ?? defaultMomentQuote(index, language),
      intensity: index === 1 ? 0.92 : index === 0 ? 0.68 : 0.74
    }));
}

function splitTranscript(transcript: string) {
  if (!transcript) {
    return [];
  }
  return transcript
    .split(/(?<=[。！？.!?])\s+|[。！？!?]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function defaultMomentQuote(index: number, language: EpisodeAiSummary['language']) {
  if (language === 'zh' || language === 'mixed') {
    return ['我现在正在记录这个后悔感。', '这里会放最关键的一句。', '回放时提醒自己暂停一下。'][index];
  }
  return ['I am capturing this regret now.', 'The strongest regret line will appear here.', 'Replay this before repeating it.'][index];
}

function roundTime(value: number) {
  return Math.round(value * 10) / 10;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
