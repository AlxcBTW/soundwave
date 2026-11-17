"""
Builds the festival main stage procedurally in Blender and renders it.

    blender -b --factory-startup -P tools/stage/build_stage.py -- \
        --view hero --out local-audio/stage/hero.png --samples 256 --res 2560x1440 [--save stage.blend]

The stage: a giant cartoon wave (sound wave and ocean wave at once) curls over the band like a
barrel, smaller waves break toward it from the wings, the deck spreads into the crowd in ripple
steps, and sweeping ribbons carry the lights. The look is painted: gradients, glitter, glowing
rims. Everything is generated, so the scene stays reviewable as code and can be re-tuned or
re-exported for the game.

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


# =================================================================== PAINTED LOOK
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


def mat_painted(name, stops, source='u', zmax=40.0, glitter=0.0, illum=0.22, rough=0.42, coat=0.5, streaks=0.0):
    """Hand-painted look: a colour gradient (along the wave profile or up the object), softly
    self-lit so it reads like paint even in shadow, with a clear coat and glitter sparkles."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = 0.12
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    if source == 'u':
        nt.links.new(tc.outputs['UV'], sep.inputs[0])
        fac = sep.outputs['X']
    else:
        nt.links.new(tc.outputs['Object'], sep.inputs[0])
        fac = mnode(nt, 'DIVIDE', sep.outputs['Z'], zmax)
    # brushy breakup so the gradient doesn't look airbrushed
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 0.12
    nz.inputs['Detail'].default_value = 4
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    fac = mnode(nt, 'ADD', fac, mnode(nt, 'SUBTRACT', mnode(nt, 'MULTIPLY', nz.outputs['Fac'], 0.14), 0.07))
    col = ramp_node(nt, stops, fac)
    if streaks and source == 'u':
        # cartoon water: lighter streaks running up the face, following the flow
        sv = nt.nodes.new('ShaderNodeCombineXYZ')
        nt.links.new(mnode(nt, 'MULTIPLY', sep.outputs['X'], 3.0), sv.inputs['X'])
        nt.links.new(mnode(nt, 'MULTIPLY', sep.outputs['Y'], 70.0), sv.inputs['Y'])
        sn = nt.nodes.new('ShaderNodeTexNoise')
        sn.inputs['Scale'].default_value = 1.0
        sn.inputs['Detail'].default_value = 2
        nt.links.new(sv.outputs[0], sn.inputs['Vector'])
        sm = nt.nodes.new('ShaderNodeMapRange')
        sm.inputs['From Min'].default_value = 0.56
        sm.inputs['From Max'].default_value = 0.66
        nt.links.new(sn.outputs['Fac'], sm.inputs['Value'])
        col = mix_rgba(nt, col, (*srgb((0.62, 0.7, 1.0)), 1), mnode(nt, 'MULTIPLY', sm.outputs[0], streaks))
    nt.links.new(col, p.inputs['Base Color'])
    emit_col, strength = col, None
    if glitter:
        vor = nt.nodes.new('ShaderNodeTexVoronoi')
        vor.inputs['Scale'].default_value = glitter
        nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
        spark = mnode(nt, 'MULTIPLY', mnode(nt, 'MAXIMUM', mnode(nt, 'SUBTRACT', 1.0, mnode(nt, 'DIVIDE', vor.outputs['Distance'], 0.07)), 0.0),
                      mnode(nt, 'GREATER_THAN', vor.outputs['Color'], 0.62))
        emit_col = mix_rgba(nt, col, (1, 1, 1, 1), spark)
        strength = mnode(nt, 'ADD', mnode(nt, 'MULTIPLY', spark, 16.0), illum)
    nt.links.new(emit_col, p.inputs['Emission Color'])
    if strength is None:
        p.inputs['Emission Strength'].default_value = illum
    else:
        nt.links.new(strength, p.inputs['Emission Strength'])
    return m


def mat_soundlines(name, lines=30.0):
    """The curl's underside: glowing sound-wave lines running along the curl, hue drifting across."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*srgb((0.02, 0.03, 0.16)), 1)
    p.inputs['Roughness'].default_value = 0.4
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['UV'], sep.inputs[0])
    wob = mnode(nt, 'MULTIPLY', mnode(nt, 'SINE', mnode(nt, 'MULTIPLY', sep.outputs['Y'], 25.0)), 0.012)
    line = mnode(nt, 'POWER', mnode(nt, 'ABSOLUTE', mnode(nt, 'SINE', mnode(nt, 'MULTIPLY', mnode(nt, 'ADD', sep.outputs['X'], wob), lines))), 18.0)
    hue = ramp_node(nt, [(0.0, MAGENTA), (0.3, VIOLET), (0.5, CYAN), (0.7, VIOLET), (1.0, MAGENTA)], sep.outputs['Y'])
    nt.links.new(hue, p.inputs['Emission Color'])
    nt.links.new(mnode(nt, 'ADD', mnode(nt, 'MULTIPLY', line, 9.0), 0.25), p.inputs['Emission Strength'])
    return m


# profile positions: 0.375 crest top, 0.5 lip edge, 0.625 lip front, 0.75+ underside of the curl
M['wave_out'] = mat_painted('WavePaint', [(0.0, (0.015, 0.025, 0.18)), (0.25, (0.04, 0.1, 0.5)), (0.34, (0.2, 0.22, 0.95)),
                                            (0.4, (0.6, 0.45, 1.0)), (0.45, (0.9, 0.86, 1.0)), (0.5, (0.35, 0.4, 1.0)),
                                            (0.6, (0.1, 0.3, 0.98)), (0.74, (0.04, 0.5, 0.95)), (1.0, (0.2, 0.85, 1.0))],
                            glitter=2.6, illum=0.32, streaks=0.55, rough=0.55, coat=0.15)
M['wave_in'] = mat_soundlines('WaveLines')
M['rim'] = mat_emit('WaveRim', LILAC, 5)
M['foam'] = mat_painted('Foam', [(0.0, (0.7, 0.72, 1.0)), (1.0, (0.97, 0.95, 1.0))], source='z', zmax=50, glitter=6.0, illum=0.45, rough=0.3)
M['step'] = mat_painted('StepPaint', [(0.0, (0.06, 0.1, 0.45)), (1.0, (0.55, 0.6, 1.0))], source='z', zmax=3.0, glitter=4.0, illum=0.3)
M['ribbon'] = mat_painted('RibbonPaint', [(0.0, (0.08, 0.12, 0.5)), (0.6, (0.45, 0.5, 1.0)), (1.0, (0.85, 0.85, 1.0))], source='z', zmax=50, glitter=3.0, illum=0.3, coat=0.8)


# =================================================================== STAGE: THE SOUNDWAVE CREST
def catmull(points, n):
    """Smooth curve through `points` (2D or 3D), `n` samples per span."""
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


# a breaking wave's cross-section (y toward the back, z up): rises at the back, crests, throws its
# lip forward and curls back in underneath, a barrel the band plays inside
CREST = [(26, 0), (22, 14), (14, 30), (2, 42), (-10, 40.5), (-16, 31), (-13.5, 21.5), (-6, 18.5), (-2.5, 22.5)]
# toward its ends a wave peels off into a low swell running into the ground
SWELL = [(26, 0), (21, 4), (13, 8.5), (4, 10.5), (-5, 9.5), (-12, 6.5), (-16, 3.5), (-18.5, 1.2), (-20, -0.4)]
CREST_PROFILE = catmull(CREST, 9)
SWELL_PROFILE = catmull(SWELL, 9)
CREST_BASE = Vector(CREST[0])


def curl(u):
    """How much of the barrel curl stands at this point across the wave (0..1 edge to edge)."""
    return (1 - abs(2 * u - 1) ** 2.2) ** 1.2


def profile_at(u, flat=False):
    """The cross-section at u. A flat (a thin cut-out) keeps the full curl across its width."""
    c = 1.0 if flat else curl(u)
    fade = min(1.0, (1 - abs(2 * u - 1)) / (0.3 if flat else 0.08)) ** 0.5
    return [CREST_BASE + (sw.lerp(cr, c) - CREST_BASE) * max(0.04, fade) for sw, cr in zip(SWELL_PROFILE, CREST_PROFILE)]


def crest_local(u, f, half_w, scale, lift=0.0, flat=False):
    """Local position on a wave: u across its width, f along its profile (0 back foot, 1 inner tip)."""
    prof = profile_at(u, flat)
    j = f * (len(prof) - 1)
    q = prof[int(j)].lerp(prof[min(len(prof) - 1, int(j) + 1)], j - int(j)) * scale
    return Vector(((u - 0.5) * 2 * half_w, q.x, q.y + lift))


def envelope(u):
    return max(0.05, curl(u))


WAVES = {}


def wave(name, loc, yaw, half_w, scale, nx=60, thick=1.4, flat=False):
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    grid = []
    npf = len(CREST_PROFILE)
    for i in range(nx + 1):
        u = i / nx
        x = (u - 0.5) * 2 * half_w
        row = []
        for q in profile_at(u, flat):
            w = q * scale
            row.append(bm.verts.new((x, w.x, w.y)))
        grid.append(row)
    for i in range(nx):
        for j in range(npf - 1):
            ids = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            f = bm.faces.new([grid[a][b] for a, b in ids])
            f.smooth = True
            for loop, (a, b) in zip(f.loops, ids):
                loop[uvl].uv = (b / (npf - 1), a / nx)
    o = bm_obj(name, bm, [M['wave_in'], M['wave_out'], M['rim']])
    o.location = loc
    o.rotation_euler = (0, 0, yaw)
    sol = o.modifiers.new('thickness', 'SOLIDIFY')
    sol.thickness = thick * max(scale, 0.55)
    sol.offset = 0.0
    sol.use_rim = True
    sol.material_offset = 1
    sol.material_offset_rim = 2
    sub = o.modifiers.new('smooth', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 2
    WAVES[name] = (o, half_w, scale, flat)
    return o


def on_wave(name, u, f, lift=0.0):
    o, half_w, scale, flat = WAVES[name]
    bpy.context.view_layer.update()
    return o.matrix_world @ crest_local(u, f, half_w, scale, lift, flat)


def wave_dir(name, v):
    o = WAVES[name][0]
    return o.matrix_world.to_3x3() @ Vector(v)


def foam(name, n):
    """A bubbly foam roll along the lip, a few bubbles on it, and spray thrown off the front."""
    o, half_w, scale, flat = WAVES[name]
    cu = bpy.data.curves.new(name + '_foamroll', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 6
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    steps = 90
    sp.points.add(steps)
    for k in range(steps + 1):
        u = 0.02 + 0.96 * k / steps
        c = 1.0 if flat else curl(u)
        pt = on_wave(name, u, 0.47, lift=0.6 * scale)
        sp.points[k].co = (pt.x, pt.y, pt.z, 1)
        sp.points[k].radius = (0.25 + 1.25 * c * (0.75 + 0.25 * math.sin(u * 47) * math.sin(u * 13))) * scale
    sp.use_smooth = True
    cu.materials.append(M['foam'])
    link(bpy.data.objects.new(name + '_foamroll', cu))
    bm, bd = bmesh.new(), bmesh.new()
    for _ in range(n):
        u = random.uniform(0.05, 0.95)
        c = 1.0 if flat else curl(u)
        if c < 0.3:
            continue
        pt = on_wave(name, u, random.uniform(0.42, 0.53), lift=random.uniform(0.4, 1.4) * scale)
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=random.uniform(0.4, 1.3) * scale * c, matrix=Matrix.Translation(pt))
    for _ in range(int(n * 0.5)):
        u = random.uniform(0.15, 0.85)
        c = 1.0 if flat else curl(u)
        pt = on_wave(name, u, random.uniform(0.48, 0.56))
        pt += wave_dir(name, (random.uniform(-1.5, 1.5), -random.uniform(1.0, 5.0), random.uniform(0, 4))) * scale * c
        bmesh.ops.create_icosphere(bd, subdivisions=2, radius=random.uniform(0.12, 0.4) * scale * c, matrix=Matrix.Translation(pt))
    bm_obj(name + '_foam', bm, M['foam'], smooth=True)
    bm_obj(name + '_spray', bd, M['foam'], smooth=True)


wave('Crest', (0, 0, 0), 0.0, 33, 1.0, nx=72)
foam('Crest', 120)
# wing waves: layered cut-outs showing the crowd their curl, stepping down outward like
# theatre flats, all breaking toward the centre
WING_WAVES = []
for side in (-1, 1):
    for k, (x, y, sc, hw, yaw) in enumerate(((45, 15, 0.78, 2.6, 84), (59, 8, 0.6, 2.3, 80), (72, 1, 0.44, 2.0, 76), (83, -6, 0.3, 1.7, 72))):
        n = 'Wing%+d_%d' % (side, k)
        wave(n, (side * x, y, 0), math.radians(-side * yaw), hw, sc, nx=14, thick=1.6, flat=True)
        foam(n, 30)
        WING_WAVES.append(n)

# ---------------------------------------------------------------- ripple-step deck
DECK_H = 2.6
DECK_C = 8.0  # the deck's ellipses are centred here (y)
FRONT_Y = DECK_C - 16.0
CAT_LEN = 24.0


def ellipse_step(name, rx, ry, h, led, top_mat=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=144, radius1=1, radius2=1, depth=h, matrix=Matrix.Translation((0, 0, h / 2)))
    for v in bm.verts:
        v.co.x *= rx
        v.co.y *= ry
    rim = [e for e in bm.edges if all(abs(v.co.z - h) < 1e-4 for v in e.verts)]
    bmesh.ops.bevel(bm, geom=rim + list({v for e in rim for v in e.verts}), offset=min(0.35, h * 0.3), segments=3, affect='EDGES', profile=0.5)
    bm.normal_update()
    for f in bm.faces:
        f.material_index = 0 if f.normal.z > 0.6 else 1
        f.smooth = f.normal.z <= 0.6
    o = bm_obj(name, bm, [top_mat or M['deck'], M['step']])
    o.location = (0, DECK_C, 0)
    lb = bmesh.new()
    bmesh.ops.create_cone(lb, cap_ends=False, segments=144, radius1=1, radius2=1, depth=0.14, matrix=Matrix.Translation((0, 0, h * 0.55)))
    for v in lb.verts:
        v.co.x *= rx + 0.03
        v.co.y *= ry + 0.03
    led_o = bm_obj(name + '_led', lb, led)
    led_o.location = (0, DECK_C, 0)
    return o


ellipse_step('Deck', 40, 16, DECK_H, M['edge_c'])
for k, (rx, ry, h, led) in enumerate(((45, 20, 1.75, M['edge_m']), (50.5, 24, 1.05, M['edge_v']), (56, 28, 0.45, M['edge_c']))):
    ellipse_step('Ripple%d' % k, rx, ry, h, led)

# thrust catwalk into the crowd and a round B-stage
box_obj('Catwalk', (5.0, CAT_LEN, DECK_H - 0.4), (0, FRONT_Y - CAT_LEN / 2 + 0.5, (DECK_H - 0.4) / 2), M['deck'], bevel=0.05)
for sx in (-1, 1):
    box_obj('CatwalkLED', (0.12, CAT_LEN, 0.1), (sx * 2.56, FRONT_Y - CAT_LEN / 2 + 0.5, DECK_H - 0.45), M['edge_c'])
B_Y = FRONT_Y - CAT_LEN - 5
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=6.0, radius2=6.0, depth=DECK_H - 0.4, matrix=Matrix.Translation((0, B_Y, (DECK_H - 0.4) / 2)))
bm_obj('BStage', bm, M['deck'])
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=6.05, radius2=6.05, depth=0.12, matrix=Matrix.Translation((0, B_Y, DECK_H - 0.45)))
bm_obj('BStageLED', bm, M['edge_c'])

# risers: drums centre, two raised side platforms with LED fascias and stairs
box_obj('DrumRiser', (12, 7, 1.4), (0, 13, DECK_H + 0.7), M['deck'], bevel=0.05)
box_obj('DrumRiserLED', (12, 0.1, 0.1), (0, 9.45, DECK_H + 1.35), M['edge_g'])
pixel_face('DrumRiserPx', 11.5, 1.2, sweep, GOLD, None, 9.44, z0=DECK_H + 0.05, pitch=0.5, cell=0.2)
for sx in (-1, 1):
    x = sx * 19
    box_obj('Platform', (11, 7, 3.0), (x, 15, DECK_H + 1.5), M['deck'], bevel=0.05)
    box_obj('PlatformLED', (11, 0.1, 0.12), (x, 11.45, DECK_H + 2.95), M['edge_c' if sx > 0 else 'edge_m'])
    pixel_face('PlatformPx', 10.5, 2.6, columns, CYAN if sx > 0 else MAGENTA, None, 11.44, z0=DECK_H + 0.1, pitch=0.55, cell=0.24)
    bm = bmesh.new()
    for i in range(10):
        bm_box(bm, (2.4, 0.35, 0.3), Vector((x - sx * 6.7, 11.5 + 0.35 * i, DECK_H + 0.15 + i * 0.3)))
    bm_obj('Stairs', bm, M['trim'])

# ---------------------------------------------------------------- the disc screen behind the band
def mat_sunburst(name, strength=3.0, rays=20, rings=9.0, aspect=1.0, cz=0.5):
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
    el[0].position, el[0].color = 0.0, (*srgb((0.03, 0.0, 0.1)), 1)
    el[1].position, el[1].color = 1.0, (*srgb((1.0, 0.9, 1.0)), 1)
    e = el.new(0.35)
    e.color = (*srgb((0.75, 0.08, 0.5)), 1)
    e = el.new(0.65)
    e.color = (*srgb((0.25, 0.75, 1.0)), 1)
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



DISC = Vector((0, 17.5, 13.5))
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=8.6, radius2=8.6, depth=0.3,
                      matrix=Matrix.Translation(DISC) @ Matrix.Rotation(math.radians(90), 4, 'X'))
bm_obj('DiscScreen', bm, mat_sunburst('DiscContent', strength=3.2, rays=24, rings=7.0))
bpy.ops.mesh.primitive_torus_add(major_radius=9.3, minor_radius=0.75, major_segments=96, minor_segments=20, location=DISC, rotation=(math.radians(90), 0, 0))
ring = bpy.context.active_object
ring.data.materials.append(M['ribbon'])
for f in ring.data.polygons:
    f.use_smooth = True
ring.users_collection[0].objects.unlink(ring)
link(ring)
bpy.ops.mesh.primitive_torus_add(major_radius=10.15, minor_radius=0.14, major_segments=96, minor_segments=8, location=DISC - Vector((0, 0.3, 0)), rotation=(math.radians(90), 0, 0))
glow = bpy.context.active_object
glow.data.materials.append(M['edge_m'])
glow.users_collection[0].objects.unlink(glow)
link(glow)


# ---------------------------------------------------------------- sweeping ribbons
RIBBON_LIGHTS = []


def ribbon(name, ctrl, r, n=14):
    pts = catmull(ctrl, n)
    for nm, rad, mat, off in ((name, r, M['ribbon'], 0.0), (name + '_led', r * 0.22, M['edge_l'], r * 0.92)):
        cu = bpy.data.curves.new(nm, 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = rad
        cu.bevel_resolution = 6
        cu.use_fill_caps = True
        sp = cu.splines.new('POLY')
        sp.points.add(len(pts) - 1)
        for k, q in enumerate(pts):
            sp.points[k].co = (q.x, q.y, q.z + off, 1)
        sp.use_smooth = True
        cu.materials.append(mat)
        link(bpy.data.objects.new(nm, cu))
    return pts


for side in (-1, 1):
    hi = ribbon('RibbonHigh%+d' % side, [(side * 18, 22, 42), (side * 36, 25, 39), (side * 54, 23, 32), (side * 69, 16, 23),
                                         (side * 82, 7, 12), (side * 92, -2, -1)], 1.4)
    lo = ribbon('RibbonLow%+d' % side, [(side * 30, 27, 26), (side * 48, 30, 19), (side * 66, 25, 11), (side * 80, 17, 4),
                                        (side * 88, 12, -1)], 1.0)
    RIBBON_LIGHTS += [(q, 'hi', side) for q in hi[6:-6:6]] + [(q, 'lo', side) for q in lo[6:-6:8]]


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
    for (x, y, h, arm) in ((side * 36.5, -15.0, 27.0, 2.5),):
        top = truss_tower('Truss%+d_%d' % (side, int(abs(x))), x, y, h, arm)
        line_array('Array%+d_%d' % (side, int(abs(x))), x + side * 1.0, y - 0.2, h - 1.2, boxes=16 if abs(x) < 20 else 12)
        line_array('ArrayOut%+d_%d' % (side, int(abs(x))), x - side * 1.4, y - 0.2, h - 1.2, boxes=10, turn=0.6)
        SPEAKER_HANGS.append(top)

# crowd barrier around the outer ripple and the catwalk
bm = bmesh.new()
OUT_RX, OUT_RY = 58.0, 30.0
arc_l = [(-OUT_RX * math.cos(a), DECK_C - OUT_RY * math.sin(a)) for a in [k / 40 * math.pi / 2 for k in range(41)]]
arc_l = [q for q in arc_l if q[0] < -3.5]
path = arc_l + [(-3.5, FRONT_Y - CAT_LEN + 2), (-8, B_Y), (-3.5, B_Y - 6.5), (3.5, B_Y - 6.5), (8, B_Y), (3.5, FRONT_Y - CAT_LEN + 2)] + \
    [(-x, y) for x, y in reversed(arc_l)]
for (x0, y0), (x1, y1) in zip(path, path[1:]):
    bm_cyl(bm, (x0, y0, 1.15), (x1, y1, 1.15), 0.05, segs=6)
    seg = Vector((x1 - x0, y1 - y0, 0))
    for k in range(int(seg.length / 1.2) + 1):
        q = Vector((x0, y0, 0)) + seg * (k / max(1, int(seg.length / 1.2)))
        bm_cyl(bm, (q.x, q.y, 0), (q.x, q.y, 1.15), 0.03, segs=4)
bm_obj('Barrier', bm, M['truss'], 'Detail')

# CO2 cannons along the front and the catwalk, flame units on wing tops
bm = bmesh.new()
cannons = [(39 * math.cos(a), DECK_C - 15.4 * math.sin(a), DECK_H) for a in [math.radians(d) for d in range(196, 345, 12)] if abs(39 * math.cos(a)) > 4] + \
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
for i, (x, y, z) in enumerate([cannons[k] for k in (0, 1, 2, -6, -5)]):
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
bm_box(bm_b, (3.2, 1.2, 1.1), Vector((-4, 10, DECK_H + 0.55)), bevel=0.04)
bm_obj('Backline', bm_b, M['black'], 'Detail')
bm_obj('BacklineGrilles', bm_g, M['grille'], 'Detail')
box_obj('DeskLED', (3.2, 0.05, 0.08), (-4, 9.38, DECK_H + 1.0), M['edge_c'], where='Detail')
pixel_face('DeskPx', 3.0, 0.8, columns, MAGENTA, None, 9.37, z0=DECK_H + 0.1, pitch=0.2, cell=0.09)

figure(-7.0, 4.5, DECK_H, 'lead', 0.25)
figure(0.0, 3.0, DECK_H, 'vox')
figure(7.0, 4.5, DECK_H, 'bass', -0.25)
figure(0.0, 14.2, DECK_H + 1.4, 'drums')


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
cols = [(0.05, 0.05, 0.06), (0.2, 0.2, 0.22), (0.35, 0.08, 0.1), (0.08, 0.12, 0.3), (0.5, 0.5, 0.5), (0.12, 0.2, 0.12), (0.45, 0.3, 0.12)]
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
phone_m = mat_emit('Phone', (0.95, 0.95, 1.0), 12)


def person(pose):
    bm = bmesh.new()

    def tag(verts, idx):
        vs = set(verts)
        for f in bm.faces:
            if all(v in vs for v in f.verts):
                f.material_index = idx

    for s in (-1, 1):
        bm_cyl(bm, (s * 0.1, 0, 0), (s * 0.11, 0, 0.86), 0.075, segs=6, r2=0.09)
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.17, radius2=0.21, depth=0.6,
                                matrix=Matrix.Translation((0, 0, 1.16)) @ Matrix.Diagonal((1, 0.62, 1, 1)))
    res = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=0.11, matrix=Matrix.Translation((0, 0, 1.6)))
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
        v = bm_cyl(bm, p0, p1, 0.05, segs=5, r2=0.045)
        tag(v, 1 if a != 'down' else 0)
        if a == 'phone':
            res = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(p1 + Vector((0, -0.04, 0.08))) @ Matrix.Diagonal((0.07, 0.012, 0.13, 1)))
            tag(res['verts'], 2)
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
    if (x / (OUT_RX + 1)) ** 2 + ((y - DECK_C) / (OUT_RY + 1)) ** 2 < 1:
        continue  # ripple steps
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
    if abs(x) < 9 or (x / (OUT_RX + 3)) ** 2 + ((y - DECK_C) / (OUT_RY + 3)) ** 2 < 1:
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
# heads tucked under the lip of the crest: fans over the crowd and pools on the band
for k in range(15):
    u = 0.16 + 0.68 * k / 14
    pos = on_wave('Crest', u, 0.9, lift=-1.6)
    x = pos.x
    if k % 2:
        spot('Lip%d' % k, tuple(pos), (x * 3.2, -75, 0), MAGENTA if k % 4 == 1 else LILAC, 260000 * BEAM, 2.4)
    else:
        spot('Lip%d' % k, tuple(pos), (x * 0.35, 4, DECK_H), CYAN if k % 4 else LILAC, 300000, 3.5)
# heads along the crest throwing a fan into the sky
for k in range(11):
    u = 0.14 + 0.72 * k / 10
    pos = on_wave('Crest', u, 0.36, lift=1.6)
    spot('CrestBeam%d' % k, tuple(pos), (pos.x * 4.5, pos.y - 18, 150), VIOLET if k % 2 else CYAN, 300000 * BEAM, 2.3)
# one sky beam off each wing crest
for k, n in enumerate(WING_WAVES):
    pos = on_wave(n, 0.5, 0.36, lift=1.0)
    spot(n + '_beam', tuple(pos), (pos.x * 1.25, pos.y - 30, 150), MAGENTA if k % 2 else CYAN, 500000 * BEAM, 2.4)
# heads riding the ribbons
for k, (q, kind, side) in enumerate(RIBBON_LIGHTS):
    pos = q + Vector((0, 0, -1.6 if kind == 'hi' else 1.4))
    if kind == 'hi':
        tgt = (q.x * 0.6, -70, 0)
    else:
        tgt = (q.x + side * 25, q.y - 40, 70)
    spot('Ribbon%d' % k, tuple(pos), tgt, GOLD if k % 3 == 0 else MAGENTA, 200000 * BEAM, 2.2)

# truss tower tops
for top in SPEAKER_HANGS:
    for k, dx in enumerate((-1.8, -0.6, 0.6, 1.8)):
        p = top + Vector((dx, -0.6, 0.9))
        spot('TrussHead', tuple(p), (p.x * 2.0 + dx * 12, -60, 0 if k % 2 else 40), GOLD if k % 2 else LILAC, 300000 * BEAM, 2.6)

# light curtains: backlights behind the wings, punching blue up through the haze
for side in (-1, 1):
    for (x, y) in ((44, 26), (60, 18), (74, 10), (30, 30)):
        spot('Curtain', (side * x, y, 0.8), (side * (x + 8), y - 26, 80), BLUE, 500000 * BEAM, 7, blend=0.5, radius=0.6, fixture=False)

# washes that paint the waves (they light surfaces only, not the haze)
for k, (x, tx) in enumerate(((-34, -60), (-18, -30), (-6, -8), (6, 8), (18, 30), (34, 60))):
    spot('Wash%d' % k, (x * 0.4, -80, 16), (tx, 10, 22), BLUE if k % 2 else VIOLET, 220000, 18, blend=0.7, radius=0.5, fixture=False, haze=False)
for top in DELAYS:
    for k in range(3):
        p = top + Vector(((k - 1) * 1.0, 0.6, 0.9))
        spot('DelayWash', tuple(p), (p.x * 0.4 + (k - 1) * 18, -40, 0), MAGENTA if k == 1 else VIOLET, 120000, 22, blend=0.7, haze=False)
for k, x in enumerate(range(-40, 41, 10)):
    spot('CrowdWash', (x, FRONT_Y + 3 if abs(x) < 20 else 0, DECK_H + 0.3), (x * 1.3, -45, 1), LILAC, 60000, 32, blend=0.8, radius=0.4, fixture=False, haze=False)
# the barrel glows from within
point('BarrelGlow', (0, 2, 20), VIOLET, 60000, radius=4)
point('DiscGlow', (0, 12, 13), MAGENTA, 30000, radius=3)
# band key lights
area('BandKey', (0, -16, 12), (0, 5, 3), (0.9, 0.85, 1.0), 70000, 10)
for sx in (-1, 1):
    area('BandRim', (sx * 9, 12, 12), (sx * 3, 3, 3), MAGENTA if sx < 0 else CYAN, 30000, 4)
# a cool moon behind the stage for rims on the trees and clouds
sun = bpy.data.lights.new('Moon', 'SUN')
sun.energy = 0.35
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
hr.inputs['To Min'].default_value = 0.0006
hr.inputs['To Max'].default_value = 0.0022
hn.links.new(hnoise.outputs['Fac'], hr.inputs['Value'])
hn.links.new(hr.outputs[0], hv.inputs['Density'])
hn.links.new(hv.outputs[0], ho.inputs['Volume'])
bm = bmesh.new()
bm_box(bm, (240, 190, 120), Vector((0, -55, 59.9)))
bm_obj('HazeDomain', bm, haze, 'FX')

# ---------------------------------------------------------------- sky: painted dusk, clouds, stars
world = bpy.data.worlds.new('Dusk')
scene.world = world
world.use_nodes = True
wn = world.node_tree
bg = wn.nodes['Background']
coord = wn.nodes.new('ShaderNodeTexCoord')
sep = wn.nodes.new('ShaderNodeSeparateXYZ')
wn.links.new(coord.outputs['Generated'], sep.inputs[0])
dz = sep.outputs['Z']
sky = ramp_node(wn, [(0.0, (0.16, 0.22, 0.72)), (0.12, (0.07, 0.12, 0.5)), (0.4, (0.02, 0.05, 0.25)), (1.0, (0.01, 0.02, 0.1))], dz)
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
cloud_col = ramp_node(wn, [(0.0, (0.04, 0.07, 0.3)), (1.0, (0.12, 0.17, 0.55))], cl.outputs['Fac'])
col = mix_rgba(wn, sky, cloud_col, mnode(wn, 'MULTIPLY', cmask, 0.92))
# stars where the sky is clear
st = wn.nodes.new('ShaderNodeTexVoronoi')
st.inputs['Scale'].default_value = 420
wn.links.new(coord.outputs['Generated'], st.inputs['Vector'])
star = mnode(wn, 'MULTIPLY', mnode(wn, 'MULTIPLY', mnode(wn, 'LESS_THAN', st.outputs['Distance'], 0.05), mnode(wn, 'GREATER_THAN', st.outputs['Color'], 0.55)),
             mnode(wn, 'MULTIPLY', mnode(wn, 'SUBTRACT', 1.0, cmask), mnode(wn, 'MAXIMUM', above, 0.0)))
col = mix_rgba(wn, col, (1.0, 1.0, 1.0, 1), mnode(wn, 'MULTIPLY', star, 0.9))
wn.links.new(col, bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.5


# =================================================================== CAMERAS
VIEWS = {
    # elevated three-quarter view from the side of the field
    'hero': ((-104, -128, 40), (8, 2, 20), 26),
    # straight on from the middle of the crowd: the in-game backdrop framing
    'front': ((-2, -58, 4.2), (0, 6, 22), 17),
    # low and close from the B-stage
    'close': ((-7, -48, 3.8), (2, 6, 19), 17),
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
    scene.view_settings.look = 'AgX - Punchy'
except Exception:
    pass
scene.view_settings.exposure = 0.0
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

print('lights:', LIGHT_COUNT[0], 'crowd:', len(crowd_pts), 'trees:', len(tree_pts))
if args.save:
    bpy.ops.wm.save_as_mainfile(filepath=args.save)
if args.out != 'none':
    bpy.ops.render.render(write_still=True)
    print('rendered', args.out)
