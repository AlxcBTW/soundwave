/**
 * The lie of the land around the stage, as tools/stage/aurora/terrain.py defines it: level around
 * the stage, rising gently toward the back of the audience, falling under the lake behind the
 * stage and beyond the wings. The build writes the numbers to scenery.json; this mirrors its
 * `height` so the game can stand people on the ground.
 */
export interface TerrainParams {
  centre: number;
  flat: number;
  steep: number;
  cap: number;
  lead: number;
  shore: number;
  side: number;
  bank: number;
  drop: number;
  water: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Height of the ground at a point, in the game's axes (x right, z toward the audience). */
export function terrainHeight(p: TerrainParams | undefined, x: number, z: number): number {
  if (!p) return 0;
  // The build works with y pointing away from the audience.
  const y = -z;
  const toward = clamp01((-y + 5) / p.lead);
  const beyond = Math.max(0, Math.hypot(x, y - p.centre) - p.flat);
  const rise = toward * Math.min(p.cap, p.steep * beyond * beyond);
  const back = clamp01((y - p.shore) / p.bank);
  const side = clamp01((Math.abs(x) - p.side) / p.bank) * clamp01((y + 30) / 30);
  return rise - p.drop * Math.max(back, side);
}
