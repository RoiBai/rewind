import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import bpy


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_fbx(path: Path):
    clear_scene()
    bpy.ops.import_scene.fbx(filepath=str(path), use_image_search=True)


def bone_path(bone):
    names = [bone.name]
    parent = bone.parent
    while parent is not None:
        names.append(parent.name)
        parent = parent.parent
    return " > ".join(reversed(names))


def mesh_summary(obj):
    data = obj.data
    shape_keys = []
    if data.shape_keys:
        shape_keys = [key.name for key in data.shape_keys.key_blocks]
    groups = [group.name for group in obj.vertex_groups]
    modifier_types = [modifier.type for modifier in obj.modifiers]
    return {
        "name": obj.name,
        "vertices": len(data.vertices),
        "polygons": len(data.polygons),
        "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
        "shape_key_count": len(shape_keys),
        "shape_key_sample": shape_keys[:40],
        "vertex_group_count": len(groups),
        "vertex_group_sample": groups[:40],
        "modifiers": modifier_types,
    }


def mesh_weight_report(obj):
    data = obj.data
    group_names = [group.name for group in obj.vertex_groups]
    counter = Counter()
    weighted_vertices = 0
    for vertex in data.vertices:
        if not vertex.groups:
            continue
        weighted_vertices += 1
        top = max(vertex.groups, key=lambda g: g.weight)
        if top.group < len(group_names):
            counter[group_names[top.group]] += 1
    return {
        "name": obj.name,
        "weighted_vertices": weighted_vertices,
        "top_groups": counter.most_common(25),
    }


def inspect(path: Path):
    import_fbx(path)
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    bones = []
    for armature in armatures:
        for bone in armature.data.bones:
            lower = bone.name.lower()
            if any(token in lower for token in ["head", "neck", "spine", "clavicle", "upperarm", "forearm", "hand"]):
                bones.append(
                    {
                        "armature": armature.name,
                        "name": bone.name,
                        "parent": bone.parent.name if bone.parent else None,
                        "path": bone_path(bone),
                        "head": [round(v, 4) for v in bone.head_local],
                        "tail": [round(v, 4) for v in bone.tail_local],
                        "length": round(bone.length, 5),
                    }
                )

    mesh_reports = [mesh_summary(obj) for obj in meshes]
    weight_reports = [mesh_weight_report(obj) for obj in meshes]
    shape_key_meshes = [
        {
            "mesh": report["name"],
            "count": report["shape_key_count"],
            "sample": report["shape_key_sample"],
        }
        for report in mesh_reports
        if report["shape_key_count"] > 0
    ]
    return {
        "source": str(path),
        "armatures": [{"name": obj.name, "bone_count": len(obj.data.bones)} for obj in armatures],
        "mesh_count": len(meshes),
        "meshes": mesh_reports,
        "shape_key_meshes": shape_key_meshes,
        "pose_bones": bones,
        "weights": weight_reports,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    report = inspect(Path(args.input))
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
