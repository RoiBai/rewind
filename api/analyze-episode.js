import { Buffer } from 'node:buffer';

export const config = {
  maxDuration: 60
};

const MAX_JSON_BYTES = 8 * 1024 * 1024;

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: 'OPENAI_API_KEY is not configured' });
    return;
  }

  try {
    const payload = await readJson(req);
    const durationSec = clampNumber(Number(payload.durationSec), 1, 600);
    const localTranscript = normalizeText(payload.localTranscript || '');
    const localCues = sanitizeInputCues(payload.transcriptCues);
    const faceTrace = sanitizeFaceTrace(payload.faceTrace);

    const transcription = await transcribeAudio(payload).catch((error) => {
      console.warn('OpenAI transcription failed.', error);
      return null;
    });

    const transcriptText = normalizeText(transcription?.text || localTranscript);
    const transcriptCues = transcription?.cues?.length ? transcription.cues : localCues;
    const language = detectLanguage(transcriptText);

    const localPlan = buildLocalClipPlan({
      transcriptText,
      transcriptCues,
      faceTrace,
      durationSec,
      language
    });

    const llmPlan = transcriptText
      ? await selectClipsWithLlm({
          transcriptText,
          transcriptCues,
          faceTrace,
          durationSec,
          language,
          localPlan
        }).catch((error) => {
          console.warn('OpenAI clip selection failed.', error);
          return null;
        })
      : null;

    const plan = normalizePlan(llmPlan || localPlan, {
      transcriptText,
      durationSec,
      language,
      fallbackPlan: localPlan,
      pipeline: llmPlan ? 'openai-stt-llm' : transcription ? 'openai-stt-local-plan' : 'remote-fallback'
    });

    res.status(200).json(plan);
  } catch (error) {
    console.error('Episode analysis failed.', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Episode analysis failed' });
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.REWIND_ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}');
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) {
      throw new Error('Request too large. Send audio-only, not full video.');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function transcribeAudio(payload) {
  const audioBase64 = String(payload.audioBase64 || '');
  if (!audioBase64) {
    return null;
  }

  const audioMimeType = String(payload.audioMimeType || 'audio/webm').split(';')[0];
  const audioBytes = Buffer.from(audioBase64, 'base64');
  if (!audioBytes.length) {
    return null;
  }

  const formData = new FormData();
  formData.append('file', new Blob([audioBytes], { type: audioMimeType }), `episode.${extensionForMime(audioMimeType)}`);
  formData.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch(`${getOpenAiBaseUrl()}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Transcription failed with ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    text: normalizeText(data.text || ''),
    cues: Array.isArray(data.segments)
      ? data.segments
          .map((segment) => ({
            text: normalizeText(segment.text || ''),
            tSec: clampNumber(Number(segment.start), 0, 600),
            endSec: clampNumber(Number(segment.end), 0, 600)
          }))
          .filter((cue) => cue.text && cue.endSec > cue.tSec)
      : []
  };
}

async function selectClipsWithLlm(input) {
  const model = process.env.OPENAI_CLIP_MODEL || 'gpt-4.1-mini';
  const response = await fetch(`${getOpenAiBaseUrl()}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content:
            'You create concise research-prototype replay clips. Return only JSON that follows the schema. Do not claim clinical effectiveness.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            goal:
              'Condense a regret capture into a TikTok-like 20-35 second replay using the user voice and cat avatar recording.',
            transcriptText: input.transcriptText,
            transcriptCues: input.transcriptCues.slice(0, 60),
            faceTrace: summarizeFaceTrace(input.faceTrace),
            durationSec: input.durationSec,
            language: input.language,
            fallbackPlan: input.localPlan
          })
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'rewind_clip_plan',
          strict: true,
          schema: clipPlanSchema()
        }
      },
      max_output_tokens: 1400
    })
  });

  if (!response.ok) {
    const fallback = await selectClipsWithChatCompletion(input).catch((error) => {
      console.warn('Chat Completions clip selection fallback failed.', error);
      return null;
    });
    if (fallback) {
      return fallback;
    }
    throw new Error(`Responses clip selection failed with ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.output_text || findOutputText(data);
  if (!text) {
    throw new Error('No structured clip plan returned.');
  }
  return JSON.parse(text);
}

async function selectClipsWithChatCompletion(input) {
  const model = process.env.OPENAI_CLIP_MODEL || 'gpt-4.1-mini';
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You create concise research-prototype replay clips. Return only JSON that follows the schema. Do not claim clinical effectiveness.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          goal:
            'Condense a regret capture into a TikTok-like 20-35 second replay using the user voice and cat avatar recording.',
          transcriptText: input.transcriptText,
          transcriptCues: input.transcriptCues.slice(0, 60),
          faceTrace: summarizeFaceTrace(input.faceTrace),
          durationSec: input.durationSec,
          language: input.language,
          fallbackPlan: input.localPlan
        })
      }
    ],
    temperature: 0.2,
    max_tokens: 1400,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'rewind_clip_plan',
        strict: true,
        schema: clipPlanSchema()
      }
    }
  };

  let response = await fetch(`${getOpenAiBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (response.status === 400 || response.status === 422) {
    response = await fetch(`${getOpenAiBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...body,
        response_format: { type: 'json_object' }
      })
    });
  }

  if (!response.ok) {
    throw new Error(`Chat clip selection failed with ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('No chat clip plan returned.');
  }
  return JSON.parse(text);
}

function clipPlanSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'topic', 'summary', 'tags', 'moments'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 60 },
      topic: { type: 'string', minLength: 1, maxLength: 60 },
      summary: { type: 'string', minLength: 1, maxLength: 220 },
      tags: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: { type: 'string', minLength: 1, maxLength: 24 }
      },
      moments: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'startSec', 'endSec', 'label', 'quote', 'intensity'],
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 40 },
            startSec: { type: 'number', minimum: 0 },
            endSec: { type: 'number', minimum: 0 },
            label: { type: 'string', minLength: 1, maxLength: 36 },
            quote: { type: 'string', minLength: 1, maxLength: 96 },
            intensity: { type: 'number', minimum: 0, maximum: 1 }
          }
        }
      }
    }
  };
}

function getOpenAiBaseUrl() {
  const raw = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function buildLocalClipPlan({ transcriptText, transcriptCues, faceTrace, durationSec, language }) {
  const topic = inferTopic(transcriptText, language);
  const title = language === 'zh' || language === 'mixed' ? `${topic}回放` : `${topic} replay`;
  const cues = transcriptCues.length
    ? transcriptCues
    : [{ text: transcriptText || defaultQuote(language), tSec: durationSec > 8 ? 2 : 0, endSec: Math.min(durationSec, 8) }];

  const scored = cues
    .map((cue, index) => ({
      cue,
      index,
      score: scoreCue(cue.text, language) + expressionScoreNear(faceTrace, cue.tSec)
    }))
    .filter(({ cue }) => cue.text)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.cue.tSec - b.cue.tSec);

  const moments = scored.map(({ cue, score }, index) => {
    const startSec = clampNumber(cue.tSec - 1.6, 0, Math.max(durationSec - 1, 0));
    const preferredEnd = cue.endSec && cue.endSec > cue.tSec ? cue.endSec + 1.2 : cue.tSec + (score > 2 ? 7 : 5.5);
    return {
      id: `moment-${index + 1}`,
      startSec,
      endSec: clampNumber(preferredEnd, startSec + 1.5, durationSec),
      label: score > 2 ? labelFor(language, 'Regret line') : labelFor(language, index === 0 ? 'Opening' : 'Next choice'),
      quote: cue.text,
      intensity: clampNumber(0.58 + score * 0.1, 0.35, 0.98)
    };
  });

  return {
    title,
    topic,
    summary:
      language === 'zh' || language === 'mixed'
        ? `从录音中选出 ${moments.length || 1} 个后悔片段。`
        : `Selected ${moments.length || 1} regret replay moments from the recording.`,
    tags: language === 'zh' || language === 'mixed' ? ['AI剪辑', topic] : ['AI cut', topic],
    moments: moments.length ? moments : fallbackMoments(durationSec, language)
  };
}

function normalizePlan(plan, { transcriptText, durationSec, language, fallbackPlan, pipeline }) {
  const topic = normalizeText(plan.topic || fallbackPlan.topic || inferTopic(transcriptText, language));
  const title = normalizeText(plan.title || fallbackPlan.title || topic);
  const tags = sanitizeTags(plan.tags || fallbackPlan.tags || ['AI cut']);
  const moments = sanitizeMoments(plan.moments || fallbackPlan.moments || [], durationSec);
  const safeMoments = moments.length ? moments : sanitizeMoments(fallbackPlan.moments || fallbackMoments(durationSec, language), durationSec);
  const summary = normalizeText(plan.summary || fallbackPlan.summary || topic);

  return {
    title,
    tags,
    transcriptText,
    replayStartSec: Math.min(...safeMoments.map((moment) => moment.startSec)),
    replayEndSec: Math.min(35, Math.max(...safeMoments.map((moment) => moment.endSec))),
    replaySegments: safeMoments,
    aiSummary: {
      title,
      topic,
      summary,
      language,
      suggestedTags: tags,
      moments: safeMoments,
      generatedAt: new Date().toISOString(),
      pipeline
    }
  };
}

function sanitizeInputCues(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((cue) => ({
      text: normalizeText(cue?.text || ''),
      tSec: clampNumber(Number(cue?.tSec), 0, 600),
      endSec: cue?.endSec ? clampNumber(Number(cue.endSec), 0, 600) : undefined
    }))
    .filter((cue) => cue.text);
}

function sanitizeFaceTrace(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((sample) => ({
      t: Number(sample?.t) || 0,
      mouthOpen: Number(sample?.mouthOpen) || 0,
      blinkLeft: Number(sample?.blinkLeft) || 0,
      blinkRight: Number(sample?.blinkRight) || 0,
      yaw: Number(sample?.yaw) || 0,
      pitch: Number(sample?.pitch) || 0,
      faceScale: Number(sample?.faceScale) || 1
    }))
    .filter((sample) => sample.t >= 0)
    .slice(0, 300);
}

function sanitizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map((tag) => normalizeText(tag)).filter(Boolean))].slice(0, 5);
}

function sanitizeMoments(moments, durationSec) {
  return (Array.isArray(moments) ? moments : [])
    .map((moment, index) => {
      const startSec = clampNumber(Number(moment?.startSec), 0, Math.max(durationSec - 0.5, 0));
      const endSec = clampNumber(Number(moment?.endSec), startSec + 1.2, durationSec);
      return {
        id: normalizeText(moment?.id || '') || `moment-${index + 1}`,
        startSec: roundTime(startSec),
        endSec: roundTime(endSec),
        label: normalizeText(moment?.label || '') || `Moment ${index + 1}`,
        quote: normalizeText(moment?.quote || ''),
        intensity: clampNumber(Number(moment?.intensity), 0.35, 1)
      };
    })
    .filter((moment) => moment.endSec > moment.startSec && moment.quote)
    .slice(0, 4);
}

function fallbackMoments(durationSec, language) {
  const end = Math.min(durationSec, 8);
  return [
    {
      id: 'moment-1',
      startSec: 0,
      endSec: Math.max(1.5, end),
      label: labelFor(language, 'Opening'),
      quote: defaultQuote(language),
      intensity: 0.6
    }
  ];
}

function detectLanguage(transcript) {
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

function inferTopic(transcript, language) {
  const lower = transcript.toLowerCase();
  const checks = [
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

function scoreCue(text, language) {
  const normalized = normalizeText(text).toLowerCase();
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

function expressionScoreNear(faceTrace, tSec) {
  const centerMs = tSec * 1000;
  const nearby = faceTrace.filter((sample) => Math.abs(sample.t - centerMs) < 2200);
  return nearby.reduce((best, sample) => {
    const intensity =
      sample.mouthOpen * 0.7 +
      Math.abs(sample.yaw) * 0.18 +
      Math.abs(sample.pitch) * 0.18 +
      Math.max(sample.blinkLeft, sample.blinkRight) * 0.08;
    return Math.max(best, intensity);
  }, 0);
}

function summarizeFaceTrace(faceTrace) {
  return faceTrace
    .filter((_, index) => index % 4 === 0)
    .map((sample) => ({
      tSec: Math.round((sample.t / 1000) * 10) / 10,
      mouthOpen: roundTime(sample.mouthOpen),
      blink: roundTime(Math.max(sample.blinkLeft, sample.blinkRight)),
      yaw: roundTime(sample.yaw),
      pitch: roundTime(sample.pitch),
      faceScale: roundTime(sample.faceScale || 1)
    }))
    .slice(0, 80);
}

function labelFor(language, label) {
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

function defaultQuote(language) {
  return language === 'zh' || language === 'mixed' ? '我正在记录这个后悔感。' : 'I am capturing this regret now.';
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (max <= min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function roundTime(value) {
  return Math.round(value * 10) / 10;
}

function extensionForMime(mimeType) {
  if (mimeType.includes('mp4')) {
    return 'mp4';
  }
  if (mimeType.includes('mpeg')) {
    return 'mp3';
  }
  if (mimeType.includes('wav')) {
    return 'wav';
  }
  if (mimeType.includes('aac')) {
    return 'aac';
  }
  return 'webm';
}

function findOutputText(data) {
  const queue = [data];
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (typeof item.text === 'string') {
      return item.text;
    }
    if (Array.isArray(item)) {
      queue.push(...item);
    } else {
      queue.push(...Object.values(item));
    }
  }
  return '';
}
