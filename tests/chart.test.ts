import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../src/analysis/types';
import { generateChart } from '../src/chart/generator';
import { PROFILES } from '../src/chart/profiles';
import { DIFFICULTIES, PARTS, lanesFor } from '../src/chart/types';

function fakeAnalysis(): AnalysisResult {
  const spb = 0.5;
  const beats = Array.from({ length: 240 }, (_, i) => 1 + i * spb);
  const drums: AnalysisResult['drums'] = [];
  const bass: AnalysisResult['bass'] = [];
  const lead: AnalysisResult['lead'] = [];
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  beats.forEach((t, i) => {
    drums.push({ t: t + 0.01, kind: 'kick', strength: 0.9 });
    if (i % 2) drums.push({ t: t - 0.008, kind: 'snare', strength: 0.8 });
    drums.push({ t: t + spb / 2, kind: 'hat', strength: 0.4 });
    drums.push({ t: t + spb / 4, kind: 'hat', strength: 0.2 });
    bass.push({ t, dur: i % 8 === 0 ? spb * 2 : spb * 0.4, midi: 40 + (i % 4) * 2, strength: 0.7 });
    lead.push({ t: t + 0.01, dur: spb * 0.45, midi: scale[(i * 3) % scale.length], strength: 0.6 });
    lead.push({ t: t + spb / 2, dur: i % 4 === 3 ? spb * 1.5 : spb * 0.2, midi: scale[(i * 5) % scale.length], strength: 0.4 });
  });
  return {
    version: 1,
    source: 'local',
    duration: 1 + 240 * spb,
    tempo: 120,
    beats,
    downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0),
    drums,
    bass,
    lead,
    vocals: lead.map((n) => ({ ...n, midi: n.midi + 2, bend: 0.2 })),
    harmony: beats.filter((_, i) => i % 8 === 0).map((t, i) => ({ t, root: i % 12, minor: false, strength: 0.8 })),
    sections: [
      { start: 0, end: 40, energy: 0.4 },
      { start: 40, end: 121, energy: 1 },
    ],
    energy: [],
    energyHop: 0.1,
    pitchSource: 'salience',
  };
}

describe('generateChart', () => {
  const a = fakeAnalysis();
  for (const part of PARTS) {
    for (const d of DIFFICULTIES) {
      it(`${part}/${d} respects lanes, gaps, chords and sustains`, () => {
        const c = generateChart(a, part, d, 'song');
        const p = PROFILES[d];
        expect(c.lanes).toBe(lanesFor(d));
        expect(c.notes.length).toBeGreaterThan(20);
        const times = [...new Set(c.notes.map((n) => n.t))].sort((x, y) => x - y);
        for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(p.minGap - 1e-6);
        const perTime = new Map<number, number>();
        for (const n of c.notes) {
          expect(n.lane).toBeGreaterThanOrEqual(0);
          expect(n.lane).toBeLessThan(c.lanes);
          perTime.set(n.t, (perTime.get(n.t) ?? 0) + 1);
        }
        for (const v of perTime.values()) expect(v).toBeLessThanOrEqual(p.maxChord);
        for (let i = 0; i < c.notes.length; i++) {
          const n = c.notes[i];
          if (!n.dur) continue;
          for (const m of c.notes) {
            if (m.lane === n.lane && m.t > n.t) expect(m.t).toBeGreaterThan(n.t + n.dur);
          }
        }
        for (let i = 1; i < c.notes.length; i++) expect(c.notes[i].t).toBeGreaterThanOrEqual(c.notes[i - 1].t);
      });
    }
  }

  it('is deterministic', () => {
    expect(generateChart(a, 'lead', 'expert', 'x')).toEqual(generateChart(a, 'lead', 'expert', 'x'));
  });

  it('gets denser with difficulty', () => {
    for (const part of PARTS) {
      const counts = DIFFICULTIES.map((d) => generateChart(a, part, d, 's').notes.length);
      for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });

  it('marks overdrive phrases', () => {
    const c = generateChart(a, 'drums', 'medium', 's');
    const phrases = new Set(c.notes.filter((n) => n.phrase >= 0).map((n) => n.phrase));
    expect(phrases.size).toBeGreaterThan(3);
  });

  it('uses 5 lanes only on expert', () => {
    const used = new Set(generateChart(a, 'lead', 'expert', 's').notes.map((n) => n.lane));
    expect(used.has(4)).toBe(true);
    const hard = new Set(generateChart(a, 'lead', 'hard', 's').notes.map((n) => n.lane));
    expect(hard.has(4)).toBe(false);
  });
});
