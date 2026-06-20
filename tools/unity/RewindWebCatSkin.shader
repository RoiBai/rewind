Shader "Rewind/WebGL Cat Skin"
{
    Properties
    {
        _MainTex ("Base Map", 2D) = "white" {}
        _BumpMap ("Normal Map", 2D) = "bump" {}
        _BumpScale ("Normal Strength", Range(0, 2)) = 0.45
        _Color ("Color", Color) = (1, 1, 1, 1)
        _LightFloor ("Light Floor", Range(0, 1)) = 0.42
        _LightRange ("Light Range", Range(0, 1)) = 0.30
        _RimSoftness ("Rim Softness", Range(0, 1)) = 0.04
    }
    SubShader
    {
        Tags
        {
            "Queue" = "Geometry"
            "RenderType" = "Opaque"
        }
        Cull Back
        ZWrite On
        ZTest LEqual

        Pass
        {
            Tags { "LightMode" = "ForwardBase" }

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0

            #include "UnityCG.cginc"
            #include "Lighting.cginc"

            sampler2D _MainTex;
            sampler2D _BumpMap;
            float4 _MainTex_ST;
            fixed4 _Color;
            half _BumpScale;
            half _LightFloor;
            half _LightRange;
            half _RimSoftness;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float4 tangent : TANGENT;
                float2 uv : TEXCOORD0;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 worldNormal : TEXCOORD1;
                float3 worldPos : TEXCOORD2;
                float3 worldTangent : TEXCOORD3;
                float3 worldBinormal : TEXCOORD4;
            };

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.worldNormal = UnityObjectToWorldNormal(v.normal);
                o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
                o.worldTangent = UnityObjectToWorldDir(v.tangent.xyz);
                o.worldBinormal = cross(o.worldNormal, o.worldTangent) * v.tangent.w * unity_WorldTransformParams.w;
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                fixed4 tex = tex2D(_MainTex, i.uv) * _Color;
                float3 tangentNormal = UnpackNormal(tex2D(_BumpMap, i.uv));
                tangentNormal.xy *= _BumpScale;
                tangentNormal.z = sqrt(saturate(1.0 - dot(tangentNormal.xy, tangentNormal.xy)));
                float3 normal = normalize(
                    normalize(i.worldTangent) * tangentNormal.x +
                    normalize(i.worldBinormal) * tangentNormal.y +
                    normalize(i.worldNormal) * tangentNormal.z);
                float3 lightDir = normalize(_WorldSpaceLightPos0.xyz);
                float3 viewDir = normalize(_WorldSpaceCameraPos.xyz - i.worldPos);
                float ndl = saturate(dot(normal, lightDir));
                float rim = pow(1.0 - saturate(dot(normal, viewDir)), 2.8) * _RimSoftness;
                float shade = saturate(_LightFloor + ndl * _LightRange + rim);
                return fixed4(tex.rgb * shade, tex.a);
            }
            ENDCG
        }
    }
    FallBack "Unlit/Texture"
}
