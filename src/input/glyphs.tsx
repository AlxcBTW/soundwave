import type { GlyphStyle, PadInput } from './pads';

export const STYLE_LABEL: Record<GlyphStyle, string> = {
  xbox: 'Xbox',
  ps4: 'PlayStation 4',
  ps5: 'PlayStation 5',
  switch: 'Nintendo Switch',
};

type Face = 'bottom' | 'right' | 'left' | 'top';
const FACE: Record<string, Face> = { b0: 'bottom', b1: 'right', b2: 'left', b3: 'top' };

const XBOX_FACE: Record<Face, [string, string]> = { bottom: ['A', '#4fd36a'], right: ['B', '#ff5466'], left: ['X', '#3d9bff'], top: ['Y', '#ffd23d'] };
const SWITCH_FACE: Record<Face, string> = { bottom: 'B', right: 'A', left: 'Y', top: 'X' };
const PS_FACE: Record<Face, [string, string]> = { bottom: ['Cross', '#7fb4ff'], right: ['Circle', '#ff6b6b'], left: ['Square', '#ff8ad8'], top: ['Triangle', '#3fe0b0'] };

const SHOULDER: Record<GlyphStyle, Record<string, string>> = {
  xbox: { b4: 'LB', b5: 'RB', b6: 'LT', b7: 'RT', b10: 'LS', b11: 'RS' },
  ps4: { b4: 'L1', b5: 'R1', b6: 'L2', b7: 'R2', b10: 'L3', b11: 'R3' },
  ps5: { b4: 'L1', b5: 'R1', b6: 'L2', b7: 'R2', b10: 'L3', b11: 'R3' },
  switch: { b4: 'L', b5: 'R', b6: 'ZL', b7: 'ZR', b10: 'LS', b11: 'RS' },
};

const MENU: Record<GlyphStyle, Record<string, string>> = {
  xbox: { b8: 'View', b9: 'Menu', b16: 'Guide', b17: 'Share' },
  ps4: { b8: 'Share', b9: 'Options', b16: 'PS', b17: 'Touchpad' },
  ps5: { b8: 'Create', b9: 'Options', b16: 'PS', b17: 'Touchpad' },
  switch: { b8: '−', b9: '+', b16: 'Home', b17: 'Capture' },
};

const DPAD: Record<string, [string, string]> = { b12: ['up', 'Up'], b13: ['down', 'Down'], b14: ['left', 'Left'], b15: ['right', 'Right'] };
const ARROW: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };

function stick(input: PadInput): { side: 'L' | 'R'; dir: 'up' | 'down' | 'left' | 'right' } | undefined {
  const m = /^a(\d+)([+-])$/.exec(input);
  if (!m) return undefined;
  const axis = +m[1];
  if (axis > 3) return undefined;
  const vertical = axis % 2 === 1;
  const neg = m[2] === '-';
  return { side: axis < 2 ? 'L' : 'R', dir: vertical ? (neg ? 'up' : 'down') : neg ? 'left' : 'right' };
}

/** Spoken name of an input, e.g. "Cross", "LB", "D-pad Up", "Left stick Left". */
export function inputName(input: PadInput, style: GlyphStyle): string {
  const face = FACE[input];
  if (face) return style === 'xbox' ? XBOX_FACE[face][0] : style === 'switch' ? SWITCH_FACE[face] : PS_FACE[face][0];
  if (SHOULDER[style][input]) return SHOULDER[style][input];
  if (MENU[style][input]) return style === 'switch' && (input === 'b8' || input === 'b9') ? (input === 'b8' ? 'Minus' : 'Plus') : MENU[style][input];
  if (DPAD[input]) return `D-pad ${DPAD[input][1]}`;
  const s = stick(input);
  if (s) return `${s.side === 'L' ? 'Left' : 'Right'} stick ${s.dir[0].toUpperCase()}${s.dir.slice(1)}`;
  const b = /^b(\d+)$/.exec(input);
  if (b) return `Button ${+b[1] + 1}`;
  const a = /^a(\d+)([+-])$/.exec(input);
  return a ? `Axis ${+a[1] + 1} ${a[2]}` : input;
}

const BASE = '#1b1630';
const RING = 'rgba(255,255,255,0.55)';

function PsSymbol({ face, color }: { face: Face; color: string }) {
  const s = { stroke: color, strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (face === 'bottom') return <path d="M11 11 L21 21 M21 11 L11 21" {...s} />;
  if (face === 'right') return <circle cx="16" cy="16" r="5.6" {...s} />;
  if (face === 'left') return <rect x="10.6" y="10.6" width="10.8" height="10.8" rx="0.8" {...s} />;
  return <path d="M16 9.6 L22.4 20.8 L9.6 20.8 Z" {...s} />;
}

/** A controller button, trigger or stick direction drawn in the given controller's style. */
export function PadGlyph({ input, style, className }: { input: PadInput; style: GlyphStyle; className?: string }) {
  const name = inputName(input, style);
  const cls = `glyph ${className ?? ''}`;
  const face = FACE[input];
  if (face) {
    const ps = style === 'ps4' || style === 'ps5';
    const [letter, color] = style === 'xbox' ? XBOX_FACE[face] : style === 'switch' ? [SWITCH_FACE[face], '#f2f0ff'] : PS_FACE[face];
    // PS5 symbols are monochrome; PS4 keeps the classic colours.
    const symColor = style === 'ps5' ? '#e8e6f5' : color;
    return (
      <svg className={cls} viewBox="0 0 32 32" role="img" aria-label={name}>
        <title>{name}</title>
        <circle cx="16" cy="16" r="14" fill={BASE} stroke={style === 'xbox' ? color : RING} strokeWidth="1.6" />
        {ps ? (
          <PsSymbol face={face} color={symColor} />
        ) : (
          <text x="16" y="21.5" textAnchor="middle" fontSize="15" fontWeight="800" fill={color}>{letter}</text>
        )}
      </svg>
    );
  }
  const dpad = DPAD[input];
  if (dpad) {
    const dir = dpad[0];
    const arm = (d: string, x: number, y: number, w: number, h: number) => (
      <rect key={d} x={x} y={y} width={w} height={h} rx="2" fill={d === dir ? '#f2f0ff' : 'rgba(255,255,255,0.22)'} />
    );
    return (
      <svg className={cls} viewBox="0 0 32 32" role="img" aria-label={name}>
        <title>{name}</title>
        {arm('up', 12, 3, 8, 10)}
        {arm('down', 12, 19, 8, 10)}
        {arm('left', 3, 12, 10, 8)}
        {arm('right', 19, 12, 10, 8)}
        <rect x="12" y="12" width="8" height="8" fill="rgba(255,255,255,0.22)" />
      </svg>
    );
  }
  const st = stick(input);
  if (st) {
    return (
      <svg className={cls} viewBox="0 0 32 32" role="img" aria-label={name}>
        <title>{name}</title>
        <circle cx="16" cy="16" r="14" fill={BASE} stroke={RING} strokeWidth="1.6" />
        <circle cx="16" cy="16" r="8.5" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.4" />
        <text x="16" y="20" textAnchor="middle" fontSize="11" fontWeight="800" fill="#f2f0ff">{st.side}</text>
        <text
          x={st.dir === 'left' ? 4.5 : st.dir === 'right' ? 27.5 : 16}
          y={st.dir === 'up' ? 9 : st.dir === 'down' ? 30 : 19.5}
          textAnchor="middle"
          fontSize="9"
          fontWeight="900"
          fill="#3ad4ff"
        >
          {ARROW[st.dir]}
        </text>
      </svg>
    );
  }
  // Shoulders, triggers, menu buttons and anything else: a labelled pill sized to its text.
  const label = SHOULDER[style][input] ?? MENU[style][input] ?? name;
  const trigger = input === 'b6' || input === 'b7';
  const w = Math.max(32, 12 + label.length * 8.2);
  return (
    <svg className={cls} viewBox={`0 0 ${w} 32`} style={{ aspectRatio: `${w} / 32` }} role="img" aria-label={name}>
      <title>{name}</title>
      <rect x="1" y={trigger ? 2 : 6} width={w - 2} height={trigger ? 28 : 20} rx={trigger ? 9 : 6} fill={BASE} stroke={RING} strokeWidth="1.6" />
      <text x={w / 2} y="20.5" textAnchor="middle" fontSize={label.length > 5 ? 10 : 12.5} fontWeight="800" fill="#f2f0ff">{label}</text>
    </svg>
  );
}
