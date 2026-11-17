/**
 * What this device can run the stem model on: its graphics card (seconds per song), its processor
 * (minutes per song), or nothing, on phones and tablets, where the model does not fit in memory.
 */
export type AnalysisDevice = 'gpu' | 'cpu' | 'none';

let cached: Promise<AnalysisDevice> | null = null;

async function detect(): Promise<AnalysisDevice> {
  // Development only: `localStorage['festival.dev.analysis-device'] = 'cpu'` (or 'none') to try the other paths.
  if (import.meta.env.DEV) {
    try {
      const forced = localStorage.getItem('festival.dev.analysis-device');
      if (forced === 'gpu' || forced === 'cpu' || forced === 'none') return forced;
    } catch {
      /* storage unavailable */
    }
  }
  const nav = navigator as Navigator & {
    gpu?: { requestAdapter(): Promise<unknown> };
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean };
  };
  const handheld = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(nav.userAgent);
  // A segment needs about 2.5 GB while it runs.
  if (handheld || (nav.deviceMemory !== undefined && nav.deviceMemory < 4)) return 'none';
  try {
    if (nav.gpu && (await nav.gpu.requestAdapter())) return 'gpu';
  } catch {
    /* no adapter */
  }
  return 'cpu';
}

export function analysisDevice(): Promise<AnalysisDevice> {
  cached ??= detect();
  return cached;
}
