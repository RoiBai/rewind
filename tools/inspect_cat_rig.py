import argparse
import sys

import bpy


INTERESTING = (
    "CC_Base_Spine02",
    "CC_Base_NeckTwist01",
    "CC_Base_NeckTwist02",
    "CC_Base_Head",
    "CC_Base_FacialBone",
    "CC_Base_L_Upperarm",
    "CC_Base_L_Forearm",
    "CC_Base_L_Hand",
    "CC_Base_R_Upperarm",
    "CC_Base_R_Forearm",
    "CC_Base_R_Hand",
)


def main():
    args = parse_args()
    reset_scene()
    if args.input.lower().endswith(".glb") or args.input.lower().endswith(".gltf"):
        bpy.ops.import_scene.gltf(filepath=args.input)
    else:
        bpy.ops.import_scene.fbx(filepath=args.input, automatic_bone_orientation=False)

    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if not armature:
        print("No armature found")
        return

    print(f"Armature: {armature.name}")
    print(f"Actions: {[action.name for action in bpy.data.actions]}")
    print(f"Pose bones: {len(armature.pose.bones)}")

    for name in INTERESTING:
        bone = armature.data.bones.get(name)
        pose = armature.pose.bones.get(name)
        if not bone or not pose:
            print(f"{name}: missing")
            continue
        parent = bone.parent.name if bone.parent else "-"
        print(
            f"{name}: parent={parent} "
            f"head={tuple(round(v, 4) for v in bone.head_local)} "
            f"tail={tuple(round(v, 4) for v in bone.tail_local)} "
            f"rot_mode={pose.rotation_mode}"
        )

    mesh_rows = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        keys = obj.data.shape_keys.key_blocks if obj.data.shape_keys else []
        mesh_rows.append(f"{obj.name}: shapekeys={max(len(keys) - 1, 0)} modifiers={[mod.type for mod in obj.modifiers]}")
    print("\n".join(mesh_rows))


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    return parser.parse_args(argv)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


if __name__ == "__main__":
    main()
