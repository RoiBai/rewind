import argparse
import os
import sys
from math import radians

import bpy
from mathutils import Euler
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import export_cat_glb as base_export


RELEVANT_BONES = [
    "CC_Base_Spine02",
    "CC_Base_NeckTwist01",
    "CC_Base_NeckTwist02",
    "CC_Base_Head",
    "CC_Base_L_Clavicle",
    "CC_Base_L_Upperarm",
    "CC_Base_L_Forearm",
    "CC_Base_L_Hand",
    "CC_Base_L_Thumb1",
    "CC_Base_L_Index1",
    "CC_Base_L_Mid1",
    "CC_Base_L_Ring1",
    "CC_Base_L_Pinky1",
    "CC_Base_R_Clavicle",
    "CC_Base_R_Upperarm",
    "CC_Base_R_Forearm",
    "CC_Base_R_Hand",
    "CC_Base_R_Thumb1",
    "CC_Base_R_Index1",
    "CC_Base_R_Mid1",
    "CC_Base_R_Ring1",
    "CC_Base_R_Pinky1",
]

NEUTRAL_POSE = {}


def main():
    args = parse_args()
    asset_root = os.path.abspath(args.asset_root)
    fbx_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)

    base_export.reset_scene()
    bpy.ops.import_scene.fbx(filepath=fbx_path, automatic_bone_orientation=False)
    base_export.remove_unwanted_meshes()
    base_export.apply_materials(asset_root)
    base_export.clean_fur_card_weights()
    base_export.prepare_scene()
    create_pose_actions()

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    export_glb_with_actions(output_path)
    base_export.report_scene(output_path)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--asset-root", required=True)
    return parser.parse_args(argv)


def create_pose_actions():
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("No armature found")
    capture_neutral_pose(armature)

    poses = {
        "Neutral": {},
        "Head_Tilt_L": head_pose(z=8, x=0, y=0),
        "Head_Tilt_R": head_pose(z=-8, x=0, y=0),
        "Head_Turn_L": head_pose(z=0, x=0, y=5),
        "Head_Turn_R": head_pose(z=0, x=0, y=-5),
        "Head_Up": head_pose(z=0, x=-5, y=0),
        "Head_Down": head_pose(z=0, x=5, y=0),
        "Hands_Back": {
            **left_arm_pose(upper=(0, -14, -10), fore=(0, 18, 8), hand=(0, -8, 0), fingers=8),
            **right_arm_pose(upper=(0, 14, 10), fore=(0, -18, -8), hand=(0, 8, 0), fingers=8),
        },
        "Debug_Head_X": {"CC_Base_Head": (35, 0, 0)},
        "Debug_Head_Y": {"CC_Base_Head": (0, 35, 0)},
        "Debug_Head_Z": {"CC_Base_Head": (0, 0, 35)},
        "Debug_Neck1_X": {"CC_Base_NeckTwist01": (25, 0, 0)},
        "Debug_Neck1_Y": {"CC_Base_NeckTwist01": (0, 25, 0)},
        "Debug_Neck1_Z": {"CC_Base_NeckTwist01": (0, 0, 25)},
        "Debug_Neck2_X": {"CC_Base_NeckTwist02": (25, 0, 0)},
        "Debug_Neck2_Y": {"CC_Base_NeckTwist02": (0, 25, 0)},
        "Debug_Neck2_Z": {"CC_Base_NeckTwist02": (0, 0, 25)},
        "Debug_Spine2_X": {"CC_Base_Spine02": (25, 0, 0)},
        "Debug_Spine2_Y": {"CC_Base_Spine02": (0, 25, 0)},
        "Debug_Spine2_Z": {"CC_Base_Spine02": (0, 0, 25)},
        "Debug_L_Upper_X": {"CC_Base_L_Upperarm": (45, 0, 0)},
        "Debug_L_Upper_Y": {"CC_Base_L_Upperarm": (0, 45, 0)},
        "Debug_L_Upper_Z": {"CC_Base_L_Upperarm": (0, 0, 45)},
        "Debug_L_Upper_NX": {"CC_Base_L_Upperarm": (-45, 0, 0)},
        "Debug_L_Upper_NY": {"CC_Base_L_Upperarm": (0, -45, 0)},
        "Debug_L_Upper_NZ": {"CC_Base_L_Upperarm": (0, 0, -45)},
        "Debug_L_Fore_X": {"CC_Base_L_Forearm": (45, 0, 0)},
        "Debug_L_Fore_Y": {"CC_Base_L_Forearm": (0, 45, 0)},
        "Debug_L_Fore_Z": {"CC_Base_L_Forearm": (0, 0, 45)},
        "Debug_L_Fore_NX": {"CC_Base_L_Forearm": (-45, 0, 0)},
        "Debug_L_Fore_NY": {"CC_Base_L_Forearm": (0, -45, 0)},
        "Debug_L_Fore_NZ": {"CC_Base_L_Forearm": (0, 0, -45)},
        "Debug_R_Upper_X": {"CC_Base_R_Upperarm": (45, 0, 0)},
        "Debug_R_Upper_Y": {"CC_Base_R_Upperarm": (0, 45, 0)},
        "Debug_R_Upper_Z": {"CC_Base_R_Upperarm": (0, 0, 45)},
        "Debug_R_Upper_NX": {"CC_Base_R_Upperarm": (-45, 0, 0)},
        "Debug_R_Upper_NY": {"CC_Base_R_Upperarm": (0, -45, 0)},
        "Debug_R_Upper_NZ": {"CC_Base_R_Upperarm": (0, 0, -45)},
        "Debug_R_Fore_X": {"CC_Base_R_Forearm": (45, 0, 0)},
        "Debug_R_Fore_Y": {"CC_Base_R_Forearm": (0, 45, 0)},
        "Debug_R_Fore_Z": {"CC_Base_R_Forearm": (0, 0, 45)},
        "Debug_R_Fore_NX": {"CC_Base_R_Forearm": (-45, 0, 0)},
        "Debug_R_Fore_NY": {"CC_Base_R_Forearm": (0, -45, 0)},
        "Debug_R_Fore_NZ": {"CC_Base_R_Forearm": (0, 0, -45)},
        "Debug_L_Cand_A": left_arm_pose(upper=(-45, 0, 0), fore=(45, 0, 0), hand=(0, 0, 0), fingers=12),
        "Debug_L_Cand_B": left_arm_pose(upper=(-55, 0, 0), fore=(-45, 0, 0), hand=(0, 0, 0), fingers=12),
        "Debug_L_Cand_C": left_arm_pose(upper=(-45, 0, -12), fore=(0, 55, 0), hand=(0, 0, -18), fingers=12),
        "Debug_L_Cand_D": left_arm_pose(upper=(-35, 0, -25), fore=(0, -65, 0), hand=(0, 0, 18), fingers=12),
        "Debug_L_Cand_E": left_arm_pose(upper=(0, 58, 18), fore=(-62, 0, 0), hand=(0, 0, -10), fingers=12),
        "Debug_L_Cand_F": left_arm_pose(upper=(0, -58, -18), fore=(62, 0, 0), hand=(0, 0, 10), fingers=12),
        "Debug_L_Cand_G": left_arm_pose(upper=(-34, 48, 18), fore=(-48, -28, 0), hand=(8, 0, -16), fingers=12),
        "Debug_L_Cand_H": left_arm_pose(upper=(-34, -48, -18), fore=(48, 28, 0), hand=(-8, 0, 16), fingers=12),
        "Debug_R_Cand_A": right_arm_pose(upper=(-45, 0, 0), fore=(45, 0, 0), hand=(0, 0, 0), fingers=12),
        "Debug_R_Cand_B": right_arm_pose(upper=(-55, 0, 0), fore=(-45, 0, 0), hand=(0, 0, 0), fingers=12),
        "Debug_R_Cand_C": right_arm_pose(upper=(-45, 0, 12), fore=(0, -55, 0), hand=(0, 0, 18), fingers=12),
        "Debug_R_Cand_D": right_arm_pose(upper=(-35, 0, 25), fore=(0, 65, 0), hand=(0, 0, -18), fingers=12),
        "Debug_R_Cand_E": right_arm_pose(upper=(0, -58, -18), fore=(-62, 0, 0), hand=(0, 0, 10), fingers=12),
        "Debug_R_Cand_F": right_arm_pose(upper=(0, 58, 18), fore=(62, 0, 0), hand=(0, 0, -10), fingers=12),
        "Debug_R_Cand_G": right_arm_pose(upper=(-34, -48, -18), fore=(-48, 28, 0), hand=(8, 0, 16), fingers=12),
        "Debug_R_Cand_H": right_arm_pose(upper=(-34, 48, 18), fore=(48, -28, 0), hand=(-8, 0, -16), fingers=12),
    }

    for pose_name, rotations in poses.items():
        action = bpy.data.actions.new(f"RigLab_{pose_name}")
        armature.animation_data_create()
        armature.animation_data.action = action
        key_pose(armature, rotations, frame=1)
        key_pose(armature, rotations, frame=20)
        action.use_fake_user = True

    create_ik_action(armature, "Left_Raise", "L", target=(7.2, 22.05, -0.9), pole=(10.4, 17.2, -3.2), fingers=6, pole_angle=-90)
    create_ik_action(armature, "Right_Raise", "R", target=(-7.2, 22.05, -0.9), pole=(-10.4, 17.2, -3.2), fingers=6, pole_angle=90)
    create_ik_action(armature, "Left_Mouth", "L", target=(4.2, 20.45, -0.9), pole=(10.2, 16.6, -3.2), fingers=16, pole_angle=-90)
    create_ik_action(armature, "Right_Mouth", "R", target=(-4.2, 20.45, -0.9), pole=(-10.2, 16.6, -3.2), fingers=16, pole_angle=90)
    create_ik_action(armature, "Left_Eyes", "L", target=(4.25, 21.65, -0.95), pole=(10.4, 17.2, -3.4), fingers=20, pole_angle=-90)
    create_ik_action(armature, "Right_Eyes", "R", target=(-4.25, 21.65, -0.95), pole=(-10.4, 17.2, -3.4), fingers=20, pole_angle=90)

    for angle in (-180, -90, 0, 90, 180):
        create_ik_action(
            armature,
            f"Debug_IK_L_Mouth_A{angle}",
            "L",
            target=(4.2, 20.45, -0.9),
            pole=(10.2, 16.6, -3.2),
            fingers=16,
            pole_angle=angle,
        )
        create_ik_action(
            armature,
            f"Debug_IK_R_Mouth_A{angle}",
            "R",
            target=(-4.2, 20.45, -0.9),
            pole=(-10.2, 16.6, -3.2),
            fingers=16,
            pole_angle=-angle,
        )

    armature.animation_data.action = bpy.data.actions.get("RigLab_Neutral")
    restore_neutral_pose(armature, RELEVANT_BONES)


def capture_neutral_pose(armature):
    NEUTRAL_POSE.clear()
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        rotation = pose_bone.rotation_quaternion.copy()
        location = pose_bone.location.copy()
        scale = pose_bone.scale.copy()
        if pose_bone.name in RELEVANT_BONES:
            rotation.identity()
            location.zero()
            scale = Vector((1, 1, 1))
        NEUTRAL_POSE[pose_bone.name] = {
            "rotation": rotation,
            "location": location,
            "scale": scale,
        }


def restore_neutral_pose(armature, bone_names=None):
    names = bone_names if bone_names is not None else NEUTRAL_POSE.keys()
    for bone_name in names:
        pose_bone = armature.pose.bones.get(bone_name)
        neutral = NEUTRAL_POSE.get(bone_name)
        if pose_bone is None or neutral is None:
            continue
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = neutral["rotation"].copy()
        pose_bone.location = neutral["location"].copy()
        pose_bone.scale = neutral["scale"].copy()
    bpy.context.view_layer.update()


def head_pose(x=0, y=0, z=0):
    """Small distributed head-chain pose; avoids zero-length head bone overdrive."""
    return {
        "CC_Base_Spine02": (x * 0.28, y * 0.22, z * 0.22),
        "CC_Base_NeckTwist01": (x * 0.28, y * 0.25, z * 0.28),
        "CC_Base_NeckTwist02": (x * 0.24, y * 0.25, z * 0.25),
        "CC_Base_Head": (x * 0.14, y * 0.12, z * 0.12),
    }


def left_arm_pose(upper, fore, hand, fingers=0):
    return {
        "CC_Base_L_Clavicle": (0, 0, upper[2] * 0.18),
        "CC_Base_L_Upperarm": upper,
        "CC_Base_L_Forearm": fore,
        "CC_Base_L_Hand": hand,
        "CC_Base_L_Thumb1": (0, fingers * 0.45, 0),
        "CC_Base_L_Index1": (fingers, 0, 0),
        "CC_Base_L_Mid1": (fingers, 0, 0),
        "CC_Base_L_Ring1": (fingers, 0, 0),
        "CC_Base_L_Pinky1": (fingers, 0, 0),
    }


def right_arm_pose(upper, fore, hand, fingers=0):
    return {
        "CC_Base_R_Clavicle": (0, 0, upper[2] * 0.18),
        "CC_Base_R_Upperarm": upper,
        "CC_Base_R_Forearm": fore,
        "CC_Base_R_Hand": hand,
        "CC_Base_R_Thumb1": (0, -fingers * 0.45, 0),
        "CC_Base_R_Index1": (fingers, 0, 0),
        "CC_Base_R_Mid1": (fingers, 0, 0),
        "CC_Base_R_Ring1": (fingers, 0, 0),
        "CC_Base_R_Pinky1": (fingers, 0, 0),
    }


def create_ik_action(armature, pose_name, side, target, pole, fingers=0, pole_angle=0):
    action = bpy.data.actions.new(f"RigLab_{pose_name}")
    armature.animation_data_create()
    armature.animation_data.action = action
    for frame in (1, 20):
        bpy.context.scene.frame_set(frame)
        apply_ik_arm_pose(armature, side, Vector(target), Vector(pole), fingers, pole_angle)
        insert_current_pose_keys(armature, frame)
    action.use_fake_user = True
    set_pose(armature, {})


def apply_ik_arm_pose(armature, side, target, pole, fingers, pole_angle=0):
    prefix = f"CC_Base_{side}_"
    chain = [
        f"{prefix}Clavicle",
        f"{prefix}Upperarm",
        f"{prefix}Forearm",
        f"{prefix}Hand",
    ]

    set_pose(armature, {})
    target_obj = bpy.data.objects.new(f"RigLab_{side}_IK_Target", None)
    pole_obj = bpy.data.objects.new(f"RigLab_{side}_IK_Pole", None)
    bpy.context.collection.objects.link(target_obj)
    bpy.context.collection.objects.link(pole_obj)
    target_obj.empty_display_type = "SPHERE"
    pole_obj.empty_display_type = "PLAIN_AXES"
    target_obj.location = armature.matrix_world @ target
    pole_obj.location = armature.matrix_world @ pole

    hand = armature.pose.bones.get(f"{prefix}Hand")
    if hand is None:
        return
    constraint = hand.constraints.new(type="IK")
    constraint.name = "RigLab_IK"
    constraint.target = target_obj
    constraint.pole_target = pole_obj
    constraint.chain_count = 3
    constraint.use_rotation = False
    constraint.pole_angle = radians(pole_angle)

    bpy.context.view_layer.update()
    rotations = {}
    for bone_name in chain:
        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone:
            solved_matrix = pose_bone.matrix.copy()
            local_matrix = armature.convert_space(
                pose_bone=pose_bone,
                matrix=solved_matrix,
                from_space="POSE",
                to_space="LOCAL",
            )
            rotations[bone_name] = local_matrix.to_quaternion()
    hand.constraints.remove(constraint)
    bpy.data.objects.remove(target_obj, do_unlink=True)
    bpy.data.objects.remove(pole_obj, do_unlink=True)

    restore_neutral_pose(armature, RELEVANT_BONES)
    bpy.context.view_layer.update()
    for bone_name in chain:
        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone and bone_name in rotations:
            pose_bone.rotation_mode = "QUATERNION"
            pose_bone.rotation_quaternion = rotations[bone_name]
            pose_bone.location = NEUTRAL_POSE[bone_name]["location"].copy()
            pose_bone.scale = NEUTRAL_POSE[bone_name]["scale"].copy()

    finger_rotations = left_arm_pose((0, 0, 0), (0, 0, 0), (0, 0, 0), fingers)
    if side == "R":
        finger_rotations = right_arm_pose((0, 0, 0), (0, 0, 0), (0, 0, 0), fingers)
    for bone_name, rotation in finger_rotations.items():
        if not any(token in bone_name for token in ("Thumb", "Index", "Mid", "Ring", "Pinky")):
            continue
        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone:
            pose_bone.rotation_mode = "QUATERNION"
            pose_bone.rotation_quaternion = Euler(tuple(radians(value) for value in rotation), "XYZ").to_quaternion()

    bpy.context.view_layer.update()


def set_pose(armature, rotations):
    restore_neutral_pose(armature, RELEVANT_BONES)
    for bone_name in RELEVANT_BONES:
        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone is None:
            continue
        pose_bone.rotation_mode = "QUATERNION"
        x, y, z = rotations.get(bone_name, (0, 0, 0))
        offset = Euler((radians(x), radians(y), radians(z)), "XYZ").to_quaternion()
        neutral = NEUTRAL_POSE.get(bone_name)
        if neutral:
            pose_bone.rotation_quaternion = neutral["rotation"] @ offset
    bpy.context.view_layer.update()


def key_pose(armature, rotations, frame):
    bpy.context.scene.frame_set(frame)
    set_pose(armature, rotations)
    insert_current_pose_keys(armature, frame)


def insert_current_pose_keys(armature, frame):
    for bone_name in RELEVANT_BONES:
        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone is None:
            continue
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def export_glb_with_actions(output_path):
    kwargs = dict(
        filepath=output_path,
        export_format="GLB",
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texture_dir="",
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_morph=True,
        export_morph_normal=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_range=False,
        export_apply=False,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop("export_morph_normal", None)
        bpy.ops.export_scene.gltf(**kwargs)


if __name__ == "__main__":
    main()
