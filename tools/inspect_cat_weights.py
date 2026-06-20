import argparse
import collections
import sys

import bpy


WATCH_BONES = (
    "CC_Base_Head",
    "CC_Base_NeckTwist01",
    "CC_Base_NeckTwist02",
    "CC_Base_L_Clavicle",
    "CC_Base_L_Upperarm",
    "CC_Base_L_Forearm",
    "CC_Base_L_Hand",
    "CC_Base_R_Clavicle",
    "CC_Base_R_Upperarm",
    "CC_Base_R_Forearm",
    "CC_Base_R_Hand",
)


def main():
    args = parse_args()
    reset_scene()
    if args.input.lower().endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=args.input)
    else:
        bpy.ops.import_scene.fbx(filepath=args.input, automatic_bone_orientation=False)

    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        print(f"\n{obj.name}")
        print(f"  vertices={len(obj.data.vertices)} modifiers={[mod.type for mod in obj.modifiers]}")
        totals = object_weight_totals(obj)
        for name, weight in totals.most_common(16):
            marker = "*" if name in WATCH_BONES else " "
            print(f"  {marker}{name}: {weight:.2f}")
        watched = [(name, totals.get(name, 0.0)) for name in WATCH_BONES if totals.get(name, 0.0) > 0.01]
        if watched:
            print("  watched:", ", ".join(f"{name}={weight:.2f}" for name, weight in watched))


def object_weight_totals(obj):
    group_names = {group.index: group.name for group in obj.vertex_groups}
    totals = collections.Counter()
    for vertex in obj.data.vertices:
        for group in vertex.groups:
            name = group_names.get(group.group)
            if name:
                totals[name] += group.weight
    return totals


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
