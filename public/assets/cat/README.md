# Cat Asset Folder

Copy the web-ready cat model and textures here.

Preferred:

- `public/assets/cat/cat.glb`

Fallback:

- `public/assets/cat/Cat.fbx`
- any texture folders next to it, for example `Cat.fbm/`

Source asset on this PC:

`E:\Games\CityU-Game\Rewind\Assets\Cat`

Browsers cannot read that folder directly. The files must be copied into this public folder.

Current web build:

- `cat.glb` was exported with `tools/export_cat_glb.py`
- source: `Cat.fbx`
- preserved: body blendshapes, skin weights, hairplates
- removed: diaper, eye occlusion, tearline
