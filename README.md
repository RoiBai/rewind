# Rewind

Mobile-first PWA prototype for an HCI study.

> Research prototype only. Rewind does not claim clinical effect.

## What Works

- Home-screen workflow: Start New Episode or Review Episode.
- Cat-only affective capture with avatar video and user voice.
- Camera preview is hidden and used only for tracking.
- Unity WebGL cat avatar during recording.
- MediaPipe face + hand tracking hook with a graceful fallback.
- Local episode archive in IndexedDB.
- Stubbed AI draft pipeline for title, topic, tags, and replay moments.
- Review flow with pre/post desire sliders.
- Reward variant with treat animation and counter.
- Local JSON export.
- PWA manifest, service worker, icons, and iOS meta tags.

## User Flow

1. Launch Rewind from the home-screen icon.
2. Tap Start New Episode.
3. Connect camera and microphone.
4. Watch only the cat avatar.
5. Start Recording.
6. Speak the regret episode.
7. Stop.
8. Rewind saves avatar video + voice locally.
9. Processing creates a draft title, topic, and 30s replay plan.
10. Tap Review Episode to watch and log feedback.

## Run Locally

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Camera and microphone require localhost or HTTPS.

## Build

```bash
npm run build
npm run preview
```

## Deploy

Vercel:

```bash
npm run build
```

- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`

Netlify:

- Build command: `npm run build`
- Publish directory: `dist`

Use HTTPS for camera, microphone, PWA install, and service worker support.

## Install on iOS

1. Open the deployed HTTPS URL in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Launch Rewind from the icon.

## Cat Asset

The purchased asset is on this PC:

```text
E:\Games\CityU-Game\Rewind\Assets\Cat
```

Browsers cannot load that path directly.

Project target:

```text
public/assets/cat/
```

Current runtime:

```text
public/unity/rewind-avatar/
```

Unity source project:

```text
E:\Games\CityU-Game\Rewind
```

Three.js legacy experiments are not used for capture. The active capture path is:

```text
Camera -> MediaPipe face/hands -> React tracking packet -> Unity WebGL cat
```

The Unity build owns:

- cat model import
- materials and lights
- facial blendshapes
- baked hand poses
- WebGL export

No fake eyelid or mouth overlay is used.

## Unity WebGL Avatar

Unity scripts live in:

```text
tools/unity/
```

Copy them into the Unity project:

```text
E:\Games\CityU-Game\Rewind\Assets\Editor\RewindWebBuild.cs
E:\Games\CityU-Game\Rewind\Assets\Editor\RewindRigBaker.cs
E:\Games\CityU-Game\Rewind\Assets\Scripts\RewindWebAvatarController.cs
```

Bake pose JSON:

```powershell
& "D:\2022.3.62f1\Editor\Unity.exe" -batchmode -quit -projectPath "E:\Games\CityU-Game\Rewind" -executeMethod RewindRigBaker.BakeBatch
```

Build WebGL:

```powershell
& "D:\2022.3.62f1\Editor\Unity.exe" -batchmode -quit -projectPath "E:\Games\CityU-Game\Rewind" -executeMethod RewindWebBuild.BuildWebGLBatch
```

Output:

```text
public/unity/rewind-avatar/
```

Rig test page:

```text
http://127.0.0.1:5173/#rig
```

## Convert FBX to GLB

1. Open Blender.
2. File > Import > FBX.
3. Select `Cat.fbx`.
4. Confirm these are preserved:
   - `CC_Base_Body`
   - shapekeys / blendshapes
   - armature / skin weights
   - hairplate meshes
   - alpha textures
   - eye, cornea, tongue, teeth materials
5. File > Export > glTF 2.0.
6. Format: GLB.
7. Enable export of:
   - shape keys
   - skins
   - animations if needed
   - selected objects only if all cat parts are selected
8. Save as `public/assets/cat/cat.glb`.

If using Unity:

1. Open the Unity package.
2. Confirm blendshapes on the skinned body mesh.
3. Remove or disable the diaper mesh if not needed.
4. Export GLB with a glTF exporter.
5. Keep ARKit-style blendshape names or keep a mapping table.

The asset lists ARKit-ready facial shapes. The web prototype maps MediaPipe coefficients to names such as:

- `A14_Eye_Blink_Left`
- `A15_Eye_Blink_Right`
- `A25_Jaw_Open`
- `A38_Mouth_Smile_Left`
- `A39_Mouth_Smile_Right`

Raw FBX is useful for preview, but GLB is the target web runtime.

This repo includes a Blender export script:

```bash
"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe" --background --python tools/export_cat_glb.py -- --input public/assets/cat/Cat.fbx --output public/assets/cat/cat.glb --asset-root public/assets/cat
```

The script:

- removes the diaper mesh
- removes eye-occlusion and tearline meshes for the web avatar
- preserves `CC_Base_Body` blendshapes
- embeds black-cat body textures
- embeds hairplate opacity textures

## Optional Offline Face Tracking

The app first tries local MediaPipe files:

```text
public/mediapipe/face_landmarker.task
public/mediapipe/wasm/
```

If missing, it falls back to hosted MediaPipe assets. The capture flow still works with a lightweight avatar fallback.

## Data

All study data is local-first in IndexedDB.

Exports are available in Settings:

- Replay logs JSON
- Episode metadata JSON
- Combined study JSON

Recorded videos stay in IndexedDB for the MVP. The metadata export references blob IDs, not video files.

## AI Encoding Hook

Current MVP:

- Uses the avatar canvas recording as replay media.
- Stores a 0-35s replay pointer for the TikTok-like review clip.
- Creates a local draft title, topic, tags, summary, and moment list.
- Uses browser speech recognition when available.
- Falls back to an empty transcript and placeholder moments.

TODO hook:

```text
src/lib/encoding.ts
```

Replace `createEpisodeDraft` and `createReplayClipPlaceholder` with:

- approved speech-to-text for Chinese and English
- LLM theme extraction
- high-intensity sentence selection
- media trimming or serverless clipping
- subtitle/caption generation
