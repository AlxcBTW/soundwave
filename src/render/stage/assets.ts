import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { StageCameras, Vec3 } from './Director';

/** What tools/stage/build_stage.py --export writes next to the GLB (three.js coordinates). */
export interface StageData {
  version: number;
  cameras: StageCameras;
  beams: LightSpec[];
  washes: LightSpec[];
  glows: LightSpec[];
  fireworks: FireworkSpec[];
  co2: Vec3[];
  wheel: Vec3;
  armillary: Vec3;
  sun: Vec3;
  /** x, y, z, radius per bulb. */
  bulbs: number[];
  crowd: Scatter;
  trees: Scatter;
  band: Partial<Record<string, Vec3>>;
}

export interface LightSpec {
  group: string;
  pos: Vec3;
  dir: Vec3;
  color: Vec3;
  /** Blender watts. */
  energy: number;
  /** Cone angle in degrees (spots). */
  angle?: number;
}

export interface FireworkSpec {
  origin: Vec3;
  n: number;
  spread: number;
  length: [number, number];
  lean: number;
  gold: boolean;
}

export interface Scatter {
  /** x, y, z, rotation, scale per instance. */
  points: number[];
  variants: string[];
}

export interface StageAssets {
  scene: THREE.Group;
  data: StageData;
}

let cache: Promise<StageAssets> | null = null;

/** Loads the stage once; later callers share the same promise. */
export function loadStage(): Promise<StageAssets> {
  if (cache) return cache;
  const base = import.meta.env.BASE_URL;
  const draco = new DRACOLoader().setDecoderPath(`${base}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  cache = Promise.all([
    loader.loadAsync(`${base}stage/stage.glb`),
    fetch(`${base}stage/stage.json`).then((r) => {
      if (!r.ok) throw new Error(`stage data: ${r.status}`);
      return r.json() as Promise<StageData>;
    }),
  ]).then(([gltf, data]) => {
    draco.dispose();
    return { scene: gltf.scene, data };
  });
  cache.catch(() => {
    cache = null;
  });
  return cache;
}
