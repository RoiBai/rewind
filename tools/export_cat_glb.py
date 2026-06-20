import argparse
import os
import sys

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree


def main():
    args = parse_args()
    asset_root = os.path.abspath(args.asset_root)
    fbx_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)

    reset_scene()
    bpy.ops.import_scene.fbx(filepath=fbx_path, automatic_bone_orientation=False)

    remove_unwanted_meshes()
    apply_materials(asset_root)
    clean_fur_card_weights()
    prepare_scene()

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    export_glb(output_path)
    report_scene(output_path)


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--asset-root", required=True)
    return parser.parse_args(argv)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def remove_unwanted_meshes():
    blocked = ("diaper", "pincaps", "metalpins", "tearline")
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        material_names = " ".join(slot.material.name.lower() for slot in obj.material_slots if slot.material)
        if any(token in name or token in material_names for token in blocked):
            bpy.data.objects.remove(obj, do_unlink=True)


def apply_materials(asset_root):
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue

        obj.data.update()
        for slot in obj.material_slots:
            if not slot.material:
                continue
            configure_material(slot.material, obj.name, asset_root)


def clean_fur_card_weights():
    """Bind each disconnected fur card from the no-fur skin underneath it.

    The purchased cat uses many alpha hair cards. Some cards arrive with mixed
    influences from distant bones (head + spine + hand, for example), which can
    stretch them into long sheets when the rig is posed in Three.js. The clean
    source of truth is the main body skin, not the fur cards' original weights.
    Each disconnected fur card is therefore projected to the closest main-skin
    vertex and assigned to that vertex's dominant anatomical bone.
    """
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if not armature:
        print("Weight clean: no armature found; skipped")
        return

    body_reference = build_body_skin_reference(armature)
    if not body_reference:
        print("Weight clean: no main skin reference found; skipped")
        return

    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.name.lower().startswith("fibers"):
            continue

        components = connected_vertex_components(obj.data)
        if not components:
            continue

        grouped_indices = {}
        for component in components:
            centroid = component_centroid(obj, component)
            target_name = body_reference_bone_for_point(body_reference, centroid)
            grouped_indices.setdefault(target_name, []).extend(component)

        for group in list(obj.vertex_groups):
            obj.vertex_groups.remove(group)
        for target_name, indices in grouped_indices.items():
            group = obj.vertex_groups.new(name=target_name)
            add_indices_in_chunks(group, indices, 1.0)

        largest = max(len(component) for component in components)
        summary = ", ".join(f"{name}:{len(indices)}" for name, indices in sorted(grouped_indices.items()))
        print(f"Weight clean: {obj.name} cards={len(components)} largest={largest} {summary}")


def build_body_skin_reference(armature):
    body = next(
        (obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name.lower().startswith("cc_base_body")),
        None,
    )
    if not body:
        return None

    available_bones = {bone.name for bone in armature.data.bones}
    group_names = {group.index: group.name for group in body.vertex_groups}
    kd_tree = KDTree(len(body.data.vertices))
    dominant_bones = []

    for index, vertex in enumerate(body.data.vertices):
        point = body.matrix_world @ vertex.co
        dominant_name = dominant_vertex_group_name(vertex, group_names)
        dominant_name = canonical_fur_bone(dominant_name, available_bones)
        kd_tree.insert(point, index)
        dominant_bones.append(dominant_name)

    kd_tree.balance()
    print(f"Weight clean: using {body.name} as no-fur skin reference ({len(dominant_bones)} vertices)")
    return {"tree": kd_tree, "bones": dominant_bones}


def body_reference_bone_for_point(reference, point):
    _, index, _ = reference["tree"].find(point)
    return reference["bones"][index]


def dominant_vertex_group_name(vertex, group_names):
    if not vertex.groups:
        return "CC_Base_Pelvis"
    group = max(vertex.groups, key=lambda item: item.weight)
    return group_names.get(group.group, "CC_Base_Pelvis")


def canonical_fur_bone(name, available_bones):
    lower = name.lower()

    def pick(*names):
        for candidate in names:
            if candidate in available_bones:
                return candidate
        if name in available_bones:
            return name
        return "CC_Base_Pelvis"

    if "eye" in lower or "eyelid" in lower or "brow" in lower:
        return pick("CC_Base_Head")
    if "teeth" in lower or "tongue" in lower:
        return pick("CC_Base_JawRoot", "CC_Base_Head")
    if "ribstwist" in lower:
        return pick("CC_Base_Spine02")
    if "breast" in lower or "chest" in lower:
        return pick("CC_Base_Spine02")
    if "elbowshare" in lower:
        side = "L" if "_l_" in lower else "R"
        return pick(f"CC_Base_{side}_Forearm", f"CC_Base_{side}_Upperarm")
    if "kneeshare" in lower:
        side = "L" if "_l_" in lower else "R"
        return pick(f"CC_Base_{side}_Calf", f"CC_Base_{side}_Thigh")
    if "upperarmtwist" in lower:
        side = "L" if "_l_" in lower else "R"
        return pick(f"CC_Base_{side}_Upperarm")
    if "forearmtwist" in lower:
        side = "L" if "_l_" in lower else "R"
        return pick(f"CC_Base_{side}_Forearm")
    if "thightwist" in lower:
        side = "L" if "_l_" in lower else "R"
        return pick(f"CC_Base_{side}_Thigh")
    if "calftwist" in lower:
        side = "L" if "_l_" in lower else "R"
        return pick(f"CC_Base_{side}_Calf")
    if any(token in lower for token in ("finger", "index", "mid", "pinky", "ring", "thumb")):
        side = "L" if "_l_" in lower else "R"
        return pick(f"CC_Base_{side}_Hand")
    if "toe" in lower:
        side = "L" if "_l_" in lower else "R"
        return pick(f"CC_Base_{side}_Foot")
    return pick(name)


def connected_vertex_components(mesh):
    parent = list(range(len(mesh.vertices)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left, right):
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for edge in mesh.edges:
        union(edge.vertices[0], edge.vertices[1])

    components = {}
    for vertex in mesh.vertices:
        components.setdefault(find(vertex.index), []).append(vertex.index)
    return list(components.values())


def component_centroid(obj, vertex_indices):
    total = Vector((0, 0, 0))
    for vertex_index in vertex_indices:
        total += obj.matrix_world @ obj.data.vertices[vertex_index].co
    return total / max(len(vertex_indices), 1)


def add_indices_in_chunks(group, indices, weight):
    chunk_size = 10000
    for start in range(0, len(indices), chunk_size):
        group.add(indices[start : start + chunk_size], weight, "ADD")


def configure_material(material, object_name, asset_root):
    name = material.name.lower()
    object_name = object_name.lower()
    material.use_nodes = True
    material.diffuse_color = (0.04, 0.045, 0.042, 1.0)

    if object_name.startswith("fibers") or "gozmesh_import_material" in name:
        hair_material(material, object_name, name, asset_root)
        return

    if "eye_occlusion" in name or "eyeocclusion" in object_name:
        pbr_material(
            material,
            base_color=(0.045, 0.052, 0.05, 1),
            roughness=0.92,
        )
        return

    if "cornea" in name:
        pbr_material(
            material,
            base_color=(0.86, 0.94, 0.9, 0.22),
            roughness=0.05,
            alpha=0.22,
            normal=cat_fbm(asset_root, "Cornea_Pbr_Normal.png"),
            blend_method="BLEND",
        )
        return

    if "eye" in name and "eyelash" not in name:
        pbr_material(
            material,
            base_color=(1, 1, 1, 1),
            roughness=0.18,
            base=cat_fbm(asset_root, "Eye_Pbr_Diffuse.png"),
            normal=cat_fbm(asset_root, "Eye_Pbr_Normal.png"),
        )
        return

    if "eyelash" in name:
        pbr_material(
            material,
            base_color=(0.015, 0.016, 0.015, 1),
            roughness=0.82,
            alpha=0.62,
            base=cat_fbm(asset_root, "Std_Eyelash_Pbr_Diffuse.png"),
            normal=cat_fbm(asset_root, "Std_Eyelash_Pbr_Normal.png"),
            blend_method="BLEND",
            backface=True,
        )
        return

    if "tongue" in name:
        pbr_material(
            material,
            base_color=(1, 0.72, 0.7, 1),
            roughness=0.66,
            base=cat_fbm(asset_root, "Std_Tongue_Pbr_Diffuse.png"),
            normal=cat_fbm(asset_root, "Std_Tongue_Pbr_Normal.png"),
        )
        return

    if "teeth" in name:
        lower = "lower" in name
        pbr_material(
            material,
            base_color=(0.92, 0.84, 0.74, 1),
            roughness=0.52,
            base=cat_fbm(asset_root, "Std_Lower_Teeth_Pbr_Diffuse.jpg" if lower else "Std_Upper_Teeth_Pbr_Diffuse.jpg"),
            normal=cat_fbm(asset_root, "Std_Lower_Teeth_Pbr_Normal.png" if lower else "Std_Upper_Teeth_Pbr_Normal.png"),
        )
        return

    if "skin" in name or "nails" in name or "cc_base_body" in object_name:
        base, normal = black_skin_maps(name, asset_root)
        pbr_material(
            material,
            base_color=(0.055, 0.065, 0.062, 1),
            roughness=0.78,
            base=base,
            normal=normal,
        )
        return

    pbr_material(material, base_color=(0.05, 0.055, 0.052, 1), roughness=0.78)


def hair_material(material, object_name, material_name, asset_root):
    diffuse = hair_diffuse_path(material_name, asset_root)
    pbr_material(
        material,
        base_color=(0.025, 0.03, 0.028, 1),
        roughness=0.94,
        base=diffuse,
        normal=os.path.join(asset_root, "Fur_Maps", "GoZMesh_Import_Material_Normal.jpg"),
        alpha=1,
        blend_method="BLEND",
        backface=True,
    )


def pbr_material(
    material,
    base_color=(1, 1, 1, 1),
    roughness=0.7,
    metallic=0,
    alpha=1,
    base=None,
    normal=None,
    alpha_map=None,
    blend_method="OPAQUE",
    backface=False,
):
    clear_nodes(material)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    set_input(shader, "Base Color", base_color)
    set_input(shader, "Metallic", metallic)
    set_input(shader, "Roughness", roughness)
    set_input(shader, "Alpha", alpha if blend_method != "OPAQUE" else 1)

    if base and os.path.exists(base):
        tex = texture_node(nodes, base, color_space="sRGB")
        links.new(tex.outputs["Color"], shader.inputs["Base Color"])
        if blend_method != "OPAQUE" and not alpha_map and "Alpha" in tex.outputs:
            links.new(tex.outputs["Alpha"], shader.inputs["Alpha"])

    if normal and os.path.exists(normal):
        tex = texture_node(nodes, normal, color_space="Non-Color")
        normal_map = nodes.new("ShaderNodeNormalMap")
        set_input(normal_map, "Strength", 0.45)
        links.new(tex.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])

    if alpha_map and os.path.exists(alpha_map):
        tex = texture_node(nodes, alpha_map, color_space="Non-Color")
        links.new(tex.outputs["Color"], shader.inputs["Alpha"])

    material.blend_method = blend_method
    material.use_backface_culling = not backface
    material.use_screen_refraction = False
    material.show_transparent_back = backface
    material.use_nodes = True
    material.diffuse_color = base_color
    if blend_method != "OPAQUE":
        material.alpha_threshold = 0.015


def clear_nodes(material):
    material.node_tree.nodes.clear()


def texture_node(nodes, path, color_space):
    node = nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(path, check_existing=True)
    node.image.colorspace_settings.name = color_space
    return node


def set_input(node, name, value):
    if name in node.inputs:
        node.inputs[name].default_value = value


def cat_fbm(asset_root, filename):
    return os.path.join(asset_root, "Cat.fbm", filename)


def black_skin_maps(material_name, asset_root):
    suffix = ""
    normal_suffix = ""
    if "body" in material_name:
        suffix = "_1"
        normal_suffix = "_3"
    elif "arm" in material_name:
        suffix = "_5"
        normal_suffix = "_7"
    elif "leg" in material_name:
        suffix = "_9"
        normal_suffix = "_11"
    elif "nails" in material_name:
        suffix = "_13"
        normal_suffix = "_15"
    elif "head" in material_name:
        suffix = ""
        normal_suffix = ""

    base = os.path.join(asset_root, "Black_Cat_Textures", f"Furry_Std_Skin_Head_BaseMap{suffix}.png")
    normal = os.path.join(asset_root, "Black_Cat_Textures", f"Furry_Std_Skin_Head_Normal{normal_suffix}.png")
    return base, normal


def hair_diffuse_path(material_name, asset_root):
    if "material_0_tra" in material_name:
        name = "GoZMesh_Import_Material_0_Tra_Diffuse.png"
    elif "material_1_pbr" in material_name:
        name = "GoZMesh_Import_Material_1_Pbr_Diffuse.png"
    elif "material_2_tra" in material_name:
        name = "GoZMesh_Import_Material_2_Tra_Diffuse.png"
    elif "material_3_tra" in material_name:
        name = "GoZMesh_Import_Material_3_Tra_Diffuse.png"
    elif "material_4_tra" in material_name:
        name = "GoZMesh_Import_Material_4_Tra_Diffuse.png"
    elif "material_5_tra" in material_name:
        name = "GoZMesh_Import_Material_5_Tra_Diffuse.png"
    elif "material_6_tra" in material_name:
        name = "GoZMesh_Import_Material_6_Tra_Diffuse.png"
    elif "material_7_tra" in material_name:
        name = "GoZMesh_Import_Material_7_Tra_Diffuse.png"
    elif "material_8_tra" in material_name:
        name = "GoZMesh_Import_Material_8_Tra_Diffuse.png"
    else:
        name = "GoZMesh_Import_Material_Pbr_Diffuse.png"
    return os.path.join(asset_root, "web-textures", name)


def hair_opacity_path(material_name, asset_root):
    if "material_0_" in material_name:
        name = "GoZMesh_Import_Material_Opacity_0001.jpg"
    elif "material_1_" in material_name:
        name = "GoZMesh_Import_Material_Opacity_0002.jpg"
    elif "material_2_" in material_name:
        name = "GoZMesh_Import_Material_Opacity_0003.jpg"
    elif "material_3_" in material_name:
        name = "GoZMesh_Import_Material_Opacity_0004.jpg"
    elif "material_4_" in material_name:
        name = "GoZMesh_Import_Material_Opacity_0005.jpg"
    elif "material_5_" in material_name:
        name = "GoZMesh_Import_Material_Opacity_0006.jpg"
    elif "material_6_" in material_name:
        name = "GoZMesh_Import_Material_Opacity_0007.jpg"
    elif "material_7_" in material_name:
        name = "GoZMesh_Import_Material_Opacity_0008.jpg"
    elif "material_8_" in material_name:
        name = "GoZMesh_Import_Material_Opacity_0009.jpg"
    else:
        name = "GoZMesh_Import_Material_Opacity.jpg"
    return os.path.join(asset_root, "Fur_Maps", name)


def prepare_scene():
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
        if obj.type == "MESH":
            obj.data.update()
            for poly in obj.data.polygons:
                poly.use_smooth = True
            if obj.data.shape_keys:
                obj.data.shape_keys.name = f"{obj.name}_ShapeKeys"

    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"


def export_glb(output_path):
    kwargs = dict(
        filepath=output_path,
        export_format="GLB",
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texture_dir="",
        export_copyright="Rewind local research prototype",
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_morph=True,
        export_morph_normal=True,
        export_skins=True,
        export_animations=False,
        export_apply=False,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop("export_morph_normal", None)
        bpy.ops.export_scene.gltf(**kwargs)


def report_scene(output_path):
    rows = []
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            shape_count = len(obj.data.shape_keys.key_blocks) - 1 if obj.data.shape_keys else 0
            rows.append(f"{obj.name}: materials={len(obj.material_slots)} shapekeys={shape_count}")
    print("Exported", output_path)
    print("\n".join(rows))


if __name__ == "__main__":
    main()
