export interface EncodingResult {
  replayVideoBlobId: string;
  replayLabel: string;
  replayStartSec: number;
  replayEndSec: number;
}

interface PlaceholderEncodingInput {
  rawVideoBlobId: string;
  durationSec: number;
  onProgress?: (progress: number) => void;
}

export async function createReplayClipPlaceholder(input: PlaceholderEncodingInput): Promise<EncodingResult> {
  for (const progress of [0.18, 0.42, 0.7, 1]) {
    await wait(260);
    input.onProgress?.(progress);
  }

  const end = Math.min(Math.max(input.durationSec, 1), 60);

  return {
    replayVideoBlobId: input.rawVideoBlobId,
    replayLabel: input.durationSec > 60 ? 'raw capture, 0-60s pointer' : 'raw capture',
    replayStartSec: 0,
    replayEndSec: end
  };
}

export async function transcribeStub(title: string) {
  await wait(520);
  return `Stub transcript for "${title}". TODO: plug in local or approved speech-to-text pipeline.`;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
