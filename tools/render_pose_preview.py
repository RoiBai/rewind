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
    apply_pose(args.pose)
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
    parser.add_argument("--pose", action="append", default=[])
    parser.add_argument("--ortho-scale", type=float, default=2.2)
    return parser.parse_args(argv)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def apply_pose(specs):
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if not armature:
        return
    bpy.context.view_layer.objects.active = armature

    for spec in specs:
        parts = spec.split(":")
        if len(parts) != 3:
            continue
        name, axis, degrees_text = parts
        bone = armature.pose.bones.get(name)
        if not bone:
            continue
        bone.rotation_mode = "XYZ"
        value = math.radians(float(degrees_text))
        if axis.lower() == "x":
            bone.rotation_euler.x += value
        elif axis.lower() == "y":
            bone.rotation_euler.y += value
        elif axis.lower() == "z":
            bone.rotation_euler.z += value

    bpy.context.view_layer.update()


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
    scale = 2.05 / max(size, 0.001)

    roots = [obj for obj in bpy.context.scene.objects if obj.parent is None]
    for obj in roots:
        obj.location -= center
        obj.scale *= scale


def add_lights():
    bpy.ops.object.light_add(type="AREA", location=(0, -3, 3.4))
    key = bpy.context.object
    key.data.energy = 620
    key.data.size = 4.8

    bpy.ops.object.light_add(type="POINT", location=(-2.5, 2.2, 2.6))
    fill = bpy.context.object
    fill.data.energy = 130


def add_camera(ortho_scale):
    bpy.ops.object.camera_add(location=(0, -4.6, 0.1), rotation=(math.radians(88), 0, 0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    bpy.context.scene.camera = camera


def render(output):
    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    bpy.context.scene.eevee.taa_render_samples = 32
    bpy.context.scene.world.color = (0.96, 0.94, 0.9)
    bpy.context.scene.render.resolution_x = 700
    bpy.context.scene.render.resolution_y = 900
    bpy.context.scene.render.filepath = os.path.abspath(output)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
