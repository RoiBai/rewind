# Cat Avatar Rebuild Prompt

You are rebuilding the Rewind cat avatar from a clean slate.

## Non-Negotiables

- Do not add fake eyelid, mouth, or expression overlay meshes.
- Do not shrink, recolor, hide, or fade the eye balls to fake blinking.
- Do not hide face hair to hide expression bugs.
- Drive only real asset parts: morph targets, bones, and materials from the cat model.
- Do not use `CC_Base_EyeOcclusion` as a black blink cover in normal capture.
- Prefer `public/assets/cat/cat.glb`. Treat raw FBX as a fallback preview format only.
- Keep the app mobile-first and performant.

## Correct Runtime Pipeline

1. MediaPipe Face Landmarker reads camera frames.
2. `CatExpression` stores normalized coefficients:
   - `blinkLeft`, `blinkRight`
   - `smile`
   - `mouthOpen`
   - `yaw`, `pitch`
   - hand pose values
3. `CatAvatar` maps those coefficients to existing model controls:
   - `A14_Eye_Blink_Left` / `A15_Eye_Blink_Right` for blink
   - `A38_Mouth_Smile_Left` / `A39_Mouth_Smile_Right` for smile
   - `A25_Jaw_Open` for jaw
   - humanoid bones for head and arms
4. Hairplates use their own diffuse and alpha textures. They must not be animated as face expressions.

## Asset Requirements

Full fidelity needs a clean GLB:

- Export from Blender or Unity as `public/assets/cat/cat.glb`.
- Preserve shapekeys / blendshapes.
- Preserve `CC_Base_Body`, `CC_Base_EyeOcclusion`, hairplate meshes, textures, and skinning.
- Use alpha-tested or alpha-hashed hair materials.
- Rename shapekeys to ARKit names only if using an ARKit source. For MediaPipe, use a mapping table.

## Fallback Behavior

If only `Cat.fbx` exists:

- Load it for static preview and basic head/arm bone motion.
- Try existing morph targets conservatively.
- Show a short status badge when the model source is FBX, because raw FBX may not match Unity rendering.

## Debug Rules

- Status chips may show coefficients.
- Visual debug geometry is allowed only behind a `debug` flag and never in normal capture.
- Every expression effect must be traceable to a model morph target or bone.
