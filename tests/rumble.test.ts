import { describe, expect, it } from 'vitest';
import { HIT_FEEL, motorPulse, plainOnActuators, RUMBLE_SCALE } from '../src/input/rumble';

describe('rumble on plain motors', () => {
  it('never asks a motor for less than it starts at, or for shorter than it takes to be felt', () => {
    for (const level of ['weak', 'strong'] as const)
      for (const grade of ['perfect', 'great', 'good'] as const) {
        const { amp, ms, floor } = HIT_FEEL[grade];
        for (const pan of [-1, -0.5, 0, 0.5, 1]) {
          const m = motorPulse({ pan, amp, ms, kind: 'click', floor }, RUMBLE_SCALE[level])!;
          expect(m.strong).toBeGreaterThanOrEqual(0.32);
          expect(m.weak).toBeGreaterThanOrEqual(0.32);
          expect(m.ms).toBeGreaterThanOrEqual(60);
        }
      }
    // A menu move was a 22 ms pulse at a fifth of full strength: too little for a motor to turn.
    const move = motorPulse({ pan: 0, amp: 0.22, ms: 22, kind: 'click' }, 1)!;
    expect(move.ms).toBe(60);
    expect(Math.max(move.strong, move.weak)).toBeGreaterThan(0.45);
  });

  it('keeps the feel of the grade, the side and the setting', () => {
    const at = (grade: keyof typeof HIT_FEEL, k = 1, pan = 0) => {
      const { amp, ms, floor } = HIT_FEEL[grade];
      return motorPulse({ pan, amp, ms, kind: 'click', floor }, k)!;
    };
    expect(at('perfect').weak).toBeGreaterThan(at('great').weak);
    expect(at('great').weak).toBeGreaterThan(at('good').weak);
    expect(at('great', RUMBLE_SCALE.weak).weak).toBeLessThan(at('great').weak);
    // A lane on the right: the right grip's light motor leads, the left one is eased off, not stopped.
    const right = at('great', 1, 1);
    expect(right.weak).toBeGreaterThan(right.strong);
    // A thud is carried by the heavy motor.
    const thud = motorPulse({ pan: 0, amp: 1, ms: 130, kind: 'thud' }, 1)!;
    expect(thud.strong).toBeGreaterThan(thud.weak);
  });

  it('plays nothing when rumble is off or the effect has no strength', () => {
    expect(motorPulse({ pan: 0, amp: 1, ms: 100, kind: 'click' }, RUMBLE_SCALE.off)).toBeNull();
    expect(motorPulse({ pan: 0, amp: 0, ms: 100, kind: 'click' }, 1)).toBeNull();
  });

  it('plays a DualSense with 3D haptics off as the two motors: heavy left, light right, as long', () => {
    const e = { pan: 0, amp: 1, ms: 130, kind: 'thud' as const };
    const m = motorPulse(e, 1)!;
    const p = plainOnActuators(e, 1)!;
    expect(p.kind).toBe('rumble');
    expect(p.ms).toBe(m.ms);
    // Constant-power pan back to the grips' strengths.
    const a = ((p.pan + 1) * Math.PI) / 4;
    const scale = p.amp / Math.hypot(m.strong, m.weak);
    expect(p.amp * Math.cos(a)).toBeCloseTo(m.strong * scale, 5);
    expect(p.amp * Math.sin(a)).toBeCloseTo(m.weak * scale, 5);
    expect(p.pan).toBeLessThan(0);
    expect(plainOnActuators(e, RUMBLE_SCALE.off)).toBeNull();
  });
});
