import argparse
import json
import struct
from collections import Counter, defaultdict
from pathlib import Path


COMPONENT_FORMATS = {
    5120: ("b", 1, True),
    5121: ("B", 1, False),
    5122: ("h", 2, True),
    5123: ("H", 2, False),
    5125: ("I", 4, False),
    5126: ("f", 4, False),
}

TYPE_COUNTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}

WATCH_BONES = {
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
}


def main():
    args = parse_args()
    gltf, bin_chunk = read_glb(Path(args.input))
    nodes = gltf.get("nodes", [])
    node_names = [node.get("name", f"node_{index}") for index, node in enumerate(nodes)]

    print(f"nodes={len(nodes)} meshes={len(gltf.get('meshes', []))} skins={len(gltf.get('skins', []))}")
    for skin_index, skin in enumerate(gltf.get("skins", [])):
        names = [node_names[joint] for joint in skin.get("joints", [])]
        watched = [name for name in names if name in WATCH_BONES]
        print(f"skin[{skin_index}] joints={len(names)} watched={watched}")

    for node_index, node in enumerate(nodes):
        mesh_index = node.get("mesh")
        skin_index = node.get("skin")
        if mesh_index is None or skin_index is None:
            continue

        mesh = gltf["meshes"][mesh_index]
        skin = gltf["skins"][skin_index]
        joint_names = [node_names[joint] for joint in skin.get("joints", [])]
        totals = Counter()
        vertex_hits = defaultdict(int)
        bounds = defaultdict(lambda: [[float("inf")] * 3, [float("-inf")] * 3])
        vertex_count = 0

        for primitive in mesh.get("primitives", []):
            attributes = primitive.get("attributes", {})
            if not {"POSITION", "JOINTS_0", "WEIGHTS_0"}.issubset(attributes):
                continue
            positions = list(read_accessor(gltf, bin_chunk, attributes["POSITION"]))
            joints = list(read_accessor(gltf, bin_chunk, attributes["JOINTS_0"]))
            weights = list(read_accessor(gltf, bin_chunk, attributes["WEIGHTS_0"]))
            vertex_count += len(positions)

            for position, joint_row, weight_row in zip(positions, joints, weights):
                for joint_slot, weight in zip(joint_row, weight_row):
                    if weight <= 0:
                        continue
                    joint_slot = int(joint_slot)
                    if joint_slot >= len(joint_names):
                        continue
                    name = joint_names[joint_slot]
                    totals[name] += weight
                    vertex_hits[name] += 1
                    if name in WATCH_BONES:
                        update_bounds(bounds[name], position)

        print(f"\n{node_names[node_index]} / {mesh.get('name', f'mesh_{mesh_index}')}")
        print(f"  vertices={vertex_count}")
        for name, weight in totals.most_common(args.top):
            marker = "*" if name in WATCH_BONES else " "
            print(f"  {marker}{name}: weight={weight:.2f} vertices={vertex_hits[name]}")
        watched = [name for name in WATCH_BONES if totals.get(name, 0) > args.min_weight]
        if watched:
            print("  watched bone bounds:")
            for name in sorted(watched):
                min_v, max_v = bounds[name]
                print(
                    f"    {name}: weight={totals[name]:.2f} "
                    f"min={tuple(round(v, 4) for v in min_v)} max={tuple(round(v, 4) for v in max_v)}"
                )


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--top", type=int, default=12)
    parser.add_argument("--min-weight", type=float, default=0.01)
    return parser.parse_args()


def read_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2 or length != len(data):
        raise ValueError(f"{path} is not a valid glTF 2.0 GLB")

    offset = 12
    gltf = None
    bin_chunk = b""
    while offset < length:
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8"))
        elif chunk_type == 0x004E4942:
            bin_chunk = chunk
    if gltf is None:
        raise ValueError("GLB has no JSON chunk")
    return gltf, bin_chunk


def read_accessor(gltf, bin_chunk, accessor_index):
    accessor = gltf["accessors"][accessor_index]
    buffer_view = gltf["bufferViews"][accessor["bufferView"]]
    component_type = accessor["componentType"]
    fmt, component_size, normalized = COMPONENT_FORMATS[component_type]
    count = accessor["count"]
    item_count = TYPE_COUNTS[accessor["type"]]
    item_size = component_size * item_count
    stride = buffer_view.get("byteStride", item_size)
    start = buffer_view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    unpack = struct.Struct("<" + fmt * item_count).unpack_from

    for index in range(count):
        values = list(unpack(bin_chunk, start + index * stride))
        if normalized:
            values = [normalize_component(value, component_type) for value in values]
        yield values


def normalize_component(value, component_type):
    if component_type == 5120:
        return max(value / 127, -1)
    if component_type == 5121:
        return value / 255
    if component_type == 5122:
        return max(value / 32767, -1)
    if component_type == 5123:
        return value / 65535
    return value


def update_bounds(bounds, position):
    min_v, max_v = bounds
    for axis in range(3):
        min_v[axis] = min(min_v[axis], position[axis])
        max_v[axis] = max(max_v[axis], position[axis])


if __name__ == "__main__":
    main()
