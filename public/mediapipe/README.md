# Optional Local MediaPipe Files

The prototype first tries local MediaPipe files, then falls back to hosted MediaPipe assets.

For offline face tracking, place these here:

- `face_landmarker.task`
- `hand_landmarker.task`
- the MediaPipe Tasks Vision `wasm/` files

Without these files, the app still runs. Face/hand tracking may require a network connection on first use.
