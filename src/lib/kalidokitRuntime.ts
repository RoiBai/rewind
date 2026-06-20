type KalidokitRuntime = {
  Face?: { solve?: (...args: unknown[]) => unknown };
  Pose?: { solve?: (...args: unknown[]) => unknown };
  Hand?: { solve?: (...args: unknown[]) => unknown };
};

let runtimePromise: Promise<KalidokitRuntime> | null = null;

export function loadKalidokitRuntime() {
  runtimePromise ??= import('kalidokit/dist/kalidokit.es.js').then((module) => module as KalidokitRuntime);
  return runtimePromise;
}

export async function getKalidokitStatus() {
  try {
    const runtime = await loadKalidokitRuntime();
    const parts = [
      runtime.Face?.solve ? 'Face' : '',
      runtime.Pose?.solve ? 'Pose' : '',
      runtime.Hand?.solve ? 'Hand' : ''
    ].filter(Boolean);

    return parts.length > 0 ? `Kalidokit ${parts.join('+')}` : 'Kalidokit partial';
  } catch {
    return 'Kalidokit unavailable';
  }
}
