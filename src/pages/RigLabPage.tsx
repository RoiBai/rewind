import { useEffect, useMemo, useState } from 'react';
import { UnityAvatarStage, type UnityLookMode } from '../components/UnityAvatarStage';
import { CatExpression, neutralExpression } from '../lib/faceTracking';
import { getKalidokitStatus } from '../lib/kalidokitRuntime';

type Preset = {
  id: string;
  keyName: string;
  label: string;
  values: Partial<CatExpression>;
  clip?: string;
};

type SliderConfig = {
  key: keyof CatExpression;
  label: string;
  min?: number;
  max?: number;
};

const facePresets: Preset[] = [
  { id: 'neutral', keyName: '1', label: 'Neutral', values: {} },
  { id: 'smile', keyName: '2', label: 'Smile', values: { smile: 0.72, mouthWide: 0.12 } },
  { id: 'blink', keyName: '3', label: 'Blink', values: { blinkLeft: 1, blinkRight: 1 } },
  { id: 'talk', keyName: '4', label: 'Talk', values: { mouthOpen: 0.72 } },
  { id: 'pucker', keyName: '5', label: 'Pucker', values: { mouthPucker: 0.85, mouthFunnel: 0.48 } },
  { id: 'wide', keyName: '6', label: 'Wide', values: { mouthWide: 0.68, mouthOpen: 0.10 } }
];

const actionPresets: Preset[] = [
  { id: 'tilt-left', keyName: 'Q', label: 'Tilt L', values: {}, clip: 'RigLab_Head_Tilt_L' },
  { id: 'tilt-right', keyName: 'W', label: 'Tilt R', values: {}, clip: 'RigLab_Head_Tilt_R' },
  { id: 'turn-left', keyName: 'E', label: 'Turn L', values: {}, clip: 'RigLab_Head_Turn_L' },
  { id: 'turn-right', keyName: 'R', label: 'Turn R', values: {}, clip: 'RigLab_Head_Turn_R' },
  { id: 'look-up', keyName: 'T', label: 'Look Up', values: {}, clip: 'RigLab_Head_Up' },
  { id: 'look-down', keyName: 'Y', label: 'Look Down', values: {}, clip: 'RigLab_Head_Down' },
  { id: 'hands-back', keyName: 'H', label: 'Hands Back', values: {}, clip: 'RigLab_Hands_Back' },
  { id: 'raise-left', keyName: 'A', label: 'Raise L', values: {}, clip: 'RigLab_Left_Raise' },
  { id: 'raise-right', keyName: 'S', label: 'Raise R', values: {}, clip: 'RigLab_Right_Raise' },
  { id: 'mouth-left', keyName: 'Z', label: 'Mouth L', values: {}, clip: 'RigLab_Left_Mouth' },
  { id: 'mouth-right', keyName: 'X', label: 'Mouth R', values: {}, clip: 'RigLab_Right_Mouth' },
  { id: 'eyes-left', keyName: 'C', label: 'Eyes L', values: {}, clip: 'RigLab_Left_Eyes' },
  { id: 'eyes-right', keyName: 'V', label: 'Eyes R', values: {}, clip: 'RigLab_Right_Eyes' }
];

const sliders: SliderConfig[] = [
  { key: 'smile', label: 'Smile' },
  { key: 'mouthOpen', label: 'Mouth' },
  { key: 'mouthPucker', label: 'Pucker' },
  { key: 'blinkLeft', label: 'Blink L' },
  { key: 'blinkRight', label: 'Blink R' },
  { key: 'yaw', label: 'Yaw', min: -1, max: 1 },
  { key: 'pitch', label: 'Pitch', min: -1, max: 1 },
  { key: 'faceScale', label: 'Zoom', min: -1, max: 1 },
  { key: 'leftHandRaise', label: 'Left arm' },
  { key: 'rightHandRaise', label: 'Right arm' }
];

export function RigLabPage() {
  const initialPreset = getInitialPreset();
  const [expression, setExpression] = useState<CatExpression>({ ...neutralExpression, ...initialPreset.values });
  const [poseClip, setPoseClip] = useState(initialPreset.clip ?? 'RigLab_Neutral');
  const [activeId, setActiveId] = useState(initialPreset.id);
  const [lookMode, setLookMode] = useState<UnityLookMode>(getInitialLookMode());
  const [solverStatus, setSolverStatus] = useState('Loading solver');

  const allPresets = useMemo(() => [...facePresets, ...actionPresets], []);

  const applyPreset = (preset: Preset) => {
    setExpression({ ...neutralExpression, ...preset.values });
    setPoseClip(preset.clip ?? 'RigLab_Neutral');
    setActiveId(preset.id);
  };

  const reset = () => {
    setExpression(neutralExpression);
    setPoseClip('RigLab_Neutral');
    setActiveId('neutral');
  };

  const setFeature = (key: keyof CatExpression, value: number) => {
    setExpression((current) => ({ ...current, [key]: value }));
    setPoseClip('RigLab_Neutral');
    setActiveId('custom');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === '0') {
        event.preventDefault();
        reset();
        return;
      }
      const preset = allPresets.find((item) => item.keyName.toLowerCase() === key);
      if (preset) {
        event.preventDefault();
        applyPreset(preset);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [allPresets]);

  useEffect(() => {
    let cancelled = false;
    getKalidokitStatus().then((status) => {
      if (!cancelled) {
        setSolverStatus(status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rig-lab page-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Temporary Test</p>
          <h2>Rig Lab</h2>
        </div>
        <div className="rig-lab__toggles">
          <div className="segmented-control rig-lab__look-toggle" aria-label="Avatar look">
            {(['official', 'stable'] as UnityLookMode[]).map((mode) => (
              <button
                key={mode}
                className={lookMode === mode ? 'is-active' : ''}
                type="button"
                onClick={() => setLookMode(mode)}
              >
                {mode === 'official' ? 'Official' : 'Stable'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rig-lab__status">
        <span>Unity WebGL rig</span>
        <span>Baked poses</span>
        <span>{solverStatus}</span>
      </div>

      <UnityAvatarStage className="rig-lab__avatar" poseClip={poseClip} expression={expression} lookMode={lookMode} />

      <div className="rig-lab__quick">
        <button className="secondary-button compact-button" type="button" onClick={reset}>
          0 Reset
        </button>
        <span>{activeId === 'custom' ? 'Custom' : activeId}</span>
      </div>

      <section className="form-panel">
        <div className="detail-heading">
          <h3>Face Keys</h3>
          <span className="muted-label">1-6</span>
        </div>
        <div className="rig-lab__button-grid">
          {facePresets.map((preset) => (
            <button
              key={preset.id}
              className={`secondary-button compact-button ${activeId === preset.id ? 'is-active' : ''}`}
              type="button"
              onClick={() => applyPreset(preset)}
            >
              {preset.keyName} {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className="form-panel">
        <div className="detail-heading">
          <h3>Pose Keys</h3>
          <span className="muted-label">Q W E R T Y H A S Z X C V</span>
        </div>
        <div className="rig-lab__button-grid">
          {actionPresets.map((preset) => (
            <button
              key={preset.id}
              className={`secondary-button compact-button ${activeId === preset.id ? 'is-active' : ''}`}
              type="button"
              onClick={() => applyPreset(preset)}
            >
              {preset.keyName} {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className="form-panel">
        <div className="detail-heading">
          <h3>Manual</h3>
          <span className="muted-label">Face only</span>
        </div>
        <div className="rig-lab__sliders">
          {sliders.map((slider) => {
            const min = slider.min ?? 0;
            const max = slider.max ?? 1;
            return (
              <label className="slider-label" key={slider.key}>
                <span>
                  {slider.label}
                  <strong>{expression[slider.key].toFixed(2)}</strong>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step="0.01"
                  value={expression[slider.key]}
                  onChange={(event) => setFeature(slider.key, Number(event.target.value))}
                />
              </label>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

function getInitialPreset(): Preset {
  const presetId = new URLSearchParams(window.location.search).get('preset');
  return [...facePresets, ...actionPresets].find((preset) => preset.id === presetId) ?? facePresets[0];
}

function getInitialLookMode(): UnityLookMode {
  return new URLSearchParams(window.location.search).get('look') === 'stable' ? 'stable' : 'official';
}
