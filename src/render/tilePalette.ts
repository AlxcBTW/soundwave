/**
 * The colours of a tile, as they show on screen (sRGB: the highway's shaders write them as they
 * are, and the track editor draws with them), in the order of TILE_BANDS: from the top of the bar
 * down, its dark top edge, the line of light just inside it, its upper band, a darker dip, its
 * middle, its deep lower band, the light rising from its base and the pale base plate; then the
 * white of the light it reflects, the streak down its left end, the light and the shade of its
 * sustain rod, and the glow round it.
 */
export const TILE_BANDS = ['edge', 'hi', 'up', 'dip', 'mid', 'low', 'rise', 'base', 'glare', 'streak', 'rodHi', 'rodLo', 'halo'] as const;
/** One palette per lane, then the tiles that hold overdrive (silver) and every tile while overdrive lasts (light blue). */
export const TILE_PALETTES = [
  // green
  [0x107100, 0xa5f6c4, 0x12a200, 0x0f7000, 0x0a7500, 0x005002, 0x086a00, 0xb8f1ba, 0xc1e5c2, 0x94f5c4, 0x4ba750, 0x176c1a, 0x03ab00],
  // red
  [0x9a0800, 0xffb08c, 0xd81c06, 0x990900, 0x9e1002, 0x6c0a00, 0x900b00, 0xfbaf9d, 0xffccbf, 0xffac7e, 0xc8553e, 0x8a2414, 0xe02810],
  // yellow
  [0x9a7008, 0xffef65, 0xe5b115, 0xa05e00, 0xb06a00, 0x703000, 0x8a5300, 0xffecb8, 0xfffbc9, 0xfff9a3, 0xc4a157, 0x8a6a1c, 0xe8a812],
  // blue
  [0x00548c, 0xa8c6ff, 0x0079c9, 0x00538c, 0x005792, 0x003a65, 0x004e85, 0x99c9ff, 0xbfddff, 0xa8c1ff, 0x2581d4, 0x00508a, 0x007fd4],
  // orange
  [0xa14b19, 0xffd195, 0xe97a26, 0xa23d1c, 0xad461e, 0x711c13, 0x923519, 0xffceb3, 0xffe4cd, 0xffd5a6, 0xcd7d53, 0x904b21, 0xed742c],
  // holds overdrive
  [0x94a1be, 0xf4fcff, 0xc2cde5, 0x8392b1, 0xa0afd0, 0x6c7b9f, 0x94a0b1, 0xe9f4ff, 0xf5ffff, 0xecf7ff, 0xb2b6c8, 0x74798a, 0xdceaff],
  // overdrive
  [0x56acdb, 0xecfffe, 0x95d7fd, 0x359dcf, 0x56bbf1, 0x0085bc, 0x70a8c0, 0xdff8ff, 0xf7fffb, 0xe1fbff, 0x96bcdd, 0x577f9d, 0xcdefff],
];
export const PHRASE_KIND = 5;
export const DRIVE_KIND = 6;
export type TileBand = (typeof TILE_BANDS)[number];

/** One colour of a kind of tile, as a number (0xrrggbb). */
export const tileColour = (kind: number, name: TileBand) => TILE_PALETTES[kind][TILE_BANDS.indexOf(name)];
