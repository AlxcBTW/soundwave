import * as THREE from 'three';
import { COMMON, OUTPUT, shared } from './shared';

/**
 * The night sky: a deep blue gradient soaked in the stage's light on its side, drifting clouds
 * with lit edges, and stars between them.
 */
export function buildSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: shared,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        // The dome travels with the camera, so it is always infinitely far away.
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyGradient(d);
        float stars = 0.0;
        vec3 sp = d * 190.0;
        float r = hash31(floor(sp));
        if (r > 0.972) {
          float s = smoothstep(0.32, 0.0, length(fract(sp) - 0.5));
          stars = s * (0.5 + 0.5 * sin(uTime * (1.0 + r * 3.0) + r * 90.0)) * (r - 0.972) * 50.0;
        }
        if (d.y > 0.0) {
          vec2 p = d.xz / (d.y + 0.16) * 1.15 + vec2(uTime * 0.004, uTime * 0.0015);
          vec2 warp = vec2(fbm(p * 1.6 + 3.1), fbm(p * 1.6 - 5.2));
          float n = fbm(p + 0.75 * warp);
          float cover = smoothstep(0.46, 0.72, n);
          float edge = smoothstep(0.46, 0.56, n) * (1.0 - smoothstep(0.56, 0.8, n));
          float toStage = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), vec3(0.0, 0.0, -1.0)));
          vec3 body = mix(vec3(0.022, 0.055, 0.2), vec3(0.006, 0.014, 0.07), smoothstep(0.55, 0.9, n));
          vec3 cloud = body + (vec3(0.035, 0.09, 0.3) + uHazeNear * (0.1 + 0.9 * pow(toStage, 2.0))) * edge;
          float fade = smoothstep(0.0, 0.2, d.y);
          col = mix(col, cloud, cover * fade * 0.92);
          stars *= 1.0 - cover;
        }
        col += vec3(0.8, 0.9, 1.0) * stars * smoothstep(0.02, 0.2, d.y);
        // A dark line of trees and hills closes the horizon.
        float az = atan(d.z, d.x);
        float ridge = 0.012 + 0.03 * fbm(vec2(az * 5.0, 1.7)) + 0.008 * vnoise(vec2(az * 90.0, 4.0));
        col = mix(uHazeFar * 0.45, col, smoothstep(ridge - 0.002, ridge + 0.002, d.y));
        gl_FragColor = vec4(col, 1.0);
        ${OUTPUT}
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}
