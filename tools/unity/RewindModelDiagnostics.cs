#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class RewindModelDiagnostics
{
    private const string ModelPath = "Assets/Cat/Cat.Fbx";
    private const string OutputPath = "E:/CreativeCoding/Rewind/.tmp/diagnostics/rewind-model-diagnostics.txt";

    public static void DumpBatch()
    {
        var ok = Dump();
        EditorApplication.Exit(ok ? 0 : 1);
    }

    [MenuItem("Rewind/Dump Model Diagnostics")]
    public static bool Dump()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(OutputPath));
        var log = new StringBuilder();
        try
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
            if (prefab == null)
            {
                throw new InvalidOperationException("Missing model: " + ModelPath);
            }

            var cat = (GameObject)PrefabUtility.InstantiatePrefab(prefab, scene);
            cat.name = "Rewind_Diagnostics_Cat";
            log.AppendLine("=== Renderers ===");
            foreach (var renderer in cat.GetComponentsInChildren<Renderer>(true).OrderBy(r => r.name))
            {
                var mats = string.Join(" | ", renderer.sharedMaterials.Where(m => m != null).Select(m => m.name + " shader=" + (m.shader != null ? m.shader.name : "null")));
                var flags = renderer.enabled ? "enabled" : "disabled";
                log.AppendLine($"{renderer.name} type={renderer.GetType().Name} {flags} materials=[{mats}] bounds={renderer.bounds.size}");
            }

            log.AppendLine();
            log.AppendLine("=== BlendShapes ===");
            foreach (var skinned in cat.GetComponentsInChildren<SkinnedMeshRenderer>(true).OrderBy(r => r.name))
            {
                var mesh = skinned.sharedMesh;
                if (mesh == null || mesh.blendShapeCount == 0)
                {
                    continue;
                }

                log.AppendLine($"{skinned.name} blendShapeCount={mesh.blendShapeCount}");
                for (var i = 0; i < mesh.blendShapeCount; i++)
                {
                    log.AppendLine($"  {i:000}: {mesh.GetBlendShapeName(i)}");
                }
            }

            File.WriteAllText(OutputPath, log.ToString(), Encoding.UTF8);
            Debug.Log("Wrote " + OutputPath);
            UnityEngine.Object.DestroyImmediate(cat);
            return true;
        }
        catch (Exception ex)
        {
            log.AppendLine(ex.ToString());
            File.WriteAllText(OutputPath, log.ToString(), Encoding.UTF8);
            Debug.LogError(ex);
            return false;
        }
    }
}
#endif
