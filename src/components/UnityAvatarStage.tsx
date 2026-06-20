import { useEffect, useRef, useState } from 'react';
import { CatExpression, neutralExpression } from '../lib/faceTracking';

interface UnityAvatarStageProps {
  expression?: CatExpression;
  poseClip?: string;
  lookMode?: UnityLookMode;
  className?: string;
  label?: string;
}

export type UnityLookMode = 'official' | 'stable';

interface UnityInstance {
  SendMessage(gameObject: string, method: string, value?: string): void;
  Quit(): Promise<void>;
}

type CreateUnityInstance = (
  canvas: HTMLCanvasElement,
  config: Record<string, unknown>,
  onProgress?: (progress: number) => void
) => Promise<UnityInstance>;

interface PosePacket {
  yaw?: number;
  pitch?: number;
  roll?: number;
  leftHandRaise?: number;
  rightHandRaise?: number;
  leftHandX?: number;
  rightHandX?: number;
  leftHandY?: number;
  rightHandY?: number;
  leftCoverMouth?: number;
  rightCoverMouth?: number;
  leftCoverEyes?: number;
  rightCoverEyes?: number;
  leftGesture?: string;
  rightGesture?: string;
}

const BUILD_ROOT = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/unity/rewind-avatar`;
const BUILD_NAME = 'rewind-avatar';
const BUILD_VERSION = 'unity-v88-mobile-angle-idle-arms-20260621';
const UNITY_OBJECT = 'RewindAvatar';

export function UnityAvatarStage({
  expression = neutralExpression,
  poseClip = 'RigLab_Neutral',
  lookMode = 'official',
  className = '',
  label = 'Unity cat avatar'
}: UnityAvatarStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const unityRef = useRef<UnityInstance | null>(null);
  const expressionRef = useRef(expression);
  const poseClipRef = useRef(poseClip);
  const lookModeRef = useRef<UnityLookMode>(lookMode);
  const [status, setStatus] = useState('Loading Unity');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    expressionRef.current = expression;
  }, [expression]);

  useEffect(() => {
    poseClipRef.current = poseClip;
  }, [poseClip]);

  useEffect(() => {
    lookModeRef.current = lookMode;
    if (unityRef.current) {
      unityRef.current.SendMessage(UNITY_OBJECT, 'SetLookMode', lookMode);
    }
  }, [lookMode]);

  useEffect(() => {
    let cancelled = false;
    let sendFrame = 0;
    let lastSentAt = 0;

    async function boot() {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      try {
        await loadUnityLoader();
        if (cancelled) {
          return;
        }

        const createUnityInstance = window.createUnityInstance;
        if (!createUnityInstance) {
          throw new Error('Unity loader did not expose createUnityInstance.');
        }

        const unity = await createUnityInstance(
          canvas,
          {
            dataUrl: withBuildVersion(`${BUILD_ROOT}/Build/${BUILD_NAME}.data`),
            frameworkUrl: withBuildVersion(`${BUILD_ROOT}/Build/${BUILD_NAME}.framework.js`),
            codeUrl: withBuildVersion(`${BUILD_ROOT}/Build/${BUILD_NAME}.wasm`),
            streamingAssetsUrl: `${BUILD_ROOT}/StreamingAssets`,
            companyName: 'CityU Shen Lab',
            productName: 'Rewind Avatar',
            productVersion: '0.1'
          },
          (nextProgress) => {
            if (!cancelled) {
              setProgress(nextProgress);
              setStatus(`Unity ${Math.round(nextProgress * 100)}%`);
            }
          }
        );

        if (cancelled) {
          void unity.Quit();
          return;
        }

        unityRef.current = unity;
        unity.SendMessage(UNITY_OBJECT, 'SetLookMode', lookModeRef.current);
        setStatus('Unity ready');

        const sendLoop = (now: number) => {
          if (cancelled) {
            return;
          }
          if (unityRef.current && now - lastSentAt > 33) {
            sendTracking(unityRef.current, expressionRef.current, poseClipRef.current);
            lastSentAt = now;
          }
          sendFrame = window.requestAnimationFrame(sendLoop);
        };
        sendFrame = window.requestAnimationFrame(sendLoop);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unity failed');
      }
    }

    void boot();

    return () => {
      cancelled = true;
      if (sendFrame) {
        window.cancelAnimationFrame(sendFrame);
      }
      const unity = unityRef.current;
      unityRef.current = null;
      if (unity) {
        void unity.Quit();
      }
    };
  }, []);

  return (
    <div className={`cat-avatar unity-avatar ${className}`} aria-label={label}>
      <canvas id="rewind-unity-canvas" ref={canvasRef} className="unity-avatar__canvas" />
      {status !== 'Unity ready' && (
        <div className="unity-avatar__overlay">
          <span>{status}</span>
          {progress > 0 && <div style={{ width: `${Math.round(progress * 100)}%` }} />}
        </div>
      )}
      <div className="cat-avatar__badge">{status === 'Unity ready' ? 'Unity ready' : status}</div>
    </div>
  );
}

function sendTracking(unity: UnityInstance, expression: CatExpression, poseClip: string) {
  unity.SendMessage(UNITY_OBJECT, 'ApplyTrackingJson', JSON.stringify(toTrackingPacket(expression, poseClip)));
}

function toTrackingPacket(expression: CatExpression, poseClip: string) {
  const pose = poseToPacket(poseClip);
  const leftGesture = pose.leftGesture ?? '';
  const rightGesture = pose.rightGesture ?? '';
  return {
    mouthOpen: expression.mouthOpen,
    mouthPucker: Math.max(expression.mouthPucker, expression.mouthFunnel),
    mouthWide: expression.mouthWide,
    smile: expression.smile,
    blinkLeft: expression.blinkLeft,
    blinkRight: expression.blinkRight,
    yaw: pose.yaw ?? expression.yaw,
    pitch: pose.pitch ?? expression.pitch,
    roll: pose.roll ?? 0,
    leftHandRaise: Math.max(expression.leftHandRaise, pose.leftHandRaise ?? 0),
    rightHandRaise: Math.max(expression.rightHandRaise, pose.rightHandRaise ?? 0),
    leftHandX: pose.leftHandX ?? expression.leftHandX,
    rightHandX: pose.rightHandX ?? expression.rightHandX,
    leftHandY: pose.leftHandY ?? expression.leftHandY,
    rightHandY: pose.rightHandY ?? expression.rightHandY,
    leftCoverMouth: Math.max(expression.leftCoverMouth, pose.leftCoverMouth ?? 0),
    rightCoverMouth: Math.max(expression.rightCoverMouth, pose.rightCoverMouth ?? 0),
    leftCoverEyes: Math.max(expression.leftCoverEyes, pose.leftCoverEyes ?? 0),
    rightCoverEyes: Math.max(expression.rightCoverEyes, pose.rightCoverEyes ?? 0),
    leftGesture,
    rightGesture,
    poseClip
  };
}

function poseToPacket(poseClip: string): PosePacket {
  switch (poseClip) {
    case 'RigLab_Head_Tilt_L':
      return { roll: -0.8 };
    case 'RigLab_Head_Tilt_R':
      return { roll: 0.8 };
    case 'RigLab_Head_Turn_L':
      return { yaw: -0.8 };
    case 'RigLab_Head_Turn_R':
      return { yaw: 0.8 };
    case 'RigLab_Head_Up':
      return { pitch: -0.75 };
    case 'RigLab_Head_Down':
      return { pitch: 0.75 };
    case 'RigLab_Left_Raise':
      return { leftGesture: 'raise', leftHandRaise: 1 };
    case 'RigLab_Right_Raise':
      return { rightGesture: 'raise', rightHandRaise: 1 };
    case 'RigLab_Left_Mouth':
      return { leftGesture: 'mouth', leftCoverMouth: 1 };
    case 'RigLab_Right_Mouth':
      return { rightGesture: 'mouth', rightCoverMouth: 1 };
    case 'RigLab_Left_Eyes':
      return { leftGesture: 'eyes', leftCoverEyes: 1 };
    case 'RigLab_Right_Eyes':
      return { rightGesture: 'eyes', rightCoverEyes: 1 };
    default:
      return {};
  }
}

function loadUnityLoader() {
  const src = withBuildVersion(`${BUILD_ROOT}/Build/${BUILD_NAME}.loader.js`);
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) {
    return window.createUnityInstance ? Promise.resolve() : loadUnityLoaderViaEval(src);
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (window.createUnityInstance) {
        resolve();
        return;
      }
      void loadUnityLoaderViaEval(src).then(resolve).catch(reject);
    };
    script.onerror = () => reject(new Error('Unity build missing. Run Unity WebGL build.'));
    document.body.append(script);
  });
}

function withBuildVersion(url: string) {
  return `${url}?v=${BUILD_VERSION}`;
}

async function loadUnityLoaderViaEval(src: string) {
  const response = await fetch(src, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Unity build missing. Run Unity WebGL build.');
  }
  const source = await response.text();
  const factory = new Function(`${source}; return createUnityInstance;`);
  const createUnityInstance = factory() as CreateUnityInstance | undefined;
  if (!createUnityInstance) {
    throw new Error('Unity loader did not expose createUnityInstance.');
  }
  window.createUnityInstance = createUnityInstance;
}

declare global {
  interface Window {
    createUnityInstance?: CreateUnityInstance;
  }
}
