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
  fireworks: FireworkSpec[];
  co2: Vec3[];
  /** Spots in the audience that stay free: the mix position, delay towers. */
  clear?: { pos: Vec3; radius: number }[];
  deck: DeckInfo;
}

/** A fan of sparks: rays spread (degrees) around a lean from vertical, each `length` metres long. */
export interface FireworkSpec {
  origin: Vec3;
  n: number;
  spread: number;
  length: [number, number];
  lean: number;
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

export interface Character {
  /** Mesh name in the set's GLB, and the lighter mesh for people far from every camera. */
  mesh: string;
  far?: string;
  joints: number;
  height: number;
  clips: Clip[];
}

/** What tools/stage/aurora/build_figures.py and build_people.py write next to each set's GLB. */
export interface FigureData {
  version: number;
  /** The loops are made to the beat: everyone plays them in time instead of at their own point. */
  sync?: boolean;
  /** Widest skeleton in the set: the animation texture is three texels per joint wide. */
  joints: number;
  frames: number;
  characters: Record<string, Character>;
  /** Band set: who plays which part, and with which loop. */
  band?: Record<string, { character: string; clip: string }>;
}

/** One set of people: the band or the crowd. */
export interface FigureSet {
  scene: THREE.Group;
  data: FigureData;
  /** Per frame and joint a 3x4 matrix, row-major, half floats. */
  anim: Uint16Array;
}

export interface VenueAssets {
  scene: THREE.Group;
  data: VenueData;
  band: FigureSet;
  crowd: FigureSet;
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
  const loadSet = async (path: string): Promise<FigureSet> => {
    // The description first: a missing set fails here, before anything large is fetched.
    const data = (await get(`${path}.json`).then((r) => r.json())) as FigureData;
    const [gltf, anim] = await Promise.all([loader.loadAsync(`${base}${path}.glb`), get(`${path}.bin`).then((r) => r.arrayBuffer())]);
    return { scene: gltf.scene, data, anim: new Uint16Array(anim) };
  };
  // Characters built on this machine from downloaded files (build_people.py, kept out of the
  // repository) take the place of the project's own figures when they are there.
  const people = (name: string): Promise<FigureSet> => loadSet(`local/${name}`).catch(() => loadSet(name));
  cache = Promise.all([loader.loadAsync(`${base}venue.glb`), get('venue.json').then((r) => r.json() as Promise<VenueData>), people('band'), people('crowd')]).then(
    ([venue, data, band, crowd]) => {
      draco.dispose();
      return { scene: venue.scene, data, band, crowd };
    },
  );
  cache.catch(() => {
    cache = null;
  });
  return cache;
}
