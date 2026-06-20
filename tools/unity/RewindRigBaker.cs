#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class RewindRigBaker
{
    private const string ScriptBuildStamp = "2026-06-17-rest-pose-delta-1";
    private const string ModelPath = "Assets/Cat/Cat.Fbx";
    private const string AutoRunFlag = "E:/CreativeCoding/Rewind/.tmp/unity-run-rig-bake.flag";
    private const string ScreenshotDir = "E:/CreativeCoding/Rewind/.tmp/screenshots/unity-rig-bake";
    private const string PoseJsonPath = "E:/CreativeCoding/Rewind/public/assets/cat/rig-poses-unity.json";
    private const string LogPath = "E:/CreativeCoding/Rewind/.tmp/diagnostics/unity-rig-bake.log";

    [MenuItem("Rewind/Bake Rig Lab Poses")]
    public static void BakeFromMenu()
    {
        Bake();
    }

    public static void BakeBatch()
    {
        var ok = Bake();
        EditorApplication.Exit(ok ? 0 : 1);
    }

    private static bool Bake()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
        Directory.CreateDirectory(ScreenshotDir);
        Directory.CreateDirectory(Path.GetDirectoryName(PoseJsonPath));
        var log = new StringBuilder();

        try
        {
            log.AppendLine($"Rewind rig bake {DateTime.Now:O}");
            log.AppendLine($"ScriptBuildStamp={ScriptBuildStamp}");
            ConfigureModelImporter(log);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
            if (model == null)
            {
                throw new InvalidOperationException($"Missing model at {ModelPath}");
            }

            var cat = (GameObject)PrefabUtility.InstantiatePrefab(model, scene);
            cat.name = "Rewind_Cat_Bake_Instance";
            cat.transform.position = Vector3.zero;
            cat.transform.rotation = Quaternion.identity;

            var animator = cat.GetComponent<Animator>();
            if (animator == null)
            {
                animator = cat.AddComponent<Animator>();
            }

            animator.avatar = FindAvatar();
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            animator.applyRootMotion = false;
            if (animator.avatar == null || !animator.avatar.isValid || !animator.avatar.isHuman)
            {
                throw new InvalidOperationException($"Avatar is not a valid Humanoid avatar. valid={animator.avatar?.isValid} human={animator.avatar?.isHuman}");
            }

            HideNonValidationMeshes(cat);
            var camera = CreateCamera();
            var lights = CreateLights();

            var restPose = CaptureRestPose(cat);

            var poses = BuildPoses();
            var poseJson = new StringBuilder();
            poseJson.AppendLine("{");
            poseJson.AppendLine("  \"source\": \"Unity HumanPoseHandler baked from Assets/Cat/Cat.Fbx\",");
            poseJson.Append("  \"restPose\": ");
            WriteBonePoseJson(poseJson, cat);
            poseJson.AppendLine(",");
            poseJson.Append("  \"worldRest\": ");
            WriteBoneWorldPoseJson(poseJson, cat);
            poseJson.AppendLine(",");
            poseJson.AppendLine("  \"poses\": {");
            var worldPoseJson = new StringBuilder();
            worldPoseJson.AppendLine("  \"worldPoses\": {");

            for (var index = 0; index < poses.Count; index++)
            {
                var spec = poses[index];
                ResetPose(restPose);
                ApplyRigPose(cat, spec, log);
                ForceSceneUpdate();
                FitCameraToCat(camera, cat, log, spec.Id);
                var bakedMeshes = BakeVisibleSkinnedMeshes(cat, log, spec.Id);

                var pngPath = Path.Combine(ScreenshotDir, $"{spec.Id}.png").Replace("\\", "/");
                RenderPng(camera, pngPath);
                log.AppendLine($"Rendered {pngPath}");
                RestoreBakedMeshes(bakedMeshes);

                poseJson.Append($"    \"{spec.ClipName}\": ");
                WriteBonePoseJson(poseJson, cat);
                poseJson.AppendLine(index == poses.Count - 1 ? "" : ",");
                worldPoseJson.Append($"    \"{spec.ClipName}\": ");
                WriteBoneWorldPoseJson(worldPoseJson, cat);
                worldPoseJson.AppendLine(index == poses.Count - 1 ? "" : ",");
            }

            poseJson.AppendLine("  },");
            worldPoseJson.AppendLine("  }");
            poseJson.Append(worldPoseJson);
            poseJson.AppendLine("}");
            File.WriteAllText(PoseJsonPath, poseJson.ToString(), Encoding.UTF8);
            log.AppendLine($"Wrote {PoseJsonPath}");

            foreach (var obj in lights)
            {
                UnityEngine.Object.DestroyImmediate(obj);
            }
            UnityEngine.Object.DestroyImmediate(camera.gameObject);
            UnityEngine.Object.DestroyImmediate(cat);
            File.WriteAllText(LogPath, log.ToString(), Encoding.UTF8);
            AssetDatabase.Refresh();
            return true;
        }
        catch (Exception ex)
        {
            log.AppendLine(ex.ToString());
            File.WriteAllText(LogPath, log.ToString(), Encoding.UTF8);
            Debug.LogError(ex);
            return false;
        }
    }

    private static void ConfigureModelImporter(StringBuilder log)
    {
        var importer = AssetImporter.GetAtPath(ModelPath) as ModelImporter;
        if (importer == null)
        {
            throw new InvalidOperationException($"ModelImporter not found for {ModelPath}");
        }

        var changed = false;
        changed |= SetImporterValue(importer.animationType != ModelImporterAnimationType.Human, () => importer.animationType = ModelImporterAnimationType.Human);
        changed |= SetImporterValue(importer.avatarSetup != ModelImporterAvatarSetup.CreateFromThisModel, () => importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel);
        changed |= SetImporterValue(importer.optimizeGameObjects, () => importer.optimizeGameObjects = false);
        changed |= SetImporterValue(importer.optimizeBones, () => importer.optimizeBones = false);
        changed |= SetImporterValue(!importer.importBlendShapes, () => importer.importBlendShapes = true);
        changed |= SetImporterValue(!importer.isReadable, () => importer.isReadable = true);
        importer.maxBonesPerVertex = 4;

        if (changed)
        {
            log.AppendLine("Reimporting Cat.Fbx as Humanoid, non-optimized hierarchy, readable mesh.");
            importer.SaveAndReimport();
        }
        else
        {
            log.AppendLine("Cat.Fbx importer already configured for baking.");
        }
    }

    private static bool SetImporterValue(bool shouldSet, Action setter)
    {
        if (!shouldSet)
        {
            return false;
        }
        setter();
        return true;
    }

    private static Avatar FindAvatar()
    {
        return AssetDatabase.LoadAllAssetsAtPath(ModelPath).OfType<Avatar>().FirstOrDefault();
    }

    private static void HideNonValidationMeshes(GameObject cat)
    {
        foreach (var renderer in cat.GetComponentsInChildren<Renderer>(true))
        {
            var lower = renderer.name.ToLowerInvariant();
            if (lower.StartsWith("fibers") || lower.Contains("diaper") || lower.Contains("tearline") || lower.Contains("eyeocclusion"))
            {
                renderer.enabled = false;
                continue;
            }

            var skinned = renderer as SkinnedMeshRenderer;
            if (skinned != null)
            {
                skinned.updateWhenOffscreen = true;
            }
        }
    }

    private static Camera CreateCamera()
    {
        var go = new GameObject("Rewind_Bake_Camera");
        var camera = go.AddComponent<Camera>();
        camera.orthographic = true;
        camera.orthographicSize = 1f;
        camera.transform.position = new Vector3(0f, -2.5f, 0.75f);
        camera.transform.rotation = Quaternion.identity;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0.965f, 0.945f, 0.91f, 1f);
        return camera;
    }

    private static void FitCameraToCat(Camera camera, GameObject cat, StringBuilder log, string poseId)
    {
        var renderers = cat.GetComponentsInChildren<Renderer>(true).Where(r => r.enabled).ToArray();
        if (renderers.Length == 0)
        {
            log.AppendLine($"{poseId}: no enabled renderers for camera fit");
            return;
        }

        var bounds = renderers[0].bounds;
        foreach (var renderer in renderers.Skip(1))
        {
            bounds.Encapsulate(renderer.bounds);
        }

        var size = bounds.size;
        var center = bounds.center;
        var distance = Mathf.Max(size.magnitude * 2.5f, 2f);
        camera.transform.position = center + new Vector3(0f, size.y * 0.03f, distance);
        camera.transform.LookAt(center + Vector3.up * size.y * 0.04f, Vector3.up);
        camera.orthographicSize = Mathf.Max(size.y * 0.74f, size.x * 0.72f, 0.28f);
        camera.nearClipPlane = 0.01f;
        camera.farClipPlane = distance * 4f;
        log.AppendLine($"{poseId}: bounds center={center} size={size} camera={camera.transform.position} ortho={camera.orthographicSize}");
    }

    private static List<GameObject> CreateLights()
    {
        var lights = new List<GameObject>();
        var key = new GameObject("Rewind_Bake_Key");
        var keyLight = key.AddComponent<Light>();
        keyLight.type = LightType.Directional;
        keyLight.intensity = 1.8f;
        key.transform.rotation = Quaternion.Euler(40f, -25f, 0f);
        lights.Add(key);

        var fill = new GameObject("Rewind_Bake_Fill");
        var fillLight = fill.AddComponent<Light>();
        fillLight.type = LightType.Directional;
        fillLight.intensity = 1.15f;
        fill.transform.rotation = Quaternion.Euler(25f, 35f, 0f);
        lights.Add(fill);
        RenderSettings.ambientLight = new Color(0.48f, 0.48f, 0.46f, 1f);
        return lights;
    }

    private static List<BakedRendererState> BakeVisibleSkinnedMeshes(GameObject cat, StringBuilder log, string poseId)
    {
        var states = new List<BakedRendererState>();
        foreach (var skinned in cat.GetComponentsInChildren<SkinnedMeshRenderer>(true))
        {
            if (!skinned.enabled || !skinned.gameObject.activeInHierarchy)
            {
                continue;
            }

            var mesh = new Mesh();
            skinned.BakeMesh(mesh, true);
            var baked = new GameObject($"Baked_{skinned.name}");
            baked.transform.SetPositionAndRotation(skinned.transform.position, skinned.transform.rotation);
            baked.transform.localScale = skinned.transform.lossyScale;
            var filter = baked.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;
            var renderer = baked.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = BuildValidationMaterials(skinned.sharedMaterials);
            states.Add(new BakedRendererState(skinned, baked, mesh));
            skinned.enabled = false;
            log.AppendLine($"{poseId}: baked {skinned.name} vertices={mesh.vertexCount}");
        }
        return states;
    }

    private static void RestoreBakedMeshes(List<BakedRendererState> states)
    {
        foreach (var state in states)
        {
            state.Source.enabled = true;
            UnityEngine.Object.DestroyImmediate(state.Baked);
            UnityEngine.Object.DestroyImmediate(state.Mesh);
        }
    }

    private static List<PoseSpec> BuildPoses()
    {
        return new List<PoseSpec>
        {
            new PoseSpec("left_relaxed", "RigLab_Left_Relaxed", RigSide.Left, RigGesture.Relaxed),
            new PoseSpec("right_relaxed", "RigLab_Right_Relaxed", RigSide.Right, RigGesture.Relaxed),
            new PoseSpec("left_raise", "RigLab_Left_Raise", RigSide.Left, RigGesture.Raise),
            new PoseSpec("right_raise", "RigLab_Right_Raise", RigSide.Right, RigGesture.Raise),
            new PoseSpec("left_mouth", "RigLab_Left_Mouth", RigSide.Left, RigGesture.CoverMouth),
            new PoseSpec("right_mouth", "RigLab_Right_Mouth", RigSide.Right, RigGesture.CoverMouth),
            new PoseSpec("left_eye", "RigLab_Left_Eyes", RigSide.Left, RigGesture.CoverEyes),
            new PoseSpec("right_eye", "RigLab_Right_Eyes", RigSide.Right, RigGesture.CoverEyes)
        };
    }

    private static List<RestTransform> CaptureRestPose(GameObject cat)
    {
        return cat.GetComponentsInChildren<Transform>(true)
            .Select(t => new RestTransform(t))
            .ToList();
    }

    private static void ResetPose(List<RestTransform> restPose)
    {
        foreach (var entry in restPose)
        {
            entry.Apply();
        }
    }

    private static void ApplyRigPose(GameObject cat, PoseSpec spec, StringBuilder log)
    {
        ApplyArmPose(cat, spec.Side == RigSide.Left ? RigSide.Right : RigSide.Left, RigGesture.Relaxed, log, spec.Id + "_relaxed_other");
        ApplyArmPose(cat, spec.Side, spec.Gesture, log, spec.Id);
    }

    private static void ApplyArmPose(GameObject cat, RigSide side, RigGesture gesture, StringBuilder log, string poseId)
    {
        var spec = new PoseSpec(poseId, poseId, side, gesture);
        var prefix = spec.Side == RigSide.Left ? "CC_Base_L_" : "CC_Base_R_";
        var upper = FindBone(cat, prefix + "Upperarm");
        var forearm = FindBone(cat, prefix + "Forearm");
        var hand = FindBone(cat, prefix + "Hand");
        var clavicle = FindBone(cat, prefix + "Clavicle");
        var head = FindBone(cat, "CC_Base_Head");
        var leftEye = FindBone(cat, "CC_Base_L_Eye");
        var rightEye = FindBone(cat, "CC_Base_R_Eye");
        var spine = FindBone(cat, "CC_Base_Spine02") ?? cat.transform;
        if (upper == null || forearm == null || hand == null || head == null)
        {
            log.AppendLine($"{spec.Id}: missing arm/head bones. upper={upper} forearm={forearm} hand={hand} head={head}");
            return;
        }

        var sideDir = upper.position - spine.position;
        sideDir.y = 0f;
        sideDir.z = 0f;
        if (sideDir.sqrMagnitude < 0.00001f)
        {
            sideDir = spec.Side == RigSide.Left ? Vector3.left : Vector3.right;
        }
        sideDir.Normalize();

        var up = Vector3.up;
        var front = Vector3.forward;
        var shoulder = upper.position;
        var headCenter = head.position;
        var eyeCenter = (leftEye != null && rightEye != null) ? (leftEye.position + rightEye.position) * 0.5f : headCenter + Vector3.up * 0.055f;
        var mouthCenter = eyeCenter + Vector3.down * 0.036f + Vector3.forward * 0.032f;
        var eyeCoverCenter = eyeCenter + Vector3.forward * 0.032f;
        var gestureFocus = headCenter;
        var target = hand.position;
        var pole = shoulder + sideDir * 0.08f + front * 0.06f;

        switch (spec.Gesture)
        {
            case RigGesture.Relaxed:
                target = shoulder + sideDir * 0.028f + up * -0.105f + front * 0.018f;
                pole = shoulder + sideDir * 0.08f + up * -0.035f + front * 0.10f;
                break;
            case RigGesture.Raise:
                target = shoulder + sideDir * 0.072f + up * 0.082f + front * 0.038f;
                pole = shoulder + sideDir * 0.108f + up * 0.040f + front * 0.075f;
                break;
            case RigGesture.CoverMouth:
                gestureFocus = mouthCenter;
                target = mouthCenter + sideDir * 0.035f + up * -0.020f + front * -0.030f;
                pole = shoulder + sideDir * 0.100f + up * 0.012f + front * 0.072f;
                break;
            case RigGesture.CoverEyes:
                gestureFocus = eyeCoverCenter;
                target = shoulder + up * 0.060f + front * 0.040f;
                pole = shoulder + sideDir * 0.086f + up * 0.070f + front * 0.080f;
                break;
        }

        if (clavicle != null)
        {
            var clavicleAim = Quaternion.FromToRotation(upper.position - clavicle.position, target - clavicle.position);
            var clavicleWeight = spec.Gesture == RigGesture.Relaxed ? 0.18f : spec.Gesture == RigGesture.Raise ? 0.32f : 0.46f;
            clavicle.rotation = Quaternion.Slerp(clavicle.rotation, clavicleAim * clavicle.rotation, clavicleWeight);
        }

        SolveTwoBoneIk(upper, forearm, hand, target, pole, spec.Id, log);
        PoseHand(hand, spec.Side, spec.Gesture);
        OrientHand(cat, hand, spec.Side, spec.Gesture, gestureFocus, log, spec.Id);
        PoseFingers(cat, spec.Side, spec.Gesture);
        log.AppendLine($"{poseId}: eyeCenter={eyeCenter} mouthCenter={mouthCenter} focus={gestureFocus}");
        log.AppendLine($"{poseId}: target={target} pole={pole} shoulder={shoulder} hand={hand.position}");
    }

    private static Transform FindBone(GameObject cat, string name)
    {
        return cat.GetComponentsInChildren<Transform>(true).FirstOrDefault(t => t.name == name);
    }

    private static void SolveTwoBoneIk(Transform upper, Transform forearm, Transform hand, Vector3 rawTarget, Vector3 pole, string poseId, StringBuilder log)
    {
        var root = upper.position;
        var elbow = forearm.position;
        var wrist = hand.position;
        var upperLen = Vector3.Distance(root, elbow);
        var foreLen = Vector3.Distance(elbow, wrist);
        var maxReach = Mathf.Max(upperLen + foreLen - 0.002f, 0.001f);
        var minReach = Mathf.Max(Mathf.Abs(upperLen - foreLen) + 0.002f, 0.001f);
        var targetVector = rawTarget - root;
        var distance = Mathf.Clamp(targetVector.magnitude, minReach, maxReach);
        var target = root + targetVector.normalized * distance;
        var rootToTarget = (target - root).normalized;
        var poleDir = pole - root;
        poleDir -= Vector3.Project(poleDir, rootToTarget);
        if (poleDir.sqrMagnitude < 0.00001f)
        {
            poleDir = Vector3.Cross(rootToTarget, Vector3.forward);
        }
        poleDir.Normalize();

        var along = (upperLen * upperLen + distance * distance - foreLen * foreLen) / (2f * distance);
        var heightSq = Mathf.Max(upperLen * upperLen - along * along, 0f);
        var desiredElbow = root + rootToTarget * along + poleDir * Mathf.Sqrt(heightSq);

        RotateChildDirection(upper, forearm, desiredElbow - root);
        RotateChildDirection(forearm, hand, target - forearm.position);
        log.AppendLine($"{poseId}: IK lengths upper={upperLen:F4} forearm={foreLen:F4} dist={distance:F4}");
    }

    private static void RotateChildDirection(Transform bone, Transform child, Vector3 desiredDirection)
    {
        var currentDirection = child.position - bone.position;
        if (currentDirection.sqrMagnitude < 0.000001f || desiredDirection.sqrMagnitude < 0.000001f)
        {
            return;
        }
        bone.rotation = Quaternion.FromToRotation(currentDirection, desiredDirection) * bone.rotation;
    }

    private static void PoseHand(Transform hand, RigSide side, RigGesture gesture)
    {
        var sideSign = side == RigSide.Left ? -1f : 1f;
        if (gesture == RigGesture.Relaxed)
        {
            hand.localRotation *= Quaternion.Euler(2f, sideSign * -4f, sideSign * 4f);
        }
        else if (gesture == RigGesture.Raise)
        {
            hand.localRotation *= Quaternion.Euler(-8f, sideSign * -12f, sideSign * 14f);
        }
        else
        {
            hand.localRotation *= Quaternion.Euler(-18f, sideSign * -24f, sideSign * 8f);
        }
    }

    private static void OrientHand(GameObject cat, Transform hand, RigSide side, RigGesture gesture, Vector3 focusPoint, StringBuilder log, string poseId)
    {
        var prefix = side == RigSide.Left ? "CC_Base_L_" : "CC_Base_R_";
        var fingerRoots = new[]
        {
            FindBone(cat, prefix + "Index1"),
            FindBone(cat, prefix + "Mid1"),
            FindBone(cat, prefix + "Ring1"),
            FindBone(cat, prefix + "Pinky1")
        }.Where(t => t != null).ToArray();

        if (fingerRoots.Length == 0)
        {
            log.AppendLine($"{poseId}: no finger roots for hand orientation");
            return;
        }

        var fingerCenter = Vector3.zero;
        foreach (var finger in fingerRoots)
        {
            fingerCenter += finger.position;
        }
        fingerCenter /= fingerRoots.Length;

        var currentFingerDirection = fingerCenter - hand.position;
        if (currentFingerDirection.sqrMagnitude < 0.000001f)
        {
            return;
        }

        var desired = Vector3.up;
        var desiredPalmNormal = Vector3.forward;
        var strength = 1f;
        if (gesture == RigGesture.CoverMouth)
        {
            desired = (focusPoint + Vector3.forward * 0.050f) - hand.position;
            desiredPalmNormal = Vector3.forward;
        }
        else if (gesture == RigGesture.CoverEyes)
        {
            desired = (focusPoint + Vector3.forward * 0.050f) - hand.position;
            desiredPalmNormal = Vector3.forward;
        }
        else if (gesture == RigGesture.Raise)
        {
            var sideDir = side == RigSide.Left ? Vector3.left : Vector3.right;
            desired = Vector3.up * 0.82f + sideDir * 0.34f + Vector3.forward * 0.20f;
            desiredPalmNormal = Vector3.forward;
            strength = 0.86f;
        }

        if (desired.sqrMagnitude < 0.000001f)
        {
            return;
        }

        var rotation = Quaternion.FromToRotation(currentFingerDirection.normalized, desired.normalized);
        hand.rotation = Quaternion.Slerp(hand.rotation, rotation * hand.rotation, strength);

        var index = FindBone(cat, prefix + "Index1");
        var pinky = FindBone(cat, prefix + "Pinky1");
        fingerCenter = Vector3.zero;
        foreach (var finger in fingerRoots)
        {
            fingerCenter += finger.position;
        }
        fingerCenter /= fingerRoots.Length;
        var updatedFingerDirection = fingerCenter - hand.position;
        if (index == null || pinky == null || updatedFingerDirection.sqrMagnitude < 0.000001f)
        {
            return;
        }

        var spreadDirection = index.position - pinky.position;
        var currentPalmNormal = Vector3.Cross(spreadDirection, updatedFingerDirection).normalized;
        if (Vector3.Dot(currentPalmNormal, desiredPalmNormal) < Vector3.Dot(-currentPalmNormal, desiredPalmNormal))
        {
            currentPalmNormal = -currentPalmNormal;
        }
        var desiredAxis = desired.normalized;
        currentPalmNormal -= Vector3.Project(currentPalmNormal, desiredAxis);
        desiredPalmNormal -= Vector3.Project(desiredPalmNormal, desiredAxis);
        if (currentPalmNormal.sqrMagnitude < 0.000001f || desiredPalmNormal.sqrMagnitude < 0.000001f)
        {
            return;
        }

        currentPalmNormal.Normalize();
        desiredPalmNormal.Normalize();
        var roll = Quaternion.FromToRotation(currentPalmNormal, desiredPalmNormal);
        hand.rotation = roll * hand.rotation;
        log.AppendLine($"{poseId}: hand orient finger={updatedFingerDirection.normalized} palm={currentPalmNormal} desiredPalm={desiredPalmNormal}");
    }

    private static void PoseFingers(GameObject cat, RigSide side, RigGesture gesture)
    {
        var prefix = side == RigSide.Left ? "CC_Base_L_" : "CC_Base_R_";
        var curl = gesture == RigGesture.Relaxed ? 6f : gesture == RigGesture.Raise ? 4f : 8f;
        foreach (var finger in new[] { "Index", "Mid", "Ring", "Pinky", "Thumb" })
        {
            for (var i = 1; i <= 3; i++)
            {
                var bone = FindBone(cat, $"{prefix}{finger}{i}");
                if (bone == null)
                {
                    continue;
                }
                bone.localRotation *= Quaternion.Euler(curl, 0f, 0f);
            }
        }
    }

    private static Material[] BuildValidationMaterials(Material[] sourceMaterials)
    {
        return sourceMaterials.Select(BuildValidationMaterial).ToArray();
    }

    private static Material BuildValidationMaterial(Material source)
    {
        var name = source == null ? "" : source.name.ToLowerInvariant();
        if (name.Contains("cornea"))
        {
            return source;
        }

        var shader = Shader.Find("Unlit/Color");
        var material = new Material(shader != null ? shader : Shader.Find("Standard"));
        material.name = "Rewind_Validation_Matte";
        material.SetInt("_Cull", (int)UnityEngine.Rendering.CullMode.Off);
        if (name.Contains("eye"))
        {
            material.color = new Color(0.92f, 0.76f, 0.20f, 1f);
        }
        else if (name.Contains("teeth"))
        {
            material.color = new Color(0.94f, 0.90f, 0.82f, 1f);
        }
        else if (name.Contains("tongue"))
        {
            material.color = new Color(0.92f, 0.55f, 0.58f, 1f);
        }
        else if (name.Contains("nail"))
        {
            material.color = new Color(0.08f, 0.085f, 0.085f, 1f);
        }
        else if (name.Contains("arm"))
        {
            material.color = new Color(0.50f, 0.53f, 0.51f, 1f);
        }
        else if (name.Contains("head"))
        {
            material.color = new Color(0.56f, 0.59f, 0.57f, 1f);
        }
        else
        {
            material.color = new Color(0.62f, 0.64f, 0.63f, 1f);
        }
        return material;
    }

    private static void ForceSceneUpdate()
    {
        SceneView.RepaintAll();
        EditorApplication.QueuePlayerLoopUpdate();
        UnityEditorInternal.InternalEditorUtility.RepaintAllViews();
    }

    private static void RenderPng(Camera camera, string path)
    {
        var previous = RenderTexture.active;
        var rt = new RenderTexture(900, 1100, 24, RenderTextureFormat.ARGB32);
        var tex = new Texture2D(rt.width, rt.height, TextureFormat.RGBA32, false);
        camera.targetTexture = rt;
        camera.Render();
        RenderTexture.active = rt;
        tex.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
        tex.Apply();
        File.WriteAllBytes(path, tex.EncodeToPNG());
        camera.targetTexture = null;
        RenderTexture.active = previous;
        UnityEngine.Object.DestroyImmediate(tex);
        rt.Release();
        UnityEngine.Object.DestroyImmediate(rt);
    }

    private static void WriteBonePoseJson(StringBuilder output, GameObject cat)
    {
        output.AppendLine("{");
        var bones = cat.GetComponentsInChildren<Transform>(true)
            .Where(t => t.name.StartsWith("CC_Base_", StringComparison.Ordinal))
            .OrderBy(t => t.name, StringComparer.Ordinal)
            .ToArray();
        for (var i = 0; i < bones.Length; i++)
        {
            var bone = bones[i];
            var q = bone.localRotation;
            output.Append("      \"").Append(bone.name).Append("\": [")
                .Append(q.x.ToString("R", CultureInfo.InvariantCulture)).Append(", ")
                .Append(q.y.ToString("R", CultureInfo.InvariantCulture)).Append(", ")
                .Append(q.z.ToString("R", CultureInfo.InvariantCulture)).Append(", ")
                .Append(q.w.ToString("R", CultureInfo.InvariantCulture)).Append("]");
            output.AppendLine(i == bones.Length - 1 ? "" : ",");
        }
        output.Append("    }");
    }

    private static void WriteBoneWorldPoseJson(StringBuilder output, GameObject cat)
    {
        output.AppendLine("{");
        var bones = cat.GetComponentsInChildren<Transform>(true)
            .Where(t => t.name.StartsWith("CC_Base_", StringComparison.Ordinal))
            .OrderBy(t => t.name, StringComparer.Ordinal)
            .ToArray();
        for (var i = 0; i < bones.Length; i++)
        {
            var bone = bones[i];
            var p = bone.position;
            output.Append("      \"").Append(bone.name).Append("\": [")
                .Append(p.x.ToString("R", CultureInfo.InvariantCulture)).Append(", ")
                .Append(p.y.ToString("R", CultureInfo.InvariantCulture)).Append(", ")
                .Append(p.z.ToString("R", CultureInfo.InvariantCulture)).Append("]");
            output.AppendLine(i == bones.Length - 1 ? "" : ",");
        }
        output.Append("    }");
    }

    private sealed class PoseSpec
    {
        public readonly string Id;
        public readonly string ClipName;
        public readonly RigSide Side;
        public readonly RigGesture Gesture;

        public PoseSpec(string id, string clipName, RigSide side, RigGesture gesture)
        {
            Id = id;
            ClipName = clipName;
            Side = side;
            Gesture = gesture;
        }
    }

    private enum RigSide
    {
        Left,
        Right
    }

    private enum RigGesture
    {
        Relaxed,
        Raise,
        CoverMouth,
        CoverEyes
    }

    private sealed class RestTransform
    {
        private readonly Transform transform;
        private readonly Vector3 localPosition;
        private readonly Quaternion localRotation;
        private readonly Vector3 localScale;

        public RestTransform(Transform transform)
        {
            this.transform = transform;
            localPosition = transform.localPosition;
            localRotation = transform.localRotation;
            localScale = transform.localScale;
        }

        public void Apply()
        {
            transform.localPosition = localPosition;
            transform.localRotation = localRotation;
            transform.localScale = localScale;
        }
    }

    private sealed class BakedRendererState
    {
        public readonly SkinnedMeshRenderer Source;
        public readonly GameObject Baked;
        public readonly Mesh Mesh;

        public BakedRendererState(SkinnedMeshRenderer source, GameObject baked, Mesh mesh)
        {
            Source = source;
            Baked = baked;
            Mesh = mesh;
        }
    }
}

[InitializeOnLoad]
public static class RewindRigBakerAutoRun
{
    static RewindRigBakerAutoRun()
    {
        EditorApplication.delayCall += () =>
        {
            try
            {
                if (!File.Exists("E:/CreativeCoding/Rewind/.tmp/unity-run-rig-bake.flag"))
                {
                    return;
                }
                File.Delete("E:/CreativeCoding/Rewind/.tmp/unity-run-rig-bake.flag");
                RewindRigBaker.BakeFromMenu();
            }
            catch (Exception ex)
            {
                Debug.LogError(ex);
            }
        };
    }
}
#endif
