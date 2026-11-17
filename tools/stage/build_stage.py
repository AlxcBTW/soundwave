"""
Builds the festival main stage procedurally in Blender and renders it.

    blender -b --factory-startup -P tools/stage/build_stage.py -- \
        --view hero --out local-audio/stage/hero.png --samples 256 --res 2560x1440 [--save stage.blend]

The stage: a sun court. A fantasy palace of round arches glowing from within, onion domes and
round towers, gilt ornament and strings of bulbs, stepping out from a great arched gate (holding the
screen) under a gilded sun. A wheel turns on one wing, an armillary sphere on the other; firework
fans burst over the skyline and CO2 rolls over the crowd. Everything is generated, so the scene
stays reviewable as code and can be re-tuned or re-exported for the game.

Axes: Z up, metres. The stage front edge is y = 0; the stage extends into +y, the crowd into -y.
"""
import argparse
import math
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

# ---------------------------------------------------------------- arguments
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--view', default='hero')
ap.add_argument('--out', default='//stage.png')
ap.add_argument('--samples', type=int, default=128)
ap.add_argument('--res', default='1920x1080')
ap.add_argument('--save', default='')
ap.add_argument('--crowd', type=int, default=16000)
ap.add_argument('--trees', type=int, default=1400)
ap.add_argument('--export', default='', help='write the real-time version (GLB + JSON) to this folder instead of rendering')
args = ap.parse_args(argv)

random.seed(11)

# ---------------------------------------------------------------- palette
MAGENTA = (1.0, 0.18, 0.55)
CYAN = (0.2, 0.9, 1.0)
VIOLET = (0.55, 0.32, 1.0)
LILAC = (0.85, 0.75, 1.0)
GOLD = (1.0, 0.78, 0.28)
WARM = (1.0, 0.55, 0.22)
BLUE = (0.22, 0.32, 1.0)
WHITE = (1.0, 1.0, 1.0)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
root_col = scene.collection


def collection(name):
    c = bpy.data.collections.new(name)
    root_col.children.link(c)
    return c


COL = {k: collection(k) for k in ('Stage', 'Detail', 'Lights', 'Crowd', 'Environment', 'Band', 'FX', 'Cameras')}


def link(o, where='Stage'):
    COL[where].objects.link(o)
    return o


def srgb(c):
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


# ---------------------------------------------------------------- materials
def mat_emit(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*srgb(color), 1)
    em.inputs['Strength'].default_value = strength
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def mat_pbr(name, color, rough=0.5, metal=0.0, emit=None, emit_strength=0.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*srgb(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if transmission:
        p.inputs['Transmission Weight'].default_value = transmission
    if emit:
        p.inputs['Emission Color'].default_value = (*srgb(emit), 1)
        p.inputs['Emission Strength'].default_value = emit_strength
    return m


def mat_panels(name, color, rough=0.3, metal=0.3, scale=(0.18, 0.12), bump=0.25):
    """Cladding with panel seams: a brick texture in object space drives a bump and roughness."""
    m = mat_pbr(name, color, rough, metal)
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (scale[0], scale[0], scale[1])
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.inputs['Mortar Size'].default_value = 0.012
    br.inputs['Color1'].default_value = (1, 1, 1, 1)
    br.inputs['Color2'].default_value = (0.82, 0.82, 0.82, 1)
    br.inputs['Mortar'].default_value = (0, 0, 0, 1)
    br.offset = 0.0
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs[0], br.inputs['Vector'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = bump
    nt.links.new(br.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], p.inputs['Normal'])
    # tiles vary slightly in roughness so reflections break up
    rr = nt.nodes.new('ShaderNodeMapRange')
    rr.inputs['To Min'].default_value = rough * 0.7
    rr.inputs['To Max'].default_value = rough * 1.3
    nt.links.new(br.outputs['Color'], rr.inputs['Value'])
    nt.links.new(rr.outputs[0], p.inputs['Roughness'])
    return m


def mat_screen(name, a, b, c, kind='rings', scale=1.0, strength=2.5):
    """LED screen content: a procedural graphic in the stage palette."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = strength
    tc = nt.nodes.new('ShaderNodeTexCoord')
    if kind == 'rings':
        tex = nt.nodes.new('ShaderNodeTexWave')
        tex.wave_type = 'RINGS'
        tex.inputs['Scale'].default_value = 1.6 * scale
        tex.inputs['Distortion'].default_value = 3.0
        tex.inputs['Detail'].default_value = 3
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Location'].default_value = (-0.5, 0.0, -0.5)
        nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
        nt.links.new(mp.outputs[0], tex.inputs['Vector'])
        fac = tex.outputs['Color']
    else:
        tex = nt.nodes.new('ShaderNodeTexWave')
        tex.wave_type = 'BANDS'
        tex.bands_direction = 'Z'
        tex.inputs['Scale'].default_value = 3.0 * scale
        tex.inputs['Distortion'].default_value = 8.0
        tex.inputs['Detail'].default_value = 2
        nt.links.new(tc.outputs['Generated'], tex.inputs['Vector'])
        fac = tex.outputs['Color']
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.0, (*srgb(a), 1)
    el[1].position, el[1].color = 1.0, (*srgb(c), 1)
    mid = el.new(0.55)
    mid.color = (*srgb(b), 1)
    nt.links.new(fac, ramp.inputs[0])
    # LED pixel grid: a fine dark lattice over the image
    px = nt.nodes.new('ShaderNodeTexBrick')
    px.inputs['Scale'].default_value = 160 * scale
    px.inputs['Mortar Size'].default_value = 0.08
    px.inputs['Brick Width'].default_value = 1.0
    px.inputs['Row Height'].default_value = 1.0
    px.offset = 0.0
    px.inputs['Color1'].default_value = (1, 1, 1, 1)
    px.inputs['Color2'].default_value = (1, 1, 1, 1)
    px.inputs['Mortar'].default_value = (0.25, 0.25, 0.25, 1)
    nt.links.new(tc.outputs['Generated'], px.inputs['Vector'])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(ramp.outputs[0], mix.inputs['A'])
    nt.links.new(px.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


M = {
    'slab': mat_panels('Slab', (0.035, 0.03, 0.075), rough=0.3, metal=0.35, scale=(0.22, 0.14)),
    'panel': mat_panels('Panel', (0.07, 0.06, 0.13), rough=0.38, metal=0.5, scale=(0.55, 0.55), bump=0.15),
    'trim': mat_pbr('Trim', (0.5, 0.48, 0.55), rough=0.25, metal=1.0),
    'deck': mat_panels('Deck', (0.03, 0.028, 0.045), rough=0.2, metal=0.2, scale=(0.5, 0.5), bump=0.1),
    'truss': mat_pbr('Truss', (0.62, 0.62, 0.66), rough=0.3, metal=1.0),
    'black': mat_pbr('Black', (0.012, 0.012, 0.015), rough=0.55),
    'grille': mat_panels('Grille', (0.02, 0.02, 0.025), rough=0.8, metal=0.2, scale=(14, 14), bump=0.4),
    'glass': mat_pbr('Crystal', (0.6, 0.5, 1.0), rough=0.08, transmission=0.85, emit=VIOLET, emit_strength=0.6),
    'warm': mat_emit('WarmGlow', WARM, 9),
    'edge_m': mat_emit('EdgeMagenta', MAGENTA, 28),
    'edge_c': mat_emit('EdgeCyan', CYAN, 28),
    'edge_v': mat_emit('EdgeViolet', VIOLET, 22),
    'edge_l': mat_emit('EdgeLilac', LILAC, 14),
    'edge_g': mat_emit('EdgeGold', GOLD, 18),
}
PIX_ON = {c: mat_emit('PixOn', c, 9) for c in (MAGENTA, CYAN, VIOLET, GOLD)}
PIX_OFF = mat_emit('PixOff', (0.18, 0.12, 0.4), 0.5)
EDGE = {MAGENTA: M['edge_m'], CYAN: M['edge_c'], VIOLET: M['edge_v'], LILAC: M['edge_l'], GOLD: M['edge_g']}


# ---------------------------------------------------------------- geometry helpers
def bm_obj(name, bm, mats, where='Stage', smooth=False):
    me = bpy.data.meshes.new(name)
    if smooth:
        for f in bm.faces:
            f.smooth = True
    bm.to_mesh(me)
    bm.free()
    for m in mats if isinstance(mats, (list, tuple)) else [mats]:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    return link(o, where)


def place(o, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    o.location = loc
    o.rotation_euler = rot
    if parent is not None:
        o.parent = parent
    return o


def bm_box(bm, size, center, rot=None, bevel=0.0, segs=1):
    """Adds a box to bm (optionally bevelled) and returns its faces."""
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    for v in tmp.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel > 0:
        bmesh.ops.bevel(tmp, geom=list(tmp.verts) + list(tmp.edges), offset=min(bevel, *(s / 3 for s in size)),
                        segments=segs, affect='EDGES', profile=0.5)
    mat = Matrix.Translation(center) @ (rot.to_matrix().to_4x4() if rot else Matrix.Identity(4))
    for v in tmp.verts:
        v.co = mat @ v.co
    me = bpy.data.meshes.new('_tmp')
    tmp.to_mesh(me)
    tmp.free()
    before = set(bm.faces)
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    return [f for f in bm.faces if f not in before]


def bm_cyl(bm, p1, p2, r, segs=8, r2=None):
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    q = d.to_track_quat('Z', 'Y')
    m = Matrix.Translation((p1 + p2) / 2) @ q.to_matrix().to_4x4()
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=d.length, matrix=m)
    return res['verts']


def box_obj(name, size, loc, mat, rot=(0, 0, 0), bevel=0.0, segs=1, where='Stage', parent=None):
    bm = bmesh.new()
    bm_box(bm, size, Vector((0, 0, 0)), bevel=bevel, segs=segs)
    return place(bm_obj(name, bm, mat, where), loc, rot, parent)


def empty(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, where='Stage'):
    o = bpy.data.objects.new(name, None)
    link(o, where)
    return place(o, loc, rot, parent)


def pentagon(w, h, peak):
    x = w / 2
    return [(-x, 0), (x, 0), (x, h - peak), (0, h), (-x, h - peak)]


def bm_prism(bm, poly, depth, y0=0.0):
    """Extrudes a 2D polygon (x, z) along +y from y0."""
    vs_front = [bm.verts.new((x, y0, z)) for x, z in poly]
    vs_back = [bm.verts.new((x, y0 + depth, z)) for x, z in poly]
    bm.faces.new(list(reversed(vs_front)))
    bm.faces.new(vs_back)
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([vs_front[i], vs_front[j], vs_back[j], vs_back[i]])


def bm_ring(bm, outer, inner, depth, y0=0.0):
    """A frame between two polygons with the same vertex count, extruded along +y."""
    n = len(outer)
    of = [bm.verts.new((x, y0, z)) for x, z in outer]
    inf = [bm.verts.new((x, y0, z)) for x, z in inner]
    ob = [bm.verts.new((x, y0 + depth, z)) for x, z in outer]
    ib = [bm.verts.new((x, y0 + depth, z)) for x, z in inner]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([of[i], of[j], inf[j], inf[i]])
        bm.faces.new([ob[j], ob[i], ib[i], ib[j]])
        bm.faces.new([of[j], of[i], ob[i], ob[j]])
        bm.faces.new([inf[i], inf[j], ib[j], ib[i]])


# ---------------------------------------------------------------- lights
LIGHT_COUNT = [0]
# a narrow beam crosses only a metre or so of haze side-on, so beam fixtures need huge power
BEAM = 24.0


def spot(name, loc, target, color, energy, size_deg, blend=0.2, radius=0.08, fixture=True, haze=True):
    d = bpy.data.lights.new(name, 'SPOT')
    d.energy = energy
    d.color = color
    d.spot_size = math.radians(size_deg)
    d.spot_blend = blend
    d.shadow_soft_size = radius
    o = bpy.data.objects.new(name, d)
    direction = (Vector(target) - Vector(loc)).normalized()
    o.location = Vector(loc) + direction * 0.35
    o.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    # only beam fixtures light the haze; washes would fog it evenly and drown the beams
    o.visible_volume_scatter = haze
    link(o, 'Lights')
    LIGHT_COUNT[0] += 1
    if fixture:
        # moving head: yoke + head, lens glowing in the beam colour
        bm = bmesh.new()
        bm_cyl(bm, (0, 0, 0.32), (0, 0, -0.1), 0.24, segs=14)
        bm_box(bm, (0.6, 0.12, 0.5), Vector((0, 0.24, 0.25)))
        bm_box(bm, (0.6, 0.12, 0.5), Vector((0, -0.24, 0.25)))
        f = bm_obj(name + '_fx', bm, M['black'], 'Lights')
        f.location = loc
        f.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        lens_bm = bmesh.new()
        bm_cyl(lens_bm, (0, 0, -0.11), (0, 0, -0.13), 0.2, segs=14)
        lens = bm_obj(name + '_lens', lens_bm, lens_mat(color), 'Lights')
        lens.parent = f
    return o


_LENS = {}


def lens_mat(color):
    k = tuple(round(c, 3) for c in color)
    if k not in _LENS:
        _LENS[k] = mat_emit('Lens', color, 60)
    return _LENS[k]


def point(name, loc, color, energy, radius=0.4):
    d = bpy.data.lights.new(name, 'POINT')
    d.energy = energy
    d.color = color
    d.shadow_soft_size = radius
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.visible_volume_scatter = False
    LIGHT_COUNT[0] += 1
    return link(o, 'Lights')


def area(name, loc, target, color, energy, size, shape='SQUARE', size_y=None):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.color = color
    d.shape = shape
    d.size = size
    if size_y:
        d.size_y = size_y
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    o.visible_volume_scatter = False
    LIGHT_COUNT[0] += 1
    return link(o, 'Lights')


# =================================================================== LED PIXELS
def pixel_face(name, w, h, pattern, color, parent, y, z0=0.0, pitch=1.15, cell=0.42):
    """A grid of LED pixel tiles on a slab face; `pattern(col, row, cols, rows)` says which are lit."""
    cols, rows = max(1, int(w / pitch)), max(1, int(h / pitch))
    on, off = bmesh.new(), bmesh.new()
    x0 = -(cols - 1) * pitch / 2
    for r in range(rows):
        for c in range(cols):
            bm = on if pattern(c, r, cols, rows) else off
            cx, cz = x0 + c * pitch, z0 + pitch / 2 + r * pitch
            s = cell / 2
            vs = [bm.verts.new((cx - s, y, cz - s)), bm.verts.new((cx + s, y, cz - s)), bm.verts.new((cx + s, y, cz + s)), bm.verts.new((cx - s, y, cz + s))]
            bm.faces.new(vs)
    a = bm_obj(name + '_on', on, PIX_ON[color])
    b = bm_obj(name + '_off', off, PIX_OFF)
    a.parent = parent
    b.parent = parent


def chevrons(c, r, cols, rows):
    mid = (cols - 1) / 2
    return (r - abs(c - mid) * 1.0) % 7 < 1.6


def sweep(c, r, cols, rows):
    return (r + c * 0.6) % 9 < 1.4


def columns(c, r, cols, rows):
    return c % 3 == 1 and (r * 7 + c * 13) % 11 > 2


# =================================================================== NODE HELPERS
def mix_rgba(nt, a, b, fac, blend='MIX'):
    """A colour Mix node wired by socket type (the node has float/vector/colour twins)."""
    n = nt.nodes.new('ShaderNodeMix')
    n.data_type = 'RGBA'
    n.blend_type = blend
    for key, v in (('A', a), ('B', b)):
        sock = [s for s in n.inputs if s.name == key and s.type == 'RGBA'][0]
        if isinstance(v, tuple):
            sock.default_value = v
        else:
            nt.links.new(v, sock)
    fsock = [s for s in n.inputs if s.name == 'Factor' and s.type == 'VALUE'][0]
    if isinstance(fac, float):
        fsock.default_value = fac
    else:
        nt.links.new(fac, fsock)
    return [s for s in n.outputs if s.name == 'Result' and s.type == 'RGBA'][0]


def mnode(nt, op, a, b=None):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    for k, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[k].default_value = float(v)
        else:
            nt.links.new(v, n.inputs[k])
    return n.outputs[0]


def ramp_node(nt, stops, src):
    r = nt.nodes.new('ShaderNodeValToRGB')
    el = r.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], (*srgb(stops[0][1]), 1)
    el[1].position, el[1].color = stops[-1][0], (*srgb(stops[-1][1]), 1)
    for pos, c in stops[1:-1]:
        e = el.new(pos)
        e.color = (*srgb(c), 1)
    nt.links.new(src, r.inputs[0])
    return r.outputs[0]



def mat_sunburst(name, strength=3.0, rays=20, rings=9.0, aspect=1.0, cz=0.5, palette=None):
    """Wall content: rays and rings radiating from the centre, brightest in the middle."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    N, Lk = nt.nodes, nt.links
    out = N.new('ShaderNodeOutputMaterial')
    em = N.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = strength
    tc = N.new('ShaderNodeTexCoord')
    sp = N.new('ShaderNodeSeparateXYZ')
    Lk.new(tc.outputs['Generated'], sp.inputs[0])

    def math_node(op, a, b=None, v=None):
        n = N.new('ShaderNodeMath')
        n.operation = op
        Lk.new(a, n.inputs[0]) if not isinstance(a, float) else None
        if isinstance(a, float):
            n.inputs[0].default_value = a
        if b is not None:
            if isinstance(b, float):
                n.inputs[1].default_value = b
            else:
                Lk.new(b, n.inputs[1])
        return n.outputs[0]

    x = math_node('MULTIPLY', math_node('SUBTRACT', sp.outputs['X'], 0.5), aspect)
    z = math_node('SUBTRACT', sp.outputs['Z'], cz)
    ang = math_node('ARCTAN2', z, x)
    rad = math_node('SQRT', math_node('ADD', math_node('MULTIPLY', x, x), math_node('MULTIPLY', z, z)))
    ray = math_node('POWER', math_node('ABSOLUTE', math_node('SINE', math_node('MULTIPLY', ang, float(rays / 2)))), 6.0)
    ring = math_node('POWER', math_node('ABSOLUTE', math_node('SINE', math_node('SUBTRACT', math_node('MULTIPLY', rad, rings), 0.0))), 10.0)
    core = math_node('POWER', math_node('MAXIMUM', math_node('SUBTRACT', 1.0, math_node('MULTIPLY', rad, 2.2)), 0.0), 2.0)
    fade = math_node('MAXIMUM', math_node('SUBTRACT', 1.0, math_node('MULTIPLY', rad, 0.9)), 0.12)
    val = math_node('ADD', math_node('MULTIPLY', math_node('ADD', math_node('MULTIPLY', ray, 0.7), math_node('MULTIPLY', ring, 0.55)), fade), core)
    ramp = N.new('ShaderNodeValToRGB')
    el = ramp.color_ramp.elements
    stops = palette or [(0.0, (0.0, 0.01, 0.05)), (0.35, (0.05, 0.25, 0.9)), (0.65, (0.4, 0.8, 1.0)), (1.0, (0.95, 0.98, 1.0))]
    el[0].position, el[0].color = stops[0][0], (*srgb(stops[0][1]), 1)
    el[1].position, el[1].color = stops[-1][0], (*srgb(stops[-1][1]), 1)
    for pos, c in stops[1:-1]:
        e = el.new(pos)
        e.color = (*srgb(c), 1)
    Lk.new(val, ramp.inputs[0])
    px = N.new('ShaderNodeTexBrick')
    px.inputs['Scale'].default_value = 140
    px.inputs['Mortar Size'].default_value = 0.08
    px.inputs['Brick Width'].default_value = 1.0
    px.inputs['Row Height'].default_value = 1.0
    px.offset = 0.0
    px.inputs['Color1'].default_value = (1, 1, 1, 1)
    px.inputs['Color2'].default_value = (1, 1, 1, 1)
    px.inputs['Mortar'].default_value = (0.25, 0.25, 0.25, 1)
    Lk.new(tc.outputs['Generated'], px.inputs['Vector'])
    mix = N.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    Lk.new(ramp.outputs[0], mix.inputs['A'])
    Lk.new(px.outputs['Color'], mix.inputs['B'])
    Lk.new(mix.outputs['Result'], em.inputs['Color'])
    Lk.new(em.outputs[0], out.inputs[0])
    return m




# =================================================================== STAGE: THE SUN COURT
WARM_W = (1.0, 0.62, 0.28)
AMBER = (1.0, 0.42, 0.1)
TEAL = (0.1, 0.75, 0.9)
ICE = (0.3, 0.65, 1.0)
DEEP = (0.05, 0.18, 1.0)
M['sand'] = mat_panels('Sandstone', (0.6, 0.48, 0.36), rough=0.6, metal=0.0, scale=(0.35, 0.25), bump=0.3)
M['sand2'] = mat_panels('SandstoneDark', (0.36, 0.27, 0.21), rough=0.65, metal=0.0, scale=(0.5, 0.35), bump=0.3)
M['gilt'] = mat_pbr('Gilt', (0.95, 0.66, 0.3), rough=0.28, metal=1.0)
M['patina'] = mat_pbr('Patina', (0.16, 0.5, 0.52), rough=0.38, metal=0.5)
M['rosetile'] = mat_pbr('RoseTile', (0.62, 0.2, 0.3), rough=0.42, metal=0.25)
M['bluetile'] = mat_pbr('BlueTile', (0.08, 0.16, 0.5), rough=0.35, metal=0.4)
M['bulbs'] = mat_emit('Bulbs', (1.0, 0.72, 0.38), 16)
M['bayglow'] = mat_emit('BayWarm', (1.0, 0.5, 0.18), 3.2)
M['baycool'] = mat_emit('BayCool', (0.25, 0.55, 1.0), 2.6)
WIN = {'warm': mat_emit('WinWarm', (1.0, 0.6, 0.26), 5), 'gold': mat_emit('WinGold', (1.0, 0.82, 0.5), 9),
       'blue': mat_emit('WinBlue', ICE, 3.5), 'dark': mat_pbr('WinDark', (0.03, 0.02, 0.015), rough=0.3)}
DOMES = [M['patina'], M['gilt'], M['rosetile'], M['bluetile']]
TOWER_TOPS = []


def catmull(points, n):
    pts = [Vector(q) for q in points]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t))
    out.append(pts[-1].copy())
    return out


def arch_poly(w, h, x0=0.0, z0=0.0, segs=12):
    """A round-headed arch outline (x, z): straight jambs, semicircular head."""
    r = w / 2
    spring = z0 + max(h - r, 0.01)
    return [(x0 - r, z0), (x0 + r, z0)] + [(x0 + r * math.cos(math.pi * k / segs), spring + r * math.sin(math.pi * k / segs)) for k in range(segs + 1)]


def add_prism(bm, poly, depth, matrix):
    """Extrudes a 2D polygon (x, z) along +y by `depth`, transformed into bm."""
    vf = [bm.verts.new(matrix @ Vector((x, 0, z))) for x, z in poly]
    vb = [bm.verts.new(matrix @ Vector((x, depth, z))) for x, z in poly]
    bm.faces.new(list(reversed(vf)))
    bm.faces.new(vb)
    for i in range(len(poly)):
        j = (i + 1) % len(poly)
        bm.faces.new([vf[i], vf[j], vb[j], vb[i]])


def lathe(bm, profile, segs=32, matrix=None):
    """Revolves an (r, z) profile around Z."""
    matrix = matrix or Matrix.Identity(4)
    rings = []
    for r, z in profile:
        if r < 1e-4:
            rings.append([bm.verts.new(matrix @ Vector((0, 0, z)))])
        else:
            rings.append([bm.verts.new(matrix @ Vector((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), z))) for k in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for k in range(segs):
            k2 = (k + 1) % segs
            if len(a) == 1 and len(b) > 1:
                bm.faces.new([a[0], b[k], b[k2]])
            elif len(b) == 1 and len(a) > 1:
                bm.faces.new([a[k], a[k2], b[0]])
            elif len(a) > 1:
                bm.faces.new([a[k], a[k2], b[k2], b[k]])


def roof_profile(kind, R):
    if kind == 'onion':
        return [(R, 0), (R * 1.12, R * 0.25), (R * 1.22, R * 0.6), (R * 1.08, R * 1.0), (R * 0.7, R * 1.35), (R * 0.3, R * 1.7),
                (R * 0.12, R * 2.0), (R * 0.07, R * 2.35), (0, R * 2.7)]
    if kind == 'dome':
        return [(R * math.cos(a), R * 1.05 * math.sin(a)) for a in [k / 10 * math.pi / 2 for k in range(10)]] + [(0, R * 1.05)]
    return [(R * 1.05, 0), (R * 0.6, R * 1.2), (R * 0.2, R * 2.4), (0, R * 3.2)]  # spire


def bulbs_line(bm, a, b, step=0.7, r=0.11, sag=0.0):
    """A string of bulbs from a to b, hanging `sag` metres in the middle."""
    a, b = Vector(a), Vector(b)
    n = max(1, int((b - a).length / step))
    for k in range(n + 1):
        t = k / n
        q = a.lerp(b, t) - Vector((0, 0, sag * 4 * t * (1 - t)))
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r, matrix=Matrix.Translation(q))


def window_set(wins, rnd, matrix, w, z0, z1, floor_h, pitch=2.3, bias=0.55):
    """Arched windows on a face whose outward normal is local -y (matrix places the face)."""
    cols = max(1, int(w / pitch))
    for k in range(int((z1 - z0) / floor_h)):
        zb = z0 + k * floor_h + floor_h * 0.2
        for c in range(cols):
            cx = (c - (cols - 1) / 2) * (w / cols)
            r = rnd.random()
            key = 'warm' if r < bias else 'gold' if r < bias + 0.15 else 'blue' if r < bias + 0.25 else 'dark'
            add_prism(wins[key], arch_poly(w / cols * 0.5, floor_h * 0.62, cx, zb, 8), 0.14, matrix @ Matrix.Translation((0, -0.1, 0)))


def tower(name, x, y, w, h, shape='round', roof='onion', seed=0):
    rnd = random.Random(seed)
    R = w / 2
    stone, trim, roofm, bl = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    wins = {k: bmesh.new() for k in WIN}
    fh = rnd.uniform(3.6, 4.8)
    if shape == 'round':
        bmesh.ops.create_cone(stone, cap_ends=True, segments=40, radius1=R, radius2=R * 0.94, depth=h, matrix=Matrix.Translation((x, y, h / 2)))
        z = fh
        while z < h - 0.8:
            bmesh.ops.create_cone(trim, cap_ends=True, segments=40, radius1=R * 1.04 + 0.25, radius2=R * 1.04 + 0.25, depth=0.3, matrix=Matrix.Translation((x, y, z)))
            z += fh * rnd.choice((1, 1, 2))
        n = max(3, int(math.pi * R / 2.1))
        for k in range(int((h - 2) / fh)):
            for j in range(n):
                phi = math.radians(-170 + 160 * (j + 0.5) / n)
                rr = R * (1 - 0.06 * (k * fh / h))
                m = Matrix.Translation((x + rr * math.cos(phi), y + rr * math.sin(phi), 0)) @ Matrix.Rotation(phi + math.pi / 2, 4, 'Z')
                rv = rnd.random()
                key = 'warm' if rv < 0.5 else 'gold' if rv < 0.62 else 'blue' if rv < 0.72 else 'dark'
                add_prism(wins[key], arch_poly(min(1.1, 2 * math.pi * rr / (2.2 * n) * 1.6), fh * 0.6, 0, k * fh + fh * 0.25 + 1.0, 8), 0.14, m @ Matrix.Translation((0, -0.12, 0)))
        # a balcony ring with bulbs
        bz = h * rnd.uniform(0.45, 0.7)
        bmesh.ops.create_cone(trim, cap_ends=True, segments=40, radius1=R + 1.1, radius2=R + 0.9, depth=0.45, matrix=Matrix.Translation((x, y, bz)))
        for j in range(40):
            a = 2 * math.pi * j / 40
            bmesh.ops.create_icosphere(bl, subdivisions=1, radius=0.12, matrix=Matrix.Translation((x + (R + 1.05) * math.cos(a), y + (R + 1.05) * math.sin(a), bz + 0.55)))
        rr_top = R * 0.94
    else:
        bm_box(stone, (w, w, h), Vector((x, y, h / 2)), bevel=0.15, segs=2)
        z = fh
        while z < h - 0.8:
            bm_box(trim, (w + 0.5, w + 0.5, 0.3), Vector((x, y, z)))
            z += fh * rnd.choice((1, 1, 2))
        for sx in (-1, 1):
            bm_box(trim, (0.6, 0.6, h), Vector((x + sx * R, y - R, h / 2)))
        window_set(wins, rnd, Matrix.Translation((x, y - R, 0)), w - 1.2, 1.2, h - 1.5, fh)
        for sx in (-1, 1):
            window_set(wins, rnd, Matrix.Translation((x + sx * R, y, 0)) @ Matrix.Rotation(sx * math.pi / 2, 4, 'Z'), w - 1.2, 1.2, h - 1.5, fh, bias=0.4)
        rr_top = R * 1.02
        bm_box(trim, (w + 1.0, w + 1.0, 0.6), Vector((x, y, h)))
    # drum and roof
    bmesh.ops.create_cone(trim, cap_ends=True, segments=40, radius1=rr_top + 0.4, radius2=rr_top + 0.4, depth=0.6, matrix=Matrix.Translation((x, y, h + 0.3)))
    prof = roof_profile(roof, rr_top)
    lathe(roofm, [(r_, z_ + h + 0.6) for r_, z_ in prof], segs=40, matrix=Matrix.Translation((x, y, 0)))
    tip = h + 0.6 + prof[-1][1]
    bm_cyl(trim, (x, y, tip - 0.2), (x, y, tip + 2.2), 0.08, segs=6)
    bmesh.ops.create_icosphere(trim, subdivisions=2, radius=0.35, matrix=Matrix.Translation((x, y, tip + 0.6)))
    # bulbs tracing the roof's ribs
    for j in range(8):
        a = 2 * math.pi * j / 8 - math.pi / 2
        pts = [(x + r_ * 1.02 * math.cos(a), y + r_ * 1.02 * math.sin(a), z_ + h + 0.6) for r_, z_ in prof]
        for q0, q1 in zip(pts, pts[1:]):
            bulbs_line(bl, q0, q1, step=0.8, r=0.1)
    o = bm_obj(name + '_stone', stone, M['sand'])
    bm_obj(name + '_trim', trim, M['gilt'])
    bm_obj(name + '_roof', roofm, rnd.choice(DOMES), smooth=True)
    bm_obj(name + '_bulbs', bl, M['bulbs'])
    for key, b in wins.items():
        if len(b.faces):
            bm_obj(name + '_win_' + key, b, WIN[key])
        else:
            b.free()
    TOWER_TOPS.append(Vector((x, y, tip + 2.2)))
    return o


def gallery(name, xa, xb, y, h, bays, tiers=2, d=3.4, seed=0, cool=False):
    """Tiers of round arches glowing from within, gilt archivolts, bulbs along every cornice."""
    rnd = random.Random(seed)
    x0, x1 = min(xa, xb), max(xa, xb)
    w, cx = x1 - x0, (x0 + x1) / 2
    stone, trim, glow, bl = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    z0 = 0.0
    for t in range(tiers):
        th = h if t == 0 else h * 0.72
        nb = bays if t == 0 else bays * 2
        bw = w / nb
        pier = bw * 0.24
        r = (bw - pier) / 2
        spring = z0 + th * 0.78 - r
        top = z0 + th * 0.78
        for i in range(nb + 1):
            bm_box(stone, (pier, d, top - z0), Vector((x0 + i * bw, y, (z0 + top) / 2)))
        bm_box(stone, (w + pier, d, th * 0.22), Vector((cx, y, top + th * 0.11)))
        for i in range(nb):
            bx = x0 + (i + 0.5) * bw
            for sgn in (-1, 1):
                arc = [(bx + sgn * r * math.cos(a), spring + r * math.sin(a)) for a in [k / 8 * math.pi / 2 for k in range(9)]]
                poly = arc + [(bx, top + 0.01), (bx + sgn * r, top + 0.01)]
                add_prism(stone, poly[::sgn], d * 0.5, Matrix.Translation((0, y - d / 2, 0)))
            outer = [(bx + (r + 0.35) * math.cos(a), spring + (r + 0.35) * math.sin(a)) for a in [k / 12 * math.pi for k in range(13)]]
            inner = [(bx + r * math.cos(a), spring + r * math.sin(a)) for a in [k / 12 * math.pi for k in range(13)]][::-1]
            add_prism(trim, outer + inner, 0.3, Matrix.Translation((0, y - d / 2 - 0.25, 0)))
            # bulbs around each arch
            for a in [k / 10 * math.pi for k in range(11)]:
                bmesh.ops.create_icosphere(bl, subdivisions=1, radius=0.09, matrix=Matrix.Translation((bx + (r + 0.6) * math.cos(a), y - d / 2 - 0.35, spring + (r + 0.6) * math.sin(a))))
        bm_box(trim, (w + pier + 0.7, d + 0.7, 0.35), Vector((cx, y, top + th * 0.22)))
        bulbs_line(bl, (x0, y - d / 2 - 0.45, top + th * 0.22 + 0.35), (x1, y - d / 2 - 0.45, top + th * 0.22 + 0.35), step=0.6)
        bm_box(glow, (w, 0.2, top - z0), Vector((cx, y + d / 2 - 0.25, (z0 + top) / 2)))
        z0 = top + th * 0.22
    # balustrade on the roof
    for i in range(int(w / 0.8)):
        bm_cyl(trim, (x0 + i * 0.8, y - d / 2 + 0.2, z0), (x0 + i * 0.8, y - d / 2 + 0.2, z0 + 1.0), 0.09, segs=6)
    bm_box(trim, (w, 0.3, 0.2), Vector((cx, y - d / 2 + 0.2, z0 + 1.05)))
    bm_obj(name, stone, M['sand'])
    bm_obj(name + '_trim', trim, M['gilt'])
    bm_obj(name + '_glow', glow, M['baycool'] if cool else M['bayglow'])
    bm_obj(name + '_bulbs', bl, M['bulbs'])
    return z0


# ---------------------------------------------------------------- the deck
DECK_H = 2.4
FRONT_Y = -4.0
CAT_LEN = 22.0
box_obj('Deck', (50, 18, DECK_H), (0, 5, DECK_H / 2), M['deck'], bevel=0.06)
box_obj('DeckFascia', (50.2, 0.2, DECK_H - 0.3), (0, FRONT_Y - 0.1, DECK_H / 2 - 0.1), M['grille'])
box_obj('DeckEdgeLED', (50, 0.18, 0.12), (0, FRONT_Y - 0.25, DECK_H - 0.08), M['bulbs'])
box_obj('DeckFootLED', (50, 0.12, 0.08), (0, FRONT_Y - 0.25, 0.3), M['bulbs'])
box_obj('Catwalk', (5.0, CAT_LEN, DECK_H - 0.4), (0, FRONT_Y - CAT_LEN / 2, (DECK_H - 0.4) / 2), M['deck'], bevel=0.05)
for sx in (-1, 1):
    box_obj('CatwalkLED', (0.12, CAT_LEN, 0.1), (sx * 2.56, FRONT_Y - CAT_LEN / 2, DECK_H - 0.45), M['bulbs'])
B_Y = FRONT_Y - CAT_LEN - 5
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=6.0, radius2=6.0, depth=DECK_H - 0.4, matrix=Matrix.Translation((0, B_Y, (DECK_H - 0.4) / 2)))
bm_obj('BStage', bm, M['deck'])
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=6.05, radius2=6.05, depth=0.12, matrix=Matrix.Translation((0, B_Y, DECK_H - 0.45)))
bm_obj('BStageLED', bm, M['bulbs'])
box_obj('DrumRiser', (12, 5, 1.4), (0, 12, DECK_H + 0.7), M['deck'], bevel=0.05)
box_obj('DrumRiserLED', (12, 0.1, 0.1), (0, 9.45, DECK_H + 1.35), M['bulbs'])
pixel_face('DrumRiserPx', 11.5, 1.2, sweep, GOLD, None, 9.44, z0=DECK_H + 0.05, pitch=0.5, cell=0.2)
for sx in (-1, 1):
    x = sx * 17
    box_obj('Platform', (9, 5, 3.0), (x, 11, DECK_H + 1.5), M['deck'], bevel=0.05)
    box_obj('PlatformLED', (9, 0.1, 0.12), (x, 8.45, DECK_H + 2.95), M['bulbs'])
    pixel_face('PlatformPx', 8.5, 2.6, columns, GOLD, None, 8.44, z0=DECK_H + 0.1, pitch=0.55, cell=0.24)
    bm = bmesh.new()
    for i in range(10):
        bm_box(bm, (2.4, 0.35, 0.3), Vector((x - sx * 5.7, 8.5 + 0.35 * i, DECK_H + 0.15 + i * 0.3)))
    bm_obj('Stairs', bm, M['trim'])


# ---------------------------------------------------------------- the sun gate
GATE_Y = 16.0
GW, GI, GH = 32.0, 22.0, 36.0        # outer width, opening width, opening height
stone, trim, bl = bmesh.new(), bmesh.new(), bmesh.new()
r = GI / 2
spring = GH - r
for sx in (-1, 1):
    bm_box(stone, ((GW - GI) / 2, 4, GH + 4), Vector((sx * (GI / 2 + (GW - GI) / 4), GATE_Y, (GH + 4) / 2)))
bm_box(stone, (GW, 4, 6), Vector((0, GATE_Y, GH + 3)))
for sgn in (-1, 1):
    arc = [(sgn * r * math.cos(a), spring + r * math.sin(a)) for a in [k / 16 * math.pi / 2 for k in range(17)]]
    add_prism(stone, (arc + [(0, GH + 0.01), (sgn * r, GH + 0.01)])[::sgn], 4, Matrix.Translation((0, GATE_Y - 2, 0)))
for k, rr in enumerate((r + 0.5, r + 1.6)):
    outer = [((rr + 0.45) * math.cos(a), spring + (rr + 0.45) * math.sin(a)) for a in [j / 24 * math.pi for j in range(25)]]
    inner = [(rr * math.cos(a), spring + rr * math.sin(a)) for a in [j / 24 * math.pi for j in range(25)]][::-1]
    add_prism(trim, outer + inner, 0.5, Matrix.Translation((0, GATE_Y - 2.4 - 0.2 * k, 0)))
for a in [j / 40 * math.pi for j in range(41)]:
    for rr in (r + 1.15, r + 2.45):
        bmesh.ops.create_icosphere(bl, subdivisions=1, radius=0.14, matrix=Matrix.Translation((rr * math.cos(a), GATE_Y - 2.7, spring + rr * math.sin(a))))
for sx in (-1, 1):
    bulbs_line(bl, (sx * r * 1.0, GATE_Y - 2.4, 0.5), (sx * r * 1.0, GATE_Y - 2.4, spring), step=0.7, r=0.13)
bm_box(trim, (GW + 1.2, 5, 0.6), Vector((0, GATE_Y, GH + 6.2)))
bulbs_line(bl, (-GW / 2, GATE_Y - 2.8, GH + 6.6), (GW / 2, GATE_Y - 2.8, GH + 6.6), step=0.6, r=0.13)
GATE_R, GATE_SPRING = r, spring
bm_obj('Gate', stone, M['sand'])
bm_obj('GateTrim', trim, M['gilt'])
bm_obj('GateBulbs', bl, M['bulbs'])
# the screen fills the arch
sc = bmesh.new()
add_prism(sc, arch_poly(GI - 0.6, GH - 0.6, 0, DECK_H + 0.2, 24), 0.1, Matrix.Translation((0, GATE_Y + 1.2, 0)))
bm_obj('GateScreen', sc, mat_sunburst('GateContent', strength=2.4, rays=28, rings=8.0, aspect=(GI - 0.6) / (GH - 0.6 - DECK_H), cz=0.45,
                                       palette=[(0.0, (0.0, 0.02, 0.08)), (0.35, (0.0, 0.3, 0.8)), (0.62, (0.2, 0.85, 1.0)), (0.85, (1.0, 0.75, 0.35)), (1.0, (1.0, 0.95, 0.85))]))
# the sun medallion above the gate
SUN = Vector((0, GATE_Y - 2.6, GH + 15.0))
sm, sr, sg = bmesh.new(), bmesh.new(), bmesh.new()
bmesh.ops.create_cone(sm, cap_ends=True, segments=64, radius1=6.5, radius2=6.5, depth=1.2, matrix=Matrix.Translation(SUN) @ Matrix.Rotation(math.radians(90), 4, 'X'))
for k in range(24):
    a = 2 * math.pi * k / 24
    ln = 6.5 if k % 2 else 4.2
    m = Matrix.Translation(SUN) @ Matrix.Rotation(-a, 4, 'Y')
    add_prism(sr, [(-0.9, 6.0), (0.9, 6.0), (0, 6.0 + ln)], 0.8, m @ Matrix.Translation((0, -0.4, 0)))
bmesh.ops.create_cone(sg, cap_ends=True, segments=64, radius1=4.6, radius2=4.6, depth=0.3, matrix=Matrix.Translation(SUN - Vector((0, 0.7, 0))) @ Matrix.Rotation(math.radians(90), 4, 'X'))
bm_obj('SunDisc', sm, M['gilt'])
bm_obj('SunRays', sr, M['gilt'])
bm_obj('SunFace', sg, mat_sunburst('SunContent', strength=5.0, rays=18, rings=4.0,
                                   palette=[(0.0, (0.6, 0.18, 0.02)), (0.5, (1.0, 0.55, 0.12)), (1.0, (1.0, 0.92, 0.7))]))
bl = bmesh.new()
for k in range(48):
    a = 2 * math.pi * k / 48
    bmesh.ops.create_icosphere(bl, subdivisions=1, radius=0.16, matrix=Matrix.Translation(SUN + Vector((math.cos(a) * 7.0, -0.7, math.sin(a) * 7.0))))
bm_obj('SunBulbs', bl, M['bulbs'])
bm = bmesh.new()
bm_box(bm, (3, 2, SUN.z - GH - 7), Vector((0, GATE_Y - 1.2, (SUN.z + GH + 7) / 2 - 3)))
bm_obj('SunMast', bm, M['sand2'])

# ---------------------------------------------------------------- towers, domes and galleries
tower('GateTowerL', -20.5, GATE_Y + 1, 9, 40, 'round', 'onion', seed=3)
tower('GateTowerR', 20.5, GATE_Y + 1, 9, 40, 'round', 'onion', seed=4)
# the great dome behind
gd, gt, gb = bmesh.new(), bmesh.new(), bmesh.new()
bmesh.ops.create_cone(gd, cap_ends=True, segments=64, radius1=13, radius2=12.5, depth=26, matrix=Matrix.Translation((0, 38, 13)))
bm_box(gt, (28, 28, 0.6), Vector((0, 38, 26.2)))
prof = [(12.5 * math.cos(a), 26.5 + 13.5 * math.sin(a)) for a in [k / 16 * math.pi / 2 for k in range(16)]] + [(0, 40)]
dm = bmesh.new()
lathe(dm, prof, segs=64, matrix=Matrix.Translation((0, 38, 0)))
for j in range(16):
    a = 2 * math.pi * j / 16
    for q0, q1 in zip(prof, prof[1:]):
        bulbs_line(gb, (q0[0] * 1.01 * math.cos(a), 38 + q0[0] * 1.01 * math.sin(a), q0[1]), (q1[0] * 1.01 * math.cos(a), 38 + q1[0] * 1.01 * math.sin(a), q1[1]), step=0.9, r=0.13)
bmesh.ops.create_cone(gt, cap_ends=True, segments=24, radius1=1.8, radius2=1.4, depth=4, matrix=Matrix.Translation((0, 38, 42)))
lathe(gt, [(r_, z_ + 44) for r_, z_ in roof_profile('onion', 1.6)], segs=24, matrix=Matrix.Translation((0, 38, 0)))
bm_obj('GreatDrum', gd, M['sand2'])
bm_obj('GreatDome', dm, M['bluetile'], smooth=True)
bm_obj('GreatTrim', gt, M['gilt'])
bm_obj('GreatBulbs', gb, M['bulbs'])
TOWER_TOPS.append(Vector((0, 38, 49)))

for side in (-1, 1):
    sd = 10 if side < 0 else 40
    rnd = random.Random(sd)
    gallery('Gallery%+d_0' % side, side * 25.5, side * 43, 12, 11, 4, tiers=2, seed=sd + 1)
    tower('Tower%+d_0' % side, side * 46, 9, 7, 30, 'round', 'onion', seed=sd + 2)
    gallery('Gallery%+d_1' % side, side * 49.5, side * 63, 6, 9, 3, tiers=2, seed=sd + 3, cool=True)
    tower('Tower%+d_1' % side, side * 66, 3, 6, 23, 'square', 'dome', seed=sd + 4)
    gallery('Gallery%+d_2' % side, side * 69.5, side * 80, 0, 7, 3, tiers=1, seed=sd + 5)
    tower('Tower%+d_2' % side, side * 82.5, -3, 4, 15, 'round', 'spire', seed=sd + 6)
    # the back row rising behind
    for k, (x, w, h, shape, roof) in enumerate([(31, 8, 44, 'round', 'onion'), (41, 7, 36, 'square', 'dome'), (51, 7, 40, 'round', 'onion'),
                                                (60, 6, 31, 'square', 'spire'), (69, 6, 26, 'round', 'dome'), (77, 5, 20, 'round', 'onion')]):
        tower('Back%+d_%d' % (side, k), side * (x + rnd.uniform(-1, 1)), 28 + rnd.uniform(-2, 3), w, h + rnd.uniform(-3, 3), shape, roof, seed=sd + 10 + k)

# a fairground wheel on one wing, a gilt armillary sphere on the other
WHEEL = Vector((92, 18, 19))
wr, wt, wb = bmesh.new(), bmesh.new(), bmesh.new()
for rr in (15.0, 14.2):
    for k in range(96):
        a0, a1 = 2 * math.pi * k / 96, 2 * math.pi * (k + 1) / 96
        bm_cyl(wr, WHEEL + Vector((rr * math.cos(a0), 0, rr * math.sin(a0))), WHEEL + Vector((rr * math.cos(a1), 0, rr * math.sin(a1))), 0.18, segs=6)
for k in range(24):
    a = 2 * math.pi * k / 24
    tip = WHEEL + Vector((15 * math.cos(a), 0, 15 * math.sin(a)))
    bm_cyl(wr, WHEEL, tip, 0.08, segs=4)
    bulbs_line(wb, WHEEL + Vector((1.5 * math.cos(a), -0.3, 1.5 * math.sin(a))), tip + Vector((0, -0.3, 0)), step=0.8, r=0.12)
    bm_box(wt, (1.6, 1.4, 1.4), tip - Vector((0, 0, 1.4)), bevel=0.2, segs=2)
for k in range(140):
    a = 2 * math.pi * k / 140
    bmesh.ops.create_icosphere(wb, subdivisions=1, radius=0.16, matrix=Matrix.Translation(WHEEL + Vector((15.4 * math.cos(a), -0.3, 15.4 * math.sin(a)))))
for sx in (-1, 1):
    bm_cyl(wr, (WHEEL.x + sx * 8, WHEEL.y, 0), WHEEL, 0.35, segs=8)
bm_cyl(wr, WHEEL + Vector((0, -0.8, 0)), WHEEL + Vector((0, 0.8, 0)), 1.0, segs=16)
bm_obj('Wheel', wr, M['gilt'])
bm_obj('WheelCars', wt, M['rosetile'])
bm_obj('WheelBulbs', wb, M['bulbs'])
ARM = Vector((-90, 16, 22))
ar, ab = bmesh.new(), bmesh.new()
for k, (rot, rad) in enumerate(((Euler((0, 0, 0)), 10), (Euler((math.radians(90), 0, 0)), 9.6), (Euler((math.radians(90), 0, math.radians(60))), 9.2),
                                (Euler((math.radians(90), 0, math.radians(-60))), 8.8), (Euler((math.radians(23), 0, 0)), 10.4))):
    m = rot.to_matrix()
    for j in range(72):
        a0, a1 = 2 * math.pi * j / 72, 2 * math.pi * (j + 1) / 72
        bm_cyl(ar, ARM + m @ Vector((rad * math.cos(a0), rad * math.sin(a0), 0)), ARM + m @ Vector((rad * math.cos(a1), rad * math.sin(a1), 0)), 0.32, segs=6)
        if k == 4 and j % 2 == 0:
            bmesh.ops.create_icosphere(ab, subdivisions=1, radius=0.2, matrix=Matrix.Translation(ARM + m @ Vector(((rad + 0.5) * math.cos(a0), (rad + 0.5) * math.sin(a0), 0))))
bmesh.ops.create_icosphere(ab, subdivisions=3, radius=2.6, matrix=Matrix.Translation(ARM))
bm_cyl(ar, (ARM.x, ARM.y, 0), ARM - Vector((0, 0, 10)), 1.2, segs=16)
bm_obj('Armillary', ar, M['gilt'])
bm_obj('ArmillaryLights', ab, M['bulbs'])

# fairy lights strung between neighbouring tower tops
fl = bmesh.new()
tops = sorted(TOWER_TOPS, key=lambda q: q.x)
for a, b in zip(tops, tops[1:]):
    if (b - a).length < 22:
        bulbs_line(fl, a - Vector((0, 0, 2.5)), b - Vector((0, 0, 2.5)), step=0.9, r=0.12, sag=2.5)
bm_obj('FairyLights', fl, M['bulbs'])


# ---------------------------------------------------------------- lantern bearers: robed statues raising lanterns
def lathe_folds(bm, profile, segs=48, folds=9, depth=0.07):
    """Like lathe, with pleats: the radius ripples around the axis, more toward the hem."""
    rings = []
    zmax = max(z for _, z in profile)
    for r, z in profile:
        k = depth * (1 - z / zmax) ** 0.7
        rings.append([bm.verts.new((r * (1 + k * math.sin(folds * 2 * math.pi * j / segs)) * math.cos(2 * math.pi * j / segs),
                                    r * (1 + k * math.sin(folds * 2 * math.pi * j / segs)) * math.sin(2 * math.pi * j / segs), z)) for j in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for j in range(segs):
            bm.faces.new([a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j]])


def lantern_bearer(name, x, y, scale, side, yaw):
    """A hooded figure in a pleated robe on a plinth, one arm raising a glowing lantern."""
    stone, gilt, glow, bl = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    bm_box(stone, (6.4, 6.4, 4.0), Vector((0, 0, 2.0)), bevel=0.2, segs=2)
    bm_box(gilt, (7.0, 7.0, 0.4), Vector((0, 0, 4.1)))
    bm_box(gilt, (7.0, 7.0, 0.4), Vector((0, 0, 0.2)))
    bulbs_line(bl, (-3.3, -3.6, 3.4), (3.3, -3.6, 3.4), step=0.6, r=0.12)
    base = 4.3
    lathe_folds(stone, [(2.9, base), (2.8, base + 1.0), (2.45, base + 4.0), (2.0, base + 8.0), (1.65, base + 10.5), (1.6, base + 11.6), (1.25, base + 12.4)])
    bmesh.ops.create_cone(gilt, cap_ends=False, segments=48, radius1=2.98, radius2=2.92, depth=0.5, matrix=Matrix.Translation((0, 0, base + 0.5)))
    # shoulders, hood, face in shadow with two glints
    bmesh.ops.create_uvsphere(stone, u_segments=32, v_segments=16, radius=1.0, matrix=Matrix.Translation((0, 0, base + 12.2)) @ Matrix.Diagonal((1.9, 1.3, 1.1, 1)))
    bmesh.ops.create_uvsphere(stone, u_segments=32, v_segments=16, radius=1.3, matrix=Matrix.Translation((0, 0.15, base + 14.4)) @ Matrix.Diagonal((1.0, 1.05, 1.2, 1)))
    bmesh.ops.create_uvsphere(gilt, u_segments=24, v_segments=12, radius=0.95, matrix=Matrix.Translation((0, -0.55, base + 14.2)) @ Matrix.Diagonal((0.85, 0.6, 1.0, 1)))
    for ex in (-0.33, 0.33):
        bmesh.ops.create_icosphere(glow, subdivisions=2, radius=0.12, matrix=Matrix.Translation((ex, -1.1, base + 14.4)))
    # the raised arm with a flared sleeve, the other hand at the robe
    sh = Vector((side * 1.7, -0.1, base + 12.4))
    el = Vector((side * 2.6, -0.9, base + 15.3))
    hd = Vector((side * 2.2, -1.3, base + 18.6))
    bm_cyl(stone, sh, el, 0.75, segs=16, r2=0.62)
    bm_cyl(stone, el, hd, 0.52, segs=16, r2=0.42)
    bmesh.ops.create_cone(stone, cap_ends=True, segments=16, radius1=0.95, radius2=0.6, depth=1.6,
                          matrix=Matrix.Translation(el.lerp(hd, 0.25)) @ (hd - el).to_track_quat('Z', 'Y').to_matrix().to_4x4())
    bm_cyl(stone, Vector((-side * 1.7, -0.1, base + 12.2)), Vector((-side * 1.9, -1.0, base + 9.0)), 0.7, segs=16, r2=0.5)
    # the lantern: a gilt cage around a glowing orb
    lc = hd + Vector((0, 0, 1.9))
    bmesh.ops.create_icosphere(glow, subdivisions=3, radius=1.05, matrix=Matrix.Translation(lc))
    for j in range(8):
        a = 2 * math.pi * j / 8
        q0 = lc + Vector((math.cos(a) * 1.25, math.sin(a) * 1.25, -1.2))
        q1 = lc + Vector((math.cos(a) * 1.25, math.sin(a) * 1.25, 1.2))
        bm_cyl(gilt, q0, q1, 0.07, segs=5)
    for dz in (-1.25, 1.25):
        bmesh.ops.create_cone(gilt, cap_ends=True, segments=24, radius1=1.45, radius2=0.6 if dz > 0 else 1.45, depth=0.35, matrix=Matrix.Translation(lc + Vector((0, 0, dz))))
    bmesh.ops.create_cone(gilt, cap_ends=True, segments=16, radius1=0.45, radius2=0.05, depth=1.2, matrix=Matrix.Translation(lc + Vector((0, 0, 2.0))))
    bm_cyl(gilt, hd, lc - Vector((0, 0, 1.2)), 0.12, segs=6)
    m = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(math.radians(yaw), 4, 'Z') @ Matrix.Scale(scale, 4)
    for b in (stone, gilt, glow, bl):
        bmesh.ops.transform(b, matrix=m, verts=b.verts)
        for f in b.faces:
            f.smooth = True
    bm_obj(name, stone, BRONZE)
    bm_obj(name + '_gilt', gilt, M['gilt'])
    bm_obj(name + '_glow', glow, LANTERN)
    bm_obj(name + '_bulbs', bl, M['bulbs'])
    q = m @ lc
    lt = point(name + '_light', tuple(q + Vector((0, -1.8 * scale, 0))), (1.0, 0.7, 0.4), 150000 * scale, radius=1.0)
    lt.visible_volume_scatter = True


LANTERN = mat_emit('Lantern', (1.0, 0.75, 0.42), 30)
BRONZE = mat_pbr('Bronze', (0.2, 0.13, 0.08), rough=0.38, metal=0.85)
for side in (-1, 1):
    lantern_bearer('Bearer%+d' % side, side * 34.5, 0.5, 1.35, side, side * 12)
    lantern_bearer('BearerSmall%+d' % side, side * 57.0, -3.0, 0.9, -side, side * 20)


# ---------------------------------------------------------------- fireworks: frozen fans of sparks over the skyline
SPARK = mat_emit('Spark', (1.0, 0.93, 0.82), 25)
SPARK_GOLD = mat_emit('SparkGold', (1.0, 0.7, 0.35), 22)
FIREWORKS = []
FIREWORK_SPECS = []


def firework_fan(name, origin, n=16, spread=55, length=(22, 34), lean=0.0, gold=False, seed=0):
    """Comet trails fanning out of one launch point, curving under gravity, glitter along them."""
    FIREWORK_SPECS.append({'origin': tuple(origin), 'n': n, 'spread': spread, 'length': list(length), 'lean': lean, 'gold': gold})
    rnd = random.Random(seed)
    trails, glitter = bmesh.new(), bmesh.new()
    o = Vector(origin)
    for k in range(n):
        ang = math.radians(-spread + 2 * spread * k / max(1, n - 1) + rnd.uniform(-4, 4) + lean)
        dirv = Vector((math.sin(ang), -0.25 + rnd.uniform(-0.1, 0.1), math.cos(ang))).normalized()
        L = rnd.uniform(*length)
        pts = [o + dirv * L * t - Vector((0, 0, 9 * t * t * (L / 30))) for t in [j / 10 for j in range(11)]]
        for j, (a, b) in enumerate(zip(pts, pts[1:])):
            bm_cyl(trails, a, b, 0.05 + 0.1 * (j / 10) ** 2, segs=5, r2=0.05 + 0.1 * ((j + 1) / 10) ** 2)
        for _ in range(14):
            t = rnd.uniform(0.35, 1.05)
            q = o + dirv * L * t - Vector((0, 0, 9 * t * t * (L / 30))) + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1.5, 0.5))) * t
            bmesh.ops.create_icosphere(glitter, subdivisions=1, radius=rnd.uniform(0.06, 0.16), matrix=Matrix.Translation(q))
    bm_obj(name, trails, SPARK_GOLD if gold else SPARK, 'FX')
    bm_obj(name + '_glitter', glitter, SPARK, 'FX')
    FIREWORKS.append(o + Vector((0, 0, sum(length) / 4)))


firework_fan('FireworkSun', SUN + Vector((0, -1, 7)), n=22, spread=70, length=(28, 42), seed=1)
for side in (-1, 1):
    firework_fan('FireworkGate%+d' % side, (side * 20.5, GATE_Y - 2, 58), n=16, spread=45, length=(22, 32), lean=side * 12, seed=2 + side)
    firework_fan('FireworkBack%+d' % side, (side * 51, 28, 58), n=16, spread=45, length=(22, 34), lean=side * 18, gold=True, seed=5 + side)
    firework_fan('FireworkWing%+d' % side, (side * 69, 26, 40), n=13, spread=40, length=(18, 28), lean=side * 25, seed=8 + side)
    firework_fan('FireworkEnd%+d' % side, (side * 84, 0, 26), n=11, spread=38, length=(16, 24), lean=side * 30, gold=True, seed=11 + side)


# =================================================================== DETAIL
def truss_tower(name, x, y, h, arm=0.0):
    """Square lattice truss with an arm on top; returns the top position."""
    bm = bmesh.new()
    s = 0.45
    corners = [(-s, -s), (s, -s), (s, s), (-s, s)]
    for cx, cy in corners:
        bm_cyl(bm, (x + cx, y + cy, 0), (x + cx, y + cy, h), 0.045, segs=6)
    step = 0.9
    n = int(h / step)
    for k in range(4):
        a, b = corners[k], corners[(k + 1) % 4]
        for i in range(n):
            z0, z1 = i * step, (i + 1) * step
            p, q = (a, b) if i % 2 == 0 else (b, a)
            bm_cyl(bm, (x + p[0], y + p[1], z0), (x + q[0], y + q[1], z1), 0.025, segs=4)
    if arm:
        for cz in (h - 0.2, h + 0.6):
            for cy in (-s, s):
                bm_cyl(bm, (x - arm, y + cy, cz), (x + arm, y + cy, cz), 0.045, segs=6)
        for i in range(int(arm * 2 / step)):
            x0 = x - arm + i * step
            bm_cyl(bm, (x0, y - s, h - 0.2), (x0 + step, y - s, h + 0.6), 0.025, segs=4)
            bm_cyl(bm, (x0, y + s, h - 0.2), (x0 + step, y + s, h + 0.6), 0.025, segs=4)
    bm_box(bm, (2.2, 2.2, 0.4), Vector((x, y, 0.2)))
    bm_obj(name, bm, M['truss'], 'Detail')
    return Vector((x, y, h))


def line_array(name, x, y, top, boxes=14, turn=1.0):
    """A hanging J-curved line array: each cabinet tilts a little more toward the crowd."""
    bm_b = bmesh.new()
    bm_g = bmesh.new()
    z = top
    tilt = 0.0
    yy = y
    for i in range(boxes):
        tilt += math.radians(0.6 + (i / boxes) ** 2 * 4.5 * turn)
        r = Euler((tilt, 0, 0))
        hgt = 0.42
        c = Vector((x, yy, z - hgt / 2))
        bm_box(bm_b, (1.4, 0.9, hgt), c, rot=r, bevel=0.03, segs=1)
        bm_box(bm_g, (1.3, 0.02, hgt * 0.8), c + r.to_matrix() @ Vector((0, -0.46, 0)), rot=r)
        z -= hgt * math.cos(tilt)
        yy -= hgt * math.sin(tilt)
    bm_box(bm_b, (1.6, 1.0, 0.15), Vector((x, y, top + 0.1)))
    bm_cyl(bm_b, (x, y, top + 0.15), (x, y, top + 2.5), 0.03, segs=4)
    bm_obj(name, bm_b, M['black'], 'Detail')
    bm_obj(name + '_grille', bm_g, M['grille'], 'Detail')


SPEAKER_HANGS = []
for side in (-1, 1):
    # the main hangs fly on truss towers just outside the crest
    for (x, y, h, arm) in ((side * 28.0, -6.5, 26.0, 2.5),):
        top = truss_tower('Truss%+d_%d' % (side, int(abs(x))), x, y, h, arm)
        line_array('Array%+d_%d' % (side, int(abs(x))), x + side * 1.0, y - 0.2, h - 1.2, boxes=16 if abs(x) < 20 else 12)
        line_array('ArrayOut%+d_%d' % (side, int(abs(x))), x - side * 1.4, y - 0.2, h - 1.2, boxes=10, turn=0.6)
        SPEAKER_HANGS.append(top)

# crowd barrier along the front and around the catwalk
bm = bmesh.new()
path = [(-70, -8.0), (-3.5, -8.0), (-3.5, FRONT_Y - CAT_LEN + 1), (-8, B_Y), (-3.5, B_Y - 6.5),
        (3.5, B_Y - 6.5), (8, B_Y), (3.5, FRONT_Y - CAT_LEN + 1), (3.5, -8.0), (70, -8.0)]
for (x0, y0), (x1, y1) in zip(path, path[1:]):
    bm_cyl(bm, (x0, y0, 1.15), (x1, y1, 1.15), 0.05, segs=6)
    seg = Vector((x1 - x0, y1 - y0, 0))
    for k in range(int(seg.length / 1.2) + 1):
        q = Vector((x0, y0, 0)) + seg * (k / max(1, int(seg.length / 1.2)))
        bm_cyl(bm, (q.x, q.y, 0), (q.x, q.y, 1.15), 0.03, segs=4)
bm_obj('Barrier', bm, M['truss'], 'Detail')

# CO2 cannons along the front and the catwalk, flame units on wing tops
bm = bmesh.new()
cannons = [(x, FRONT_Y + 0.4, DECK_H) for x in range(-22, 23, 4) if abs(x) > 3] + \
    [(sx * 2.0, FRONT_Y - y, DECK_H - 0.4) for sx in (-1, 1) for y in (8, 16)]
for (x, y, z) in cannons:
    bm_box(bm, (0.5, 0.5, 0.35), Vector((x, y, z + 0.17)))
    bm_cyl(bm, (x, y, z + 0.3), (x, y - 0.1, z + 1.0), 0.07, segs=8)
bm_obj('CO2Cannons', bm, M['trim'], 'Detail')


def plume(name, x, y, z, height, width):
    """A frozen CO2 burst: a stretched sphere of noisy white volume."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:
        k = (v.co.z + 1) / 2
        v.co = Vector((v.co.x * width * (0.35 + 0.65 * k), v.co.y * width * (0.35 + 0.65 * k), v.co.z * height / 2 + height / 2))
    o = bm_obj(name, bm, PLUME, 'FX')
    o.location = (x, y, z)
    return o


PLUME = bpy.data.materials.new('CO2')
PLUME.use_nodes = True
pn = PLUME.node_tree
pn.nodes.clear()
po = pn.nodes.new('ShaderNodeOutputMaterial')
pv = pn.nodes.new('ShaderNodeVolumePrincipled')
pv.inputs['Color'].default_value = (0.95, 0.95, 1.0, 1)
noise = pn.nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = 0.6
noise.inputs['Detail'].default_value = 6
noise.inputs['Roughness'].default_value = 0.6
ptc = pn.nodes.new('ShaderNodeTexCoord')
pn.links.new(ptc.outputs['Object'], noise.inputs['Vector'])
pr = pn.nodes.new('ShaderNodeMapRange')
pr.inputs['From Min'].default_value = 0.45
pr.inputs['From Max'].default_value = 0.75
pr.inputs['To Min'].default_value = 0.0
pr.inputs['To Max'].default_value = 0.9
pn.links.new(noise.outputs['Fac'], pr.inputs['Value'])
pn.links.new(pr.outputs[0], pv.inputs['Density'])
pn.links.new(pv.outputs[0], po.inputs['Volume'])
for i, (x, y, z) in enumerate(cannons[:10]):
    plume('CO2_%d' % i, x, y - 0.6, z + 0.3, random.uniform(8, 11), random.uniform(1.6, 2.2))

FLAME = bpy.data.materials.new('Flame')
FLAME.use_nodes = True
fn = FLAME.node_tree
fn.nodes.clear()
fo = fn.nodes.new('ShaderNodeOutputMaterial')
fv = fn.nodes.new('ShaderNodeVolumePrincipled')
fv.inputs['Density'].default_value = 0.0
fnoise = fn.nodes.new('ShaderNodeTexNoise')
fnoise.inputs['Scale'].default_value = 1.4
fnoise.inputs['Detail'].default_value = 5
ftc = fn.nodes.new('ShaderNodeTexCoord')
fn.links.new(ftc.outputs['Object'], fnoise.inputs['Vector'])
fr = fn.nodes.new('ShaderNodeMapRange')
fr.inputs['From Min'].default_value = 0.45
fr.inputs['From Max'].default_value = 0.7
fr.inputs['To Min'].default_value = 0.0
fr.inputs['To Max'].default_value = 25.0
fn.links.new(fnoise.outputs['Fac'], fr.inputs['Value'])
fn.links.new(fr.outputs[0], fv.inputs['Emission Strength'])
fv.inputs['Emission Color'].default_value = (1.0, 0.35, 0.06, 1)
fn.links.new(fv.outputs[0], fo.inputs['Volume'])

# ---------------------------------------------------------------- FOH and delay towers
box_obj('FOHDeck', (12, 9, 1.2), (0, -80, 0.6), M['deck'])
box_obj('FOHRoof', (13, 10, 0.4), (0, -80, 5.2), M['slab'], bevel=0.1)
box_obj('FOHRoofLED', (13.1, 0.1, 0.15), (0, -84.96, 5.2), M['edge_v'])
bm = bmesh.new()
for sx in (-1, 1):
    for sy in (-1, 1):
        bm_cyl(bm, (sx * 6, -80 + sy * 4.5, 1.2), (sx * 6, -80 + sy * 4.5, 5.0), 0.12, segs=8)
bm_obj('FOHPosts', bm, M['truss'])
DELAYS = []
for side in (-1, 1):
    top = truss_tower('Delay%+d' % side, side * 30, -96, 18, 1.5)
    line_array('DelayArray%+d' % side, side * 30, -96.2, 16.8, boxes=8, turn=0.5)
    DELAYS.append(top)


# =================================================================== BAND
skin = mat_pbr('Band', (0.55, 0.5, 0.75), rough=0.45, emit=(0.4, 0.35, 0.9), emit_strength=0.25)
accent = {'lead': M['edge_m'], 'bass': M['edge_c'], 'drums': M['edge_g'], 'vox': M['edge_l']}


def figure(x, y, z, kind, face=0.0):
    rootf = empty('Player_' + kind, (x, y, z), (0, 0, face), where='Band')
    bm = bmesh.new()
    h = 1.0 if kind != 'drums' else 0.62
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.42,
                              matrix=Matrix.Translation((0, 0, 0.55 * h + 0.42)) @ Matrix.Diagonal((0.75, 0.55, 1.6 * h, 1)))
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.26, matrix=Matrix.Translation((0, 0, 0.55 * h + 0.42 + 0.95 * h + 0.25)))
    if kind != 'drums':
        for s in (-1, 1):
            bm_cyl(bm, (s * 0.16, 0, 0), (s * 0.12, 0, 0.9), 0.11, segs=10)
    place(bm_obj('Body', bm, skin, 'Band', smooth=True), parent=rootf)
    bm = bmesh.new()
    bm_cyl(bm, (0, 0, 0.55 * h + 0.42 + 0.26 * h), (0, 0, 0.55 * h + 0.42 + 0.35 * h), 0.33, segs=24)
    place(bm_obj('Stripe', bm, accent[kind], 'Band'), parent=rootf)
    g = bmesh.new()
    if kind in ('lead', 'bass'):
        r = Euler((0, math.radians(-28), 0))
        bm_box(g, (0.55, 0.12, 0.38), Vector((0.1, -0.42, 1.05)), rot=r)
        bm_box(g, (1.0 if kind == 'bass' else 0.85, 0.06, 0.07), Vector((0.75, -0.44, 1.35)), rot=r)
    if kind == 'vox':
        bm_cyl(g, (0, -0.55, 0), (0, -0.55, 1.55), 0.025, segs=6)
    if kind == 'drums':
        for (dx, dy, rr, hz) in [(-0.7, -0.6, 0.25, 0.85), (0.7, -0.6, 0.25, 0.85), (-1.1, -0.2, 0.3, 0.7), (1.1, -0.2, 0.32, 0.6)]:
            bm_cyl(g, (dx, dy, hz - 0.17), (dx, dy, hz + 0.17), rr, segs=20)
        bm_cyl(g, (0, -1.2, 0.3), (0, -0.6, 0.3), 0.42, segs=24)
        for dx in (-1.4, 1.4):
            bm_cyl(g, (dx, -0.3, 1.44), (dx, -0.3, 1.46), 0.42, segs=24)
    if len(g.verts):
        place(bm_obj('Gear', g, M['black'], 'Band'), parent=rootf)
    return rootf


# backline: amp stacks, wedges, a DJ desk
bm_b = bmesh.new()
bm_g = bmesh.new()
for sx in (-1, 1):
    for k in range(2):
        c = Vector((sx * 10.5 + k * sx * 1.1, 7.5, DECK_H + 0.9))
        bm_box(bm_b, (1.0, 0.7, 1.8), c, bevel=0.03)
        bm_box(bm_g, (0.85, 0.02, 1.5), c + Vector((0, -0.36, 0)))
for x in (-8, -3.5, 0, 3.5, 8):
    r = Euler((math.radians(-35), 0, 0))
    c = Vector((x, 1.2, DECK_H + 0.3))
    bm_box(bm_b, (1.1, 0.7, 0.45), c, rot=r, bevel=0.03)
    bm_box(bm_g, (0.95, 0.02, 0.35), c + r.to_matrix() @ Vector((0, -0.36, 0)), rot=r)
bm_box(bm_b, (3.2, 1.2, 1.1), Vector((-4, 6.5, DECK_H + 0.55)), bevel=0.04)
bm_obj('Backline', bm_b, M['black'], 'Detail')
bm_obj('BacklineGrilles', bm_g, M['grille'], 'Detail')
box_obj('DeskLED', (3.2, 0.05, 0.08), (-4, 5.88, DECK_H + 1.0), M['edge_c'], where='Detail')
pixel_face('DeskPx', 3.0, 0.8, columns, MAGENTA, None, 5.87, z0=DECK_H + 0.1, pitch=0.2, cell=0.09)

figure(-7.0, 4.5, DECK_H, 'lead', 0.25)
figure(0.0, 3.0, DECK_H, 'vox')
figure(7.0, 4.5, DECK_H, 'bass', -0.25)
figure(0.0, 13.2, DECK_H + 1.4, 'drums')


# =================================================================== ENVIRONMENT
BOWL_C = Vector((0, -45, 0))


def terrain_h(x, y):
    """Flat festival ground inside an elliptical bowl; wooded slopes rise around it."""
    dx, dy = (x - BOWL_C.x) / 1.25, (y - BOWL_C.y)
    r = math.hypot(dx, dy)
    if r < 125:
        return 0.0
    return min(18.0, ((r - 125) / 90.0) ** 1.4 * 6.0)


bm = bmesh.new()
N = 220
SIZE = 1100
grid = [[None] * (N + 1) for _ in range(N + 1)]
for i in range(N + 1):
    for j in range(N + 1):
        x = (i / N - 0.5) * SIZE
        y = (j / N - 0.5) * SIZE + BOWL_C.y
        grid[i][j] = bm.verts.new((x, y, terrain_h(x, y)))
for i in range(N):
    for j in range(N):
        bm.faces.new([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])
ground = mat_pbr('Ground', (0.025, 0.03, 0.022), rough=0.95)
gn = ground.node_tree
gp = gn.nodes['Principled BSDF']
gnoise = gn.nodes.new('ShaderNodeTexNoise')
gnoise.inputs['Scale'].default_value = 0.08
gramp = gn.nodes.new('ShaderNodeValToRGB')
gramp.color_ramp.elements[0].color = (*srgb((0.018, 0.016, 0.014)), 1)
gramp.color_ramp.elements[1].color = (*srgb((0.03, 0.04, 0.025)), 1)
gn.links.new(gnoise.outputs['Fac'], gramp.inputs[0])
gn.links.new(gramp.outputs[0], gp.inputs['Base Color'])
bm_obj('Terrain', bm, ground, 'Environment', smooth=True)


SCATTERS = {}


def scatter(name, pts, variants, where):
    """Instances `variants` on points (x, y, z, rot, scale) with geometry nodes."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([p[:3] for p in pts], [], [])
    ra = me.attributes.new('rot', 'FLOAT', 'POINT')
    ra.data.foreach_set('value', [p[3] for p in pts])
    sa = me.attributes.new('scl', 'FLOAT', 'POINT')
    sa.data.foreach_set('value', [p[4] for p in pts])
    o = bpy.data.objects.new(name, me)
    link(o, where)
    SCATTERS[name] = (pts, variants)
    vc = bpy.data.collections.new(name + '_variants')
    for v in variants:
        vc.objects.link(v)
    tree = bpy.data.node_groups.new(name + '_scatter', 'GeometryNodeTree')
    tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    nn, ll = tree.nodes, tree.links
    gi, go = nn.new('NodeGroupInput'), nn.new('NodeGroupOutput')
    m2p = nn.new('GeometryNodeMeshToPoints')
    iop = nn.new('GeometryNodeInstanceOnPoints')
    ci = nn.new('GeometryNodeCollectionInfo')
    ci.inputs['Collection'].default_value = vc
    ci.inputs['Separate Children'].default_value = True
    ci.inputs['Reset Children'].default_value = True
    iop.inputs['Pick Instance'].default_value = True
    rnd = nn.new('FunctionNodeRandomValue')
    rnd.data_type = 'INT'
    [s for s in rnd.inputs if s.name == 'Min' and s.type == 'INT'][0].default_value = 0
    [s for s in rnd.inputs if s.name == 'Max' and s.type == 'INT'][0].default_value = len(variants) - 1
    rnd.inputs['Seed'].default_value = len(name)
    rot = nn.new('GeometryNodeInputNamedAttribute')
    rot.data_type = 'FLOAT'
    rot.inputs['Name'].default_value = 'rot'
    comb = nn.new('ShaderNodeCombineXYZ')
    scl = nn.new('GeometryNodeInputNamedAttribute')
    scl.data_type = 'FLOAT'
    scl.inputs['Name'].default_value = 'scl'
    ll.new(gi.outputs[0], m2p.inputs['Mesh'])
    ll.new(m2p.outputs['Points'], iop.inputs['Points'])
    ll.new(ci.outputs[0], iop.inputs['Instance'])
    ll.new([s for s in rnd.outputs if s.type == 'INT'][0], iop.inputs['Instance Index'])
    ll.new(rot.outputs['Attribute'], comb.inputs['Z'])
    ll.new(comb.outputs[0], iop.inputs['Rotation'])
    ll.new(scl.outputs['Attribute'], iop.inputs['Scale'])
    ll.new(iop.outputs['Instances'], go.inputs[0])
    o.modifiers.new('scatter', 'NODES').node_group = tree
    return o


# trees: conifers and broadleaf clumps on the bowl's slopes
tree_m = mat_pbr('Foliage', (0.02, 0.045, 0.028), rough=0.9)
trunk_m = mat_pbr('Trunk', (0.03, 0.022, 0.016), rough=0.9)


def tree_variant(kind, seed):
    random.seed(seed)
    bm = bmesh.new()
    bm_cyl(bm, (0, 0, 0), (0, 0, 3.5), 0.25, segs=6)
    for f in bm.faces:
        f.material_index = 1
    if kind == 'conifer':
        for k in range(4):
            r = 3.2 - k * 0.65
            bmesh.ops.create_cone(bm, cap_ends=True, segments=9, radius1=r, radius2=0.1, depth=5.5 - k * 0.6,
                                  matrix=Matrix.Translation((0, 0, 3.0 + k * 2.6 + (5.5 - k * 0.6) / 2)))
    else:
        for k in range(6):
            c = Vector((random.uniform(-2, 2), random.uniform(-2, 2), random.uniform(6, 10)))
            bmesh.ops.create_icosphere(bm, subdivisions=2, radius=random.uniform(2.4, 3.6), matrix=Matrix.Translation(c))
    me = bpy.data.meshes.new('Tree')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(tree_m)
    me.materials.append(trunk_m)
    return bpy.data.objects.new('Tree_' + kind, me)


random.seed(23)
tree_pts = []
while len(tree_pts) < args.trees:
    a = random.uniform(0, 2 * math.pi)
    r = random.uniform(128, 360)
    x = BOWL_C.x + math.cos(a) * r * 1.25
    y = BOWL_C.y + math.sin(a) * r
    tree_pts.append((x, y, terrain_h(x, y) - 0.5, random.uniform(0, 6.28), random.uniform(1.1, 1.9)))
scatter('Trees', tree_pts, [tree_variant('conifer', 1), tree_variant('conifer', 2), tree_variant('broad', 3), tree_variant('broad', 4)], 'Environment')

# crowd: people in a handful of poses, clothes tinted per instance
crowd_m = bpy.data.materials.new('CrowdCloth')
crowd_m.use_nodes = True
cn = crowd_m.node_tree
cp = cn.nodes['Principled BSDF']
cp.inputs['Roughness'].default_value = 0.75
oi = cn.nodes.new('ShaderNodeObjectInfo')
cr = cn.nodes.new('ShaderNodeValToRGB')
cols = [(0.04, 0.04, 0.05), (0.15, 0.15, 0.17), (0.3, 0.07, 0.08), (0.06, 0.1, 0.25), (0.4, 0.4, 0.4), (0.1, 0.16, 0.1), (0.35, 0.24, 0.1)]
cr.color_ramp.interpolation = 'CONSTANT'
cr.color_ramp.elements[0].color = (*srgb(cols[0]), 1)
cr.color_ramp.elements[1].position = 1.0 / len(cols)
cr.color_ramp.elements[1].color = (*srgb(cols[1]), 1)
for k, c in enumerate(cols[2:], start=2):
    e = cr.color_ramp.elements.new(k / len(cols))
    e.color = (*srgb(c), 1)
cn.links.new(oi.outputs['Random'], cr.inputs[0])
cn.links.new(cr.outputs[0], cp.inputs['Base Color'])
skin_m = mat_pbr('CrowdSkin', (0.45, 0.32, 0.25), rough=0.6)
phone_m = mat_emit('Phone', (0.9, 0.92, 1.0), 6)


def person(pose):
    bm = bmesh.new()

    def tag(verts, idx):
        vs = set(verts)
        for f in bm.faces:
            if all(v in vs for v in f.verts):
                f.material_index = idx

    for s in (-1, 1):
        bm_cyl(bm, (s * 0.1, 0, 0), (s * 0.11, 0, 0.86), 0.075, segs=10, r2=0.09)
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.17, radius2=0.21, depth=0.6,
                                matrix=Matrix.Translation((0, 0, 1.16)) @ Matrix.Diagonal((1, 0.62, 1, 1)))
    res = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.11, matrix=Matrix.Translation((0, 0, 1.6)))
    tag(res['verts'], 1)
    shoulder = 1.42
    arms = {'down': [(-1, 'down'), (1, 'down')], 'one': [(-1, 'down'), (1, 'up')], 'both': [(-1, 'up'), (1, 'up')],
            'phone': [(-1, 'down'), (1, 'phone')], 'clap': [(-1, 'clap'), (1, 'clap')]}[pose]
    for s, a in arms:
        p0 = Vector((s * 0.23, 0, shoulder))
        if a == 'down':
            p1 = Vector((s * 0.29, 0.02, 0.86))
        elif a == 'up':
            p1 = Vector((s * 0.42, -0.05, 2.12))
        elif a == 'clap':
            p1 = Vector((s * 0.05, -0.3, 1.95))
        else:
            p1 = Vector((s * 0.12, -0.35, 1.92))
        v = bm_cyl(bm, p0, p1, 0.05, segs=8, r2=0.045)
        tag(v, 1 if a != 'down' else 0)
        if a == 'phone':
            res = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(p1 + Vector((0, -0.04, 0.08))) @ Matrix.Diagonal((0.07, 0.012, 0.13, 1)))
            tag(res['verts'], 2)
    for f in bm.faces:
        f.smooth = f.material_index != 2
    me = bpy.data.meshes.new('Person_' + pose)
    bm.to_mesh(me)
    bm.free()
    for m in (crowd_m, skin_m, phone_m):
        me.materials.append(m)
    return bpy.data.objects.new('Person_' + pose, me)


random.seed(31)
crowd_pts = []
tries = 0
while len(crowd_pts) < args.crowd and tries < args.crowd * 5:
    tries += 1
    y = -random.uniform(5.5, 125)
    t = (-y - 5.5) / 112
    half = 52 + 48 * t
    x = random.uniform(-half, half)
    if abs(x) < 9.5 and y > B_Y - 7.5:
        continue  # catwalk and B-stage
    if y > -9.0:
        continue  # in front of the barrier only
    if math.hypot(x - 5, y + 64) < 3.5:
        continue  # room for the crowd camera
    if abs(x) < 8 and -86 < y < -74:
        continue  # FOH
    # thinner at the back and edges
    if random.random() < t * 0.55 + max(0, abs(x) / half - 0.75):
        continue
    crowd_pts.append((x, y, 0, math.pi + math.atan2(-x, -y) + random.uniform(-0.4, 0.4), random.uniform(0.9, 1.08)))
scatter('Crowd', crowd_pts, [person('down'), person('down'), person('one'), person('both'), person('both'), person('phone'), person('clap')], 'Crowd')

# flags waving above the crowd
flag_cols = [MAGENTA, CYAN, GOLD, (0.9, 0.9, 0.95), (0.2, 0.35, 1.0), (1.0, 0.35, 0.15)]
bm_pole = bmesh.new()
for i in range(26):
    x, y = random.uniform(-60, 60), random.uniform(-100, -14)
    if abs(x) < 9 or y > -14 or math.hypot(x - 5, y + 64) < 25:
        continue
    hgt = random.uniform(3.6, 5.2)
    bm_cyl(bm_pole, (x, y, 0), (x, y, hgt), 0.025, segs=4)
    fb = bmesh.new()
    cols_n, rows_n = 8, 4
    ang = random.uniform(0, 6.28)
    vs = []
    for r in range(rows_n + 1):
        row = []
        for c in range(cols_n + 1):
            u = c / cols_n
            flap = math.sin(u * 5 + i) * 0.18 * u
            row.append(fb.verts.new((x + math.cos(ang) * u * 1.6 - math.sin(ang) * flap, y + math.sin(ang) * u * 1.6 + math.cos(ang) * flap, hgt - r / rows_n * 1.0 - u * 0.15)))
        vs.append(row)
    for r in range(rows_n):
        for c in range(cols_n):
            fb.faces.new([vs[r][c], vs[r][c + 1], vs[r + 1][c + 1], vs[r + 1][c]])
    fm = mat_pbr('Flag', random.choice(flag_cols), rough=0.6)
    fm.use_backface_culling = False
    bm_obj('Flag', fb, fm, 'Crowd', smooth=True)
bm_obj('FlagPoles', bm_pole, M['truss'], 'Crowd')


# =================================================================== LIGHTING
# warm gold architecture against a blue night, white beams and fireworks
# warm washes that paint the palace (surfaces only)
for k, (x, tx) in enumerate(((-40, -75), (-26, -50), (-12, -24), (0, 0), (12, 24), (26, 50), (40, 75))):
    spot('Wash%d' % k, (x * 0.5, -80, 18), (tx, 20, 22), AMBER if k % 2 else WARM_W, 260000, 16, blend=0.7, radius=0.5, fixture=False, haze=False)
for k, x in enumerate((-60, -30, 30, 60)):
    spot('WashCool%d' % k, (x * 0.6, -70, 30), (x * 1.2, 34, 45), ICE, 150000, 12, blend=0.7, radius=0.5, fixture=False, haze=False)
# heads around the gate arch: white fans over the crowd and up into the smoke
for k in range(17):
    a = math.pi * k / 16
    q = Vector(((GATE_R + 3.2) * math.cos(a), GATE_Y - 3.0, GATE_SPRING + (GATE_R + 3.2) * math.sin(a)))
    tgt = (q.x * 4, -75, 0) if k % 2 else (q.x * 4.5, -40, 80)
    spot('GateHead%d' % k, tuple(q), tgt, WHITE if k % 3 else WARM_W, 220000 * BEAM, 2.0)
# beams off the tower tops
for k, top in enumerate(TOWER_TOPS):
    if k % 3:
        continue
    spot('Sky%d' % k, tuple(top + Vector((0, -0.3, 0.6))), (top.x * 1.3 + (k % 5 - 2) * 8, top.y - 35, 160), WHITE if k % 2 else ICE, 300000 * BEAM, 1.8, fixture=False)
# cool backlight so the skyline stands off the night
for x in range(-88, 89, 11):
    spot('Back', (x, 48, 1.0), (x * 1.1, 26, 70), DEEP, 110000 * BEAM, 10, blend=0.6, radius=0.6, fixture=False)
# the fireworks light the smoke around them
for k, q in enumerate(FIREWORKS):
    point('FireworkGlow%d' % k, tuple(q), (1.0, 0.85, 0.65), 25000, radius=6).visible_volume_scatter = True
# blinders and stage-front warmth bursting through the CO2
for x in (-20, -11, 11, 20):
    b = area('Blinder', (x, FRONT_Y - 0.6, DECK_H + 0.7), (x * 1.6, -45, 3), (1.0, 0.8, 0.55), 30000, 1.0)
    b.visible_volume_scatter = True
    bm = bmesh.new()
    bm_box(bm, (1.5, 0.3, 1.0), Vector((x, FRONT_Y - 0.3, DECK_H + 0.7)))
    bm_obj('BlinderBody', bm, M['black'], 'Lights')
# truss tower tops
for top in SPEAKER_HANGS:
    for k, dx in enumerate((-1.8, -0.6, 0.6, 1.8)):
        p = top + Vector((dx, -0.6, 0.9))
        spot('TrussHead', tuple(p), (p.x * 2.0 + dx * 12, -60, 0 if k % 2 else 40), WHITE if k % 2 else WARM_W, 220000 * BEAM, 2.4)
# the crowd catches the stage's warm spill
for k, x in enumerate(range(-40, 41, 10)):
    spot('CrowdWash', (x, FRONT_Y - 1, DECK_H + 0.3), (x * 1.3, -45, 1), WARM_W, 50000, 32, blend=0.8, radius=0.4, fixture=False, haze=False)
area('BandKey', (0, -16, 12), (0, 5, 3), (1.0, 0.9, 0.8), 50000, 10)
for sx in (-1, 1):
    area('BandRim', (sx * 9, 12, 12), (sx * 3, 3, 3), ICE, 30000, 4)
sun = bpy.data.lights.new('Moon', 'SUN')
sun.energy = 0.08
sun.color = (0.6, 0.7, 1.0)
so = bpy.data.objects.new('Moon', sun)
so.rotation_euler = (math.radians(65), 0, math.radians(160))
link(so, 'Lights')

# haze over stage and crowd
haze = bpy.data.materials.new('Haze')
haze.use_nodes = True
hn = haze.node_tree
hn.nodes.clear()
ho = hn.nodes.new('ShaderNodeOutputMaterial')
hv = hn.nodes.new('ShaderNodeVolumePrincipled')
hv.inputs['Color'].default_value = (0.92, 0.92, 1.0, 1)
hv.inputs['Anisotropy'].default_value = 0.45
hnoise = hn.nodes.new('ShaderNodeTexNoise')
hnoise.inputs['Scale'].default_value = 0.02
hnoise.inputs['Detail'].default_value = 3
htc = hn.nodes.new('ShaderNodeTexCoord')
hn.links.new(htc.outputs['Object'], hnoise.inputs['Vector'])
hr = hn.nodes.new('ShaderNodeMapRange')
hr.inputs['To Min'].default_value = 0.00006
hr.inputs['To Max'].default_value = 0.0003
hn.links.new(hnoise.outputs['Fac'], hr.inputs['Value'])
hn.links.new(hr.outputs[0], hv.inputs['Density'])
hn.links.new(hv.outputs[0], ho.inputs['Volume'])
bm = bmesh.new()
bm_box(bm, (260, 200, 70), Vector((0, -55, 34.9)))
bm_obj('HazeDomain', bm, haze, 'FX')
stage_haze = haze.copy()
stage_haze.name = 'StageHaze'
for n in stage_haze.node_tree.nodes:
    if n.bl_idname == 'ShaderNodeMapRange':
        n.inputs['To Min'].default_value = 0.0004
        n.inputs['To Max'].default_value = 0.0022
bm = bmesh.new()
bm_box(bm, (190, 75, 34), Vector((0, 8, 16.9)))
bm_obj('StageHaze', bm, stage_haze, 'FX')

# ---------------------------------------------------------------- sky: deep night, faint clouds, stars
world = bpy.data.worlds.new('Dusk')
scene.world = world
world.use_nodes = True
wn = world.node_tree
bg = wn.nodes['Background']
coord = wn.nodes.new('ShaderNodeTexCoord')
sep = wn.nodes.new('ShaderNodeSeparateXYZ')
wn.links.new(coord.outputs['Generated'], sep.inputs[0])
dz = sep.outputs['Z']
sky = ramp_node(wn, [(0.0, (0.03, 0.05, 0.14)), (0.12, (0.012, 0.02, 0.07)), (0.4, (0.004, 0.007, 0.025)), (1.0, (0.002, 0.003, 0.012))], dz)
# clouds: noise projected onto a dome, soft-edged, lit a little brighter on top
den = mnode(wn, 'ADD', dz, 0.18)
proj = wn.nodes.new('ShaderNodeCombineXYZ')
wn.links.new(mnode(wn, 'DIVIDE', sep.outputs['X'], den), proj.inputs['X'])
wn.links.new(mnode(wn, 'MULTIPLY', mnode(wn, 'DIVIDE', sep.outputs['Y'], den), 1.6), proj.inputs['Y'])
cl = wn.nodes.new('ShaderNodeTexNoise')
cl.inputs['Scale'].default_value = 0.9
cl.inputs['Detail'].default_value = 7
cl.inputs['Roughness'].default_value = 0.55
wn.links.new(proj.outputs[0], cl.inputs['Vector'])
mr = wn.nodes.new('ShaderNodeMapRange')
mr.inputs['From Min'].default_value = 0.52
mr.inputs['From Max'].default_value = 0.66
wn.links.new(cl.outputs['Fac'], mr.inputs['Value'])
above = mnode(wn, 'MINIMUM', mnode(wn, 'MULTIPLY', mnode(wn, 'SUBTRACT', dz, 0.04), 6.0), 1.0)
cmask = mnode(wn, 'MULTIPLY', mnode(wn, 'MAXIMUM', mr.outputs[0], 0.0), mnode(wn, 'MAXIMUM', above, 0.0))
cloud_col = ramp_node(wn, [(0.0, (0.004, 0.007, 0.03)), (1.0, (0.015, 0.025, 0.07))], cl.outputs['Fac'])
col = mix_rgba(wn, sky, cloud_col, mnode(wn, 'MULTIPLY', cmask, 0.92))
# stars where the sky is clear
st = wn.nodes.new('ShaderNodeTexVoronoi')
st.inputs['Scale'].default_value = 420
wn.links.new(coord.outputs['Generated'], st.inputs['Vector'])
star = mnode(wn, 'MULTIPLY', mnode(wn, 'MULTIPLY', mnode(wn, 'LESS_THAN', st.outputs['Distance'], 0.05), mnode(wn, 'GREATER_THAN', st.outputs['Color'], 0.55)),
             mnode(wn, 'MULTIPLY', mnode(wn, 'SUBTRACT', 1.0, cmask), mnode(wn, 'MAXIMUM', above, 0.0)))
col = mix_rgba(wn, col, (0.6, 0.65, 0.8, 1), mnode(wn, 'MULTIPLY', star, 0.5))
wn.links.new(col, bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.0


# =================================================================== CAMERAS
VIEWS = {
    # elevated three-quarter view from the side of the field
    'hero': ((96, -122, 44), (-4, 14, 24), 26),
    # straight on from the middle of the crowd: the in-game backdrop framing
    'front': ((-2, -58, 4.2), (0, 12, 26), 18),
    # standing in the crowd, heads in silhouette against the stage
    'crowd': ((5, -64, 2.5), (0, 14, 18), 24),
    # low and close from the B-stage
    'close': ((-6, -42, 3.4), (0, 12, 20), 18),
    # wide aerial
    'aerial': ((60, -190, 95), (0, 0, 10), 32),
}
cams = {}
for k, (loc, tgt, lens) in VIEWS.items():
    cd = bpy.data.cameras.new('CAM_' + k)
    cd.lens = lens
    cd.clip_end = 3000
    cam = bpy.data.objects.new('CAM_' + k, cd)
    cam.location = loc
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    link(cam, 'Cameras')
    cams[k] = cam
scene.camera = cams.get(args.view, cams['hero'])

# =================================================================== RENDER
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
for kind in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        if any(d.type == kind for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = 'GPU'
            break
    except Exception:
        pass
cy = scene.cycles
cy.samples = args.samples
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.015
cy.use_denoising = True
cy.volume_step_rate = 2.5
cy.volume_bounces = 1
cy.max_bounces = 6
cy.transmission_bounces = 4
cy.caustics_reflective = False
cy.caustics_refractive = False
cy.use_light_tree = True
w, h = (int(v) for v in args.res.split('x'))
scene.render.resolution_x, scene.render.resolution_y = w, h
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
scene.view_settings.exposure = -0.5
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = args.out

try:
    tree = bpy.data.node_groups.new('Comp', 'CompositorNodeTree')
    scene.compositing_node_group = tree
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = tree.nodes.new('CompositorNodeRLayers')
    gl = tree.nodes.new('CompositorNodeGlare')
    out = tree.nodes.new('NodeGroupOutput')
    gl.inputs['Type'].default_value = 'Bloom'
    gl.inputs['Threshold'].default_value = 1.2
    gl.inputs['Strength'].default_value = 0.45
    gl.inputs['Size'].default_value = 0.8
    tree.links.new(rl.outputs['Image'], gl.inputs['Image'])
    tree.links.new(gl.outputs['Image'], out.inputs[0])
except Exception as e:
    print('bloom skipped:', e)


# =================================================================== REAL-TIME EXPORT
def to_three(v):
    """Blender (Z up) to three.js (Y up) coordinates."""
    return [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]


def flatten_material(m):
    """Bakes a node material down to constant glTF-friendly PBR values."""
    nt = m.node_tree
    if not nt:
        return
    base, metal, rough, emit, es = (0.5, 0.5, 0.5, 1), 0.0, 0.5, (0, 0, 0, 1), 0.0
    pr = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    em = next((n for n in nt.nodes if n.type == 'EMISSION'), None)
    if pr:
        base = tuple(pr.inputs['Base Color'].default_value) if not pr.inputs['Base Color'].is_linked else (0.5, 0.5, 0.6, 1)
        metal = pr.inputs['Metallic'].default_value
        rough = pr.inputs['Roughness'].default_value
        emit = tuple(pr.inputs['Emission Color'].default_value)
        es = pr.inputs['Emission Strength'].default_value if not pr.inputs['Emission Strength'].is_linked else 1.0
    elif em:
        base = (0, 0, 0, 1)
        emit = tuple(em.inputs['Color'].default_value) if not em.inputs['Color'].is_linked else (0.6, 0.6, 0.8, 1)
        es = em.inputs['Strength'].default_value
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = base
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    p.inputs['Emission Color'].default_value = emit
    p.inputs['Emission Strength'].default_value = es
    nt.links.new(p.outputs[0], out.inputs[0])


def islands(obj):
    """Centres and radii of the loose parts of a mesh, in world space."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    bm.verts.ensure_lookup_table()
    seen = bytearray(len(bm.verts))
    out = []
    for v in bm.verts:
        if seen[v.index]:
            continue
        stack, comp = [v], []
        seen[v.index] = 1
        while stack:
            a = stack.pop()
            comp.append(a.co.copy())
            for e in a.link_edges:
                b = e.other_vert(a)
                if not seen[b.index]:
                    seen[b.index] = 1
                    stack.append(b)
        c = sum(comp, Vector()) / len(comp)
        out.append((c, max((q - c).length for q in comp)))
    bm.free()
    return out


def join(objs, name):
    """Joins mesh objects (world transforms kept) into one named object."""
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def export_for_game(out_dir):
    import json
    import os
    import re
    os.makedirs(out_dir, exist_ok=True)
    bpy.context.view_layer.update()
    data = {'version': 1}
    data['cameras'] = {k: {'pos': to_three(loc), 'target': to_three(tgt), 'hfov': round(math.degrees(2 * math.atan(18 / lens)), 2)}
                       for k, (loc, tgt, lens) in VIEWS.items()}
    beams, washes, glows = [], [], []
    for o in list(scene.objects):
        if o.type != 'LIGHT':
            continue
        L = o.data
        mw = o.matrix_world
        e = {'group': re.match(r'[A-Za-z]+', o.name).group(0), 'pos': to_three(mw.translation),
             'dir': to_three((mw.to_3x3() @ Vector((0, 0, -1))).normalized()), 'color': [round(c, 3) for c in L.color], 'energy': round(L.energy)}
        if L.type == 'SPOT':
            e['angle'] = round(math.degrees(L.spot_size), 2)
            (beams if o.visible_volume_scatter else washes).append(e)
        elif L.type in ('POINT', 'AREA'):
            glows.append(e)
        bpy.data.objects.remove(o)
    data['beams'], data['washes'], data['glows'] = beams, washes, glows
    # volumes, fireworks and cameras are rebuilt live in the game
    for o in list(scene.objects):
        vol = o.type == 'MESH' and len(o.data.materials) > 0 and any(
            m and m.node_tree and any(n.type == 'OUTPUT_MATERIAL' and n.inputs['Volume'].is_linked for n in m.node_tree.nodes) for m in o.data.materials)
        if vol or o.name.startswith('Firework') or o.type == 'CAMERA':
            bpy.data.objects.remove(o)
    data['fireworks'] = [{**f, 'origin': to_three(f['origin'])} for f in FIREWORK_SPECS]
    data['co2'] = [to_three(c) for c in cannons]
    data['wheel'] = to_three(WHEEL)
    data['armillary'] = to_three(ARM)
    data['sun'] = to_three(SUN)
    # bulbs become a point list (the wheel keeps its own so they can turn with it)
    bulbs = []
    for o in list(scene.objects):
        if o.type == 'MESH' and len(o.data.materials) > 0 and o.data.materials[0] and o.data.materials[0].name.startswith('Bulbs') and not o.name.startswith('Wheel'):
            parts = islands(o)
            if max(r for _, r in parts) > 0.5:
                continue  # LED strips share the bulb material; they stay geometry
            for c, r in parts:
                bulbs += to_three(c) + [round(r, 2)]
            bpy.data.objects.remove(o)
    data['bulbs'] = bulbs
    # crowd and trees: instance points plus their variant meshes
    inst = bpy.data.collections.new('Instances')
    root_col.children.link(inst)
    for name, (pts, variants) in SCATTERS.items():
        data[name.lower()] = {'points': [v for q in pts for v in (*to_three(q[:3]), round(q[3], 3), round(q[4], 3))],
                              'variants': ['Variant_%s_%d' % (name, i) for i in range(len(variants))]}
        for i, v in enumerate(variants):
            v.name = 'Variant_%s_%d' % (name, i)
            inst.objects.link(v)
            # thousands of copies: real time gets a lighter mesh than the offline render
            dec = v.modifiers.new('lod', 'DECIMATE')
            dec.ratio = 0.3 if name == 'Crowd' else 0.15
        bpy.data.objects.remove(bpy.data.objects[name])
    # band positions, then flatten the hierarchy
    bpy.context.view_layer.update()
    band = {}
    for o in list(scene.objects):
        if o.type == 'EMPTY' and o.name.startswith('Player_'):
            band[o.name[7:]] = (o.matrix_world.translation.copy(), [c for c in o.children_recursive if c.type == 'MESH'])
    for o in list(scene.objects):
        if o.parent is not None:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
    data['band'] = {k: to_three(pos) for k, (pos, _) in band.items()}
    for kind, (_, parts) in band.items():
        if parts:
            join(parts, 'Band_' + kind)
    for o in list(scene.objects):
        if o.type == 'EMPTY':
            bpy.data.objects.remove(o)
    for m in bpy.data.materials:
        flatten_material(m)
    keep = ('Band_', 'Wheel', 'Armillary', 'GateScreen', 'SunFace', 'Variant_', 'Terrain')
    groups = {}
    for o in scene.objects:
        if o.type == 'MESH' and not o.name.startswith(keep) and len(o.data.materials) == 1 and o.data.materials[0]:
            groups.setdefault(o.data.materials[0].name, []).append(o)
    for mname, objs in groups.items():
        join(objs, 'M_' + mname)
    for o in scene.objects:
        if o.type not in ('MESH',):
            print('warning: non-mesh left in export', o.name, o.type)
    glb = os.path.join(out_dir, 'stage.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=True, export_yup=True, export_lights=False, export_cameras=False,
                              export_texcoords=False, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    with open(os.path.join(out_dir, 'stage.json'), 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    meshes = [o for o in scene.objects if o.type == 'MESH']
    print('exported', glb, 'objects', len(meshes), 'tris', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes),
          'bulbs', len(bulbs) // 4, 'beams', len(beams), 'washes', len(washes))


if args.export:
    export_for_game(args.export)
    raise SystemExit(0)


print('lights:', LIGHT_COUNT[0], 'crowd:', len(crowd_pts), 'trees:', len(tree_pts))
if args.save:
    bpy.ops.wm.save_as_mainfile(filepath=args.save)
if args.out != 'none':
    bpy.ops.render.render(write_still=True)
    print('rendered', args.out)
