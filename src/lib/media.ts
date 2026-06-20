export function getSupportedVideoMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=h264,aac',
    'video/mp4'
  ];

  if (!('MediaRecorder' in window)) {
    return '';
  }

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function stopStream(stream?: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function getVideoDurationFromBlob(blob: Blob) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
