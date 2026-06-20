Shader "Rewind/WebGL Hair"
{
    Properties
    {
        _MainTex ("Hair Alpha", 2D) = "white" {}
        _Color ("Hair Color", Color) = (0.025, 0.027, 0.026, 1)
        _AlphaBoost ("Alpha Boost", Range(0, 8)) = 1.2
        _Cutoff ("Cutoff", Range(0, 0.2)) = 0.01
        _DitherAmount ("Dither Amount", Range(0, 1)) = 0
        _LightBoost ("Light Boost", Range(0, 2)) = 1
        _RimStrength ("Rim Strength", Range(0, 1)) = 0.18
        _OutputAlpha ("Output Alpha", Range(0, 1)) = 0.42
    }
    SubShader
    {
        Tags
        {
            "Queue" = "Transparent-40"
            "RenderType" = "Transparent"
            "IgnoreProjector" = "True"
        }
        Cull Off
        ZWrite Off
        ZTest LEqual
        Blend SrcAlpha OneMinusSrcAlpha

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
            float4 _MainTex_ST;
            fixed4 _Color;
            half _AlphaBoost;
            half _Cutoff;
            half _DitherAmount;
            half _LightBoost;
            half _RimStrength;
            half _OutputAlpha;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 uv : TEXCOORD0;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 worldNormal : TEXCOORD1;
                float3 worldPos : TEXCOORD2;
                float4 screenPos : TEXCOORD3;
            };

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.worldNormal = UnityObjectToWorldNormal(v.normal);
                o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
                o.screenPos = ComputeScreenPos(o.pos);
                return o;
            }

            float InterleavedNoise(float2 pixel)
            {
                return frac(52.9829189 * frac(dot(pixel, float2(0.06711056, 0.00583715))));
            }

            fixed4 frag(v2f i) : SV_Target
            {
                fixed4 sample = tex2D(_MainTex, i.uv);
                float alpha = saturate(sample.a * _AlphaBoost);
                float2 pixel = floor((i.screenPos.xy / i.screenPos.w) * _ScreenParams.xy);
                float noise = InterleavedNoise(pixel);
                float threshold = _Cutoff + noise * _DitherAmount * 0.015;
                clip(alpha - threshold);

                float3 normal = normalize(i.worldNormal);
                float3 viewDir = normalize(_WorldSpaceCameraPos.xyz - i.worldPos);
                float ndl = saturate(dot(normal, normalize(_WorldSpaceLightPos0.xyz)));
                float diffuse = 0.34 + ndl * 0.46;
                float rim = pow(1.0 - saturate(dot(normal, viewDir)), 2.0) * _RimStrength;
                float3 color = _Color.rgb * (diffuse * _LightBoost + rim);
                return fixed4(color, saturate(alpha * _OutputAlpha));
            }
            ENDCG
        }
    }
    FallBack "Transparent/Diffuse"
}
