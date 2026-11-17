/**
 * Graphics settings for the 3D stage behind the highway. The highway itself always renders at full
 * quality; everything here only scales the stage, so a laptop keeps a smooth highway while an
 * RTX-class desktop gets the full show.
 */
export type GraphicsPreset = 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type Level = 'off' | 'low' | 'medium' | 'high';
export type CameraMode = 'auto' | 'calm' | 'fixed';

export interface GraphicsSettings {
  preset: GraphicsPreset;
  /** The 3D stage; off falls back to the light 2D backdrop. */
  stage3d: boolean;
  /** Stage render resolution relative to the screen, 0.5..1. */
  resolution: number;
  /** Lowers the stage resolution on the fly when frames run long. */
  dynamicResolution: boolean;
  /** Stage frame-rate cap (0 = match the display). The highway is never capped. */
  fpsCap: 0 | 30 | 60 | 120;
  crowd: Level;
  /** Moving-head beams in the haze. */
  beams: Level;
  /** Washes, bulbs and glowing details. */
  lights: Level;
  /** Fireworks and CO2. */
  effects: Level;
  /** Bloom around bright lights. */
  glow: boolean;
  antialias: boolean;
  camera: CameraMode;
}

export type Tier = Exclude<GraphicsPreset, 'auto' | 'custom'>;

export const PRESETS: Record<Tier, Omit<GraphicsSettings, 'preset' | 'camera'>> = {
  low: { stage3d: true, resolution: 0.6, dynamicResolution: true, fpsCap: 30, crowd: 'low', beams: 'low', lights: 'low', effects: 'low', glow: false, antialias: false },
  medium: { stage3d: true, resolution: 0.75, dynamicResolution: true, fpsCap: 60, crowd: 'medium', beams: 'medium', lights: 'medium', effects: 'medium', glow: true, antialias: false },
  high: { stage3d: true, resolution: 1, dynamicResolution: true, fpsCap: 0, crowd: 'high', beams: 'high', lights: 'high', effects: 'high', glow: true, antialias: true },
  ultra: { stage3d: true, resolution: 1, dynamicResolution: false, fpsCap: 0, crowd: 'high', beams: 'high', lights: 'high', effects: 'high', glow: true, antialias: true },
};

export const DEFAULT_GRAPHICS: GraphicsSettings = { preset: 'auto', camera: 'auto', ...PRESETS.medium };

/** Share of the crowd, trees and bulbs drawn at each level. */
export const LEVEL_SHARE: Record<Level, number> = { off: 0, low: 0.12, medium: 0.45, high: 1 };

/**
 * A tier from the GPU's name: integrated laptop graphics get Low, mainstream GPUs Medium, current
 * discrete cards High and the top cards Ultra. Unknown GPUs start at Medium (dynamic resolution
 * then adapts).
 */
export function tierForGpu(name: string | null): Tier {
  if (!name) return 'medium';
  const n = name.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(n)) return 'low';
  if (/rtx\s*(40[89]0|50[789]0|4080|4090)|rx\s*7[89]00|rx\s*9070|apple m\d (max|ultra)/.test(n)) return 'ultra';
  if (/rtx|rx\s*[5-9]\d{3}|arc a7|apple m\d pro|radeon pro/.test(n)) return 'high';
  if (/gtx|rx\s*[4-5]\d{2}|arc|apple m\d/.test(n)) return 'medium';
  if (/intel|uhd|iris|vega \d|radeon\(tm\) graphics|mali|adreno/.test(n)) return 'low';
  return 'medium';
}

/** The GPU's name as WebGL reports it, when the browser allows it. */
export function detectGpu(): string | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

let detected: Tier | null = null;

/** The settings actually used: Auto resolves to a tier for this machine, the rest are explicit. */
export function resolveGraphics(g: GraphicsSettings): GraphicsSettings {
  if (g.preset !== 'auto') return g;
  detected ??= tierForGpu(detectGpu());
  return { ...g, ...PRESETS[detected] };
}

export function autoTier(): Tier {
  detected ??= tierForGpu(detectGpu());
  return detected;
}

/** Applying a preset sets every individual option; changing one afterwards makes it Custom. */
export function applyPreset(g: GraphicsSettings, preset: GraphicsPreset): GraphicsSettings {
  if (preset === 'auto' || preset === 'custom') return { ...g, preset };
  return { ...g, ...PRESETS[preset], preset };
}

const LEVELS: Level[] = ['off', 'low', 'medium', 'high'];

export function normalizeGraphics(raw: unknown): GraphicsSettings {
  const g = { ...DEFAULT_GRAPHICS, ...(typeof raw === 'object' && raw ? raw : {}) } as GraphicsSettings;
  if (!['auto', 'low', 'medium', 'high', 'ultra', 'custom'].includes(g.preset)) g.preset = 'auto';
  for (const k of ['crowd', 'beams', 'lights', 'effects'] as const) if (!LEVELS.includes(g[k])) g[k] = DEFAULT_GRAPHICS[k];
  if (![0, 30, 60, 120].includes(g.fpsCap)) g.fpsCap = DEFAULT_GRAPHICS.fpsCap;
  if (!['auto', 'calm', 'fixed'].includes(g.camera)) g.camera = 'auto';
  g.resolution = Math.min(1, Math.max(0.5, Number(g.resolution) || DEFAULT_GRAPHICS.resolution));
  for (const k of ['stage3d', 'dynamicResolution', 'glow', 'antialias'] as const) g[k] = Boolean(g[k]);
  return g;
}
