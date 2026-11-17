import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { StageCameras, Vec3 } from '../stage/Director';
import type { DeckInfo } from './materials';

/** What tools/stage/aurora/build_venue.py writes next to venue.glb (three.js coordinates). */
export interface VenueData {
  version: number;
  cameras: StageCameras;
  band: Record<string, Vec3>;
  fixtures: Fixture[];
  moon: { center: Vec3; radius: number };
  deck: DeckInfo;
}

export interface Fixture {
  group: string;
  pos: Vec3;
  dir: Vec3;
}

export interface Clip {
  name: string;
  /** First row of the loop in the animation texture, and its length in rows. */
  start: number;
  frames: number;
  /** Length in beats: the loop plays once per this many beats of the song. */
  beats: number;
}

/** What tools/stage/aurora/build_figures.py writes next to figures.glb. */
export interface FigureData {
  version: number;
  joints: number;
  frames: number;
  clips: Clip[];
  crowd: string[];
  band: Record<string, string>;
}

export interface VenueAssets {
  scene: THREE.Group;
  data: VenueData;
  figures: THREE.Group;
  figureData: FigureData;
  /** Per frame and joint a 3x4 matrix, row-major. */
  anim: Float32Array;
}

let cache: Promise<VenueAssets> | null = null;

/** Loads the venue once; later callers share the same promise. */
export function loadVenue(): Promise<VenueAssets> {
  if (cache) return cache;
  const base = `${import.meta.env.BASE_URL}stage/aurora/`;
  const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const get = async (name: string) => {
    const r = await fetch(base + name);
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return r;
  };
  cache = Promise.all([
    loader.loadAsync(`${base}venue.glb`),
    get('venue.json').then((r) => r.json() as Promise<VenueData>),
    loader.loadAsync(`${base}figures.glb`),
    get('figures.json').then((r) => r.json() as Promise<FigureData>),
    get('figures.bin').then((r) => r.arrayBuffer()),
  ]).then(([venue, data, figures, figureData, anim]) => {
    draco.dispose();
    return { scene: venue.scene, data, figures: figures.scene, figureData, anim: new Float32Array(anim) };
  });
  cache.catch(() => {
    cache = null;
  });
  return cache;
}
