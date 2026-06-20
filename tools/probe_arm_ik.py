import argparse
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import export_cat_glb as base_export


POSES = {
    "left_raise": ("L", Vector((7.9, -7.0, 53.9)), Vector((10.5, -6.0, 48.0))),
    "right_raise": ("R", Vector((-7.9, -7.0, 53.9)), Vector((-10.5, -6.0, 48.0))),
    "left_mouth": ("L", Vector((3.6, -8.8, 49.8)), Vector((9.6, -8.2, 46.0))),
    "right_mouth": ("R", Vector((-3.6, -8.8, 49.8)), Vector((-9.6, -8.2, 46.0))),
    "left_eye": ("L", Vector((4.3, -8.5, 54.8)), Vector((10.2, -7.2, 49.0))),
    "right_eye": ("R", Vector((-4.3, -8.5, 54.8)), Vector((-10.2, -7.2, 49.0))),
}


def main():
    args = parse_args()
    base_export.reset_scene()
    bpy.ops.import_scene.fbx(filepath=str(Path(args.input)), automatic_bone_orientation=False)
    base_export.remove_unwanted_meshes()
    if not args.fur:
        for obj in list(bpy.context.scene.objects):
            if obj.type == "MESH" and obj.name.lower().startswith("fibers"):
                bpy.data.objects.remove(obj, do_unlink=True)
    base_export.apply_materials(args.asset_root)
    base_export.prepare_scene()
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    neutral = capture_neutral(armature)
    normalize_scene()
    add_lights()

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    for name, (side, target, pole) in POSES.items():
        restore_pose(armature, neutral)
        apply_ik(armature, side, target, pole, args.chain_count, args.pole_angle if side == "L" else -args.pole_angle)
        render_pose(out / f"{name}.png", args.ortho_scale)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--asset-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--chain-count", type=int, default=3)
    parser.add_argument("--pole-angle", type=float, default=-90)
    parser.add_argument("--ortho-scale", type=float, default=1.35)
    parser.add_argument("--fur", action="store_true")
    return parser.parse_args(argv)


def capture_neutral(armature):
    neutral = {}
    for bone in armature.pose.bones:
        neutral[bone.name] = {
            "rotation": bone.rotation_quaternion.copy(),
            "location": bone.location.copy(),
            "scale": bone.scale.copy(),
        }
    return neutral


def restore_pose(armature, neutral):
    for bone in armature.pose.bones:
        data = neutral[bone.name]
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = data["rotation"].copy()
        bone.location = data["location"].copy()
        bone.scale = data["scale"].copy()
    bpy.context.view_layer.update()


def apply_ik(armature, side, target, pole, chain_count, pole_angle):
    prefix = f"CC_Base_{side}_"
    target_obj = bpy.data.objects.new(f"Probe_{side}_Target", None)
    pole_obj = bpy.data.objects.new(f"Probe_{side}_Pole", None)
    bpy.context.collection.objects.link(target_obj)
    bpy.context.collection.objects.link(pole_obj)
    target_obj.location = armature.matrix_world @ target
    pole_obj.location = armature.matrix_world @ pole
    hand = armature.pose.bones[f"{prefix}Hand"]
    constraint = hand.constraints.new(type="IK")
    constraint.name = "Probe_IK"
    constraint.target = target_obj
    constraint.pole_target = pole_obj
    constraint.chain_count = chain_count
    constraint.use_rotation = True
    constraint.pole_angle = math.radians(pole_angle)
    bpy.context.view_layer.update()


def render_pose(output, ortho_scale):
    bpy.ops.object.camera_add(location=(0, -4.1, 0.25), rotation=(math.radians(87), 0, 0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    bpy.context.scene.camera = camera
    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    bpy.context.scene.eevee.taa_render_samples = 32
    bpy.context.scene.world.color = (0.96, 0.94, 0.9)
    bpy.context.scene.render.resolution_x = 820
    bpy.context.scene.render.resolution_y = 900
    bpy.context.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)


def normalize_scene():
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
    center = (min_v + max_v) * 0.5
    size = max(max_v.x - min_v.x, max_v.y - min_v.y, max_v.z - min_v.z)
    scale = 1.65 / max(size, 0.001)
    for obj in bpy.context.scene.objects:
        if obj.parent is None:
            obj.location -= center
            obj.scale *= scale


def add_lights():
    if any(obj.type == "LIGHT" for obj in bpy.context.scene.objects):
        return
    bpy.ops.object.light_add(type="AREA", location=(0, -3, 3.8))
    key = bpy.context.object
    key.data.energy = 520
    key.data.size = 4.2
    bpy.ops.object.light_add(type="POINT", location=(-2.4, 2.0, 2.5))
    fill = bpy.context.object
    fill.data.energy = 110


if __name__ == "__main__":
    main()
