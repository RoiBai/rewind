using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEngine;

public sealed class RewindWebAvatarController : MonoBehaviour
{
    public GameObject catRoot;
    public float faceAmplifier = 1.02f;
    public float headYawDegrees = 30f;
    public float headPitchDegrees = 34f;
    public float headRollDegrees = 22f;
    public float smoothing = 12f;
    public float closeFaceZoom = 0.34f;
    public float farFaceZoom = 0.22f;

    private readonly TrackingPacket target = new TrackingPacket();
    private readonly TrackingPacket current = new TrackingPacket();
    private readonly List<RestTransform> restPose = new List<RestTransform>();
    private readonly List<BlendBinding> blendBindings = new List<BlendBinding>();
    private readonly List<Material> eyeOcclusionMaterials = new List<Material>();
    private readonly Dictionary<HumanBodyBones, Transform> humanBones = new Dictionary<HumanBodyBones, Transform>();
    private readonly Dictionary<string, Dictionary<string, Quaternion>> bakedPoses = new Dictionary<string, Dictionary<string, Quaternion>>();
    private readonly List<Renderer> hairRenderers = new List<Renderer>();
    private readonly Dictionary<Renderer, Material[]> hairMaterials = new Dictionary<Renderer, Material[]>();
    private Animator animator;
    private Transform fallbackHead;
    private Light keyLight;
    private Light fillLight;
    private Light rimLight;
    private Camera avatarCamera;
    private float baseOrthographicSize = 0.98f;
    private Vector3 baseAvatarScale = Vector3.one;
    private string lookMode = "official";

    private void Awake()
    {
        if (catRoot == null)
        {
            catRoot = gameObject;
        }

        baseAvatarScale = catRoot.transform.localScale;
        animator = catRoot.GetComponentInChildren<Animator>();
        CacheRestPose();
        CacheHumanBones();
        CacheBlendShapes();
        CacheEyeOcclusionMaterials();
        CacheBakedPoses();
        HideNonWebMeshes();
        CacheLookTargets();
        CacheCamera();
        ApplyLookMode();
    }

    public void ApplyTrackingJson(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return;
        }

        try
        {
            var packet = JsonUtility.FromJson<TrackingPacket>(json);
            if (packet == null)
            {
                return;
            }

            target.CopyFrom(packet);
        }
        catch (Exception error)
        {
            Debug.LogWarning("Rewind tracking JSON failed: " + error.Message);
        }
    }

    public void ApplyPreset(string preset)
    {
        target.Reset();
        switch ((preset ?? string.Empty).ToLowerInvariant())
        {
            case "smile":
                target.smile = 1f;
                break;
            case "blink":
                target.blinkLeft = 1f;
                target.blinkRight = 1f;
                break;
            case "talk":
                target.mouthOpen = 1f;
                break;
            case "pucker":
                target.mouthPucker = 1f;
                break;
            case "tilt-left":
                target.roll = -0.8f;
                break;
            case "tilt-right":
                target.roll = 0.8f;
                break;
            case "turn-left":
                target.yaw = -0.8f;
                break;
            case "turn-right":
                target.yaw = 0.8f;
                break;
            case "look-up":
                target.pitch = -0.75f;
                break;
            case "look-down":
                target.pitch = 0.75f;
                break;
            case "raise-left":
                target.leftGesture = "raise";
                break;
            case "raise-right":
                target.rightGesture = "raise";
                break;
            case "mouth-left":
                target.leftGesture = "mouth";
                break;
            case "mouth-right":
                target.rightGesture = "mouth";
                break;
            case "eyes-left":
                target.leftGesture = "eyes";
                break;
            case "eyes-right":
                target.rightGesture = "eyes";
                break;
        }
    }

    public void SetLookMode(string mode)
    {
        var normalized = (mode ?? string.Empty).Trim().ToLowerInvariant();
        lookMode = normalized == "stable" ? "stable" : "official";
        ApplyLookMode();
    }

    private void LateUpdate()
    {
        var dt = Time.deltaTime <= 0f ? 0.016f : Time.deltaTime;
        current.LerpTo(target, 1f - Mathf.Exp(-smoothing * dt));

        RestoreRestPose();
        ApplyFace();
        ApplyHead();
        ApplyHands();
        ApplyFraming();
    }

    private void CacheRestPose()
    {
        restPose.Clear();
        foreach (var item in catRoot.GetComponentsInChildren<Transform>(true))
        {
            restPose.Add(new RestTransform(item));
            if (item.name == "CC_Base_Head")
            {
                fallbackHead = item;
            }
        }
    }

    private void CacheHumanBones()
    {
        humanBones.Clear();
        if (animator == null || animator.avatar == null || !animator.avatar.isHuman)
        {
            return;
        }

        foreach (HumanBodyBones bone in Enum.GetValues(typeof(HumanBodyBones)))
        {
            if (bone == HumanBodyBones.LastBone)
            {
                continue;
            }

            var transform = animator.GetBoneTransform(bone);
            if (transform != null && !humanBones.ContainsKey(bone))
            {
                humanBones.Add(bone, transform);
            }
        }
    }

    private void CacheBlendShapes()
    {
        blendBindings.Clear();
        var renderers = catRoot.GetComponentsInChildren<SkinnedMeshRenderer>(true);
        foreach (var renderer in renderers)
        {
            var mesh = renderer.sharedMesh;
            if (mesh == null || mesh.blendShapeCount == 0)
            {
                continue;
            }

            for (var i = 0; i < mesh.blendShapeCount; i++)
            {
                var name = mesh.GetBlendShapeName(i);
                var channel = ClassifyBlendShape(name);
                if (channel != BlendChannel.None)
                {
                    blendBindings.Add(new BlendBinding(renderer, i, channel, name));
                }
            }
        }

        Debug.Log("Rewind blendshape bindings: " + string.Join(", ", blendBindings.Select(b => b.Name)));
    }

    private void CacheEyeOcclusionMaterials()
    {
        eyeOcclusionMaterials.Clear();
        foreach (var renderer in catRoot.GetComponentsInChildren<Renderer>(true))
        {
            var rendererName = renderer.name.ToLowerInvariant();
            var materials = renderer.materials;
            var isEyeOcclusionRenderer = rendererName.Contains("eyeocclusion");
            foreach (var material in materials)
            {
                if (material == null)
                {
                    continue;
                }

                var materialName = material.name.ToLowerInvariant();
                if (isEyeOcclusionRenderer || materialName.Contains("eye_occlusion") || materialName.Contains("eyeocclusion"))
                {
                    eyeOcclusionMaterials.Add(material);
                    ConfigureRuntimeTransparentEyeOcclusion(material);
                }
            }
        }
    }

    private static void ConfigureRuntimeTransparentEyeOcclusion(Material material)
    {
        material.color = new Color(0.016f, 0.016f, 0.014f, 0f);
        if (material.HasProperty("_Mode"))
        {
            material.SetFloat("_Mode", 3f);
        }
        material.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
        material.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
        material.SetInt("_ZWrite", 0);
        material.DisableKeyword("_ALPHATEST_ON");
        material.EnableKeyword("_ALPHABLEND_ON");
        material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
        material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent + 14;
    }

    private static BlendChannel ClassifyBlendShape(string rawName)
    {
        var name = NormalizeName(rawName);
        if (name == "eyeblink")
        {
            return BlendChannel.BlinkBoth;
        }
        if (HasAny(name, "blinkleft", "eyeblinkleft", "eyeblinkl", "blinkl", "eyeclosel", "eyeclosedl", "a14"))
        {
            return BlendChannel.BlinkLeft;
        }
        if (HasAny(name, "blinkright", "eyeblinkright", "eyeblinkr", "blinkr", "eyecloser", "eyeclosedr", "a15"))
        {
            return BlendChannel.BlinkRight;
        }
        if (HasAny(name, "eyesquintleft", "eyesquintl", "squintleft", "squintl", "a16"))
        {
            return BlendChannel.SquintLeft;
        }
        if (HasAny(name, "eyesquintright", "eyesquintr", "squintright", "squintr", "a17"))
        {
            return BlendChannel.SquintRight;
        }
        if (HasAny(name, "jawopen", "mouthopen", "vopen", "a25"))
        {
            return BlendChannel.MouthOpen;
        }
        if (HasAny(name, "mouthsmileleft", "smileleft", "smilel", "a38"))
        {
            return BlendChannel.SmileLeft;
        }
        if (HasAny(name, "mouthsmileright", "smileright", "smiler", "a39"))
        {
            return BlendChannel.SmileRight;
        }
        if (HasAny(name, "mouthpucker", "pucker", "mouthfunnel", "funnel", "a29", "a30"))
        {
            return BlendChannel.Pucker;
        }
        if (HasAny(name, "mouthstretchleft", "mouthwideleft", "stretchleft", "a50"))
        {
            return BlendChannel.WideLeft;
        }
        if (HasAny(name, "mouthstretchright", "mouthwideright", "stretchright", "a51"))
        {
            return BlendChannel.WideRight;
        }

        return BlendChannel.None;
    }

    private static string NormalizeName(string value)
    {
        return new string((value ?? string.Empty).ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
    }

    private static bool HasAny(string name, params string[] needles)
    {
        return needles.Any(name.Contains);
    }

    private void HideNonWebMeshes()
    {
        foreach (var renderer in catRoot.GetComponentsInChildren<Renderer>(true))
        {
            var lower = renderer.name.ToLowerInvariant();
            if (lower.Contains("diaper") || lower.Contains("pincaps") || lower.Contains("metalpins"))
            {
                renderer.enabled = false;
            }

            var skinned = renderer as SkinnedMeshRenderer;
            if (skinned != null)
            {
                skinned.updateWhenOffscreen = true;
                skinned.skinnedMotionVectors = false;
            }
        }
    }

    private void CacheLookTargets()
    {
        hairRenderers.Clear();
        hairMaterials.Clear();

        foreach (var renderer in catRoot.GetComponentsInChildren<Renderer>(true))
        {
            var rendererName = renderer.name.ToLowerInvariant();
            var materials = renderer.materials;
            var isHair = rendererName.Contains("fibers") ||
                materials.Any(material => material != null && material.shader != null && material.shader.name == "Rewind/WebGL Hair");
            if (!isHair)
            {
                continue;
            }

            hairRenderers.Add(renderer);
            hairMaterials[renderer] = materials;
        }

        keyLight = FindLight("Key Light");
        fillLight = FindLight("Fill Light");
        rimLight = FindLight("Rim Light");
    }

    private static Light FindLight(string name)
    {
        var item = GameObject.Find(name);
        return item == null ? null : item.GetComponent<Light>();
    }

    private void CacheCamera()
    {
        avatarCamera = Camera.main ?? FindObjectOfType<Camera>();
        if (avatarCamera != null && avatarCamera.orthographic)
        {
            baseOrthographicSize = avatarCamera.orthographicSize;
        }
    }

    private void ApplyLookMode()
    {
        var official = lookMode == "official";
        RenderSettings.ambientLight = official
            ? new Color(0.34f, 0.33f, 0.315f, 1f)
            : new Color(0.30f, 0.29f, 0.275f, 1f);

        if (keyLight != null)
        {
            keyLight.intensity = official ? 1.52f : 1.42f;
        }
        if (fillLight != null)
        {
            fillLight.intensity = official ? 0.32f : 0.24f;
        }
        if (rimLight != null)
        {
            rimLight.intensity = official ? 0.42f : 0.34f;
        }

        foreach (var renderer in hairRenderers)
        {
            if (renderer == null)
            {
                continue;
            }

            var rendererName = renderer.name.ToLowerInvariant();
            if (!official)
            {
                renderer.enabled = false;
                continue;
            }

            if (IsAlwaysHiddenDenseHair(rendererName))
            {
                renderer.enabled = false;
                continue;
            }

            renderer.enabled = true;

            Material[] materials;
            if (!hairMaterials.TryGetValue(renderer, out materials))
            {
                continue;
            }

            foreach (var material in materials)
            {
                ConfigureHairLookMaterial(material, rendererName, official);
            }
        }
    }

    private static bool IsAlwaysHiddenDenseHair(string rendererName)
    {
        return rendererName.Contains("fibers71");
    }

    private static void ConfigureHairLookMaterial(Material material, string rendererName, bool official)
    {
        if (material == null || material.shader == null || material.shader.name != "Rewind/WebGL Hair")
        {
            return;
        }

        var materialName = material.name.ToLowerInvariant();
        var key = rendererName + " " + materialName;
        if (material.HasProperty("_Color"))
        {
            material.SetColor("_Color", official
                ? ResolveLookHairColor(key)
                : new Color(0.010f, 0.011f, 0.010f, 1f));
        }
        if (material.HasProperty("_AlphaBoost"))
        {
            material.SetFloat("_AlphaBoost", ResolveLookHairAlphaBoost(key, official));
        }
        if (material.HasProperty("_Cutoff"))
        {
            material.SetFloat("_Cutoff", official ? ResolveLookHairCutoff(key) : 0.048f);
        }
        if (material.HasProperty("_DitherAmount"))
        {
            material.SetFloat("_DitherAmount", official ? 0.04f : 0.18f);
        }
        if (material.HasProperty("_LightBoost"))
        {
            material.SetFloat("_LightBoost", official ? 1.24f : 1.12f);
        }
        if (material.HasProperty("_RimStrength"))
        {
            material.SetFloat("_RimStrength", official ? 0.10f : 0.12f);
        }
        if (material.HasProperty("_OutputAlpha"))
        {
            material.SetFloat("_OutputAlpha", ResolveLookHairOutputAlpha(key, official));
        }
    }

    private static Color ResolveLookHairColor(string key)
    {
        var name = key.ToLowerInvariant();
        if (name.Contains("_8_") || name.Contains("fibers71"))
        {
            return new Color(0.086f, 0.088f, 0.086f, 1f);
        }
        if (name.Contains("_4_") || name.Contains("_5_") || name.Contains("_6_") || name.Contains("_7_"))
        {
            return new Color(0.070f, 0.072f, 0.070f, 1f);
        }
        if (name.Contains("_0_") || name.Contains("_1_") || name.Contains("_2_"))
        {
            return new Color(0.074f, 0.076f, 0.074f, 1f);
        }
        return new Color(0.064f, 0.066f, 0.064f, 1f);
    }

    private static float ResolveLookHairAlphaBoost(string key, bool official)
    {
        var name = key.ToLowerInvariant();
        if (name.Contains("fibers71") || name.Contains("_8_"))
        {
            return official ? 0.36f : 0.18f;
        }
        if (name.Contains("_4_") || name.Contains("_5_") || name.Contains("_6_") || name.Contains("_7_"))
        {
            return official ? 1.22f : 0.08f;
        }
        if (name.Contains("_0_") || name.Contains("_1_") || name.Contains("_2_"))
        {
            return official ? (name.Contains("_0_") ? 1.05f : 0.78f) : 0.42f;
        }
        return official ? 0.64f : 0.34f;
    }

    private static float ResolveLookHairCutoff(string key)
    {
        var name = key.ToLowerInvariant();
        if (name.Contains("_8_") || name.Contains("fibers71"))
        {
            return 0.006f;
        }
        if (name.Contains("_0_") || name.Contains("_1_") || name.Contains("_2_"))
        {
            return 0.006f;
        }
        return 0.008f;
    }

    private static float ResolveLookHairOutputAlpha(string key, bool official)
    {
        if (!official)
        {
            return 0.30f;
        }

        var name = key.ToLowerInvariant();
        if (name.Contains("_8_") || name.Contains("fibers71"))
        {
            return 0.26f;
        }
        if (name.Contains("_0_") || name.Contains("_1_") || name.Contains("_2_"))
        {
            return name.Contains("_0_") ? 0.48f : 0.36f;
        }
        if (name.Contains("_4_") || name.Contains("_5_") || name.Contains("_6_") || name.Contains("_7_"))
        {
            return 0.46f;
        }
        return 0.36f;
    }

    private void RestoreRestPose()
    {
        foreach (var item in restPose)
        {
            item.Apply();
        }
    }

    private void ApplyFace()
    {
        foreach (var binding in blendBindings)
        {
            var value = GetBlendValue(binding.Channel) * 100f;
            binding.Renderer.SetBlendShapeWeight(binding.Index, Mathf.Clamp(value, 0f, 100f));
        }
        ApplyEyeOcclusionAlpha();
    }

    private void ApplyEyeOcclusionAlpha()
    {
        if (eyeOcclusionMaterials.Count == 0)
        {
            return;
        }

        var blink = Mathf.Max(current.blinkLeft, current.blinkRight);
        var alpha = Mathf.Clamp01(Shape01(blink, 0.18f, 0.74f) * 0.94f);
        foreach (var material in eyeOcclusionMaterials)
        {
            material.color = new Color(0.016f, 0.016f, 0.014f, alpha);
        }
    }

    private float GetBlendValue(BlendChannel channel)
    {
        switch (channel)
        {
            case BlendChannel.BlinkBoth:
                return Mathf.Clamp01(Shape01(Mathf.Max(current.blinkLeft, current.blinkRight), 0.03f, 0.70f) * 1.22f);
            case BlendChannel.BlinkLeft:
                return Mathf.Clamp01(Shape01(current.blinkLeft, 0.03f, 0.70f) * 1.24f);
            case BlendChannel.BlinkRight:
                return Mathf.Clamp01(Shape01(current.blinkRight, 0.03f, 0.70f) * 1.24f);
            case BlendChannel.SquintLeft:
                return Mathf.Clamp01(Shape01(current.blinkLeft, 0.08f, 0.72f) * 0.48f);
            case BlendChannel.SquintRight:
                return Mathf.Clamp01(Shape01(current.blinkRight, 0.08f, 0.72f) * 0.48f);
            case BlendChannel.MouthOpen:
                return Mathf.Clamp01(Shape01(current.mouthOpen, 0.085f, 0.82f) * 0.86f * faceAmplifier);
            case BlendChannel.SmileLeft:
            case BlendChannel.SmileRight:
                return Mathf.Clamp01(Shape01(current.smile, 0.12f, 0.86f) * 0.64f * faceAmplifier);
            case BlendChannel.Pucker:
                return Mathf.Clamp01(Shape01(current.mouthPucker, 0.14f, 0.82f) * 0.38f);
            case BlendChannel.WideLeft:
            case BlendChannel.WideRight:
                return Mathf.Clamp01(Shape01(current.mouthWide, 0.16f, 0.86f) * 0.24f);
            default:
                return 0f;
        }
    }

    private static float Shape01(float value, float min, float max)
    {
        return Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(min, max, value));
    }

    private void ApplyHead()
    {
        var chest = GetBone(HumanBodyBones.Chest, "CC_Base_Spine02");
        var neck = GetBone(HumanBodyBones.Neck, "CC_Base_NeckTwist01");
        var head = GetBone(HumanBodyBones.Head, "CC_Base_Head") ?? fallbackHead;
        var yaw = current.yaw * headYawDegrees;
        var pitch = current.pitch * headPitchDegrees;
        var roll = current.roll * headRollDegrees;

        RotateLocal(chest, pitch * 0.12f, yaw * 0.08f, roll * 0.08f);
        RotateLocal(neck, pitch * 0.34f, yaw * 0.30f, roll * 0.24f);
        RotateLocal(head, pitch * 0.54f, yaw * 0.62f, roll * 0.68f);
    }

    private void ApplyFraming()
    {
        if (avatarCamera == null || !avatarCamera.orthographic)
        {
            return;
        }

        var proximity = Mathf.Clamp(current.faceScale, -1f, 1f);
        var zoom = proximity >= 0f
            ? 1f - proximity * closeFaceZoom
            : 1f + -proximity * farFaceZoom;
        var targetSize = Mathf.Clamp(baseOrthographicSize * zoom, baseOrthographicSize * 0.62f, baseOrthographicSize * 1.28f);
        avatarCamera.orthographicSize = Mathf.Lerp(
            avatarCamera.orthographicSize,
            targetSize,
            1f - Mathf.Exp(-8f * Time.deltaTime));

        var avatarScale = proximity >= 0f
            ? 1f + proximity * 0.34f
            : 1f - -proximity * 0.18f;
        catRoot.transform.localScale = Vector3.Lerp(
            catRoot.transform.localScale,
            baseAvatarScale * Mathf.Clamp(avatarScale, 0.78f, 1.40f),
            1f - Mathf.Exp(-8f * Time.deltaTime));
    }

    private void ApplyHands()
    {
        var leftApplied = false;
        var rightApplied = false;
        if (bakedPoses.Count > 0)
        {
            leftApplied = ApplyWeightedBakedGesture(
                RigSide.Left,
                current.leftGesture,
                current.leftHandRaise,
                current.leftCoverMouth,
                current.leftCoverEyes);
            rightApplied = ApplyWeightedBakedGesture(
                RigSide.Right,
                current.rightGesture,
                current.rightHandRaise,
                current.rightCoverMouth,
                current.rightCoverEyes);
        }

        if (!leftApplied)
        {
            ApplyHand(RigSide.Left, current.leftGesture, current.leftHandRaise, current.leftCoverMouth, current.leftCoverEyes);
        }
        if (!rightApplied)
        {
            ApplyHand(RigSide.Right, current.rightGesture, current.rightHandRaise, current.rightCoverMouth, current.rightCoverEyes);
        }
    }

    private void CacheBakedPoses()
    {
        bakedPoses.Clear();
        var asset = Resources.Load<TextAsset>("rig-poses-unity");
        if (asset == null || string.IsNullOrWhiteSpace(asset.text))
        {
            Debug.LogWarning("Rewind baked pose JSON not found in Resources.");
            return;
        }

        var posesMatch = Regex.Match(asset.text, "\"poses\"\\s*:\\s*\\{(?<poses>.*?)\\n\\s*\\},\\s*\\n\\s*\"worldPoses\"", RegexOptions.Singleline);
        if (!posesMatch.Success)
        {
            Debug.LogWarning("Rewind baked pose JSON could not find poses block.");
            return;
        }

        var clipMatches = Regex.Matches(
            posesMatch.Groups["poses"].Value,
            "\"(?<clip>RigLab_[^\"]+)\"\\s*:\\s*\\{(?<body>.*?)\\n\\s*\\}",
            RegexOptions.Singleline);

        foreach (Match clipMatch in clipMatches)
        {
            var clipName = clipMatch.Groups["clip"].Value;
            var bones = new Dictionary<string, Quaternion>();
            var boneMatches = Regex.Matches(
                clipMatch.Groups["body"].Value,
                "\"(?<bone>CC_Base_[^\"]+)\"\\s*:\\s*\\[(?<x>[-+0-9.Ee]+),\\s*(?<y>[-+0-9.Ee]+),\\s*(?<z>[-+0-9.Ee]+),\\s*(?<w>[-+0-9.Ee]+)\\]");
            foreach (Match boneMatch in boneMatches)
            {
                bones[boneMatch.Groups["bone"].Value] = new Quaternion(
                    ParseFloat(boneMatch.Groups["x"].Value),
                    ParseFloat(boneMatch.Groups["y"].Value),
                    ParseFloat(boneMatch.Groups["z"].Value),
                    ParseFloat(boneMatch.Groups["w"].Value));
            }

            if (bones.Count > 0)
            {
                bakedPoses[clipName] = bones;
            }
        }

        Debug.Log("Rewind baked poses loaded: " + string.Join(", ", bakedPoses.Keys));
    }

    private bool ApplyBakedPose(string clipName)
    {
        if (string.IsNullOrEmpty(clipName) || clipName == "RigLab_Neutral")
        {
            return false;
        }

        Dictionary<string, Quaternion> pose;
        if (!bakedPoses.TryGetValue(clipName, out pose))
        {
            return false;
        }

        foreach (var entry in pose)
        {
            if (!IsArmPoseBone(entry.Key))
            {
                continue;
            }
            var bone = Find(entry.Key);
            if (bone != null)
            {
                bone.localRotation = entry.Value;
            }
        }
        return true;
    }

    private bool ApplyBakedPoseForSide(string clipName, RigSide side)
    {
        return ApplyBakedPoseForSide(clipName, side, 1f);
    }

    private bool ApplyBakedPoseForSide(string clipName, RigSide side, float weight)
    {
        Dictionary<string, Quaternion> pose;
        var clampedWeight = Mathf.Clamp01(weight);
        if (clampedWeight <= 0.001f || string.IsNullOrEmpty(clipName) || !bakedPoses.TryGetValue(clipName, out pose))
        {
            return false;
        }

        foreach (var entry in pose)
        {
            if (!IsArmPoseBoneForSide(entry.Key, side))
            {
                continue;
            }
            var bone = Find(entry.Key);
            if (bone != null)
            {
                bone.localRotation = Quaternion.Slerp(bone.localRotation, entry.Value, clampedWeight);
            }
        }
        return true;
    }

    private bool ApplyWeightedBakedGesture(RigSide side, string gesture, float raise, float coverMouth, float coverEyes)
    {
        var resolved = ResolveGesture(gesture, raise, coverMouth, coverEyes);
        if (resolved == RigGesture.Relaxed)
        {
            return false;
        }

        var clipName = ResolveBakedClipForGesture(side, resolved);
        return ApplyBakedPoseForSide(clipName, side, ResolveGestureWeight(gesture, raise, coverMouth, coverEyes, resolved));
    }

    private static string ResolveBakedClipForGesture(RigSide side, RigGesture gesture)
    {
        var prefix = side == RigSide.Left ? "RigLab_Left_" : "RigLab_Right_";
        switch (gesture)
        {
            case RigGesture.Raise:
                return prefix + "Raise";
            case RigGesture.CoverMouth:
                return prefix + "Mouth";
            case RigGesture.CoverEyes:
                return prefix + "Eyes";
            default:
                return prefix + "Relaxed";
        }
    }

    private static float ResolveGestureWeight(string gesture, float raise, float coverMouth, float coverEyes, RigGesture resolved)
    {
        var normalized = (gesture ?? string.Empty).ToLowerInvariant();
        var score = 0f;
        switch (resolved)
        {
            case RigGesture.Raise:
                score = raise;
                break;
            case RigGesture.CoverMouth:
                score = coverMouth;
                break;
            case RigGesture.CoverEyes:
                score = coverEyes;
                break;
        }

        if (score <= 0.001f &&
            ((resolved == RigGesture.Raise && normalized == "raise") ||
             (resolved == RigGesture.CoverMouth && normalized == "mouth") ||
             (resolved == RigGesture.CoverEyes && (normalized == "eyes" || normalized == "eye"))))
        {
            score = 1f;
        }

        var weight = Shape01(score, 0.12f, 0.82f);
        return resolved == RigGesture.Raise ? Mathf.Min(weight, 0.72f) : Mathf.Min(weight, 0.90f);
    }

    private static string ResolveBakedClip(RigSide side, string gesture, float raise, float coverMouth, float coverEyes)
    {
        var prefix = side == RigSide.Left ? "RigLab_Left_" : "RigLab_Right_";
        switch (ResolveGesture(gesture, raise, coverMouth, coverEyes))
        {
            case RigGesture.Raise:
                return prefix + "Raise";
            case RigGesture.CoverMouth:
                return prefix + "Mouth";
            case RigGesture.CoverEyes:
                return prefix + "Eyes";
            default:
                return prefix + "Relaxed";
        }
    }

    private static bool IsArmPoseBone(string boneName)
    {
        return IsArmPoseBoneForSide(boneName, RigSide.Left) || IsArmPoseBoneForSide(boneName, RigSide.Right);
    }

    private static bool IsArmPoseBoneForSide(string boneName, RigSide side)
    {
        var prefix = side == RigSide.Left ? "CC_Base_L_" : "CC_Base_R_";
        if (string.IsNullOrEmpty(boneName) || !boneName.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }

        var suffix = boneName.Substring(prefix.Length);
        if (
            suffix == "Clavicle" ||
            suffix == "Upperarm" ||
            suffix == "Forearm" ||
            suffix == "Hand" ||
            suffix.StartsWith("UpperarmTwist", StringComparison.Ordinal) ||
            suffix.StartsWith("ForearmTwist", StringComparison.Ordinal))
        {
            return true;
        }

        return Regex.IsMatch(suffix, "^(Thumb|Index|Mid|Ring|Pinky)[123]$");
    }

    private static float ParseFloat(string value)
    {
        return float.Parse(value, CultureInfo.InvariantCulture);
    }

    private void ApplyHand(RigSide side, string gesture, float raise, float coverMouth, float coverEyes)
    {
        var isLeft = side == RigSide.Left;
        var upper = GetBone(isLeft ? HumanBodyBones.LeftUpperArm : HumanBodyBones.RightUpperArm, isLeft ? "CC_Base_L_Upperarm" : "CC_Base_R_Upperarm");
        var forearm = GetBone(isLeft ? HumanBodyBones.LeftLowerArm : HumanBodyBones.RightLowerArm, isLeft ? "CC_Base_L_Forearm" : "CC_Base_R_Forearm");
        var hand = GetBone(isLeft ? HumanBodyBones.LeftHand : HumanBodyBones.RightHand, isLeft ? "CC_Base_L_Hand" : "CC_Base_R_Hand");
        var clavicle = GetBone(isLeft ? HumanBodyBones.LeftShoulder : HumanBodyBones.RightShoulder, isLeft ? "CC_Base_L_Clavicle" : "CC_Base_R_Clavicle");
        var head = GetBone(HumanBodyBones.Head, "CC_Base_Head") ?? fallbackHead;
        if (upper == null || forearm == null || hand == null || head == null)
        {
            return;
        }

        var resolvedGesture = ResolveGesture(gesture, raise, coverMouth, coverEyes);
        var spine = GetBone(HumanBodyBones.Chest, "CC_Base_Spine02") ?? catRoot.transform;
        var sideDir = upper.position - spine.position;
        sideDir.y = 0f;
        sideDir.z = 0f;
        if (sideDir.sqrMagnitude < 0.00001f)
        {
            sideDir = isLeft ? Vector3.left : Vector3.right;
        }
        sideDir.Normalize();

        var up = Vector3.up;
        var front = catRoot.transform.forward;
        var shoulder = upper.position;
        var eyeCenter = GetEyeCenter(head);
        var mouthCenter = eyeCenter + Vector3.down * 0.048f + front * 0.030f;
        var eyeCoverCenter = eyeCenter + front * 0.030f + Vector3.down * 0.004f;

        var target = hand.position;
        var pole = shoulder + sideDir * 0.09f + up * 0.02f + front * 0.08f;
        var focus = mouthCenter;

        switch (resolvedGesture)
        {
            case RigGesture.Raise:
                var raiseAmount = Mathf.Clamp01(Shape01(raise, 0.04f, 0.92f));
                var handX = isLeft ? current.leftHandX : current.rightHandX;
                var handY = isLeft ? current.leftHandY : current.rightHandY;
                var relaxedTarget = shoulder + sideDir * 0.042f + up * -0.205f + front * -0.004f;
                var relaxedPole = shoulder + sideDir * 0.052f + up * -0.100f + front * 0.085f;
                var raisedTarget = shoulder
                    + sideDir * (0.078f + Mathf.Clamp(Mathf.Abs(handX), 0f, 1f) * 0.016f)
                    + up * (0.200f + Mathf.Clamp(handY, -0.2f, 1f) * 0.040f)
                    + front * -0.035f;
                var raisedPole = shoulder + sideDir * 0.090f + up * 0.132f + front * 0.030f;
                target = Vector3.Lerp(relaxedTarget, raisedTarget, raiseAmount);
                pole = Vector3.Lerp(relaxedPole, raisedPole, raiseAmount);
                focus = target + up * 0.06f;
                break;
            case RigGesture.CoverMouth:
                target = mouthCenter + sideDir * 0.035f + up * -0.020f + front * -0.030f;
                pole = shoulder + sideDir * 0.100f + up * 0.012f + front * 0.072f;
                focus = mouthCenter;
                break;
            case RigGesture.CoverEyes:
                target = shoulder + up * 0.060f + front * 0.040f;
                pole = shoulder + sideDir * 0.086f + up * 0.070f + front * 0.080f;
                focus = eyeCoverCenter;
                break;
            default:
                target = shoulder + sideDir * 0.060f + up * -0.255f + front * 0.045f;
                pole = shoulder + sideDir * 0.070f + up * -0.125f + front * 0.125f;
                break;
        }

        if (clavicle != null)
        {
            var clavicleAim = Quaternion.FromToRotation(upper.position - clavicle.position, target - clavicle.position);
            var weight = resolvedGesture == RigGesture.Raise ? 0.30f : resolvedGesture == RigGesture.Relaxed ? 0.02f : 0.42f;
            clavicle.rotation = Quaternion.Slerp(clavicle.rotation, clavicleAim * clavicle.rotation, weight);
        }

        SolveTwoBoneIk(upper, forearm, hand, target, pole);
        PoseHand(hand, side, resolvedGesture);
        OrientHand(hand, side, resolvedGesture, focus);
        PoseFingers(side, resolvedGesture);
    }

    private static RigGesture ResolveGesture(string gesture, float raise, float coverMouth, float coverEyes)
    {
        var normalized = (gesture ?? string.Empty).ToLowerInvariant();
        if (normalized == "mouth" || coverMouth > 0.18f)
        {
            return RigGesture.CoverMouth;
        }
        if (normalized == "eyes" || normalized == "eye" || coverEyes > 0.18f)
        {
            return RigGesture.CoverEyes;
        }
        if (normalized == "raise" || raise > 0.04f)
        {
            return RigGesture.Raise;
        }
        return RigGesture.Relaxed;
    }

    private Vector3 GetEyeCenter(Transform head)
    {
        var left = GetBone(HumanBodyBones.LeftEye, "CC_Base_L_Eye");
        var right = GetBone(HumanBodyBones.RightEye, "CC_Base_R_Eye");
        if (left != null && right != null)
        {
            return (left.position + right.position) * 0.5f;
        }
        return head.position + Vector3.up * 0.055f + catRoot.transform.forward * 0.02f;
    }

    private void SolveTwoBoneIk(Transform upper, Transform forearm, Transform hand, Vector3 rawTarget, Vector3 pole)
    {
        var root = upper.position;
        var elbow = forearm.position;
        var wrist = hand.position;
        var upperLen = Vector3.Distance(root, elbow);
        var foreLen = Vector3.Distance(elbow, wrist);
        var maxReach = Mathf.Max(upperLen + foreLen - 0.002f, 0.001f);
        var minReach = Mathf.Max(Mathf.Abs(upperLen - foreLen) + 0.002f, 0.001f);
        var targetVector = rawTarget - root;
        if (targetVector.sqrMagnitude < 0.000001f)
        {
            return;
        }

        var distance = Mathf.Clamp(targetVector.magnitude, minReach, maxReach);
        var targetPoint = root + targetVector.normalized * distance;
        var rootToTarget = (targetPoint - root).normalized;
        var poleDir = pole - root;
        poleDir -= Vector3.Project(poleDir, rootToTarget);
        if (poleDir.sqrMagnitude < 0.00001f)
        {
            poleDir = Vector3.Cross(rootToTarget, Vector3.forward);
        }
        poleDir.Normalize();

        var along = (upperLen * upperLen + distance * distance - foreLen * foreLen) / (2f * distance);
        var height = Mathf.Sqrt(Mathf.Max(upperLen * upperLen - along * along, 0f));
        var desiredElbow = root + rootToTarget * along + poleDir * height;

        RotateChildDirection(upper, forearm, desiredElbow - root);
        RotateChildDirection(forearm, hand, targetPoint - forearm.position);
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
        var sign = side == RigSide.Left ? -1f : 1f;
        if (gesture == RigGesture.Raise)
        {
            hand.localRotation *= Quaternion.Euler(-2f, sign * -8f, sign * 8f);
        }
        else if (gesture == RigGesture.CoverMouth || gesture == RigGesture.CoverEyes)
        {
            hand.localRotation *= Quaternion.Euler(-8f, sign * -16f, sign * 5f);
        }
        else
        {
            hand.localRotation *= Quaternion.Euler(6f, sign * -3f, sign * -6f);
        }
    }

    private void OrientHand(Transform hand, RigSide side, RigGesture gesture, Vector3 focus)
    {
        if (gesture == RigGesture.Relaxed)
        {
            return;
        }

        var prefix = side == RigSide.Left ? "CC_Base_L_" : "CC_Base_R_";
        var fingerRoots = new[]
        {
            Find(prefix + "Index1"),
            Find(prefix + "Mid1"),
            Find(prefix + "Ring1"),
            Find(prefix + "Pinky1")
        }.Where(t => t != null).ToArray();

        if (fingerRoots.Length == 0)
        {
            return;
        }

        var center = Vector3.zero;
        foreach (var finger in fingerRoots)
        {
            center += finger.position;
        }
        center /= fingerRoots.Length;

        var currentDirection = center - hand.position;
        if (currentDirection.sqrMagnitude < 0.000001f)
        {
            return;
        }

        var sideDir = side == RigSide.Left ? Vector3.left : Vector3.right;
        var desired = gesture == RigGesture.Raise
            ? (Vector3.up * 1.00f + sideDir * 0.08f + catRoot.transform.forward * 0.14f)
            : (focus + catRoot.transform.forward * 0.050f) - hand.position;

        var rotation = Quaternion.FromToRotation(currentDirection.normalized, desired.normalized);
        hand.rotation = Quaternion.Slerp(hand.rotation, rotation * hand.rotation, gesture == RigGesture.Raise ? 0.72f : 1f);
    }

    private void PoseFingers(RigSide side, RigGesture gesture)
    {
        var prefix = side == RigSide.Left ? "CC_Base_L_" : "CC_Base_R_";
        var curl = gesture == RigGesture.Raise ? 2f : gesture == RigGesture.Relaxed ? 0.5f : 5f;
        foreach (var finger in new[] { "Thumb", "Index", "Mid", "Ring", "Pinky" })
        {
            for (var i = 1; i <= 3; i++)
            {
                var bone = Find(prefix + finger + i);
                if (bone != null)
                {
                    bone.localRotation *= Quaternion.Euler(curl, 0f, 0f);
                }
            }
        }
    }

    private Transform GetBone(HumanBodyBones humanBone, string fallbackName)
    {
        var named = Find(fallbackName);
        if (named != null)
        {
            return named;
        }

        Transform bone;
        if (humanBones.TryGetValue(humanBone, out bone) && bone != null)
        {
            return bone;
        }
        return null;
    }

    private Transform Find(string boneName)
    {
        return restPose.Select(r => r.Transform).FirstOrDefault(t => t.name == boneName);
    }

    private static void RotateLocal(Transform bone, float pitch, float yaw, float roll)
    {
        if (bone == null)
        {
            return;
        }
        bone.localRotation *= Quaternion.Euler(pitch, yaw, roll);
    }

    [Serializable]
    public sealed class TrackingPacket
    {
        public float mouthOpen;
        public float mouthPucker;
        public float mouthWide;
        public float smile;
        public float blinkLeft;
        public float blinkRight;
        public float yaw;
        public float pitch;
        public float roll;
        public float faceScale;
        public float leftHandRaise;
        public float rightHandRaise;
        public float leftHandX;
        public float rightHandX;
        public float leftHandY;
        public float rightHandY;
        public float leftCoverMouth;
        public float rightCoverMouth;
        public float leftCoverEyes;
        public float rightCoverEyes;
        public string leftGesture = "";
        public string rightGesture = "";
        public string poseClip = "";

        public void Reset()
        {
            CopyFrom(new TrackingPacket());
        }

        public void CopyFrom(TrackingPacket other)
        {
            mouthOpen = other.mouthOpen;
            mouthPucker = other.mouthPucker;
            mouthWide = other.mouthWide;
            smile = other.smile;
            blinkLeft = other.blinkLeft;
            blinkRight = other.blinkRight;
            yaw = other.yaw;
            pitch = other.pitch;
            roll = other.roll;
            faceScale = other.faceScale;
            leftHandRaise = other.leftHandRaise;
            rightHandRaise = other.rightHandRaise;
            leftHandX = other.leftHandX;
            rightHandX = other.rightHandX;
            leftHandY = other.leftHandY;
            rightHandY = other.rightHandY;
            leftCoverMouth = other.leftCoverMouth;
            rightCoverMouth = other.rightCoverMouth;
            leftCoverEyes = other.leftCoverEyes;
            rightCoverEyes = other.rightCoverEyes;
            leftGesture = other.leftGesture ?? "";
            rightGesture = other.rightGesture ?? "";
            poseClip = other.poseClip ?? "";
        }

        public void LerpTo(TrackingPacket other, float alpha)
        {
            mouthOpen = Mathf.Lerp(mouthOpen, other.mouthOpen, alpha);
            mouthPucker = Mathf.Lerp(mouthPucker, other.mouthPucker, alpha);
            mouthWide = Mathf.Lerp(mouthWide, other.mouthWide, alpha);
            smile = Mathf.Lerp(smile, other.smile, alpha);
            blinkLeft = Mathf.Lerp(blinkLeft, other.blinkLeft, alpha);
            blinkRight = Mathf.Lerp(blinkRight, other.blinkRight, alpha);
            yaw = Mathf.Lerp(yaw, other.yaw, alpha);
            pitch = Mathf.Lerp(pitch, other.pitch, alpha);
            roll = Mathf.Lerp(roll, other.roll, alpha);
            faceScale = Mathf.Lerp(faceScale, other.faceScale, alpha);
            leftHandRaise = Mathf.Lerp(leftHandRaise, other.leftHandRaise, alpha);
            rightHandRaise = Mathf.Lerp(rightHandRaise, other.rightHandRaise, alpha);
            leftHandX = Mathf.Lerp(leftHandX, other.leftHandX, alpha);
            rightHandX = Mathf.Lerp(rightHandX, other.rightHandX, alpha);
            leftHandY = Mathf.Lerp(leftHandY, other.leftHandY, alpha);
            rightHandY = Mathf.Lerp(rightHandY, other.rightHandY, alpha);
            leftCoverMouth = Mathf.Lerp(leftCoverMouth, other.leftCoverMouth, alpha);
            rightCoverMouth = Mathf.Lerp(rightCoverMouth, other.rightCoverMouth, alpha);
            leftCoverEyes = Mathf.Lerp(leftCoverEyes, other.leftCoverEyes, alpha);
            rightCoverEyes = Mathf.Lerp(rightCoverEyes, other.rightCoverEyes, alpha);
            leftGesture = other.leftGesture ?? "";
            rightGesture = other.rightGesture ?? "";
            poseClip = other.poseClip ?? "";
        }
    }

    private sealed class RestTransform
    {
        public readonly Transform Transform;
        private readonly Vector3 localPosition;
        private readonly Quaternion localRotation;
        private readonly Vector3 localScale;

        public RestTransform(Transform transform)
        {
            Transform = transform;
            localPosition = transform.localPosition;
            localRotation = transform.localRotation;
            localScale = transform.localScale;
        }

        public void Apply()
        {
            Transform.localPosition = localPosition;
            Transform.localRotation = localRotation;
            Transform.localScale = localScale;
        }
    }

    private sealed class BlendBinding
    {
        public readonly SkinnedMeshRenderer Renderer;
        public readonly int Index;
        public readonly BlendChannel Channel;
        public readonly string Name;

        public BlendBinding(SkinnedMeshRenderer renderer, int index, BlendChannel channel, string name)
        {
            Renderer = renderer;
            Index = index;
            Channel = channel;
            Name = name;
        }
    }

    private enum BlendChannel
    {
        None,
        BlinkBoth,
        BlinkLeft,
        BlinkRight,
        SquintLeft,
        SquintRight,
        MouthOpen,
        SmileLeft,
        SmileRight,
        Pucker,
        WideLeft,
        WideRight
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
}
