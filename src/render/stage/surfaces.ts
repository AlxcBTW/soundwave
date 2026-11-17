import * as THREE from 'three';

/**
 * Surface detail for the exported stage, added in the shaders so the GLB stays small:
 * a painted height gradient (cool, darker feet rising to warm tops), masonry courses on stone,
 * scalloped shingles on roofs, and baked ambient occlusion that also darkens direct light.
 */
export type SurfaceKind = 'stone' | 'tile' | 'metal' | 'plain' | 'window';

/**
 * Shared by every detailed material: the colour and strength of the uplights flooding the walls
 * from below, set by the light show each frame.
 */
export const surfaceUniforms = {
  uUpColor: { value: new THREE.Color(1, 0.5, 0.2) },
  uUpLevel: { value: 0.6 },
  uTime: { value: 0 },
};

export function surfaceKind(name: string): SurfaceKind | null {
  if (/^Sandstone/.test(name)) return 'stone';
  if (/^Win(Warm|Gold|Blue)/.test(name)) return 'window';
  if (/^(Patina|RoseTile|BlueTile)/.test(name)) return 'tile';
  if (/^(Gilt|Trim|Truss|Bronze|Ornament)/.test(name)) return 'metal';
  if (/^(Deck|Ground|Foliage|Trunk|Black|Grille)/.test(name)) return 'plain';
  return null;
}

export function detailSurface(mat: THREE.MeshStandardMaterial, kind: SurfaceKind) {
  if (kind === 'metal') {
    // Gilt and bronze need the environment to read as metal at all.
    mat.envMapIntensity = 1.4;
    mat.roughness = Math.min(mat.roughness, 0.32);
  } else if (kind === 'tile') {
    mat.roughness = Math.min(mat.roughness, 0.3);
    mat.metalness = Math.max(mat.metalness, 0.35);
    mat.envMapIntensity = 1.2;
  } else if (kind === 'stone') {
    mat.roughness = 0.72;
  } else if (kind === 'plain') {
    // Ground, foliage and black gear barely reflect the sky.
    mat.envMapIntensity = 0.25;
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms);
    shader.defines = { ...shader.defines, [`SURF_${kind.toUpperCase()}`]: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 sWorld = modelMatrix * vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          sWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        #endif
        vWPos = sWorld.xyz;
        vWNorm = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNorm;
        uniform vec3 uUpColor;
        uniform float uUpLevel;
        uniform float uTime;
        float sHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        // Distance to the nearest joint of a running-bond grid, in metres, anti-aliased by fwidth.
        float sJoints(vec2 p, vec2 size, out vec2 id) {
          float row = floor(p.y / size.y);
          vec2 q = vec2(p.x / size.x + mod(row, 2.0) * 0.5, p.y / size.y);
          id = floor(q);
          vec2 f = fract(q);
          vec2 d = min(f, 1.0 - f) * size;
          float m = min(d.x, d.y);
          float w = fwidth(m) * 1.2 + 0.015;
          return smoothstep(0.0, w, m - 0.02);
        }`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = normalize(vWNorm);
          vec2 p = abs(n.y) > 0.75 ? vWPos.xz : (abs(n.x) > abs(n.z) ? vWPos.zy : vWPos.xy);
          float hgt = smoothstep(-1.0, 48.0, vWPos.y);
          vec3 grade = mix(vec3(0.58, 0.6, 0.82), vec3(1.06, 1.02, 0.97), hgt);
          #if defined(SURF_STONE)
            vec2 id;
            float joint = sJoints(p, vec2(2.4, 1.2), id);
            float h = sHash(id);
            diffuseColor.rgb *= grade * mix(0.62, 1.0, joint) * (0.9 + 0.16 * h);
          #elif defined(SURF_TILE)
            vec2 id;
            vec2 sp = vec2(p.x, p.y + 0.0);
            float joint = sJoints(sp, vec2(0.9, 0.55), id);
            float h = sHash(id);
            diffuseColor.rgb *= mix(0.55, 1.0, joint) * (0.85 + 0.25 * h) * mix(0.8, 1.1, hgt);
          #elif defined(SURF_METAL)
            diffuseColor.rgb *= mix(vec3(0.85), grade, 0.6);
          #endif
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #if defined(SURF_WINDOW)
          // Every window its own: some brighter, some dimmer, a few slowly flickering.
          vec2 cellId = floor(vWPos.xz * 0.8 + vWPos.y * 0.37);
          float wh = sHash(cellId + floor(vWPos.y * 0.45));
          totalEmissiveRadiance *= (0.55 + 0.75 * wh) * (0.92 + 0.08 * sin(uTime * (1.0 + wh * 3.0) + wh * 40.0));
        #elif defined(SURF_STONE) || defined(SURF_TILE) || defined(SURF_METAL)
          // Uplights: coloured floods at the foot of the walls that face the crowd.
          float face = smoothstep(-0.2, 0.6, normalize(vWNorm).z);
          float foot = exp(-max(0.0, vWPos.y) / 9.0);
          totalEmissiveRadiance += diffuseColor.rgb * uUpColor * uUpLevel * foot * face * 0.9;
        #endif`,
      )
      // Baked AO also shades the washes (three applies it to ambient light only).
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        #ifdef USE_AOMAP
          reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.65);
          reflectedLight.directSpecular *= mix(1.0, ambientOcclusion, 0.65);
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => `surf-${kind}`;
  mat.needsUpdate = true;
}

/**
 * The environment the stage reflects: a night sky, the warm glow of the lit crowd area in front,
 * coloured light spill overhead. Pre-filtered once with PMREM.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 sky = mix(vec3(0.05, 0.07, 0.2), vec3(0.006, 0.008, 0.03), smoothstep(0.0, 0.6, h));
        vec3 ground = vec3(0.06, 0.035, 0.03);
        vec3 col = h > 0.0 ? sky : ground;
        // The crowd side (+z) glows warm from the stage front, a band along the horizon.
        float front = max(0.0, vDir.z);
        col += vec3(1.0, 0.55, 0.22) * pow(front, 3.0) * exp(-abs(h) * 6.0) * 1.6;
        // Light spill overhead: violet and blue from the beams.
        col += vec3(0.35, 0.25, 0.9) * smoothstep(0.55, 1.0, h) * 0.08;
        col += vec3(0.9, 0.4, 0.8) * pow(max(0.0, dot(vDir, normalize(vec3(-0.6, 0.5, 0.4)))), 12.0) * 1.2;
        col += vec3(0.3, 0.6, 1.0) * pow(max(0.0, dot(vDir, normalize(vec3(0.6, 0.5, 0.4)))), 12.0) * 1.2;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  env.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.02);
  pm.dispose();
  geo.dispose();
  mat.dispose();
  return rt.texture;
}
