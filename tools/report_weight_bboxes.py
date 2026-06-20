import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector


def main():
    args = parse_args()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.fbx(filepath=str(Path(args.input)), automatic_bone_orientation=False)

    report = {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if args.mesh and obj.name != args.mesh:
            continue
        group_names = {group.index: group.name for group in obj.vertex_groups}
        groups = defaultdict(list)
        for vertex in obj.data.vertices:
            if not vertex.groups:
                continue
            top = max(vertex.groups, key=lambda item: item.weight)
            name = group_names.get(top.group, "unknown")
            groups[name].append(obj.matrix_world @ vertex.co)
        report[obj.name] = {name: bbox(points) for name, points in groups.items()}

    Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mesh", default="")
    return parser.parse_args(argv)


def bbox(points):
    min_v = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    max_v = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    center = (min_v + max_v) / 2
    return {
        "count": len(points),
        "min": [round(v, 3) for v in min_v],
        "max": [round(v, 3) for v in max_v],
        "center": [round(v, 3) for v in center],
    }


if __name__ == "__main__":
    main()
