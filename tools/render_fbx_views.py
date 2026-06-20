import argparse
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import export_cat_glb as base_export


VIEWS = {
    "front_minus_y": Vector((0, -1, 0)),
    "front_plus_y": Vector((0, 1, 0)),
    "side_minus_x": Vector((-1, 0, 0)),
    "side_plus_x": Vector((1, 0, 0)),
}


def main():
    args = parse_args()
    base_export.reset_scene()
    bpy.ops.import_scene.fbx(filepath=str(Path(args.input)), automatic_bone_orientation=False)
    base_export.remove_unwanted_meshes()
    if not args.fur:
        remove_fur()
    base_export.apply_materials(args.asset_root)
    base_export.prepare_scene()
    normalize_scene()
    add_lights()

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    for name, direction in VIEWS.items():
        render_view(out / f"{name}.png", direction)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--asset-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--fur", action="store_true")
    return parser.parse_args(argv)


def remove_fur():
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj.name.lower().startswith("fibers"):
            bpy.data.objects.remove(obj, do_unlink=True)


def scene_bounds():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    min_v = Vector((1e9, 1e9, 1e9))
    max_v = Vector((-1e9, -1e9, -1e9))
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            min_v.x = min(min_v.x, world.x)
            min_v.y = min(min_v.y, world.y)
            min_v.z = min(min_v.z, world.z)
            max_v.x = max(max_v.x, world.x)
            max_v.y = max(max_v.y, world.y)
            max_v.z = max(max_v.z, world.z)
    return min_v, max_v


def normalize_scene():
    min_v, max_v = scene_bounds()
    center = (min_v + max_v) * 0.5
    size = max(max_v.x - min_v.x, max_v.y - min_v.y, max_v.z - min_v.z)
    scale = 1.8 / max(size, 0.001)
    for obj in bpy.context.scene.objects:
        if obj.parent is None:
            obj.location -= center
            obj.scale *= scale
    bpy.context.view_layer.update()


def add_lights():
    bpy.ops.object.light_add(type="AREA", location=(0, -3, 4))
    key = bpy.context.object
    key.data.energy = 650
    key.data.size = 5
    bpy.ops.object.light_add(type="AREA", location=(2.5, 2.5, 3.2))
    fill = bpy.context.object
    fill.data.energy = 180
    fill.data.size = 4


def render_view(output, direction):
    min_v, max_v = scene_bounds()
    center = (min_v + max_v) * 0.5
    size = max(max_v.x - min_v.x, max_v.y - min_v.y, max_v.z - min_v.z)
    camera_pos = center + direction.normalized() * (size * 2.7)
    camera_pos.z = center.z + size * 0.08

    bpy.ops.object.camera_add(location=camera_pos)
    camera = bpy.context.object
    look_at(camera, center + Vector((0, 0, size * 0.02)))
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = size * 1.06
    camera.data.clip_end = size * 8
    bpy.context.scene.camera = camera

    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    bpy.context.scene.eevee.taa_render_samples = 48
    bpy.context.scene.world.color = (0.965, 0.945, 0.91)
    bpy.context.scene.render.resolution_x = 820
    bpy.context.scene.render.resolution_y = 900
    bpy.context.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)


def look_at(obj, target):
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


if __name__ == "__main__":
    main()
