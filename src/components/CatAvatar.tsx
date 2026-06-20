import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CatExpression, neutralExpression, smoothExpression } from '../lib/faceTracking';

type CatMood = 'idle' | 'recording' | 'reward';
type AssetSource = 'glb' | 'fbx' | 'procedural';

interface CatAvatarProps {
  expression?: CatExpression;
  mood?: CatMood;
  className?: string;
  label?: string;
  enableImportedRig?: boolean;
  showFur?: boolean;
  showGround?: boolean;
}

interface CatRuntime {
  root: THREE.Object3D;
  source: AssetSource;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  restBones: DrivenBone[];
  poseBones: DrivenPoseBone[];
  fallbackMouth?: THREE.Object3D;
  fallbackLeftEye?: THREE.Object3D;
  fallbackRightEye?: THREE.Object3D;
  morphMeshes: THREE.Mesh[];
  armBones: DrivenArmBone[];
  handIndicators?: HandIndicatorSet;
  treat?: THREE.Object3D;
  enableImportedRig: boolean;
}

interface DrivenBone {
  bone: THREE.Object3D;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  baseScale: THREE.Vector3;
  baseWorldQuaternion: THREE.Quaternion;
}

interface DrivenPoseBone extends DrivenBone {
  pitchWeight: number;
  yawWeight: number;
  rollWeight: number;
}

type ArmRole = 'clavicle' | 'upper' | 'forearm' | 'hand' | 'finger';

interface DrivenArmBone extends DrivenBone {
  side: 'left' | 'right';
  role: ArmRole;
  finger?: 'thumb' | 'index' | 'mid' | 'ring' | 'pinky';
}

interface HandIndicatorSet {
  group: THREE.Group;
  left: THREE.Group;
  right: THREE.Group;
}

interface HandIndicatorParts {
  palm: THREE.Mesh;
  fingers: THREE.Mesh[];
  halo: THREE.Mesh;
}

interface MorphRule {
  names: string[];
  value: number;
}

let fbxWarningMuteDepth = 0;
let originalConsoleWarn: typeof console.warn | undefined;
let sharedTextureLoader: THREE.TextureLoader | undefined;
const catTextureCache = new Map<string, THREE.Texture>();
const morphLookupCache = new WeakMap<Record<string, number>, Map<string, number>>();
const CAT_GLB_PATH = '/assets/cat/cat.glb?v=20260531-skin-reference-fur-weights';
const HAIR_ALPHA_TEST = 0.08;

export function CatAvatar({
  expression = neutralExpression,
  mood = 'idle',
  className = '',
  label,
  enableImportedRig = false,
  showFur = true,
  showGround = true
}: CatAvatarProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const expressionRef = useRef(expression);
  const smoothRef = useRef(expression);
  const moodRef = useRef(mood);
  const [modelStatus, setModelStatus] = useState('Cat ready');

  useEffect(() => {
    expressionRef.current = expression;
  }, [expression]);

  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8f4ec);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.2, 4.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.34;
    host.append(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const key = new THREE.DirectionalLight(0xffffff, 2.55);
    key.position.set(3, 4, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.55);
    fill.position.set(-3, 2.4, 3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.8);
    rim.position.set(-2.8, 3, -2);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8aa9b, 1.85));

    if (showGround) {
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(1.72, 64),
        new THREE.MeshBasicMaterial({ color: 0xefe5d7, transparent: true, opacity: 0.32, depthWrite: false })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1.18;
      ground.renderOrder = -10;
      scene.add(ground);
    }

    let disposed = false;
    let frame = 0;
    let runtime: CatRuntime | undefined;
    const clock = new THREE.Clock();
    const debugExpression = new URLSearchParams(window.location.search).has('debugAvatar');

    loadCatRuntime(enableImportedRig, showFur).then((loaded) => {
      if (disposed) {
        disposeObject(loaded.root);
        return;
      }

      runtime = loaded;
      scene.add(loaded.root);
      setModelStatus(getModelStatus(loaded.source));
    });

    const resize = () => {
      const width = host.clientWidth || 320;
      const height = host.clientHeight || 260;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const target = debugExpression ? getDebugExpression(elapsed) : expressionRef.current;
      smoothRef.current = smoothExpression(smoothRef.current, target, 0.2);

      if (runtime) {
        applyExpression(runtime, smoothRef.current, moodRef.current, elapsed);
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.dispose();
      runtime && disposeObject(runtime.root);
      host.removeChild(renderer.domElement);
    };
  }, [enableImportedRig, showFur, showGround]);

  return (
    <div className={`cat-avatar ${className}`} aria-label={label ?? '3D cat avatar'}>
      <div ref={hostRef} className="cat-avatar__stage" />
      <div className="cat-avatar__badge">
        {mood === 'reward' ? 'Treat' : mood === 'recording' ? 'Mirroring' : modelStatus}
      </div>
    </div>
  );
}

function getDebugExpression(elapsed: number): CatExpression {
  const blink = Math.max(0, Math.sin(elapsed * 3.1));
  return {
    ...neutralExpression,
    mouthOpen: 0.28 + Math.max(0, Math.sin(elapsed * 1.2)) * 0.3,
    blinkLeft: blink,
    blinkRight: blink,
    yaw: Math.sin(elapsed * 0.8) * 0.22,
    pitch: Math.sin(elapsed * 0.6) * 0.12,
    smile: 0.82,
    leftHandRaise: 0.5,
    rightHandRaise: 0.5,
    leftHandOpen: 0.85,
    rightHandOpen: 0.85,
    leftHandX: -0.18,
    rightHandX: 0.18
  };
}

function getModelStatus(source: AssetSource) {
  if (source === 'glb') {
    return 'GLB ready';
  }
  if (source === 'fbx') {
    return 'FBX preview';
  }
  return 'Fallback cat';
}

async function loadCatRuntime(enableImportedRig: boolean, showFur: boolean): Promise<CatRuntime> {
  if (await assetExists(CAT_GLB_PATH)) {
    try {
      const gltf = await loadGlb(CAT_GLB_PATH);
      return prepareRuntime(gltf.scene, 'glb', enableImportedRig, showFur);
    } catch {
      // Try FBX next.
    }
  }

  if (await assetExists('/assets/cat/Cat.fbx')) {
    try {
      const fbx = await loadFbx('/assets/cat/Cat.fbx');
      return prepareRuntime(fbx, 'fbx', enableImportedRig, showFur);
    } catch {
      // Use procedural fallback below.
    }
  }

  return prepareRuntime(createProceduralCat(), 'procedural', enableImportedRig, showFur);
}

function loadGlb(path: string) {
  const loader = new GLTFLoader();
  return new Promise<any>((resolve, reject) => {
    loader.load(path, resolve, undefined, reject);
  });
}

function loadFbx(path: string) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => resolveCatTextureUrl(url));
  const loader = new FBXLoader(manager);

  return new Promise<THREE.Group>((resolve, reject) => {
    const restoreWarnings = muteFbxWarnings();
    loader.load(
      path,
      (group) => {
        restoreWarnings();
        resolve(group);
      },
      undefined,
      (error) => {
        restoreWarnings();
        reject(error);
      }
    );
  });
}

function resolveCatTextureUrl(url: string) {
  const cleanUrl = url.replace(/\\/g, '/').split(/[?#]/)[0] ?? '';
  const fileName = cleanUrl.split('/').pop() ?? '';
  const extension = fileName.split('.').pop()?.toLowerCase();
  const isTexture = ['jpg', 'jpeg', 'png', 'tif', 'tiff'].includes(extension ?? '');
  const alreadyScoped =
    cleanUrl.includes('/Cat.fbm/') || cleanUrl.includes('/Black_Cat_Textures/') || cleanUrl.includes('/Fur_Maps/');

  if (isTexture && fileName && !alreadyScoped) {
    return `/assets/cat/Cat.fbm/${fileName}`;
  }

  return url;
}

function muteFbxWarnings() {
  fbxWarningMuteDepth += 1;
  if (!originalConsoleWarn) {
    originalConsoleWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const first = String(args[0] ?? '');
      if (first.startsWith('THREE.FBXLoader:')) {
        return;
      }
      originalConsoleWarn?.(...args);
    };
  }

  return () => {
    fbxWarningMuteDepth = Math.max(0, fbxWarningMuteDepth - 1);
    if (fbxWarningMuteDepth === 0 && originalConsoleWarn) {
      console.warn = originalConsoleWarn;
      originalConsoleWarn = undefined;
    }
  };
}

async function assetExists(path: string) {
  try {
    const response = await fetch(path, { method: 'HEAD', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

function prepareRuntime(root: THREE.Object3D, source: AssetSource, enableImportedRig: boolean, showFur: boolean): CatRuntime {
  normalizeObject(root, source === 'procedural');
  if (source !== 'procedural') {
    prepareImportedModel(root, source, showFur, enableImportedRig);
  }
  root.updateWorldMatrix(true, true);

  const runtime: CatRuntime = {
    root,
    source,
    basePosition: root.position.clone(),
    baseQuaternion: root.quaternion.clone(),
    restBones: collectRestBones(root),
    poseBones: [],
    morphMeshes: [],
    armBones: [],
    enableImportedRig
  };

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const name = child.name.toLowerCase();

    if (mesh.isMesh) {
      mesh.frustumCulled = false;
      if (mesh.visible && mesh.morphTargetInfluences && isFaceMorphMesh(mesh)) {
        runtime.morphMeshes.push(mesh);
      }
    }

    runtime.fallbackMouth ??= name === 'fallback-mouth' ? child : undefined;
    runtime.fallbackLeftEye ??= name === 'fallback-left-eye' ? child : undefined;
    runtime.fallbackRightEye ??= name === 'fallback-right-eye' ? child : undefined;
  });

  runtime.poseBones = collectPoseBones(root, source);
  if (runtime.poseBones.length === 0) {
    runtime.poseBones.push({ ...captureDrivenBone(root), pitchWeight: 1, yawWeight: 1, rollWeight: 1 });
  }
  if (source === 'procedural' || enableImportedRig) {
    runtime.armBones = collectArmBones(root);
  } else if (source !== 'glb') {
    runtime.handIndicators = createHandIndicators();
    runtime.root.add(runtime.handIndicators.group);
  }
  runtime.treat = createTreat();
  runtime.root.add(runtime.treat);

  return runtime;
}

function collectRestBones(root: THREE.Object3D): DrivenBone[] {
  const bones: DrivenBone[] = [];
  root.traverse((child) => {
    const bone = child as THREE.Bone;
    if (bone.isBone) {
      bones.push(captureDrivenBone(bone));
    }
  });
  return bones;
}

function captureDrivenBone(bone: THREE.Object3D): DrivenBone {
  const baseWorldQuaternion = new THREE.Quaternion();
  bone.getWorldQuaternion(baseWorldQuaternion);
  return {
    bone,
    basePosition: bone.position.clone(),
    baseQuaternion: bone.quaternion.clone(),
    baseScale: bone.scale.clone(),
    baseWorldQuaternion
  };
}

function collectPoseBones(root: THREE.Object3D, source: AssetSource): DrivenPoseBone[] {
  const namedBones: Array<{ name: string; pitchWeight: number; yawWeight: number; rollWeight: number }> =
    source === 'glb'
      ? [
          { name: 'CC_Base_Spine02', pitchWeight: 0.04, yawWeight: 0.06, rollWeight: 0 },
          { name: 'CC_Base_NeckTwist01', pitchWeight: 0.26, yawWeight: 0.28, rollWeight: 0 },
          { name: 'CC_Base_NeckTwist02', pitchWeight: 0.38, yawWeight: 0.4, rollWeight: 0 },
          { name: 'CC_Base_Head', pitchWeight: 0.12, yawWeight: 0.14, rollWeight: 0 }
        ]
      : [
          { name: 'CC_Base_Spine02', pitchWeight: 0.05, yawWeight: 0.04, rollWeight: 0.04 },
          { name: 'CC_Base_NeckTwist01', pitchWeight: 0.2, yawWeight: 0.17, rollWeight: 0.12 },
          { name: 'CC_Base_NeckTwist02', pitchWeight: 0.28, yawWeight: 0.24, rollWeight: 0.14 },
          { name: 'CC_Base_Head', pitchWeight: 0.34, yawWeight: 0.3, rollWeight: 0.1 }
        ];

  const bones = namedBones
    .map((item) => {
      const bone = root.getObjectByName(item.name);
      return bone
        ? {
            ...captureDrivenBone(bone),
            pitchWeight: item.pitchWeight,
            yawWeight: item.yawWeight,
            rollWeight: item.rollWeight
          }
        : undefined;
    })
    .filter(Boolean) as DrivenPoseBone[];

  if (bones.length > 0) {
    return bones;
  }

  const fallbackHead = root.getObjectByName('head');
  return fallbackHead
    ? [{ ...captureDrivenBone(fallbackHead), pitchWeight: 0.7, yawWeight: 0.7, rollWeight: 0.45 }]
    : [];
}

function isFaceMorphMesh(mesh: THREE.Mesh) {
  const dictionary = mesh.morphTargetDictionary;
  if (!dictionary) {
    return false;
  }

  const lookup = getMorphLookup(dictionary);
  return (
    lookup.has('a14_eye_blink_left') ||
    lookup.has('eye_blink_l') ||
    lookup.has('a38_mouth_smile_left') ||
    lookup.has('mouth_smile_l') ||
    lookup.has('a25_jaw_open') ||
    lookup.has('mouth_open')
  );
}

function prepareImportedModel(root: THREE.Object3D, source: AssetSource, showFur: boolean, rigSafeFur: boolean) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    mesh.frustumCulled = false;
    const meshName = mesh.name.toLowerCase();
    const materials = getMaterials(mesh.material);
    const materialNames = materials.map((material) => material.name.toLowerCase()).join(' ');

    if (
      meshName.includes('diaper') ||
      materialNames.includes('diaper') ||
      materialNames.includes('pincaps') ||
      materialNames.includes('metalpins')
    ) {
      mesh.visible = false;
      return;
    }

    if (meshName.startsWith('fibers')) {
      const layerOpacity = getHairLayerOpacity(meshName, rigSafeFur);
      mesh.visible = showFur && layerOpacity > 0;
      mesh.renderOrder = 0;
      if (source === 'fbx') {
        mesh.material = createHairMaterial(mesh, layerOpacity);
      } else {
        materials.forEach((material) => prepareHairRuntimeMaterial(material, layerOpacity));
      }
      return;
    }

    if (meshName === 'cc_base_eyeocclusion') {
      mesh.visible = source === 'glb';
      mesh.renderOrder = 2;
      materials.forEach(prepareEyeOcclusionRuntimeMaterial);
      return;
    }

    if (meshName === 'cc_base_tearline') {
      mesh.visible = false;
      return;
    }

    if (source === 'fbx') {
      materials.forEach((material) => prepareStandardMaterial(material, meshName));
    }
  });
}

function getMaterials(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material : [material];
}

function prepareStandardMaterial(material: THREE.Material, meshName: string) {
  material.side = THREE.DoubleSide;
  material.opacity = 1;
  material.transparent = false;
  material.depthWrite = true;

  const standard = material as THREE.MeshStandardMaterial & {
    emissive?: THREE.Color;
    emissiveIntensity?: number;
  };
  const name = material.name.toLowerCase();

  if (name.includes('cornea')) {
    standard.map = null;
    standard.normalMap = loadCatTexture('/assets/cat/Cat.fbm/Cornea_Pbr_Normal.png', false);
    standard.color?.set(0xeaf4ee);
    standard.roughness = 0.06;
    standard.metalness = 0;
    material.opacity = 0.24;
    material.transparent = true;
    material.depthWrite = false;
    material.needsUpdate = true;
    return;
  }

  if (name.includes('eye') && !name.includes('occlusion')) {
    standard.map = loadCatTexture('/assets/cat/Cat.fbm/Eye_Pbr_Diffuse.png', true, true);
    standard.normalMap = loadCatTexture('/assets/cat/Cat.fbm/Eye_Pbr_Normal.png', false, true);
    standard.color?.set(0xffffff);
    standard.emissive?.set(0x1c1500);
    standard.emissiveIntensity = 0.05;
    standard.roughness = 0.18;
    standard.metalness = 0;
    material.needsUpdate = true;
    return;
  }

  if (name.includes('eyelash')) {
    const eyelash = loadCatTexture('/assets/cat/Cat.fbm/Std_Eyelash_Pbr_Diffuse.png', true);
    standard.map = eyelash;
    standard.alphaMap = eyelash;
    standard.normalMap = loadCatTexture('/assets/cat/Cat.fbm/Std_Eyelash_Pbr_Normal.png', false);
    standard.color?.set(0xffffff);
    standard.roughness = 0.82;
    standard.metalness = 0;
    material.alphaTest = 0.24;
    material.transparent = false;
    material.needsUpdate = true;
    return;
  }

  if (name.includes('tongue')) {
    standard.map = loadCatTexture('/assets/cat/Cat.fbm/Std_Tongue_Pbr_Diffuse.png', true);
    standard.normalMap = loadCatTexture('/assets/cat/Cat.fbm/Std_Tongue_Pbr_Normal.png', false);
    standard.color?.set(0xffffff);
    standard.roughness = 0.66;
    material.needsUpdate = true;
    return;
  }

  if (name.includes('teeth')) {
    const lower = name.includes('lower');
    standard.map = loadCatTexture(
      lower ? '/assets/cat/Cat.fbm/Std_Lower_Teeth_Pbr_Diffuse.jpg' : '/assets/cat/Cat.fbm/Std_Upper_Teeth_Pbr_Diffuse.jpg',
      true
    );
    standard.normalMap = loadCatTexture(
      lower ? '/assets/cat/Cat.fbm/Std_Lower_Teeth_Pbr_Normal.png' : '/assets/cat/Cat.fbm/Std_Upper_Teeth_Pbr_Normal.png',
      false
    );
    standard.color?.set(0xf4eadc);
    standard.roughness = 0.52;
    material.needsUpdate = true;
    return;
  }

  if (name.includes('skin') || name.includes('nails') || meshName.includes('cc_base_body')) {
    const textureSet = getSubstanceTextureSet(name);
    standard.map = textureSet?.baseMap ?? standard.map ?? null;
    standard.normalMap = textureSet?.normalMap ?? standard.normalMap ?? null;
    standard.color?.set(0x68716d);
    standard.roughness = 0.78;
    standard.metalness = 0;
    standard.emissive?.set(0x080909);
    standard.emissiveIntensity = 0.08;
    material.needsUpdate = true;
  }
}

function prepareEyeOcclusionRuntimeMaterial(material: THREE.Material) {
  material.transparent = true;
  material.opacity = 0;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;

  const standard = material as THREE.MeshStandardMaterial;
  standard.color?.set(0x171c1a);
  standard.roughness = 0.94;
  standard.metalness = 0;
  material.needsUpdate = true;
}

function prepareHairRuntimeMaterial(material: THREE.Material, opacity: number) {
  material.transparent = true;
  material.opacity = opacity;
  material.alphaTest = HAIR_ALPHA_TEST;
  material.alphaHash = false;
  material.alphaToCoverage = false;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.forceSinglePass = true;

  const standard = material as THREE.MeshStandardMaterial;
  standard.alphaMap = null;
  standard.color?.set(0xffffff);
  standard.roughness = 0.98;
  standard.metalness = 0;
  standard.emissive?.set(0x080808);
  standard.emissiveIntensity = 0.06;
  standard.normalMap = null;
  tuneHairTexture(standard.map);
  material.needsUpdate = true;
}

function createHairMaterial(mesh: THREE.Mesh, opacity: number) {
  const diffuse = loadCatTexture(getHairDiffusePath(mesh), true);
  tuneHairTexture(diffuse);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: diffuse,
    alphaTest: HAIR_ALPHA_TEST,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    roughness: 0.98,
    metalness: 0
  });
  material.alphaHash = false;
  material.alphaToCoverage = false;
  material.forceSinglePass = true;
  return material;
}

function getHairLayerOpacity(meshName: string, rigSafeFur = false) {
  const layerOpacity: Record<string, number> = {
    fibers1052: 0.22,
    fibers1354: 0,
    fibers1560: 0.018,
    fibers1705: 0,
    fibers1773: 0.045,
    fibers361: 0.075,
    fibers653: 0.24,
    fibers71: 0.035,
    fibers839: 0.18,
    fibers910: 0.24
  };
  const opacity = layerOpacity[meshName] ?? 0.04;
  return rigSafeFur && ['fibers71', 'fibers1773', 'fibers361'].includes(meshName) ? opacity * 0.62 : opacity;
}

function tuneHairTexture(texture: THREE.Texture | null) {
  if (!texture) {
    return;
  }

  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.max(texture.anisotropy, 8);
  texture.needsUpdate = true;
}

function getHairDiffusePath(mesh: THREE.Mesh) {
  const material = getMaterials(mesh.material)[0];
  const name = material?.name ?? '';
  const match = name.match(/GoZMesh_Import_Material(?:_(\d+))?_(Pbr|Tra)/);
  if (!match) {
    return '/assets/cat/web-textures/GoZMesh_Import_Material_Pbr_Diffuse.png';
  }

  const index = match[1];
  const kind = match[2];
  return index === undefined
    ? '/assets/cat/web-textures/GoZMesh_Import_Material_Pbr_Diffuse.png'
    : `/assets/cat/web-textures/GoZMesh_Import_Material_${index}_${kind}_Diffuse.png`;
}

function getHairOpacityPath(mesh: THREE.Mesh) {
  const material = getMaterials(mesh.material)[0];
  const name = material?.name.toLowerCase() ?? mesh.name.toLowerCase();
  const match = name.match(/material_(\d+)/);
  if (!match) {
    return '/assets/cat/Fur_Maps/GoZMesh_Import_Material_Opacity.jpg';
  }

  const index = Number(match[1]) + 1;
  return `/assets/cat/Fur_Maps/GoZMesh_Import_Material_Opacity_${index.toString().padStart(4, '0')}.jpg`;
}

function getSubstanceTextureSet(materialName: string) {
  const textureBase = '/assets/cat/Black_Cat_Textures/';
  const suffix = getSubstanceSuffix(materialName);
  if (suffix === undefined) {
    return undefined;
  }

  return {
    baseMap: loadCatTexture(`${textureBase}Furry_Std_Skin_Head_BaseMap${suffix}.png`, true),
    normalMap: loadCatTexture(`${textureBase}Furry_Std_Skin_Head_Normal${getNormalSuffix(suffix)}.png`, false)
  };
}

function getSubstanceSuffix(materialName: string) {
  if (materialName.includes('head')) {
    return '';
  }
  if (materialName.includes('body')) {
    return '_1';
  }
  if (materialName.includes('arm')) {
    return '_5';
  }
  if (materialName.includes('leg')) {
    return '_9';
  }
  if (materialName.includes('nails')) {
    return '_13';
  }
  return undefined;
}

function getNormalSuffix(baseSuffix: string) {
  const normalSuffixes: Record<string, string> = {
    '': '',
    _1: '_3',
    _5: '_7',
    _9: '_11',
    _13: '_15'
  };
  return normalSuffixes[baseSuffix] ?? '';
}

function loadCatTexture(path: string, srgb: boolean, flipY = true) {
  const cacheKey = `${path}|${srgb ? 'srgb' : 'linear'}|${flipY ? 'flip' : 'noflip'}`;
  const cached = catTextureCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  sharedTextureLoader ??= new THREE.TextureLoader();
  const texture = sharedTextureLoader.load(path);
  texture.flipY = flipY;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  catTextureCache.set(cacheKey, texture);
  return texture;
}

function normalizeObject(root: THREE.Object3D, fallback: boolean) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxSide = Math.max(size.x, size.y, size.z, 0.001);
  const targetSize = fallback ? 2.35 : 2.02;
  const yOffset = fallback ? -0.2 : -0.08;
  const scale = targetSize / maxSide;
  root.scale.setScalar(scale);
  root.position.set(-center.x * scale, -center.y * scale + yOffset, -center.z * scale);
}

function applyExpression(runtime: CatRuntime, expression: CatExpression, mood: CatMood, elapsed: number) {
  if (runtime.source === 'procedural') {
    driveHead(runtime, expression, mood, elapsed);
    driveArms(runtime, expression, elapsed);
  } else if (runtime.enableImportedRig) {
    resetImportedPose(runtime);
    driveHead(runtime, expression, mood, elapsed);
    driveArms(runtime, expression, elapsed);
  } else {
    resetImportedPose(runtime);
    if (runtime.source !== 'glb') {
      driveRigidHead(runtime, expression, mood, elapsed);
      driveHandIndicators(runtime, expression, elapsed);
    }
  }
  runtime.morphMeshes.forEach((mesh) => driveMorphTargets(mesh, expression));
  driveProceduralFallback(runtime, expression);

  runtime.root.position.y = runtime.basePosition.y + (mood === 'reward' ? Math.sin(elapsed * 12) * 0.055 : 0);

  if (runtime.treat) {
    runtime.treat.visible = mood === 'reward';
    runtime.treat.position.set(0.8, 0.45 + Math.sin(elapsed * 14) * 0.12, 0.22);
    runtime.treat.rotation.set(elapsed * 2, elapsed * 3, elapsed);
  }
}

function resetImportedPose(runtime: CatRuntime) {
  runtime.root.quaternion.copy(runtime.baseQuaternion);
  runtime.restBones.forEach((target) => resetDrivenBone(target));
}

function resetDrivenBone(target: DrivenBone) {
  target.bone.position.copy(target.basePosition);
  target.bone.quaternion.copy(target.baseQuaternion);
  target.bone.scale.copy(target.baseScale);
}

function driveRigidHead(runtime: CatRuntime, expression: CatExpression, mood: CatMood, elapsed: number) {
  const yaw = clampNumber(expression.yaw, -0.75, 0.75) * 0.22;
  const pitch = clampNumber(expression.pitch, -0.65, 0.65) * 0.12;
  const breathe = Math.sin(elapsed * 0.65) * 0.006;
  const rewardRoll = mood === 'reward' ? Math.sin(elapsed * 10) * 0.018 : 0;
  const roll = Math.sin(elapsed * 0.4) * 0.004 + rewardRoll;
  const offset = new THREE.Euler(pitch + breathe, yaw, roll, 'XYZ');
  runtime.root.quaternion.copy(runtime.baseQuaternion).multiply(new THREE.Quaternion().setFromEuler(offset));
}

function driveHead(runtime: CatRuntime, expression: CatExpression, mood: CatMood, elapsed: number) {
  if (runtime.poseBones.length === 0) {
    return;
  }

  runtime.root.quaternion.copy(runtime.baseQuaternion);
  const isGlb = runtime.source === 'glb';
  const pitch = clampNumber(expression.pitch, -0.65, 0.65) * (isGlb ? 0.32 : 0.18);
  const yaw = clampNumber(expression.yaw, -0.75, 0.75) * (isGlb ? 0.42 : 0.36);
  const breathe = Math.sin(elapsed * 0.65) * 0.01;
  const rewardRoll = mood === 'reward' ? Math.sin(elapsed * 10) * (isGlb ? 0.025 : 0.045) : 0;
  const roll = isGlb ? 0 : Math.sin(elapsed * 0.4) * 0.01 + rewardRoll;

  runtime.poseBones.forEach((target) => {
    const offset = new THREE.Euler(
      pitch * target.pitchWeight + breathe * target.pitchWeight,
      yaw * target.yawWeight,
      roll * target.rollWeight,
      'XYZ'
    );
    applyBoneOffset(target, offset, runtime.source);
  });
}

function driveMorphTargets(mesh: THREE.Mesh, expression: CatExpression) {
  const dictionary = mesh.morphTargetDictionary;
  const influences = mesh.morphTargetInfluences;
  if (!dictionary || !influences) {
    return;
  }

  influences.fill(0);
  const blinkLeft = remapFeature(expression.blinkLeft, 0.035, 0.34, 1);
  const blinkRight = remapFeature(expression.blinkRight, 0.035, 0.34, 1);
  const smile = remapFeature(expression.smile, 0.05, 0.42, 0.68);
  const mouthOpen = remapFeature(expression.mouthOpen, 0.05, 0.34, 0.86);
  const mouthFunnel = remapFeature(expression.mouthFunnel, 0.02, 0.55, 0.82);
  const mouthPucker = remapFeature(expression.mouthPucker, 0.02, 0.52, 0.82);
  const mouthWide = remapFeature(expression.mouthWide, 0.04, 0.46, 0.72);
  const mouthPress = remapFeature(expression.mouthPress, 0.05, 0.5, 0.72);
  const mouthClose = clamp01((0.12 - expression.mouthOpen) / 0.12) * (1 - Math.max(mouthFunnel, mouthPucker) * 0.42);
  const cheek = clamp01(smile * 0.12);
  const leftEyeWide = clamp01((1 - blinkLeft) * 0.38);
  const rightEyeWide = clamp01((1 - blinkRight) * 0.38);
  const lookLeft = remapFeature(-expression.yaw, 0.08, 0.65, 0.42);
  const lookRight = remapFeature(expression.yaw, 0.08, 0.65, 0.42);
  const lookUp = remapFeature(-expression.pitch, 0.08, 0.55, 0.28);
  const lookDown = remapFeature(expression.pitch, 0.08, 0.55, 0.28);
  const isEyeOcclusion = mesh.name.toLowerCase().includes('eyeocclusion');
  if (isEyeOcclusion) {
    applyEyeOcclusionOpacity(mesh, Math.max(blinkLeft, blinkRight));
  }

  const rules: MorphRule[] = [
    { names: ['A14_Eye_Blink_Left', 'Eye_Blink_L', 'eyeBlinkLeft'], value: isEyeOcclusion ? blinkLeft : blinkLeft * 0.96 },
    { names: ['A15_Eye_Blink_Right', 'Eye_Blink_R', 'eyeBlinkRight'], value: isEyeOcclusion ? blinkRight : blinkRight * 0.96 },
    { names: ['Eye_Blink_L'], value: blinkLeft },
    { names: ['Eye_Blink_R'], value: blinkRight },
    { names: ['Eye_Blink'], value: Math.min(blinkLeft, blinkRight) * (isEyeOcclusion ? 0.58 : 0.42) },
    { names: ['A16_Eye_Squint_Left', 'Eye_Squint_L'], value: blinkLeft * 0.32 },
    { names: ['A17_Eye_Squint_Right', 'Eye_Squint_R'], value: blinkRight * 0.32 },
    { names: ['A18_Eye_Wide_Left', 'Eye_Wide_L'], value: leftEyeWide },
    { names: ['A19_Eye_Wide_Right', 'Eye_Wide_R'], value: rightEyeWide },
    { names: ['A10_Eye_Look_Out_Left'], value: lookLeft },
    { names: ['A12_Eye_Look_In_Right'], value: lookLeft },
    { names: ['A11_Eye_Look_In_Left'], value: lookRight },
    { names: ['A13_Eye_Look_Out_Right'], value: lookRight },
    { names: ['A06_Eye_Look_Up_Left'], value: lookUp },
    { names: ['A07_Eye_Look_Up_Right'], value: lookUp },
    { names: ['A08_Eye_Look_Down_Left'], value: lookDown },
    { names: ['A09_Eye_Look_Down_Right'], value: lookDown },
    { names: ['A38_Mouth_Smile_Left', 'Mouth_Smile_L', 'mouthSmileLeft'], value: smile },
    { names: ['A39_Mouth_Smile_Right', 'Mouth_Smile_R', 'mouthSmileRight'], value: smile },
    { names: ['Mouth_Smile'], value: smile * 0.18 },
    { names: ['A42_Mouth_Dimple_Left', 'Mouth_Dimple_L'], value: smile * 0.14 },
    { names: ['A43_Mouth_Dimple_Right', 'Mouth_Dimple_R'], value: smile * 0.14 },
    { names: ['A21_Cheek_Squint_Left', 'Cheek_Raise_L'], value: cheek },
    { names: ['A22_Cheek_Squint_Right', 'Cheek_Raise_R'], value: cheek },
    { names: ['A25_Jaw_Open', 'Mouth_Open', 'Merged_Open_Mouth', 'jawOpen'], value: mouthOpen },
    { names: ['Mouth_Lips_Open', 'Mouth_Lips_Part', 'Lip_Open'], value: mouthOpen * 0.52 },
    { names: ['A29_Mouth_Funnel', 'Mouth_Pucker_Open'], value: Math.max(mouthFunnel, mouthOpen * mouthFunnel * 0.7) },
    { names: ['A30_Mouth_Pucker', 'Mouth_Pucker'], value: mouthPucker },
    { names: ['Mouth_Widen', 'Mouth_Widen_Sides', 'Wide'], value: mouthWide },
    { names: ['A50_Mouth_Stretch_Left'], value: mouthWide * 0.55 },
    { names: ['A51_Mouth_Stretch_Right'], value: mouthWide * 0.55 },
    { names: ['A48_Mouth_Press_Left', 'Mouth_Lips_Tight'], value: mouthPress * 0.45 },
    { names: ['A49_Mouth_Press_Right'], value: mouthPress * 0.45 },
    { names: ['A35_Mouth_Shrug_Upper'], value: mouthOpen * 0.03 },
    { names: ['A36_Mouth_Shrug_Lower'], value: mouthOpen * 0.04 },
    { names: ['A37_Mouth_Close'], value: mouthClose * 0.24 },
    { names: ['Mouth_Lips_Tight'], value: mouthClose * 0.06 }
  ];

  rules.forEach((rule) => setFirstMorph(dictionary, influences, rule.names, rule.value));
}

function applyEyeOcclusionOpacity(mesh: THREE.Mesh, blink: number) {
  const opacity = smoothStepRange(blink, 0.72, 0.96);
  mesh.visible = opacity > 0.015;
  getMaterials(mesh.material).forEach((material) => {
    material.opacity = opacity;
    material.transparent = true;
    material.depthWrite = false;
    material.needsUpdate = true;
  });
}

function setFirstMorph(
  dictionary: Record<string, number>,
  influences: number[],
  names: string[],
  value: number
) {
  const lookup = getMorphLookup(dictionary);
  const target = names.find((name) => lookup.has(name.toLowerCase()));
  if (!target) {
    return false;
  }

  const index = lookup.get(target.toLowerCase());
  if (index === undefined) {
    return false;
  }

  influences[index] = clamp01(value);
  return true;
}

function getMorphLookup(dictionary: Record<string, number>) {
  const cached = morphLookupCache.get(dictionary);
  if (cached) {
    return cached;
  }

  const lookup = new Map<string, number>();
  Object.entries(dictionary).forEach(([name, index]) => {
    lookup.set(name.toLowerCase(), index);
  });
  morphLookupCache.set(dictionary, lookup);
  return lookup;
}

function createHandIndicators(): HandIndicatorSet {
  const group = new THREE.Group();
  group.name = 'safe-hand-intent-indicators';

  const left = createHandIndicator('left');
  const right = createHandIndicator('right');
  group.add(left, right);

  return { group, left, right };
}

function createHandIndicator(side: 'left' | 'right') {
  const group = new THREE.Group();
  group.name = `${side}-hand-intent`;
  group.visible = false;

  const color = side === 'left' ? 0x3f8fd2 : 0xd88935;
  const accent = side === 'left' ? 0x8ec7f0 : 0xf0c06e;
  const palm = new THREE.Mesh(
    new THREE.SphereGeometry(0.095, 18, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false })
  );
  palm.scale.set(1.1, 0.82, 0.16);
  palm.renderOrder = 30;
  group.add(palm);

  const fingerMaterial = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    depthTest: false
  });
  const fingers = Array.from({ length: 5 }, () => {
    const finger = new THREE.Mesh(new THREE.SphereGeometry(0.033, 12, 8), fingerMaterial.clone());
    finger.renderOrder = 31;
    group.add(finger);
    return finger;
  });

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.008, 8, 36),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false })
  );
  halo.position.z = -0.01;
  halo.renderOrder = 29;
  group.add(halo);
  group.userData.parts = { palm, fingers, halo } satisfies HandIndicatorParts;

  return group;
}

function driveHandIndicators(runtime: CatRuntime, expression: CatExpression, elapsed: number) {
  const indicators = runtime.handIndicators;
  if (!indicators) {
    return;
  }

  updateHandIndicator(indicators.left, getHandState(expression, 'left'), elapsed);
  updateHandIndicator(indicators.right, getHandState(expression, 'right'), elapsed + Math.PI);
}

function updateHandIndicator(group: THREE.Group, state: HandState, elapsed: number) {
  const parts = group.userData.parts as HandIndicatorParts | undefined;
  if (!parts) {
    return;
  }

  const cover = Math.max(state.coverMouth, state.coverEyes, state.coverHead);
  const activity = Math.max(state.raise, state.open * 0.42, state.pinch * 0.58, cover);
  group.visible = activity > 0.035;
  if (!group.visible) {
    return;
  }

  const s = state.sideSign;
  const raise = Math.max(state.raise, state.coverMouth * 0.72, state.coverEyes * 0.84, state.coverHead * 0.92);
  const target = new THREE.Vector3(
    s * (0.46 + Math.abs(state.handX) * 0.16),
    -0.22 + raise * 0.78 + state.handY * 0.12,
    0.72
  );
  target.lerp(new THREE.Vector3(s * 0.18, 0.24, 0.78), state.coverMouth);
  target.lerp(new THREE.Vector3(s * 0.2, 0.43, 0.78), state.coverEyes);
  target.lerp(new THREE.Vector3(s * 0.32, 0.62, 0.72), state.coverHead);

  group.position.copy(target);
  group.rotation.set(0, 0, s * (state.twist * 0.42 + Math.sin(elapsed * 1.7) * 0.025));
  group.scale.setScalar(0.95 + smoothStep01(activity) * 0.48);

  const open = clamp01(Math.max(state.open, cover * 0.75));
  const pinch = clamp01(state.pinch);
  const spread = 0.038 + open * 0.056;
  const lift = 0.074 + open * 0.042;
  const curl = (1 - open) * 0.04;
  const fingerTargets = [
    [-spread * 1.55, lift * 0.5 - curl],
    [-spread * 0.7, lift - curl * 0.35],
    [0, lift * 1.1 - curl * 0.2],
    [spread * 0.7, lift - curl * 0.35],
    [spread * 1.55, lift * 0.5 - curl]
  ];

  if (pinch > 0.05) {
    fingerTargets[0][0] = mixNumber(fingerTargets[0][0], -0.026, pinch);
    fingerTargets[0][1] = mixNumber(fingerTargets[0][1], 0.032, pinch);
    fingerTargets[1][0] = mixNumber(fingerTargets[1][0], 0.026, pinch);
    fingerTargets[1][1] = mixNumber(fingerTargets[1][1], 0.034, pinch);
  }

  parts.fingers.forEach((finger, index) => {
    const [x, y] = fingerTargets[index];
    finger.position.set(x, y, 0.012);
    finger.scale.setScalar(index === 0 ? 1.12 : 1);
  });

  const opacity = smoothStepRange(activity, 0.035, 0.26);
  setMeshOpacity(parts.palm, 0.28 + opacity * 0.54);
  parts.fingers.forEach((finger) => setMeshOpacity(finger, 0.24 + opacity * 0.54));
  parts.halo.scale.setScalar(1 + cover * 0.45 + Math.sin(elapsed * 3.5) * 0.025);
  setMeshOpacity(parts.halo, cover > 0.04 ? 0.18 + cover * 0.34 : 0.06 * opacity);
}

function setMeshOpacity(mesh: THREE.Mesh, opacity: number) {
  getMaterials(mesh.material).forEach((material) => {
    material.opacity = clamp01(opacity);
    material.transparent = true;
    material.needsUpdate = true;
  });
}

function collectArmBones(root: THREE.Object3D): DrivenArmBone[] {
  const bones: DrivenArmBone[] = [];
  const targets: Array<{ name: string; side: 'left' | 'right'; role: ArmRole }> = [
    { name: 'CC_Base_L_Clavicle', side: 'left', role: 'clavicle' },
    { name: 'CC_Base_L_Upperarm', side: 'left', role: 'upper' },
    { name: 'CC_Base_L_Forearm', side: 'left', role: 'forearm' },
    { name: 'CC_Base_L_Hand', side: 'left', role: 'hand' },
    { name: 'CC_Base_R_Clavicle', side: 'right', role: 'clavicle' },
    { name: 'CC_Base_R_Upperarm', side: 'right', role: 'upper' },
    { name: 'CC_Base_R_Forearm', side: 'right', role: 'forearm' },
    { name: 'CC_Base_R_Hand', side: 'right', role: 'hand' }
  ];

  targets.forEach((target) => {
    const bone = root.getObjectByName(target.name);
    if (bone) {
      bones.push({ ...captureDrivenBone(bone), side: target.side, role: target.role });
    }
  });

  root.traverse((child) => {
    const match = child.name.match(/^CC_Base_([LR])_(Thumb|Index|Mid|Ring|Pinky)([123])$/i);
    if (!match) {
      return;
    }
    bones.push({
      ...captureDrivenBone(child),
      side: match[1].toLowerCase() === 'l' ? 'left' : 'right',
      role: 'finger',
      finger: match[2].toLowerCase() as DrivenArmBone['finger']
    });
  });

  return bones;
}

function driveArms(runtime: CatRuntime, expression: CatExpression, elapsed: number) {
  runtime.armBones.forEach((target) => {
    const { side, role, finger } = target;
    if (runtime.source === 'glb' && role === 'clavicle') {
      resetDrivenBone(target);
      return;
    }
    if (runtime.source === 'glb' && role === 'finger') {
      resetDrivenBone(target);
      return;
    }

    const state = getHandState(expression, side);
    const idle = Math.sin(elapsed * 1.1 + (side === 'left' ? 0 : Math.PI)) * 0.03;
    const offset = role === 'finger' ? getFingerOffset(state, finger) : getArmOffset(role, state, idle, runtime.source);
    applyBoneOffset(target, offset, runtime.source);
  });
}

function applyBoneOffset(target: DrivenBone, offset: THREE.Euler, _source: AssetSource) {
  const offsetQuaternion = new THREE.Quaternion().setFromEuler(offset);
  target.bone.position.copy(target.basePosition);
  target.bone.scale.copy(target.baseScale);
  target.bone.quaternion.copy(target.baseQuaternion).multiply(offsetQuaternion);
}

interface HandState {
  sideSign: number;
  raise: number;
  handX: number;
  handY: number;
  open: number;
  pinch: number;
  twist: number;
  coverMouth: number;
  coverEyes: number;
  coverHead: number;
  gestureWeight: number;
}

function getHandState(expression: CatExpression, side: 'left' | 'right'): HandState {
  const coverMouth = side === 'left' ? expression.leftCoverMouth : expression.rightCoverMouth;
  const coverEyes = side === 'left' ? expression.leftCoverEyes : expression.rightCoverEyes;
  const coverHead = side === 'left' ? expression.leftCoverHead : expression.rightCoverHead;
  const strongestGesture = Math.max(coverMouth, coverEyes, coverHead);

  return {
    sideSign: side === 'left' ? 1 : -1,
    raise: smoothStep01(side === 'left' ? expression.leftHandRaise : expression.rightHandRaise),
    handX: side === 'left' ? expression.leftHandX : expression.rightHandX,
    handY: side === 'left' ? expression.leftHandY : expression.rightHandY,
    open: smoothStep01(side === 'left' ? expression.leftHandOpen : expression.rightHandOpen),
    pinch: smoothStep01(side === 'left' ? expression.leftHandPinch : expression.rightHandPinch),
    twist: side === 'left' ? expression.leftHandTwist : expression.rightHandTwist,
    coverMouth: smoothStep01(coverMouth),
    coverEyes: smoothStep01(coverEyes),
    coverHead: smoothStep01(coverHead),
    gestureWeight: smoothStep01(clamp01(strongestGesture * 1.18))
  };
}

function getArmOffset(role: Exclude<ArmRole, 'finger'>, state: HandState, idle: number, source: AssetSource) {
  if (source === 'glb') {
    return getGlbArmOffset(role, state, idle);
  }

  const raise = Math.max(state.raise, state.coverMouth * 0.78, state.coverEyes * 0.92, state.coverHead * 0.98);
  const base = new THREE.Euler(0, 0, 0, 'XYZ');

  if (role === 'clavicle') {
    base.set(-raise * 0.12, state.sideSign * (raise * 0.05 + state.handX * 0.06), state.sideSign * (raise * 0.18 + idle));
  } else if (role === 'upper') {
    base.set(
      -raise * 0.58 + state.handY * 0.12,
      state.sideSign * (raise * 0.16 + state.handX * 0.22),
      state.sideSign * (raise * 0.68 + state.handX * 0.24 + idle)
    );
  } else if (role === 'forearm') {
    base.set(
      -raise * 0.34 + state.handY * 0.18,
      state.sideSign * (state.handX * 0.2 + state.twist * 0.16),
      state.sideSign * (raise * 0.26 + state.handX * 0.18 + idle * 0.55)
    );
  } else {
    base.set(
      -raise * 0.12 + state.handY * 0.14,
      state.twist * 0.5,
      state.sideSign * (state.handX * 0.34 + state.pinch * 0.18)
    );
  }

  if (state.gestureWeight > 0.001) {
    blendEuler(base, getGestureArmOffset(role, state), state.gestureWeight);
  }

  return base;
}

function getGlbArmOffset(role: Exclude<ArmRole, 'finger'>, state: HandState, idle: number) {
  const raise = Math.max(state.raise, state.coverMouth * 0.78, state.coverEyes * 0.88, state.coverHead * 0.94);
  const base = new THREE.Euler(0, 0, 0, 'XYZ');
  const s = state.sideSign;

  if (role === 'clavicle') {
    base.set(0, 0, 0);
  } else if (role === 'upper') {
    base.set(
      -raise * 0.11 + state.handY * 0.025,
      s * (raise * 0.035 + state.handX * 0.035),
      s * (raise * 0.22 + state.handX * 0.05 + idle * 0.16)
    );
  } else if (role === 'forearm') {
    base.set(
      -raise * 0.1 + state.handY * 0.035,
      s * (state.handX * 0.04 + state.twist * 0.035),
      s * (raise * 0.1 + state.handX * 0.05 + idle * 0.1)
    );
  } else {
    base.set(-raise * 0.04 + state.handY * 0.035, state.twist * 0.1, s * (state.handX * 0.07 + state.pinch * 0.035));
  }

  if (state.gestureWeight > 0.001) {
    blendEuler(base, getGlbGestureArmOffset(role, state), state.gestureWeight);
  }

  return base;
}

function getGlbGestureArmOffset(role: Exclude<ArmRole, 'finger'>, state: HandState) {
  const s = state.sideSign;
  const mouth: Record<Exclude<ArmRole, 'finger'>, THREE.Euler> = {
    clavicle: new THREE.Euler(0, 0, 0, 'XYZ'),
    upper: new THREE.Euler(-0.16, s * 0.055, s * 0.22, 'XYZ'),
    forearm: new THREE.Euler(-0.16, s * 0.09, -s * 0.12, 'XYZ'),
    hand: new THREE.Euler(-0.05, -s * 0.025, -s * 0.04, 'XYZ')
  };
  const eyes: Record<Exclude<ArmRole, 'finger'>, THREE.Euler> = {
    clavicle: new THREE.Euler(0, 0, 0, 'XYZ'),
    upper: new THREE.Euler(-0.22, s * 0.07, s * 0.26, 'XYZ'),
    forearm: new THREE.Euler(-0.18, s * 0.11, -s * 0.16, 'XYZ'),
    hand: new THREE.Euler(-0.035, -s * 0.02, -s * 0.06, 'XYZ')
  };
  const head: Record<Exclude<ArmRole, 'finger'>, THREE.Euler> = {
    clavicle: new THREE.Euler(0, 0, 0, 'XYZ'),
    upper: new THREE.Euler(-0.24, -s * 0.04, s * 0.24, 'XYZ'),
    forearm: new THREE.Euler(-0.2, -s * 0.08, s * 0.1, 'XYZ'),
    hand: new THREE.Euler(0.025, s * 0.06, s * 0.06, 'XYZ')
  };

  return weightedEuler([
    { weight: state.coverMouth, value: mouth[role] },
    { weight: state.coverEyes, value: eyes[role] },
    { weight: state.coverHead, value: head[role] }
  ]);
}

function getGestureArmOffset(role: Exclude<ArmRole, 'finger'>, state: HandState) {
  const s = state.sideSign;
  const mouth: Record<Exclude<ArmRole, 'finger'>, THREE.Euler> = {
    clavicle: new THREE.Euler(-0.16, s * 0.08, s * 0.26, 'XYZ'),
    upper: new THREE.Euler(-0.74, s * 0.34, s * 1.06, 'XYZ'),
    forearm: new THREE.Euler(-0.62, s * 0.55, s * 0.58, 'XYZ'),
    hand: new THREE.Euler(-0.2, -s * 0.1, s * 0.34, 'XYZ')
  };
  const eyes: Record<Exclude<ArmRole, 'finger'>, THREE.Euler> = {
    clavicle: new THREE.Euler(-0.2, s * 0.1, s * 0.32, 'XYZ'),
    upper: new THREE.Euler(-0.96, s * 0.44, s * 1.2, 'XYZ'),
    forearm: new THREE.Euler(-0.76, s * 0.66, s * 0.72, 'XYZ'),
    hand: new THREE.Euler(-0.1, -s * 0.04, s * 0.46, 'XYZ')
  };
  const head: Record<Exclude<ArmRole, 'finger'>, THREE.Euler> = {
    clavicle: new THREE.Euler(-0.24, -s * 0.08, s * 0.26, 'XYZ'),
    upper: new THREE.Euler(-1.18, -s * 0.2, s * 0.8, 'XYZ'),
    forearm: new THREE.Euler(-0.94, -s * 0.34, s * 0.28, 'XYZ'),
    hand: new THREE.Euler(0.14, s * 0.42, s * 0.18, 'XYZ')
  };

  return weightedEuler([
    { weight: state.coverMouth, value: mouth[role] },
    { weight: state.coverEyes, value: eyes[role] },
    { weight: state.coverHead, value: head[role] }
  ]);
}

function getFingerOffset(state: HandState, finger?: DrivenArmBone['finger']) {
  const gestureOpen = Math.max(state.open, state.coverMouth * 0.82, state.coverEyes * 0.92, state.coverHead * 0.56);
  const coverFace = Math.max(state.coverMouth, state.coverEyes);
  const curl = clamp01(0.9 - gestureOpen + state.pinch * 0.45 - coverFace * 0.22 + state.coverHead * 0.08);
  const spread =
    finger === 'thumb'
      ? state.sideSign * (gestureOpen * 0.38 - state.pinch * 0.3 + coverFace * 0.1)
      : finger === 'index'
        ? state.sideSign * (gestureOpen * 0.16 - state.pinch * 0.18)
        : finger === 'pinky'
          ? -state.sideSign * gestureOpen * 0.2
          : 0;

  return new THREE.Euler(curl * 0.34, spread, state.sideSign * state.twist * 0.08, 'XYZ');
}

function driveProceduralFallback(runtime: CatRuntime, expression: CatExpression) {
  if (runtime.source !== 'procedural') {
    return;
  }

  if (runtime.fallbackMouth) {
    runtime.fallbackMouth.scale.y = 0.32 + expression.mouthOpen * 2.1;
  }
  if (runtime.fallbackLeftEye) {
    runtime.fallbackLeftEye.scale.y = Math.max(0.12, 1 - expression.blinkLeft * 0.88);
  }
  if (runtime.fallbackRightEye) {
    runtime.fallbackRightEye.scale.y = Math.max(0.12, 1 - expression.blinkRight * 0.88);
  }
}

function weightedEuler(items: Array<{ weight: number; value: THREE.Euler }>) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const result = new THREE.Euler(0, 0, 0, 'XYZ');
  if (total <= 0.001) {
    return result;
  }

  items.forEach((item) => {
    const weight = item.weight / total;
    result.x += item.value.x * weight;
    result.y += item.value.y * weight;
    result.z += item.value.z * weight;
  });
  return result;
}

function blendEuler(base: THREE.Euler, target: THREE.Euler, amount: number) {
  base.x = mixNumber(base.x, target.x, amount);
  base.y = mixNumber(base.y, target.y, amount);
  base.z = mixNumber(base.z, target.z, amount);
}

function mixNumber(a: number, b: number, alpha: number) {
  return a + (b - a) * alpha;
}

function remapFeature(value: number, deadZone: number, fullAt: number, maxValue: number) {
  const normalized = clamp01((value - deadZone) / Math.max(fullAt - deadZone, 0.001));
  return clamp01(Math.pow(normalized, 0.72) * maxValue);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothStep01(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function smoothStepRange(value: number, edge0: number, edge1: number) {
  return smoothStep01((value - edge0) / Math.max(edge1 - edge0, 0.001));
}

function createTreat() {
  const material = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.7 });
  const treat = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.24), material);
  treat.name = 'reward-treat';
  treat.visible = false;
  return treat;
}

function createProceduralCat() {
  const group = new THREE.Group();
  group.name = 'fallback-cat';

  const fur = new THREE.MeshStandardMaterial({ color: 0xc85b45, roughness: 0.76 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2926, roughness: 0.55 });
  const light = new THREE.MeshStandardMaterial({ color: 0xf1d8bf, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.68, 36, 28), fur);
  body.scale.set(0.88, 0.78, 0.72);
  body.position.y = -0.58;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 48, 32), fur);
  head.name = 'head';
  head.position.y = 0.28;
  group.add(head);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), light);
  muzzle.position.set(0, 0.17, 0.52);
  muzzle.scale.set(1.25, 0.72, 0.5);
  head.add(muzzle);

  const leftEar = createEar(fur);
  leftEar.position.set(-0.36, 0.72, 0.02);
  leftEar.rotation.z = 0.24;
  head.add(leftEar);

  const rightEar = createEar(fur);
  rightEar.position.set(0.36, 0.72, 0.02);
  rightEar.rotation.z = -0.24;
  head.add(rightEar);

  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), dark);
  leftEye.name = 'fallback-left-eye';
  leftEye.position.set(-0.22, 0.35, 0.53);
  head.add(leftEye);

  const rightEye = leftEye.clone();
  rightEye.name = 'fallback-right-eye';
  rightEye.position.x = 0.22;
  head.add(rightEye);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 10), dark);
  nose.position.set(0, 0.22, 0.66);
  nose.scale.set(1.2, 0.72, 0.55);
  head.add(nose);

  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.08), new THREE.MeshBasicMaterial({ color: 0x2b2926 }));
  mouth.name = 'fallback-mouth';
  mouth.position.set(0, 0.08, 0.665);
  head.add(mouth);

  return group;
}

function createEar(material: THREE.Material) {
  const ear = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.46, 3), material);
  ear.rotation.x = 0.08;
  ear.rotation.y = Math.PI / 4;
  return ear;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}
