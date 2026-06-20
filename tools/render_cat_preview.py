import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


def main():
    args = parse_args()
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.input))
    apply_shape_values(args)
    normalize()
    add_lights()
    add_camera(args.ortho_scale)
    render(args.output)


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--blink", type=float, default=0)
    parser.add_argument("--smile", type=float, default=0)
    parser.add_argument("--mouth-open", type=float, default=0)
    parser.add_argument("--ortho-scale", type=float, default=0.82)
    return parser.parse_args(argv)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def normalize():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        return

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

    center = (min_v + max_v) * 0.5
    size = max(max_v.x - min_v.x, max_v.y - min_v.y, max_v.z - min_v.z)
    scale = 2.25 / max(size, 0.001)

    roots = [obj for obj in bpy.context.scene.objects if obj.parent is None]
    for obj in roots:
        obj.location -= center
        obj.scale *= scale


def add_lights():
    bpy.ops.object.light_add(type="AREA", location=(0, -3, 3.4))
    key = bpy.context.object
    key.name = "Key"
    key.data.energy = 550
    key.data.size = 4.8

    bpy.ops.object.light_add(type="POINT", location=(-2.5, 2.2, 2.6))
    fill = bpy.context.object
    fill.name = "Fill"
    fill.data.energy = 90


def apply_shape_values(args):
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.data.shape_keys:
            continue
        set_shape(obj, ["A14_Eye_Blink_Left", "Eye_Blink_L"], args.blink)
        set_shape(obj, ["A15_Eye_Blink_Right", "Eye_Blink_R"], args.blink)
        set_shape(obj, ["A38_Mouth_Smile_Left", "Mouth_Smile_L"], args.smile)
        set_shape(obj, ["A39_Mouth_Smile_Right", "Mouth_Smile_R"], args.smile)
        set_shape(obj, ["A25_Jaw_Open", "Mouth_Open"], args.mouth_open)


def set_shape(obj, names, value):
    for name in names:
        block = obj.data.shape_keys.key_blocks.get(name)
        if block:
            block.value = value
            return


def add_camera(ortho_scale):
    bpy.ops.object.camera_add(location=(0, -4.2, 0.38), rotation=(math.radians(86), 0, 0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    bpy.context.scene.camera = camera


def render(output):
    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    bpy.context.scene.eevee.taa_render_samples = 64
    bpy.context.scene.world.color = (0.96, 0.94, 0.9)
    bpy.context.scene.render.resolution_x = 1000
    bpy.context.scene.render.resolution_y = 1000
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.render.filepath = os.path.abspath(output)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
