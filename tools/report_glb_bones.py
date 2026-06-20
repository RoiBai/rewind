import argparse
import os

import bpy
from mathutils import Vector


WATCH = [
    "CC_Base_Spine02",
    "CC_Base_NeckTwist01",
    "CC_Base_NeckTwist02",
    "CC_Base_Head",
    "CC_Base_L_Clavicle",
    "CC_Base_L_Upperarm",
    "CC_Base_L_Forearm",
    "CC_Base_L_Hand",
    "CC_Base_R_Clavicle",
    "CC_Base_R_Upperarm",
    "CC_Base_R_Forearm",
    "CC_Base_R_Hand",
]


def main():
    args = parse_args()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.input))
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    bpy.context.view_layer.update()
    for name in WATCH:
        pose_bone = armature.pose.bones.get(name)
        if not pose_bone:
            print(f"{name}: missing")
            continue
        head = armature.matrix_world @ pose_bone.head
        tail = armature.matrix_world @ pose_bone.tail
        vec = tail - head
        print(f"{name}: head={fmt(head)} tail={fmt(tail)} len={vec.length:.5f}")


def fmt(vector: Vector):
    return f"({vector.x:.5f}, {vector.y:.5f}, {vector.z:.5f})"


def parse_args():
    argv = os.sys.argv[os.sys.argv.index("--") + 1 :] if "--" in os.sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    return parser.parse_args(argv)


if __name__ == "__main__":
    main()
