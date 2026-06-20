import { FaceSample } from '../types';

export interface CatExpression {
  mouthOpen: number;
  mouthFunnel: number;
  mouthPucker: number;
  mouthWide: number;
  mouthPress: number;
  blinkLeft: number;
  blinkRight: number;
  yaw: number;
  pitch: number;
  smile: number;
  leftHandRaise: number;
  rightHandRaise: number;
  leftHandX: number;
  rightHandX: number;
  leftHandY: number;
  rightHandY: number;
  leftHandOpen: number;
  rightHandOpen: number;
  leftHandPinch: number;
  rightHandPinch: number;
  leftHandTwist: number;
  rightHandTwist: number;
  leftCoverMouth: number;
  rightCoverMouth: number;
  leftCoverEyes: number;
  rightCoverEyes: number;
  leftCoverHead: number;
  rightCoverHead: number;
}

export interface FaceTracker {
  source: 'mediapipe-local' | 'mediapipe-hosted' | 'fallback';
  hands: boolean;
  detect(video: HTMLVideoElement, timeMs: number): CatExpression | null;
  close(): void;
}

export const neutralExpression: CatExpression = {
  mouthOpen: 0,
  mouthFunnel: 0,
  mouthPucker: 0,
  mouthWide: 0,
  mouthPress: 0,
  blinkLeft: 0,
  blinkRight: 0,
  yaw: 0,
  pitch: 0,
  smile: 0,
  leftHandRaise: 0,
  rightHandRaise: 0,
  leftHandX: 0,
  rightHandX: 0,
  leftHandY: 0,
  rightHandY: 0,
  leftHandOpen: 0,
  rightHandOpen: 0,
  leftHandPinch: 0,
  rightHandPinch: 0,
  leftHandTwist: 0,
  rightHandTwist: 0,
  leftCoverMouth: 0,
  rightCoverMouth: 0,
  leftCoverEyes: 0,
  rightCoverEyes: 0,
  leftCoverHead: 0,
  rightCoverHead: 0
};

type Landmark = { x: number; y: number; z?: number };

const hostedWasm = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
const hostedModel =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
const hostedHandModel =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const localAsset = (path: string) => `${basePath}${path}`;

export async function createFaceTracker(): Promise<FaceTracker> {
  try {
    const tasksVision = await import('@mediapipe/tasks-vision');
    const attempts: Array<{
      source: 'mediapipe-local' | 'mediapipe-hosted';
      wasm: string;
      faceModel: string;
      handModel?: string;
    }> = [];

    const localFaceModel = localAsset('/mediapipe/face_landmarker.task');
    const localHandModel = localAsset('/mediapipe/hand_landmarker.task');
    if (await assetExists(localFaceModel)) {
      const hasLocalHands = await assetExists(localHandModel);
      attempts.push({
        source: 'mediapipe-local',
        wasm: localAsset('/mediapipe/wasm'),
        faceModel: localFaceModel,
        handModel: hasLocalHands ? localHandModel : undefined
      });
    }

    if (navigator.onLine) {
      attempts.push({
        source: 'mediapipe-hosted',
        wasm: hostedWasm,
        faceModel: hostedModel,
        handModel: hostedHandModel
      });
    }

    for (const attempt of attempts) {
      try {
        return await withTimeout(createMediaPipeTracker(tasksVision, attempt), 6500);
      } catch {
        // Try the next asset source.
      }
    }
  } catch {
    // Keep the capture flow available even without the library.
  }

  return createFallbackTracker();
}

async function createMediaPipeTracker(
  tasksVision: typeof import('@mediapipe/tasks-vision'),
  attempt: { source: 'mediapipe-local' | 'mediapipe-hosted'; wasm: string; faceModel: string; handModel?: string }
): Promise<FaceTracker> {
  const vision = await tasksVision.FilesetResolver.forVisionTasks(attempt.wasm);
  let landmarker: Awaited<ReturnType<typeof tasksVision.FaceLandmarker.createFromOptions>>;
  try {
    landmarker = await createFaceLandmarkerWithDelegate(tasksVision, vision, attempt.faceModel, 'GPU');
  } catch {
    landmarker = await createFaceLandmarkerWithDelegate(tasksVision, vision, attempt.faceModel, 'CPU');
  }

  let handLandmarker: Awaited<ReturnType<typeof tasksVision.HandLandmarker.createFromOptions>> | undefined;
  if (attempt.handModel) {
    try {
      handLandmarker = await createHandLandmarkerWithDelegate(tasksVision, vision, attempt.handModel, 'GPU');
    } catch {
      try {
        handLandmarker = await createHandLandmarkerWithDelegate(tasksVision, vision, attempt.handModel, 'CPU');
      } catch {
        handLandmarker = undefined;
      }
    }
  }

  let handFrame = 0;
  let cachedHands = emptyHandExpression().values;
  let smoothedHands = emptyHandExpression().values;
  let latestHandsPresent = false;

  return {
    source: attempt.source,
    hands: Boolean(handLandmarker),
    detect(video, timeMs) {
      const faceResult = landmarker.detectForVideo(video, timeMs);
      const faceExpression = expressionFromResult(faceResult);
      const faceLandmarks = faceResult.faceLandmarks?.[0] as Landmark[] | undefined;
      let hasHands = false;
      if (handLandmarker && handFrame % 2 === 0) {
        const handExpression = expressionFromHands(handLandmarker.detectForVideo(video, timeMs), faceLandmarks);
        cachedHands = handExpression.values;
        latestHandsPresent = handExpression.hasHands;
      }
      hasHands = latestHandsPresent;
      smoothedHands = blendHandExpressionValues(smoothedHands, cachedHands, hasHands ? 0.56 : 0.16);
      handFrame += 1;

      if (!faceExpression && !hasHands) {
        return null;
      }
      return {
        ...(faceExpression ?? neutralExpression),
        ...smoothedHands
      };
    },
    close() {
      landmarker.close();
      handLandmarker?.close();
    }
  };
}

function createFaceLandmarkerWithDelegate(
  tasksVision: typeof import('@mediapipe/tasks-vision'),
  vision: Awaited<ReturnType<typeof tasksVision.FilesetResolver.forVisionTasks>>,
  model: string,
  delegate: 'CPU' | 'GPU'
) {
  return tasksVision.FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: model,
      delegate
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true
  });
}

function createHandLandmarkerWithDelegate(
  tasksVision: typeof import('@mediapipe/tasks-vision'),
  vision: Awaited<ReturnType<typeof tasksVision.FilesetResolver.forVisionTasks>>,
  model: string,
  delegate: 'CPU' | 'GPU'
) {
  return tasksVision.HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: model,
      delegate
    },
    runningMode: 'VIDEO',
    numHands: 2
  });
}

async function assetExists(path: string) {
  try {
    const response = await fetch(path, { method: 'HEAD', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Face tracker startup timed out')), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeout));
  });
}

export function smoothExpression(previous: CatExpression, next: CatExpression, alpha = 0.22): CatExpression {
  const smoothed = {} as CatExpression;
  (Object.keys(neutralExpression) as Array<keyof CatExpression>).forEach((key) => {
    smoothed[key] = mix(previous[key], next[key], getFeatureAlpha(key, alpha));
  });
  return smoothed;
}

function getFeatureAlpha(key: keyof CatExpression, alpha: number) {
  if (key === 'blinkLeft' || key === 'blinkRight') {
    return clamp(alpha * 2.35, 0.18, 0.82);
  }
  if (key === 'mouthOpen' || key === 'smile') {
    return clamp(alpha * 1.55, 0.12, 0.62);
  }
  if (key.includes('Cover')) {
    return clamp(alpha * 0.86, 0.08, 0.42);
  }
  if (key.includes('Hand')) {
    return clamp(alpha * 0.92, 0.08, 0.46);
  }
  return alpha;
}

export function toFaceSample(expression: CatExpression, elapsedMs: number): FaceSample {
  return {
    t: Math.round(elapsedMs) / 1000,
    mouthOpen: roundFeature(expression.mouthOpen),
    blinkLeft: roundFeature(expression.blinkLeft),
    blinkRight: roundFeature(expression.blinkRight),
    yaw: roundFeature(expression.yaw),
    pitch: roundFeature(expression.pitch)
  };
}

function expressionFromResult(result: any): CatExpression | null {
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks) {
    return null;
  }

  const categories = result.faceBlendshapes?.[0]?.categories ?? [];
  const mouthOpen = Math.max(score(categories, ['jawOpen', 'mouthOpen']), mouthFromLandmarks(landmarks));
  const mouthFunnel = score(categories, ['mouthFunnel']);
  const mouthPucker = score(categories, ['mouthPucker']);
  const mouthWide = Math.max(
    score(categories, ['mouthStretchLeft']),
    score(categories, ['mouthStretchRight']),
    mouthWideFromLandmarks(landmarks)
  );
  const mouthPress = Math.max(score(categories, ['mouthPressLeft']), score(categories, ['mouthPressRight']));
  const blinkLeft = Math.max(score(categories, ['eyeBlinkLeft']), blinkFromLandmarks(landmarks, 'left'));
  const blinkRight = Math.max(score(categories, ['eyeBlinkRight']), blinkFromLandmarks(landmarks, 'right'));
  const smile = Math.max(
    score(categories, ['mouthSmileLeft']),
    score(categories, ['mouthSmileRight']),
    smileFromLandmarks(landmarks)
  );
  const pose = poseFromMatrix(result.facialTransformationMatrixes?.[0]?.data);

  return {
    ...neutralExpression,
    mouthOpen: clamp(mouthOpen),
    mouthFunnel: clamp(mouthFunnel),
    mouthPucker: clamp(mouthPucker),
    mouthWide: clamp(mouthWide),
    mouthPress: clamp(mouthPress),
    // The local preview is mirrored, so visible-left wink should drive the cat's visible-left eye.
    blinkLeft: clamp(blinkRight),
    blinkRight: clamp(blinkLeft),
    yaw: clamp(pose.yaw * 1.18, -1, 1),
    pitch: clamp(pose.pitch * 1.35, -1, 1),
    smile: clamp(smile)
  };
}

function score(categories: Array<{ categoryName: string; score: number }>, names: string[]) {
  return categories.reduce((best, category) => {
    return names.includes(category.categoryName) ? Math.max(best, category.score) : best;
  }, 0);
}

function mouthFromLandmarks(landmarks: Landmark[]) {
  const top = landmarks[13];
  const bottom = landmarks[14];
  const chin = landmarks[152];
  const forehead = landmarks[10];
  if (!top || !bottom || !chin || !forehead) {
    return 0;
  }
  const faceHeight = Math.max(distance(chin, forehead), 0.001);
  return clamp((distance(top, bottom) / faceHeight - 0.03) * 10);
}

function mouthWideFromLandmarks(landmarks: Landmark[]) {
  const leftCorner = landmarks[61];
  const rightCorner = landmarks[291];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  if (!leftCorner || !rightCorner || !leftCheek || !rightCheek) {
    return 0;
  }

  const faceWidth = Math.max(distance(leftCheek, rightCheek), 0.001);
  return clamp((distance(leftCorner, rightCorner) / faceWidth - 0.38) * 2.4);
}

function smileFromLandmarks(landmarks: Landmark[]) {
  const leftCorner = landmarks[61];
  const rightCorner = landmarks[291];
  const upperLip = landmarks[13];
  const lowerLip = landmarks[14];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const chin = landmarks[152];
  const forehead = landmarks[10];
  if (!leftCorner || !rightCorner || !upperLip || !lowerLip || !leftCheek || !rightCheek || !chin || !forehead) {
    return 0;
  }

  const faceWidth = Math.max(distance(leftCheek, rightCheek), 0.001);
  const faceHeight = Math.max(distance(chin, forehead), 0.001);
  const mouthCenter = mixPoint(upperLip, lowerLip, 0.5);
  const cornerLift = (mouthCenter.y - (leftCorner.y + rightCorner.y) / 2) / faceHeight;
  const width = distance(leftCorner, rightCorner) / faceWidth;
  return clamp((width - 0.36) * 2.4 + (cornerLift - 0.01) * 7.2);
}

function blinkFromLandmarks(landmarks: Landmark[], side: 'left' | 'right') {
  const ids = side === 'left' ? [159, 145, 33, 133] : [386, 374, 362, 263];
  const [upper, lower, outer, inner] = ids.map((id) => landmarks[id]);
  if (!upper || !lower || !outer || !inner) {
    return 0;
  }
  const openness = distance(upper, lower) / Math.max(distance(outer, inner), 0.001);
  return clamp((0.095 - openness) / 0.06);
}

function poseFromMatrix(data?: number[]) {
  if (!data || data.length < 16) {
    return { yaw: 0, pitch: 0 };
  }

  return {
    yaw: Math.atan2(data[8], data[10]) / 0.7,
    pitch: Math.atan2(-data[9], Math.hypot(data[8], data[10])) / 0.7
  };
}

function expressionFromHands(result: any, faceLandmarks?: Landmark[]) {
  const values = emptyHandExpression().values;
  const landmarksList = result.landmarks ?? [];
  const handednessList = result.handednesses ?? [];
  let hasHands = false;
  const faceAnchors = getFaceAnchors(faceLandmarks);

  landmarksList.forEach((landmarks: Landmark[], index: number) => {
    const wrist = landmarks[0];
    const middleBase = landmarks[9] ?? wrist;
    if (!wrist) {
      return;
    }

    hasHands = true;
    const label = String(handednessList[index]?.[0]?.categoryName ?? '').toLowerCase();
    const detectedSide = label === 'left' || label === 'right' ? label : wrist.x < 0.5 ? 'left' : 'right';
    // The capture preview is mirrored for the front camera, so map to the user's visible side.
    const side = detectedSide === 'left' ? 'right' : 'left';
    const palmY = (wrist.y + middleBase.y) / 2;
    const raise = clamp((0.86 - palmY) * 2.25);
    const x = clamp((wrist.x - 0.5) * 2, -1, 1);
    const y = clamp((0.5 - palmY) * 2, -1, 1);
    const palmSize = Math.max(distance(wrist, middleBase), 0.001);
    const tips = [4, 8, 12, 16, 20].map((id) => landmarks[id]).filter(Boolean);
    const fingertipReach = tips.reduce((sum, point) => sum + distance(wrist, point), 0) / Math.max(tips.length, 1);
    const open = clamp((fingertipReach / palmSize - 1.55) / 1.05);
    const pinchDistance = landmarks[4] && landmarks[8] ? distance(landmarks[4], landmarks[8]) / palmSize : 1;
    const pinch = clamp(1 - (pinchDistance - 0.24) * 3.6);
    const twist = clamp(Math.atan2(middleBase.y - wrist.y, middleBase.x - wrist.x) / Math.PI, -1, 1);
    const gestures = gestureScoresFromHand(landmarks, faceAnchors, open);

    if (side === 'left') {
      values.leftHandRaise = Math.max(values.leftHandRaise, raise);
      values.leftHandX = x;
      values.leftHandY = y;
      values.leftHandOpen = Math.max(values.leftHandOpen, open);
      values.leftHandPinch = Math.max(values.leftHandPinch, pinch);
      values.leftHandTwist = twist;
      values.leftCoverMouth = Math.max(values.leftCoverMouth, gestures.coverMouth);
      values.leftCoverEyes = Math.max(values.leftCoverEyes, gestures.coverEyes);
      values.leftCoverHead = Math.max(values.leftCoverHead, gestures.coverHead);
    } else {
      values.rightHandRaise = Math.max(values.rightHandRaise, raise);
      values.rightHandX = x;
      values.rightHandY = y;
      values.rightHandOpen = Math.max(values.rightHandOpen, open);
      values.rightHandPinch = Math.max(values.rightHandPinch, pinch);
      values.rightHandTwist = twist;
      values.rightCoverMouth = Math.max(values.rightCoverMouth, gestures.coverMouth);
      values.rightCoverEyes = Math.max(values.rightCoverEyes, gestures.coverEyes);
      values.rightCoverHead = Math.max(values.rightCoverHead, gestures.coverHead);
    }
  });

  return { hasHands, values };
}

function getFaceAnchors(faceLandmarks?: Landmark[]) {
  const forehead = averageLandmarks(faceLandmarks, [10, 67, 297]) ?? { x: 0.5, y: 0.24 };
  const chin = faceLandmarks?.[152] ?? { x: 0.5, y: 0.68 };
  const mouth = averageLandmarks(faceLandmarks, [13, 14, 0, 17]) ?? { x: 0.5, y: 0.58 };
  const eyes = averageLandmarks(faceLandmarks, [33, 133, 159, 263, 362, 386]) ?? { x: 0.5, y: 0.39 };
  const faceHeight = Math.max(distance(forehead, chin), 0.34);
  return { forehead, mouth, eyes, faceHeight };
}

function gestureScoresFromHand(
  landmarks: Landmark[],
  anchors: ReturnType<typeof getFaceAnchors>,
  handOpen: number
) {
  const palm = averageLandmarks(landmarks, [0, 5, 9, 13, 17]) ?? landmarks[0];
  const fingertips = averageLandmarks(landmarks, [8, 12, 16, 20]) ?? palm;
  const focus = mixPoint(palm, fingertips, 0.35);
  const openness = 0.58 + handOpen * 0.42;
  const candidates = [palm, fingertips, focus];
  const mouth = nearestProximityScore(candidates, anchors.mouth, anchors.faceHeight * 0.1, anchors.faceHeight * 0.48);
  const eyes = nearestProximityScore(candidates, anchors.eyes, anchors.faceHeight * 0.09, anchors.faceHeight * 0.5);
  const headClose = proximityScore(
    distance(palm, anchors.forehead),
    anchors.faceHeight * 0.12,
    anchors.faceHeight * 0.56
  );
  const highHand = clamp((anchors.eyes.y - palm.y) / (anchors.faceHeight * 0.3));
  const centeredHighHand = highHand * proximityScore(
    Math.abs(palm.x - anchors.forehead.x),
    anchors.faceHeight * 0.04,
    anchors.faceHeight * 0.7
  );
  const faceAligned = proximityScore(Math.abs(focus.x - anchors.mouth.x), anchors.faceHeight * 0.16, anchors.faceHeight * 0.74);
  const mouthBand = bandScore(focus.y, anchors.mouth.y, anchors.faceHeight * 0.3) * faceAligned;
  const eyesBand = bandScore(focus.y, anchors.eyes.y, anchors.faceHeight * 0.3) * faceAligned;
  const headBand = bandScore(palm.y, anchors.forehead.y, anchors.faceHeight * 0.34) * faceAligned;

  return {
    coverMouth: clamp(Math.max(mouth, mouthBand * 0.86) * openness),
    coverEyes: clamp(Math.max(eyes, eyesBand * 0.86) * openness),
    coverHead: clamp(Math.max(headClose, centeredHighHand, headBand * 0.82))
  };
}

function emptyHandExpression() {
  return {
    hasHands: false,
    values: {
      leftHandRaise: 0,
      rightHandRaise: 0,
      leftHandX: 0,
      rightHandX: 0,
      leftHandY: 0,
      rightHandY: 0,
      leftHandOpen: 0,
      rightHandOpen: 0,
      leftHandPinch: 0,
      rightHandPinch: 0,
      leftHandTwist: 0,
      rightHandTwist: 0,
      leftCoverMouth: 0,
      rightCoverMouth: 0,
      leftCoverEyes: 0,
      rightCoverEyes: 0,
      leftCoverHead: 0,
      rightCoverHead: 0
    }
  };
}

function blendHandExpressionValues(
  from: ReturnType<typeof emptyHandExpression>['values'],
  to: ReturnType<typeof emptyHandExpression>['values'],
  alpha: number
) {
  return {
    leftHandRaise: mix(from.leftHandRaise, to.leftHandRaise, alpha),
    rightHandRaise: mix(from.rightHandRaise, to.rightHandRaise, alpha),
    leftHandX: mix(from.leftHandX, to.leftHandX, alpha),
    rightHandX: mix(from.rightHandX, to.rightHandX, alpha),
    leftHandY: mix(from.leftHandY, to.leftHandY, alpha),
    rightHandY: mix(from.rightHandY, to.rightHandY, alpha),
    leftHandOpen: mix(from.leftHandOpen, to.leftHandOpen, alpha),
    rightHandOpen: mix(from.rightHandOpen, to.rightHandOpen, alpha),
    leftHandPinch: mix(from.leftHandPinch, to.leftHandPinch, alpha),
    rightHandPinch: mix(from.rightHandPinch, to.rightHandPinch, alpha),
    leftHandTwist: mix(from.leftHandTwist, to.leftHandTwist, alpha),
    rightHandTwist: mix(from.rightHandTwist, to.rightHandTwist, alpha),
    leftCoverMouth: mix(from.leftCoverMouth, to.leftCoverMouth, alpha),
    rightCoverMouth: mix(from.rightCoverMouth, to.rightCoverMouth, alpha),
    leftCoverEyes: mix(from.leftCoverEyes, to.leftCoverEyes, alpha),
    rightCoverEyes: mix(from.rightCoverEyes, to.rightCoverEyes, alpha),
    leftCoverHead: mix(from.leftCoverHead, to.leftCoverHead, alpha),
    rightCoverHead: mix(from.rightCoverHead, to.rightCoverHead, alpha)
  };
}

function averageLandmarks(landmarks: Landmark[] | undefined, indexes: number[]) {
  if (!landmarks) {
    return undefined;
  }

  const points = indexes.map((index) => landmarks[index]).filter(Boolean);
  if (points.length === 0) {
    return undefined;
  }

  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function mixPoint(a: Landmark, b: Landmark, alpha: number) {
  return {
    x: mix(a.x, b.x, alpha),
    y: mix(a.y, b.y, alpha)
  };
}

function proximityScore(value: number, inner: number, outer: number) {
  if (value <= inner) {
    return 1;
  }
  return clamp(1 - (value - inner) / Math.max(outer - inner, 0.001));
}

function nearestProximityScore(points: Landmark[], target: Landmark, inner: number, outer: number) {
  return points.reduce((best, point) => Math.max(best, proximityScore(distance(point, target), inner, outer)), 0);
}

function bandScore(value: number, center: number, halfWidth: number) {
  return clamp(1 - Math.abs(value - center) / Math.max(halfWidth, 0.001));
}

function createFallbackTracker(): FaceTracker {
  return {
    source: 'fallback',
    hands: false,
    detect(_video, timeMs) {
      const t = timeMs / 1000;
      return {
        ...neutralExpression,
        mouthOpen: 0.08 + Math.max(0, Math.sin(t * 2.1)) * 0.08,
        blinkLeft: Math.max(0, Math.sin(t * 5.2) - 0.94) * 8,
        blinkRight: Math.max(0, Math.sin(t * 5.2) - 0.94) * 8,
        yaw: Math.sin(t * 0.7) * 0.12,
        pitch: Math.cos(t * 0.6) * 0.08,
        smile: 0.08
      };
    },
    close() {
      return undefined;
    }
  };
}

function mix(a: number, b: number, alpha: number) {
  return a + (b - a) * alpha;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function roundFeature(value: number) {
  return Math.round(value * 1000) / 1000;
}
