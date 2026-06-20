import argparse
import math
import os
from pathlib import Path

import bpy
from mathutils import Euler, Vector


CASES = [
    ("neutral", {}),
    ("l_upper_x45", {"CC_Base_L_Upperarm": (45, 0, 0)}),
    ("l_upper_y45", {"CC_Base_L_Upperarm": (0, 45, 0)}),
    ("l_upper_z45", {"CC_Base_L_Upperarm": (0, 0, 45)}),
    ("l_upper_x-45", {"CC_Base_L_Upperarm": (-45, 0, 0)}),
    ("l_upper_y-45", {"CC_Base_L_Upperarm": (0, -45, 0)}),
    ("l_upper_z-45", {"CC_Base_L_Upperarm": (0, 0, -45)}),
    ("l_fore_x45", {"CC_Base_L_Forearm": (45, 0, 0)}),
    ("l_fore_y45", {"CC_Base_L_Forearm": (0, 45, 0)}),
    ("l_fore_z45", {"CC_Base_L_Forearm": (0, 0, 45)}),
    ("l_fore_x-45", {"CC_Base_L_Forearm": (-45, 0, 0)}),
    ("l_fore_y-45", {"CC_Base_L_Forearm": (0, -45, 0)}),
    ("l_fore_z-45", {"CC_Base_L_Forearm": (0, 0, -45)}),
]


def main():
    args = parse_args()
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.input))
    if not args.fur:
        hide_fur()
    normalize_scene()
    add_lights()
    armature = find_armature()
    neutral = capture_pose(armature)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    for name, rotations in CASES:
        restore_pose(armature, neutral)
        apply_rotations(armature, rotations)
        render(out / f"{name}.png")


def parse_args():
    argv = []
    if "--" in os.sys.argv:
        argv = os.sys.argv[os.sys.argv.index("--") + 1 :]
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--fur", action="store_true")
    return parser.parse_args(argv)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def hide_fur():
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and obj.name.lower().startswith("fibers"):
            obj.hide_render = True
            obj.hide_viewport = True


def find_armature():
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("No armature found")
    return armatures[0]


def capture_pose(armature):
    pose = {}
    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"
        pose[bone.name] = {
            "q": bone.rotation_quaternion.copy(),
            "loc": bone.location.copy(),
            "scale": bone.scale.copy(),
        }
    return pose


def restore_pose(armature, pose):
    for bone in armature.pose.bones:
        data = pose[bone.name]
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = data["q"].copy()
        bone.location = data["loc"].copy()
        bone.scale = data["scale"].copy()
    bpy.context.view_layer.update()


def apply_rotations(armature, rotations):
    for bone_name, degrees in rotations.items():
        bone = armature.pose.bones.get(bone_name)
        if bone is None:
            continue
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.rotate(Euler(tuple(math.radians(v) for v in degrees), "XYZ"))
    bpy.context.view_layer.update()


def scene_bounds():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not obj.hide_render]
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
    scale = 2.1 / max(size, 0.001)
    for obj in bpy.context.scene.objects:
        if obj.parent is None:
            obj.location -= center
            obj.scale *= scale
    bpy.context.view_layer.update()


def add_lights():
    bpy.ops.object.light_add(type="AREA", location=(0, -3, 3.6))
    key = bpy.context.object
    key.data.energy = 600
    key.data.size = 5
    bpy.ops.object.light_add(type="POINT", location=(-2.4, 2.2, 2.4))
    fill = bpy.context.object
    fill.data.energy = 90


def render(path):
    min_v, max_v = scene_bounds()
    center = (min_v + max_v) * 0.5
    size = max(max_v.x - min_v.x, max_v.y - min_v.y, max_v.z - min_v.z)
    bpy.ops.object.camera_add(location=(center.x, center.y - size * 2.6, center.z + size * 0.03))
    camera = bpy.context.object
    look_at(camera, center)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = size * 1.06
    bpy.context.scene.camera = camera
    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    bpy.context.scene.eevee.taa_render_samples = 40
    bpy.context.scene.world.color = (0.965, 0.945, 0.91)
    bpy.context.scene.render.resolution_x = 900
    bpy.context.scene.render.resolution_y = 900
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)


def look_at(obj, target):
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


if __name__ == "__main__":
    main()
