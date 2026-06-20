#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class RewindWebBuild
{
    private const string ModelPath = "Assets/Cat/Cat.Fbx";
    private const string ScenePath = "Assets/RewindWebGL/RewindAvatarScene.unity";
    private const string BakedPoseSourcePath = "E:/CreativeCoding/Rewind/public/assets/cat/rig-poses-unity.json";
    private const string BakedPoseAssetPath = "Assets/RewindWebGL/Resources/rig-poses-unity.json";
    private const string GeneratedHairFolder = "Assets/RewindWebGL/GeneratedHair";
    private const string HairShaderSourcePath = "E:/CreativeCoding/Rewind/tools/unity/RewindWebHair.shader";
    private const string HairShaderAssetPath = "Assets/RewindWebGL/RewindWebHair.shader";
    private const string SkinShaderSourcePath = "E:/CreativeCoding/Rewind/tools/unity/RewindWebCatSkin.shader";
    private const string SkinShaderAssetPath = "Assets/RewindWebGL/RewindWebCatSkin.shader";
    private const string FurMapFolder = "E:/CreativeCoding/Rewind/public/assets/cat/Fur_Maps";
    private const string OutputPath = "E:/CreativeCoding/Rewind/public/unity/rewind-avatar";
    private const string LogPath = "E:/CreativeCoding/Rewind/.tmp/diagnostics/unity-webgl-build.log";
    private static readonly Dictionary<string, Texture2D> GeneratedHairCache = new Dictionary<string, Texture2D>();

    [MenuItem("Rewind/Build WebGL Avatar")]
    public static void BuildWebGLFromMenu()
    {
        BuildWebGL(false);
    }

    public static void BuildWebGLBatch()
    {
        var ok = BuildWebGL(true);
        EditorApplication.Exit(ok ? 0 : 1);
    }

    private static bool BuildWebGL(bool batch)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
        var log = new System.Text.StringBuilder();
        try
        {
            log.AppendLine("Rewind Unity WebGL build " + DateTime.Now.ToString("O"));
            ConfigureModelImporter(log);
            ConfigureTextureImporters(log);
            CopyBakedPoseJson(log);
            EnsureHairShaderAsset(log);
            EnsureSkinShaderAsset(log);
            var scene = CreateScene(log);
            EditorSceneManager.SaveScene(scene, ScenePath);
            ConfigurePlayerSettings();

            if (Directory.Exists(OutputPath))
            {
                Directory.Delete(OutputPath, true);
            }
            Directory.CreateDirectory(OutputPath);

            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = OutputPath,
                target = BuildTarget.WebGL,
                options = BuildOptions.None
            };
            var report = BuildPipeline.BuildPlayer(options);
            log.AppendLine("Build result: " + report.summary.result);
            log.AppendLine("Output: " + OutputPath);
            File.WriteAllText(LogPath, log.ToString());
            AssetDatabase.Refresh();
            return report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded;
        }
        catch (Exception ex)
        {
            log.AppendLine(ex.ToString());
            File.WriteAllText(LogPath, log.ToString());
            Debug.LogError(ex);
            if (!batch)
            {
                EditorUtility.DisplayDialog("Rewind WebGL build failed", ex.Message, "OK");
            }
            return false;
        }
    }

    private static void ConfigureModelImporter(System.Text.StringBuilder log)
    {
        var importer = AssetImporter.GetAtPath(ModelPath) as ModelImporter;
        if (importer == null)
        {
            throw new InvalidOperationException("ModelImporter not found: " + ModelPath);
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
            log.AppendLine("Reimporting Cat.Fbx for WebGL humanoid runtime.");
            importer.SaveAndReimport();
        }
        else
        {
            log.AppendLine("Cat.Fbx importer already ready.");
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

    private static Scene CreateScene(System.Text.StringBuilder log)
    {
        EnsureFolder("Assets", "RewindWebGL");
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var model = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
        if (model == null)
        {
            throw new InvalidOperationException("Missing model: " + ModelPath);
        }

        var cat = (GameObject)PrefabUtility.InstantiatePrefab(model, scene);
        cat.name = "RewindCat";
        cat.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
        cat.transform.localScale = Vector3.one;

        var animator = cat.GetComponent<Animator>();
        if (animator == null)
        {
            animator = cat.AddComponent<Animator>();
        }
        animator.avatar = AssetDatabase.LoadAllAssetsAtPath(ModelPath).OfType<Avatar>().FirstOrDefault();
        animator.applyRootMotion = false;
        animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
        if (animator.avatar == null || !animator.avatar.isHuman || !animator.avatar.isValid)
        {
            throw new InvalidOperationException("Cat avatar is not a valid Humanoid avatar.");
        }

        PrepareMeshes(cat, log);
        CenterAndScale(cat);

        var controllerGo = new GameObject("RewindAvatar");
        SceneManager.MoveGameObjectToScene(controllerGo, scene);
        var controller = controllerGo.AddComponent<RewindWebAvatarController>();
        controller.catRoot = cat;
        controller.smoothing = 14f;

        CreateCamera(cat);
        CreateLights();
        RenderSettings.ambientLight = new Color(0.30f, 0.29f, 0.275f, 1f);
        RenderSettings.fog = false;
        return scene;
    }

    private static void EnsureFolder(string parent, string child)
    {
        var path = parent + "/" + child;
        if (!AssetDatabase.IsValidFolder(path))
        {
            AssetDatabase.CreateFolder(parent, child);
        }
    }

    private static void CopyBakedPoseJson(System.Text.StringBuilder log)
    {
        EnsureFolder("Assets", "RewindWebGL");
        EnsureFolder("Assets/RewindWebGL", "Resources");
        if (!File.Exists(BakedPoseSourcePath))
        {
            log.AppendLine("Baked pose JSON missing: " + BakedPoseSourcePath);
            return;
        }

        File.Copy(BakedPoseSourcePath, BakedPoseAssetPath, true);
        AssetDatabase.ImportAsset(BakedPoseAssetPath);
        log.AppendLine("Copied baked pose JSON: " + BakedPoseAssetPath);
    }

    private static void EnsureHairShaderAsset(System.Text.StringBuilder log)
    {
        EnsureFolder("Assets", "RewindWebGL");
        if (!File.Exists(HairShaderSourcePath))
        {
            log.AppendLine("Hair shader source missing: " + HairShaderSourcePath);
            return;
        }

        File.Copy(HairShaderSourcePath, HairShaderAssetPath, true);
        AssetDatabase.ImportAsset(HairShaderAssetPath, ImportAssetOptions.ForceUpdate);
        log.AppendLine("Copied WebGL hair shader: " + HairShaderAssetPath);
    }

    private static void EnsureSkinShaderAsset(System.Text.StringBuilder log)
    {
        EnsureFolder("Assets", "RewindWebGL");
        if (!File.Exists(SkinShaderSourcePath))
        {
            log.AppendLine("Skin shader source missing: " + SkinShaderSourcePath);
            return;
        }

        File.Copy(SkinShaderSourcePath, SkinShaderAssetPath, true);
        AssetDatabase.ImportAsset(SkinShaderAssetPath, ImportAssetOptions.ForceUpdate);
        log.AppendLine("Copied WebGL skin shader: " + SkinShaderAssetPath);
    }

    private static void PrepareMeshes(GameObject cat, System.Text.StringBuilder log)
    {
        foreach (var renderer in cat.GetComponentsInChildren<Renderer>(true))
        {
            var lower = renderer.name.ToLowerInvariant();
            if (
                lower.Contains("diaper") ||
                lower.Contains("pincaps") ||
                lower.Contains("metalpins") ||
                lower.Contains("tearline"))
            {
                renderer.enabled = false;
                log.AppendLine("Hidden mesh: " + renderer.name);
            }

            if (ShouldHideDenseBodyHair(renderer.name))
            {
                renderer.enabled = false;
                log.AppendLine("Hidden dense body hair: " + renderer.name);
            }

            var skinned = renderer as SkinnedMeshRenderer;
            if (skinned != null)
            {
                skinned.updateWhenOffscreen = true;
                skinned.skinnedMotionVectors = false;
                skinned.quality = SkinQuality.Bone4;
            }

            var materials = renderer.sharedMaterials
                .Select(material => material == null ? null : new Material(material))
                .ToArray();
            renderer.sharedMaterials = materials;

            foreach (var material in materials)
            {
                if (material == null)
                {
                    continue;
                }
                var materialProbeName = (material.name + " " + renderer.name).ToLowerInvariant();
                if (IsHairMaterial(materialProbeName))
                {
                    log.AppendLine(
                        "Hair renderer: " + renderer.name +
                        " material=" + material.name +
                        " center=" + renderer.bounds.center +
                        " size=" + renderer.bounds.size);
                }
                ConfigureMaterial(material, renderer.name);
            }
        }
    }

    private static void ConfigureMaterial(Material material, string rendererName)
    {
        var name = (material.name + " " + rendererName).ToLowerInvariant();
        if (name.Contains("eye_occlusion") || name.Contains("eyeocclusion"))
        {
            ConfigureEyeOcclusionMaterial(material);
            return;
        }

        if (IsHairMaterial(name))
        {
            ConfigureHairMaterial(material, name);
            return;
        }

        if (name.Contains("eyelash"))
        {
            ConfigureEyelashMaterial(material);
            return;
        }

        if (name.Contains("cornea"))
        {
            ConfigureCorneaMaterial(material);
            return;
        }

        if (name.Contains("eye") && !name.Contains("occlusion") && !name.Contains("eyelash"))
        {
            var eyeTexture = ResolveOfficialEyeTexture();
            material.SetTexture("_MainTex", eyeTexture);
            material.SetTexture("_BumpMap", LoadTexture("Assets/Cat/Cat.fbm/Eye_Pbr_Normal.png"));
            material.EnableKeyword("_NORMALMAP");
            material.color = Color.white;
            material.SetTexture("_EmissionMap", eyeTexture);
            material.SetColor("_EmissionColor", new Color(0.34f, 0.275f, 0.050f, 1f));
            material.EnableKeyword("_EMISSION");
            material.SetFloat("_Glossiness", 0.82f);
            material.SetFloat("_Metallic", 0f);
            return;
        }

        if (name.Contains("tongue"))
        {
            material.SetTexture("_MainTex", LoadTexture("Assets/Cat/Cat.fbm/Std_Tongue_Pbr_Diffuse.png"));
            material.SetTexture("_BumpMap", LoadTexture("Assets/Cat/Cat.fbm/Std_Tongue_Pbr_Normal.png"));
            material.EnableKeyword("_NORMALMAP");
            material.color = name.Contains("head") ? new Color(0.84f, 0.84f, 0.84f, 1f) : Color.white;
            material.SetFloat("_Glossiness", 0.22f);
            return;
        }

        if (name.Contains("teeth"))
        {
            var lower = name.Contains("lower");
            material.SetTexture("_MainTex", LoadTexture(lower
                ? "Assets/Cat/Cat.fbm/Std_Lower_Teeth_Pbr_Diffuse.jpg"
                : "Assets/Cat/Cat.fbm/Std_Upper_Teeth_Pbr_Diffuse.jpg"));
            material.SetTexture("_BumpMap", LoadTexture(lower
                ? "Assets/Cat/Cat.fbm/Std_Lower_Teeth_Pbr_Normal.png"
                : "Assets/Cat/Cat.fbm/Std_Upper_Teeth_Pbr_Normal.png"));
            material.EnableKeyword("_NORMALMAP");
            material.color = Color.white;
            material.SetFloat("_Glossiness", 0.22f);
            return;
        }

        var blackTexture = GetBlackCatTexture(name);
        if (blackTexture != null)
        {
            var skinShader = Shader.Find("Rewind/WebGL Cat Skin");
            if (skinShader != null)
            {
                material.shader = skinShader;
                material.SetColor("_Color", Color.white);
                material.SetFloat("_LightFloor", name.Contains("head") ? 0.88f : 0.78f);
                material.SetFloat("_LightRange", name.Contains("head") ? 0.15f : 0.26f);
                material.SetFloat("_RimSoftness", name.Contains("head") ? 0.010f : 0.012f);
            }
            material.SetTexture("_MainTex", ResolveWebBlackCatTexture(name, blackTexture));
            material.color = Color.white;
            material.SetFloat("_Glossiness", 0.040f);
            material.SetFloat("_Metallic", 0f);
            if (material.HasProperty("_SpecularHighlights"))
            {
                material.SetFloat("_SpecularHighlights", 0f);
            }
            if (material.HasProperty("_GlossyReflections"))
            {
                material.SetFloat("_GlossyReflections", 0f);
            }
            var normal = GetBlackCatNormal(name);
            if (normal != null)
            {
                material.SetTexture("_BumpMap", normal);
                material.EnableKeyword("_NORMALMAP");
                if (material.HasProperty("_BumpScale"))
                {
                    material.SetFloat("_BumpScale", name.Contains("head") ? 0.26f : 0.62f);
                }
            }
        }
        else
        {
            material.SetFloat("_Glossiness", Mathf.Min(material.HasProperty("_Glossiness") ? material.GetFloat("_Glossiness") : 0.4f, 0.42f));
        }
    }

    private static bool IsHairMaterial(string name)
    {
        return name.Contains("fibers") || name.Contains("gozmesh_import_material");
    }

    private static bool ShouldHideDenseBodyHair(string rendererName)
    {
        var name = rendererName.ToLowerInvariant();
        return
            name.Contains("fibers71");
    }

    private static void ConfigureHairMaterial(Material material, string materialKey)
    {
        var lowerName = material.name.ToLowerInvariant();
        var customShader = Shader.Find("Rewind/WebGL Hair");
        if (customShader != null)
        {
            material.shader = customShader;
            material.SetTexture("_MainTex", IsBodyFuzzLayer(lowerName) ? ResolveHairRgbaTexture(lowerName) : ResolveHairTexture(lowerName));
            material.SetColor("_Color", ResolveHairShaderColor(materialKey));
            material.SetFloat("_AlphaBoost", ResolveHairAlphaBoost(materialKey));
            material.SetFloat("_Cutoff", ResolveHairShaderCutoff(materialKey));
            material.SetFloat("_DitherAmount", ResolveHairDitherAmount(materialKey));
            material.SetFloat("_LightBoost", ResolveHairLightBoost(materialKey));
            material.SetFloat("_RimStrength", ResolveHairRimStrength(materialKey));
            material.SetFloat("_OutputAlpha", ResolveHairOutputAlpha(materialKey));
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent - 40 + ResolveHairQueueOffset(materialKey);
            return;
        }

        var shader = Shader.Find("Standard");
        if (shader != null)
        {
            material.shader = shader;
        }
        material.SetTexture("_MainTex", ResolveHairRgbaTexture(lowerName));
        material.color = Color.white;
        material.SetFloat("_Mode", 3f);
        material.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
        material.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
        material.SetInt("_ZWrite", 0);
        material.DisableKeyword("_ALPHATEST_ON");
        material.EnableKeyword("_ALPHABLEND_ON");
        material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
        material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent - 30;
        material.SetFloat("_Cutoff", 0.01f);
        material.SetInt("_Cull", (int)UnityEngine.Rendering.CullMode.Off);
        material.SetFloat("_Glossiness", 0.025f);
        material.SetFloat("_Metallic", 0f);
        if (material.HasProperty("_SpecularHighlights"))
        {
            material.SetFloat("_SpecularHighlights", 0f);
        }
        if (material.HasProperty("_GlossyReflections"))
        {
            material.SetFloat("_GlossyReflections", 0f);
        }
    }

    private static Color ResolveHairShaderColor(string materialKey)
    {
        var name = materialKey.ToLowerInvariant();
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

    private static float ResolveHairAlphaBoost(string materialKey)
    {
        var name = materialKey.ToLowerInvariant();
        if (name.Contains("_8_") || name.Contains("fibers71"))
        {
            return 0.36f;
        }
        if (name.Contains("_0_") || name.Contains("_1_") || name.Contains("_2_"))
        {
            return name.Contains("_0_") ? 1.05f : 0.78f;
        }
        if (name.Contains("_4_") || name.Contains("_5_") || name.Contains("_6_") || name.Contains("_7_"))
        {
            return 1.22f;
        }
        return 0.64f;
    }

    private static float ResolveHairShaderCutoff(string materialKey)
    {
        var name = materialKey.ToLowerInvariant();
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

    private static float ResolveHairDitherAmount(string materialKey)
    {
        var name = materialKey.ToLowerInvariant();
        if (name.Contains("_8_") || name.Contains("fibers71"))
        {
            return 0.04f;
        }
        return 0.04f;
    }

    private static float ResolveHairLightBoost(string materialKey)
    {
        var name = materialKey.ToLowerInvariant();
        return name.Contains("_8_") || name.Contains("fibers71") ? 1.18f : 1.28f;
    }

    private static float ResolveHairRimStrength(string materialKey)
    {
        var name = materialKey.ToLowerInvariant();
        return name.Contains("_8_") || name.Contains("fibers71") ? 0.10f : 0.18f;
    }

    private static float ResolveHairOutputAlpha(string materialKey)
    {
        var name = materialKey.ToLowerInvariant();
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

    private static int ResolveHairQueueOffset(string materialKey)
    {
        var name = materialKey.ToLowerInvariant();
        if (name.Contains("_8_") || name.Contains("fibers71"))
        {
            return 10;
        }
        if (name.Contains("_0_") || name.Contains("_1_") || name.Contains("_2_"))
        {
            return 24;
        }
        return 18;
    }

    private static Texture2D ResolveHairRgbaTexture(string materialName)
    {
        var alphaPath = ResolveHairAlphaPath(materialName);
        var cacheKey = "officialEdgeSoft3|" + alphaPath + "|" + ResolveHairOpacity(materialName).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
        Texture2D cached;
        if (GeneratedHairCache.TryGetValue(cacheKey, out cached) && cached != null)
        {
            return cached;
        }

        if (!File.Exists(alphaPath))
        {
            return ResolveHairTexture(materialName);
        }

        EnsureFolder("Assets", "RewindWebGL");
        EnsureFolder("Assets/RewindWebGL", "GeneratedHair");

        var alpha = new Texture2D(2, 2, TextureFormat.RGBA32, false);
        if (!alpha.LoadImage(File.ReadAllBytes(alphaPath)))
        {
            return ResolveHairTexture(materialName);
        }

        var colors = alpha.GetPixels32();
        var opacity = ResolveHairOpacity(materialName);
        for (var i = 0; i < colors.Length; i++)
        {
            var source = colors[i];
            var luminance = (source.r * 0.299f + source.g * 0.587f + source.b * 0.114f) / 255f;
            var isBodyFuzz = IsSoftBodyFuzzMaterial(materialName);
            var strand = Mathf.Pow(Mathf.Clamp01(luminance), isBodyFuzz ? 2.42f : 1.40f);
            var a = (byte)Mathf.RoundToInt(strand * opacity * 255f);
            var shadeMax = ResolveHairShadeMax(materialName, isBodyFuzz);
            var shade = (byte)Mathf.RoundToInt(Mathf.Lerp(1f, shadeMax, strand));
            colors[i] = new Color32(shade, shade, shade, a);
        }

        var rgba = new Texture2D(alpha.width, alpha.height, TextureFormat.RGBA32, true);
        rgba.SetPixels32(colors);
        rgba.Apply(true, false);

        var generatedName = "hair_" + Path.GetFileNameWithoutExtension(alphaPath).Replace("GoZMesh_Import_Material_", "").Replace(".", "_") + ".png";
        var generatedPath = GeneratedHairFolder + "/" + generatedName;
        File.WriteAllBytes(generatedPath, rgba.EncodeToPNG());
        AssetDatabase.ImportAsset(generatedPath, ImportAssetOptions.ForceUpdate);
        ConfigureGeneratedHairImporter(generatedPath);

        var imported = AssetDatabase.LoadAssetAtPath<Texture2D>(generatedPath);
        GeneratedHairCache[cacheKey] = imported != null ? imported : rgba;
        return GeneratedHairCache[cacheKey];
    }

    private static Texture2D ResolveOfficialEyeTexture()
    {
        const string generatedFolder = "Assets/RewindWebGL/GeneratedEye";
        const string generatedPath = generatedFolder + "/eye_official_dark_sclera_v3.png";
        var existing = AssetDatabase.LoadAssetAtPath<Texture2D>(generatedPath);
        if (existing != null)
        {
            return existing;
        }

        EnsureFolder("Assets", "RewindWebGL");
        EnsureFolder("Assets/RewindWebGL", "GeneratedEye");

        var source = LoadTexture("Assets/Cat/Cat.fbm/Eye_Pbr_Diffuse.png");
        if (source == null)
        {
            return null;
        }

        var readable = new Texture2D(source.width, source.height, TextureFormat.RGBA32, false);
        var renderTexture = RenderTexture.GetTemporary(source.width, source.height, 0, RenderTextureFormat.ARGB32);
        Graphics.Blit(source, renderTexture);
        var previous = RenderTexture.active;
        RenderTexture.active = renderTexture;
        readable.ReadPixels(new Rect(0, 0, source.width, source.height), 0, 0);
        readable.Apply();
        RenderTexture.active = previous;
        RenderTexture.ReleaseTemporary(renderTexture);

        var pixels = readable.GetPixels32();
        for (var i = 0; i < pixels.Length; i++)
        {
            var pixel = pixels[i];
            var r = pixel.r / 255f;
            var g = pixel.g / 255f;
            var b = pixel.b / 255f;
            var max = Mathf.Max(r, Mathf.Max(g, b));
            var min = Mathf.Min(r, Mathf.Min(g, b));
            var saturation = max <= 0.001f ? 0f : (max - min) / max;
            var yellowIris = r > 0.45f && g > 0.34f && b < 0.34f && saturation > 0.22f;
            var darkPupil = max < 0.12f;
            if (yellowIris)
            {
                pixels[i] = new Color32(
                    (byte)Mathf.Clamp(Mathf.RoundToInt(pixel.r * 1.20f + 10f), 0, 255),
                    (byte)Mathf.Clamp(Mathf.RoundToInt(pixel.g * 1.14f + 8f), 0, 255),
                    (byte)Mathf.Clamp(Mathf.RoundToInt(pixel.b * 0.96f), 0, 255),
                    pixel.a);
            }
            else if (!darkPupil)
            {
                var shade = (byte)Mathf.RoundToInt(Mathf.Lerp(24f, 78f, Mathf.Clamp01(max)));
                pixels[i] = new Color32(shade, shade, shade, pixel.a);
            }
        }

        readable.SetPixels32(pixels);
        readable.Apply();
        File.WriteAllBytes(generatedPath, readable.EncodeToPNG());
        AssetDatabase.ImportAsset(generatedPath, ImportAssetOptions.ForceUpdate);
        var importer = AssetImporter.GetAtPath(generatedPath) as TextureImporter;
        if (importer != null)
        {
            importer.textureType = TextureImporterType.Default;
            importer.alphaSource = TextureImporterAlphaSource.FromInput;
            importer.mipmapEnabled = true;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.SaveAndReimport();
        }
        return AssetDatabase.LoadAssetAtPath<Texture2D>(generatedPath);
    }

    private static void ConfigureEyelashMaterial(Material material)
    {
        var shader = Shader.Find("Standard");
        if (shader != null)
        {
            material.shader = shader;
        }

        material.SetTexture("_MainTex", LoadTexture("Assets/Cat/Cat.fbm/Std_Eyelash_Pbr_Diffuse.png"));
        material.SetTexture("_BumpMap", LoadTexture("Assets/Cat/Cat.fbm/Std_Eyelash_Pbr_Normal.png"));
        material.EnableKeyword("_NORMALMAP");
        material.color = new Color(0.018f, 0.018f, 0.017f, 1f);
        material.SetFloat("_Mode", 1f);
        material.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.One);
        material.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.Zero);
        material.SetInt("_ZWrite", 1);
        material.EnableKeyword("_ALPHATEST_ON");
        material.DisableKeyword("_ALPHABLEND_ON");
        material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
        material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.AlphaTest + 4;
        material.SetFloat("_Cutoff", 0.16f);
        material.SetFloat("_Glossiness", 0.01f);
        material.SetFloat("_Metallic", 0f);
    }

    private static void ConfigureEyeOcclusionMaterial(Material material)
    {
        var shader = Shader.Find("Standard");
        if (shader != null)
        {
            material.shader = shader;
        }

        material.SetTexture("_MainTex", null);
        material.SetTexture("_BumpMap", null);
        material.color = new Color(0.018f, 0.018f, 0.016f, 0f);
        material.SetFloat("_Mode", 3f);
        material.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
        material.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
        material.SetInt("_ZWrite", 0);
        material.DisableKeyword("_ALPHATEST_ON");
        material.EnableKeyword("_ALPHABLEND_ON");
        material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
        material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent + 14;
        material.SetFloat("_Glossiness", 0.035f);
        material.SetFloat("_Metallic", 0f);
    }

    private static void ConfigureGeneratedHairImporter(string generatedPath)
    {
        var importer = AssetImporter.GetAtPath(generatedPath) as TextureImporter;
        if (importer == null)
        {
            return;
        }

        importer.textureType = TextureImporterType.Default;
        importer.alphaSource = TextureImporterAlphaSource.FromInput;
        importer.alphaIsTransparency = true;
        importer.mipmapEnabled = true;
        importer.wrapMode = TextureWrapMode.Clamp;
        importer.filterMode = FilterMode.Bilinear;
        importer.textureCompression = TextureImporterCompression.CompressedHQ;
        importer.SaveAndReimport();
    }

    private static string ResolveHairAlphaPath(string materialName)
    {
        var basePath = Path.Combine(FurMapFolder, "GoZMesh_Import_Material_Opacity.jpg").Replace('\\', '/');
        for (var i = 0; i <= 8; i++)
        {
            if (materialName.Contains("_" + i + "_"))
            {
                var layer = (i + 1).ToString("0000");
                return Path.Combine(FurMapFolder, "GoZMesh_Import_Material_Opacity_" + layer + ".jpg").Replace('\\', '/');
            }
        }
        return basePath;
    }

    private static Texture2D ResolveHairTexture(string materialName)
    {
        var prefix = "Assets/Cat/Cat.fbm/";
        if (materialName.Contains("_0_"))
        {
            return LoadTexture(prefix + "GoZMesh_Import_Material_0_Tra_Diffuse.tif");
        }
        if (materialName.Contains("_1_"))
        {
            return LoadTexture(prefix + "GoZMesh_Import_Material_1_Pbr_Diffuse.tif");
        }
        if (materialName.Contains("_2_"))
        {
            return LoadTexture(prefix + "GoZMesh_Import_Material_2_Tra_Diffuse.tif");
        }
        if (materialName.Contains("_3_"))
        {
            return LoadTexture(prefix + "GoZMesh_Import_Material_3_Tra_Diffuse.tif");
        }
        if (materialName.Contains("_4_"))
        {
            return LoadTexture(prefix + "GoZMesh_Import_Material_4_Tra_Diffuse.tif");
        }
        if (materialName.Contains("_5_"))
        {
            return LoadTexture(prefix + "GoZMesh_Import_Material_5_Tra_Diffuse.tif");
        }
        if (materialName.Contains("_6_"))
        {
            return LoadTexture(prefix + "GoZMesh_Import_Material_6_Tra_Diffuse.tif");
        }
        if (materialName.Contains("_7_"))
        {
            return LoadTexture(prefix + "GoZMesh_Import_Material_7_Tra_Diffuse.tif");
        }
        if (materialName.Contains("_8_"))
        {
            return LoadTexture(prefix + "GoZMesh_Import_Material_8_Tra_Diffuse.tif");
        }
        return LoadTexture(prefix + "GoZMesh_Import_Material_Pbr_Diffuse.tif");
    }

    private static float ResolveHairOpacity(string materialName)
    {
        if (materialName.Contains("_4_") || materialName.Contains("_5_") || materialName.Contains("_6_") || materialName.Contains("_7_"))
        {
            return 0.155f;
        }
        if (materialName.Contains("_0_"))
        {
            return 0.240f;
        }
        if (materialName.Contains("_1_") || materialName.Contains("_2_"))
        {
            return 0.180f;
        }
        if (materialName.Contains("_8_"))
        {
            return 0.050f;
        }
        if (materialName.Contains("_3_"))
        {
            return 0.162f;
        }
        return 0.174f;
    }

    private static bool IsSoftBodyFuzzMaterial(string materialName)
    {
        return materialName.Contains("_4_") || materialName.Contains("_5_") || materialName.Contains("_6_") || materialName.Contains("_7_") || materialName.Contains("_8_");
    }

    private static bool IsBodyFuzzLayer(string materialName)
    {
        return materialName.Contains("_4_") || materialName.Contains("_5_") || materialName.Contains("_6_") || materialName.Contains("_7_");
    }

    private static float ResolveHairShadeMax(string materialName, bool isBodyFuzz)
    {
        if (materialName.Contains("_8_"))
        {
            return 14f;
        }
        return isBodyFuzz ? 7f : 34f;
    }

    private static float ResolveHairCutoff(string materialName)
    {
        var name = materialName.ToLowerInvariant();
        if (name.Contains("_6_") || name.Contains("_7_") || name.Contains("_8_"))
        {
            return 0.42f;
        }
        if (name.Contains("_0_") || name.Contains("_1_") || name.Contains("_2_"))
        {
            return 0.52f;
        }
        return 0.58f;
    }

    private static void ConfigureCorneaMaterial(Material material)
    {
        var shader = Shader.Find("Standard");
        if (shader != null)
        {
            material.shader = shader;
        }

        material.SetTexture("_MainTex", null);
        material.SetTexture("_BumpMap", LoadTexture("Assets/Cat/Cat.fbm/Cornea_Pbr_Normal.png"));
        material.EnableKeyword("_NORMALMAP");
        material.color = new Color(1f, 1f, 1f, 0.028f);
        material.SetFloat("_Mode", 3f);
        material.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
        material.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
        material.SetInt("_ZWrite", 0);
        material.DisableKeyword("_ALPHATEST_ON");
        material.EnableKeyword("_ALPHABLEND_ON");
        material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
        material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent + 20;
        material.SetFloat("_Glossiness", 0.98f);
        material.SetFloat("_Metallic", 0f);
    }

    private static void ConfigureTextureImporters(System.Text.StringBuilder log)
    {
        var paths = new[]
        {
            "Assets/Cat/Cat.fbm/GoZMesh_Import_Material_0_Tra_Diffuse.tif",
            "Assets/Cat/Cat.fbm/GoZMesh_Import_Material_2_Tra_Diffuse.tif",
            "Assets/Cat/Cat.fbm/GoZMesh_Import_Material_3_Tra_Diffuse.tif",
            "Assets/Cat/Cat.fbm/GoZMesh_Import_Material_4_Tra_Diffuse.tif",
            "Assets/Cat/Cat.fbm/GoZMesh_Import_Material_5_Tra_Diffuse.tif",
            "Assets/Cat/Cat.fbm/GoZMesh_Import_Material_6_Tra_Diffuse.tif",
            "Assets/Cat/Cat.fbm/GoZMesh_Import_Material_7_Tra_Diffuse.tif",
            "Assets/Cat/Cat.fbm/GoZMesh_Import_Material_8_Tra_Diffuse.tif",
            "Assets/Cat/Cat.fbm/Std_Eyelash_Pbr_Diffuse.png"
        };

        foreach (var path in paths)
        {
            var importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null)
            {
                log.AppendLine("Texture importer missing: " + path);
                continue;
            }

            var changed = false;
            changed |= SetTextureImporterValue(importer.alphaSource != TextureImporterAlphaSource.FromInput, () => importer.alphaSource = TextureImporterAlphaSource.FromInput);
            changed |= SetTextureImporterValue(!importer.alphaIsTransparency, () => importer.alphaIsTransparency = true);
            changed |= SetTextureImporterValue(!importer.mipmapEnabled, () => importer.mipmapEnabled = true);
            changed |= SetTextureImporterValue(importer.textureCompression != TextureImporterCompression.CompressedHQ, () => importer.textureCompression = TextureImporterCompression.CompressedHQ);
            if (changed)
            {
                importer.SaveAndReimport();
                log.AppendLine("Reimported transparent texture: " + path);
            }
        }
    }

    private static bool SetTextureImporterValue(bool shouldSet, Action setter)
    {
        if (!shouldSet)
        {
            return false;
        }
        setter();
        return true;
    }

    private static void ConfigureTransparentMaterial(Material material, float opacity, float glossiness)
    {
        material.color = new Color(1f, 1f, 1f, opacity);
        material.SetFloat("_Mode", 3f);
        material.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
        material.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
        material.SetInt("_ZWrite", 0);
        material.DisableKeyword("_ALPHATEST_ON");
        material.EnableKeyword("_ALPHABLEND_ON");
        material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
        material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        material.SetFloat("_Glossiness", glossiness);
    }

    private static Texture2D GetBlackCatTexture(string name)
    {
        var suffix = GetBlackCatSuffix(name);
        return suffix == null
            ? null
            : LoadTexture("Assets/Cat/SubstanceTextures/Black_Cat_Textures/Furry_Std_Skin_Head_BaseMap" + suffix + ".png");
    }

    private static Texture2D GetBlackCatNormal(string name)
    {
        var suffix = GetBlackCatSuffix(name);
        if (suffix == null)
        {
            return null;
        }
        var normalSuffix = suffix == "" ? "" : suffix == "_1" ? "_3" : suffix == "_5" ? "_7" : suffix == "_9" ? "_11" : suffix == "_13" ? "_15" : suffix;
        return LoadTexture("Assets/Cat/SubstanceTextures/Black_Cat_Textures/Furry_Std_Skin_Head_Normal" + normalSuffix + ".png");
    }

    private static Texture2D ResolveWebBlackCatTexture(string name, Texture2D source)
    {
        if (source == null)
        {
            return null;
        }

        var suffix = GetBlackCatSuffix(name);
        var label = string.IsNullOrEmpty(suffix) ? "head" : suffix.TrimStart('_');
        const string generatedFolder = "Assets/RewindWebGL/GeneratedSkin";
        var generatedPath = generatedFolder + "/black_cat_skin_" + label + "_web_fur_v13.png";
        var existing = AssetDatabase.LoadAssetAtPath<Texture2D>(generatedPath);
        if (existing != null)
        {
            return existing;
        }

        EnsureFolder("Assets", "RewindWebGL");
        EnsureFolder("Assets/RewindWebGL", "GeneratedSkin");

        var readable = new Texture2D(source.width, source.height, TextureFormat.RGBA32, false);
        var renderTexture = RenderTexture.GetTemporary(source.width, source.height, 0, RenderTextureFormat.ARGB32);
        Graphics.Blit(source, renderTexture);
        var previous = RenderTexture.active;
        RenderTexture.active = renderTexture;
        readable.ReadPixels(new Rect(0, 0, source.width, source.height), 0, 0);
        readable.Apply();
        RenderTexture.active = previous;
        RenderTexture.ReleaseTemporary(renderTexture);

        var pixels = readable.GetPixels32();
        var luminance = new float[pixels.Length];
        for (var i = 0; i < pixels.Length; i++)
        {
            var pixel = pixels[i];
            var r = pixel.r / 255f;
            var g = pixel.g / 255f;
            var b = pixel.b / 255f;
            luminance[i] = Mathf.Clamp01((r * 0.299f) + (g * 0.587f) + (b * 0.114f));
        }

        var isHead = name.Contains("head");
        for (var i = 0; i < pixels.Length; i++)
        {
            var pixel = pixels[i];
            var r = pixel.r / 255f;
            var g = pixel.g / 255f;
            var b = pixel.b / 255f;
            var value = luminance[i];

            // Source Substance maps are tuned for desktop Unity lighting. For WebGL,
            // keep the official black-grey fur texture visible while avoiding the
            // broad pale head band caused by Standard-specular lighting.
            var redBias = r - ((g + b) * 0.5f);
            var isWarmDetail = isHead && r > 0.18f && redBias > 0.035f && r > g * 1.08f && r > b * 1.08f;
            if (isWarmDetail)
            {
                pixels[i] = new Color32(
                    (byte)Mathf.Clamp(Mathf.RoundToInt(Mathf.Clamp01(r * 0.92f + 0.035f) * 255f), 0, 255),
                    (byte)Mathf.Clamp(Mathf.RoundToInt(Mathf.Clamp01(g * 0.88f + 0.018f) * 255f), 0, 255),
                    (byte)Mathf.Clamp(Mathf.RoundToInt(Mathf.Clamp01(b * 0.88f + 0.018f) * 255f), 0, 255),
                    pixel.a);
                continue;
            }

            var normalized = Mathf.Clamp01((value - 0.10f) / 0.82f);
            var x = i % source.width;
            var y = i / source.width;
            var local = 0f;
            var samples = 0;
            for (var yy = -2; yy <= 2; yy++)
            {
                var sy = Mathf.Clamp(y + yy, 0, source.height - 1);
                for (var xx = -2; xx <= 2; xx++)
                {
                    var sx = Mathf.Clamp(x + xx, 0, source.width - 1);
                    local += luminance[(sy * source.width) + sx];
                    samples++;
                }
            }
            var highFrequencyFur = Mathf.Clamp((value - (local / Mathf.Max(samples, 1))) * (isHead ? 0.48f : 2.05f), -0.18f, isHead ? 0.18f : 0.24f);
            var compressed = Mathf.Pow(normalized, isHead ? 0.88f : 0.70f);
            var furDetail = (value - 0.38f) * (isHead ? 0.115f : 0.285f);
            var shade = Mathf.Clamp01((isHead ? 0.145f : 0.124f) + compressed * (isHead ? 0.370f : 0.455f) + furDetail + highFrequencyFur);
            var channel = (byte)Mathf.Clamp(Mathf.RoundToInt(shade * 255f), 0, 255);
            pixels[i] = new Color32(channel, channel, channel, pixel.a);
        }

        readable.SetPixels32(pixels);
        readable.Apply();
        File.WriteAllBytes(generatedPath, readable.EncodeToPNG());
        AssetDatabase.ImportAsset(generatedPath, ImportAssetOptions.ForceUpdate);
        var importer = AssetImporter.GetAtPath(generatedPath) as TextureImporter;
        if (importer != null)
        {
            importer.textureType = TextureImporterType.Default;
            importer.alphaSource = TextureImporterAlphaSource.FromInput;
            importer.mipmapEnabled = true;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.SaveAndReimport();
        }

        return AssetDatabase.LoadAssetAtPath<Texture2D>(generatedPath);
    }

    private static string GetBlackCatSuffix(string name)
    {
        if (name.Contains("head"))
        {
            return "";
        }
        if (name.Contains("nail"))
        {
            return "_13";
        }
        if (name.Contains("arm") || name.Contains("hand") || name.Contains("finger") || name.Contains("forearm") || name.Contains("upperarm"))
        {
            return "_5";
        }
        if (name.Contains("leg") || name.Contains("foot") || name.Contains("toe") || name.Contains("thigh") || name.Contains("calf"))
        {
            return "_9";
        }
        if (name.Contains("body"))
        {
            return "_1";
        }
        if (name.Contains("torso") || name.Contains("chest") || name.Contains("abdomen") || name.Contains("skin"))
        {
            return "_1";
        }
        return null;
    }

    private static Texture2D LoadTexture(string path)
    {
        return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
    }

    private static void CenterAndScale(GameObject cat)
    {
        var renderers = cat.GetComponentsInChildren<Renderer>(true).Where(r => r.enabled).ToArray();
        if (renderers.Length == 0)
        {
            return;
        }

        var bounds = renderers[0].bounds;
        foreach (var renderer in renderers.Skip(1))
        {
            bounds.Encapsulate(renderer.bounds);
        }

        var maxSide = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z, 0.001f);
        var scale = 1.95f / maxSide;
        cat.transform.localScale *= scale;
        cat.transform.position = -bounds.center * scale + new Vector3(0f, -0.12f, 0f);
    }

    private static void CreateCamera(GameObject cat)
    {
        var go = new GameObject("Main Camera");
        var camera = go.AddComponent<Camera>();
        camera.tag = "MainCamera";
        camera.orthographic = true;
        camera.orthographicSize = 0.98f;
        camera.nearClipPlane = 0.01f;
        camera.farClipPlane = 20f;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0.965f, 0.945f, 0.91f, 1f);
        go.transform.position = new Vector3(0f, 0.02f, 4.2f);
        go.transform.LookAt(new Vector3(0f, 0f, 0f), Vector3.up);
    }

    private static void CreateLights()
    {
        var key = new GameObject("Key Light");
        var keyLight = key.AddComponent<Light>();
        keyLight.type = LightType.Directional;
        keyLight.intensity = 1.42f;
        key.transform.rotation = Quaternion.Euler(34f, -8f, 0f);

        var fill = new GameObject("Fill Light");
        var fillLight = fill.AddComponent<Light>();
        fillLight.type = LightType.Directional;
        fillLight.intensity = 0.24f;
        fill.transform.rotation = Quaternion.Euler(22f, 44f, 0f);

        var rim = new GameObject("Rim Light");
        var rimLight = rim.AddComponent<Light>();
        rimLight.type = LightType.Directional;
        rimLight.intensity = 0.34f;
        rim.transform.rotation = Quaternion.Euler(42f, 160f, 0f);
    }

    private static void ConfigurePlayerSettings()
    {
        PlayerSettings.productName = "Rewind Avatar";
        PlayerSettings.companyName = "CityU Shen Lab";
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.decompressionFallback = false;
        PlayerSettings.WebGL.dataCaching = false;
        PlayerSettings.WebGL.threadsSupport = false;
        PlayerSettings.WebGL.memorySize = 256;
        PlayerSettings.SetScriptingBackend(BuildTargetGroup.WebGL, ScriptingImplementation.IL2CPP);
        PlayerSettings.SetManagedStrippingLevel(BuildTargetGroup.WebGL, ManagedStrippingLevel.Low);
    }
}
#endif
