"""
Builds the Moonrise stage (the hero piece of the new festival venue) in Blender and exports it for
the game.

    blender -b --factory-startup -P tools/stage/aurora/build_venue.py -- \
        --out public/stage/aurora [--save local-audio/stage/moonrise.blend] [--preview local-audio/stage/moonrise.png]

The stage: a moon rising out of a breaking tide. A shell of five nested arches (the barrel of the
wave) frames a round screen (the moon); crests curl outward on both wings, a ribbon climbs from the
ground over each wing to a peak above the shell, and low screens run along the wings. Every large
form is a smooth lofted blade, so it carries gradients and glitter instead of bricks and windows.

The real-time look (gradients, glitter, haze, screens, beams) is made in the game's shaders; this
file only makes shape, baked contact shading, material roles and the positions the game needs.

Axes: Z up, metres. The deck centre is at y = 10; the stage extends into +y, the crowd into -y.
"""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', default='')
ap.add_argument('--save', default='')
ap.add_argument('--preview', default='')
ap.add_argument('--view', default='hero')
ap.add_argument('--ao-samples', type=int, default=48)
args = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))

DECK_C = Vector((0, 10, 0))
DECK_A, DECK_B, DECK_H, DECK_P = 24.0, 12.0, 2.4, 2.6
# The screen fills the innermost arch (half width 13.2, height 17.8, see the shell below); the moon
# drawn on it is centred on MOON_C.
SCREEN_W, SCREEN_H, SCREEN_POWER = 13.2 - 0.5, 17.8 - 0.9, 2.25
MOON_C = Vector((0, 23.6, 8.4))
MOON_R = SCREEN_W
# The band plays on an island at the front of the deck: a low platform with the singer front
# centre, guitar and bass either side a step back and turned in, the drums on a riser behind.
ISLAND_C, ISLAND_A, ISLAND_B = Vector((0, 4.6, 0)), 8.2, 5.6
ISLAND_H = DECK_H + 0.25
RISER_C, RISER_R, RISER_H = Vector((0, 7.5, 0)), 3.2, 0.6
BAND = {'lead': (-4.5, 3.4, ISLAND_H), 'vox': (0.0, 1.5, ISLAND_H), 'bass': (4.5, 3.4, ISLAND_H), 'drums': (0.0, 7.5, ISLAND_H + RISER_H)}

# ---------------------------------------------------------------- materials
MATS = {}


def material(name, color, **props):
    """A preview colour plus the properties the game's shaders read (exported as glTF extras)."""
    m = bpy.data.materials.new(name)
    pr = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    pr.inputs['Base Color'].default_value = (*color, 1)
    pr.inputs['Roughness'].default_value = 0.4
    m.diffuse_color = (*color, 1)
    for k, v in props.items():
        m[k] = v
    MATS[name] = m
    return m


# Paint: a three-stop gradient along the form (foot, body, tip), a rim colour, glitter amount and
# how much of the gradient glows by itself.
material('PaintShellA', (0.10, 0.16, 0.62), kind='paint', a='#0b1470', b='#2a55e8', c='#7fd8ff', rim='#9fe8ff', glitter=0.55, glow=0.34, panels=1.0)
material('PaintShellB', (0.26, 0.12, 0.62), kind='paint', a='#1a0b63', b='#6a3df0', c='#c9a2ff', rim='#ffb0f0', glitter=0.75, glow=0.3, panels=1.0)
material('PaintCrest', (0.12, 0.3, 0.75), kind='paint', a='#0a1a6e', b='#2f7af2', c='#b4f4ff', rim='#c8f6ff', glitter=0.9, glow=0.36, veins=1.0)
material('PaintEcho', (0.5, 0.15, 0.62), kind='paint', a='#2a0a66', b='#b032d8', c='#ff9ad6', rim='#ffc2ec', glitter=0.6, glow=0.4, veins=1.0)
material('PaintRibbon', (0.1, 0.5, 0.75), kind='paint', a='#0d2a8a', b='#18b8e8', c='#e6fbff', rim='#ffffff', glitter=0.35, glow=0.5)
material('Deck', (0.03, 0.03, 0.08), kind='deck')
material('Black', (0.01, 0.01, 0.015), kind='black')
material('Grille', (0.05, 0.05, 0.06), kind='grille')
material('Ground', (0.02, 0.02, 0.05), kind='ground')
material('Led', (0.4, 0.8, 1.0), kind='led')
material('Lens', (1.0, 0.8, 0.9), kind='lens')
material('Screen', (0.2, 0.5, 1.0), kind='screen')


# ---------------------------------------------------------------- geometry helpers
def catmull(points, n):
    """n + 1 points along a Catmull-Rom spline through `points`."""
    pts = [Vector(p) for p in points]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    segs = len(pts) - 1
    out = []
    for i in range(n + 1):
        u = i / n * segs
        k = min(int(u), segs - 1)
        t = u - k
        p0, p1, p2, p3 = ext[k], ext[k + 1], ext[k + 2], ext[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return out


def frames(path, depth_axis):
    """Per point: arc-length fraction, tangent, in-plane normal and depth axis."""
    lens = [0.0]
    for a, b in zip(path, path[1:]):
        lens.append(lens[-1] + (b - a).length)
    total = lens[-1] or 1.0
    out = []
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        n = depth_axis.cross(t)
        if n.length < 1e-5:
            n = Vector((1, 0, 0))
        n.normalize()
        b = t.cross(n).normalized()
        out.append((lens[i] / total, p, t, n, b))
    return out


def superpoint(a, power):
    c, s = math.cos(a), math.sin(a)
    e = 2.0 / power
    return (math.copysign(abs(c) ** e, c), math.copysign(abs(s) ** e, s))


def new_obj(name, bm, mat, smooth=True, sharp=None):
    """`sharp`: edges bent by more than this many degrees stay crisp instead of being smoothed over."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if sharp is not None:
        limit = math.radians(sharp)
        bmesh.ops.split_edges(bm, edges=[e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > limit])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS[mat])
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def loft(name, path, width, depth, mat, depth_axis=Y, sides=24, power=2.0, flare=0.0, u_of=None, bm=None):
    """
    Sweeps a rounded section along `path`. `width(t)` is the size across the path in its plane,
    `depth(t)` the size along `depth_axis`; `flare` turns the section about the path (radians).
    UV: u = `u_of(t)` (default t, the fraction along the path), v = around the section.
    """
    own = bm is None
    bm = bm or bmesh.new()
    uv = bm.loops.layers.uv.verify()
    fr = frames(path, depth_axis)
    rings = []
    for (t, p, tan, n, b) in fr:
        w, d = max(0.03, width(t)), max(0.03, depth(t))
        if flare:
            rot = Matrix.Rotation(flare, 3, tan)
            n, b = rot @ n, rot @ b
        ring = []
        for k in range(sides):
            sx, sy = superpoint(2 * math.pi * k / sides, power)
            ring.append(bm.verts.new(p + n * (sx * w / 2) + b * (sy * d / 2)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        u0 = (u_of or (lambda q: q))(fr[i][0])
        u1 = (u_of or (lambda q: q))(fr[i + 1][0])
        for k in range(sides):
            k2 = (k + 1) % sides
            f = bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
            v0, v1 = k / sides, (k + 1) / sides
            for loop, (u, v) in zip(f.loops, ((u0, v0), (u0, v1), (u1, v1), (u1, v0))):
                loop[uv].uv = (u, v)
    for ring, t in ((rings[0], fr[0][0]), (rings[-1], fr[-1][0])):
        f = bm.faces.new(ring)
        for loop in f.loops:
            loop[uv].uv = ((u_of or (lambda q: q))(t), 0.5)
    return new_obj(name, bm, mat) if own else None


def tube(bm, path, radius, sides=6):
    loft('', path, lambda t: radius * 2, lambda t: radius * 2, None, sides=sides, bm=bm)


def cyl(bm, a, b, r, sides=6):
    a, b = Vector(a), Vector(b)
    axis = b - a
    bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=r, radius2=r, depth=axis.length,
                          matrix=Matrix.Translation((a + b) / 2) @ axis.to_track_quat('Z', 'Y').to_matrix().to_4x4())


def box(bm, size, center, rot=None):
    m = Matrix.Translation(center) @ (rot.to_4x4() if rot else Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def mirror_x(pts):
    return [Vector((-p[0], p[1], p[2])) for p in pts]


def deck_outline(scale, z, n=96, front_only=False):
    pts = []
    rng = range(n + 1)
    for i in rng:
        a = (math.pi + math.pi * i / n) if front_only else (2 * math.pi * i / n)
        sx, sy = superpoint(a, DECK_P)
        pts.append(Vector((DECK_C.x + sx * DECK_A * scale, DECK_C.y + sy * DECK_B * scale, z)))
    return pts


def slab(bm, scale, z0, z1, chamfer=0.12):
    """A solid plate with the deck's outline and a chamfered top edge. UV: plan position in metres."""
    uv = bm.loops.layers.uv.verify()
    n = 96
    levels = [(scale, z0), (scale, z1 - chamfer), (scale - chamfer / DECK_B, z1)]
    rings = [[bm.verts.new(p) for p in deck_outline(s, z, n)[:-1]] for s, z in levels]
    faces = []
    for i in range(len(rings) - 1):
        for k in range(n):
            faces.append(bm.faces.new((rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k])))
    faces.append(bm.faces.new(rings[-1]))
    for f in faces:
        for loop in f.loops:
            loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)


FIXTURES = []
# Spots in the audience that must stay free of people: (centre, radius).
CLEAR = []


def stamp(target, build, matrix, bevel=0.0):
    """Builds one part in its own space, softens its edges, and adds it to `target` in place."""
    tmp = bmesh.new()
    build(tmp)
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    if bevel:
        bmesh.ops.bevel(tmp, geom=tmp.edges[:], offset=bevel, segments=1, affect='EDGES', profile=0.5)
    tmp.transform(matrix)
    me = bpy.data.meshes.new('part')
    tmp.to_mesh(me)
    tmp.free()
    target.from_mesh(me)
    bpy.data.meshes.remove(me)


def cube(size):
    return lambda t: bmesh.ops.create_cube(t, size=1.0, matrix=Matrix.Diagonal((*size, 1)))


def cabinet(size, center, rot=None, bevel=0.025):
    """A speaker cabinet with a grille on its front (local -y)."""
    w, d, h = size
    m = Matrix.Translation(center) @ (rot.to_4x4() if rot else Matrix.Identity(4))
    stamp(black, cube(size), m, bevel)
    stamp(grille, cube((w - 0.12, 0.014, h - 0.12)), m @ Matrix.Translation((0, -d / 2 - 0.005, 0)))


def prism(t, profile, width):
    """A solid with the side profile (y, z) carried across x."""
    left = [t.verts.new((-width / 2, y, z)) for y, z in profile]
    right = [t.verts.new((width / 2, y, z)) for y, z in profile]
    t.faces.new(left)
    t.faces.new(right[::-1])
    for i in range(len(profile)):
        j = (i + 1) % len(profile)
        t.faces.new((left[i], left[j], right[j], right[i]))


def wedge(pos, yaw=0.0):
    """A floor monitor: a wedge whose sloped, grilled face looks up at the band (+y)."""
    m = Matrix.Translation(pos) @ Matrix.Rotation(yaw, 4, 'Z')
    stamp(black, lambda t: prism(t, [(-0.30, 0), (0.30, 0), (0.30, 0.10), (-0.05, 0.45), (-0.30, 0.32)], 0.72), m, 0.016)
    stamp(grille, cube((0.62, 0.014, 0.41)), m @ Matrix.Translation((0, 0.131, 0.281)) @ Matrix.Rotation(math.radians(45), 4, 'X'))


def fixture(bm_body, bm_lens, pos, direction, group, mount=(0, 0, -1)):
    """
    A moving head: a barrel with a bezel and a lit lens, held by a yoke on a base. `pos` is the
    lens, `mount` the direction from the head to whatever carries it.
    """
    d = Vector(direction).normalized()
    pos = Vector(pos)
    m = Vector(mount).normalized()
    q = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    cone = lambda r1, r2, depth: (lambda t: bmesh.ops.create_cone(t, cap_ends=True, segments=20, radius1=r1, radius2=r2, depth=depth))
    stamp(bm_body, cone(0.13, 0.2, 0.1), Matrix.Translation(pos - d * 0.49) @ q)
    stamp(bm_body, cone(0.2, 0.2, 0.38), Matrix.Translation(pos - d * 0.25) @ q)
    stamp(bm_body, cone(0.2, 0.245, 0.07), Matrix.Translation(pos - d * 0.03) @ q)
    bmesh.ops.create_circle(bm_lens, cap_ends=True, segments=20, radius=0.205, matrix=Matrix.Translation(pos + d * 0.008) @ q)
    side = m.cross(d)
    if side.length < 1e-3:
        side = m.cross(Vector((1, 0, 0)))
    side.normalize()
    rot = Matrix((side, m.cross(side).normalized(), m)).transposed().to_4x4()
    c = pos - d * 0.25
    for sgn in (-1, 1):
        stamp(bm_body, cube((0.07, 0.2, 0.5)), Matrix.Translation(c + side * (0.3 * sgn) + m * 0.2) @ rot, 0.014)
    stamp(bm_body, cube((0.67, 0.2, 0.07)), Matrix.Translation(c + m * 0.45) @ rot, 0.014)
    stamp(bm_body, cube((0.46, 0.46, 0.15)), Matrix.Translation(c + m * 0.57) @ rot, 0.03)
    FIXTURES.append({'group': group, 'pos': pos.copy(), 'dir': d.copy()})


def truss(bm, stations, s=0.3, closed=False):
    """A box truss through `stations` (centre, across, depth): four chords, braced bay by bay."""
    corners = [[c + n * (s * a) + b * (s * e) for (a, e) in ((-1, -1), (1, -1), (1, 1), (-1, 1))] for (c, n, b) in stations]
    count = len(corners)
    for k in range(count if closed else count - 1):
        a, b = corners[k], corners[(k + 1) % count]
        for i in range(4):
            cyl(bm, a[i], b[i], 0.045, 5)
            j = (i + 1) % 4
            if k % 2:
                cyl(bm, a[i], b[j], 0.028, 4)
            else:
                cyl(bm, a[j], b[i], 0.028, 4)
        if k % 3 == 0:
            for i in range(4):
                cyl(bm, a[i], a[(i + 1) % 4], 0.028, 4)


def dots(bm, points, size=0.16):
    """Small lamps: a string of light points."""
    for q in points:
        box(bm, (size, size, size), q)


# =================================================================== THE STAGE
led = bmesh.new()
black = bmesh.new()
lens = bmesh.new()
grille = bmesh.new()

# ---------------------------------------------------------------- deck: a plate with three lit steps to the crowd
deck = bmesh.new()
for scale, top in ((1.0, DECK_H), (1.09, 1.8), (1.18, 1.2), (1.27, 0.6)):
    slab(deck, scale, 0.0, top)
    tube(led, deck_outline(scale + 0.004, top - 0.14, 128, front_only=True), 0.045)
# the band's island and, on it, the drum riser: two low round platforms with lit edges
def platform(name, centre, rx, ry, z0, z1):
    plate = bmesh.new()
    bmesh.ops.create_cone(plate, cap_ends=True, segments=64, radius1=1.0, radius2=0.985, depth=z1 - z0,
                          matrix=Matrix.Translation((centre.x, centre.y, (z0 + z1) / 2)) @ Matrix.Diagonal((rx, ry, 1, 1)))
    layer = plate.loops.layers.uv.verify()
    for f in plate.faces:
        for loop in f.loops:
            loop[layer].uv = (loop.vert.co.x, loop.vert.co.y)
    new_obj(name, plate, 'Deck')
    tube(led, [Vector((centre.x + math.cos(a) * (rx + 0.02), centre.y + math.sin(a) * (ry + 0.02), z1 - 0.07)) for a in [2 * math.pi * i / 96 for i in range(97)]], 0.035)


platform('Island', ISLAND_C, ISLAND_A, ISLAND_B, DECK_H - 0.02, ISLAND_H)
platform('DrumRiser', RISER_C, RISER_R, RISER_R * 0.72, ISLAND_H - 0.02, ISLAND_H + RISER_H)
new_obj('Deck', deck, 'Deck')

# ---------------------------------------------------------------- the shell: five nested arches leaning to the crowd
ARCHES = []
for i in range(5):
    half_w = 30.0 - 4.2 * i
    height = 31.0 - 3.3 * i
    y = 4.0 + 4.6 * i
    lean = math.radians(15.0 - 3.0 * i)
    tilt = Matrix.Rotation(lean, 4, 'X')  # about the ground line through the feet: the crown comes forward
    path = []
    n = 96
    for k in range(n + 1):
        a = math.pi - math.pi * k / n
        sx, sz = superpoint(a, 2.25)
        p = tilt @ Vector((sx * half_w, 0, max(0.0, sz) * height))
        path.append(Vector((p.x, y - abs(p.y), p.z)) if lean else p + Vector((0, y, 0)))
    crown = lambda t: math.sin(math.pi * t)
    thick = 2.9 - 0.3 * i
    flare = math.radians(-24)  # each ridge opens toward the crowd like a bell
    th_of = lambda t, th=thick: th * (0.5 + 0.5 * crown(t) ** 0.8)
    d_of = lambda t: 6.2 * (0.7 + 0.3 * crown(t))
    loft('Arch%d' % i, path, th_of, d_of, 'PaintShellA' if i % 2 == 0 else 'PaintShellB', sides=28, power=2.3, flare=flare, u_of=crown)
    ARCHES.append((path, half_w, height, y))
    # a line of light along the front lip, and moving heads on the outer two ridges
    lip, heads, rig = [], [], []
    for (t, p, tan, n_, b) in frames(path, Y):
        rot = Matrix.Rotation(flare, 3, tan)
        n2, b2 = rot @ n_, rot @ b
        if b2.y < 0:
            b2 = -b2
        lip.append(p - b2 * (d_of(t) * 0.5 + 0.02))
        heads.append((p - n2 * (th_of(t) * 0.5) - b2 * (d_of(t) * 0.3), -n2))
        rig.append((p - n2 * (th_of(t) * 0.5 + 0.75) - b2 * (d_of(t) * 0.3), -n2, b2))
    tube(led, lip[3:-3], 0.06)
    if i in (0, 2):
        # a truss stands off the ridge on brackets and carries the moving heads
        lo, hi = round(0.11 * n), round(0.89 * n)
        truss(black, rig[lo:hi + 1])
        for k in range(lo, hi + 1, 6):
            c, out, b2 = rig[k]
            cyl(black, c, c - out * 0.8, 0.05, 5)
        count = 15 if i == 0 else 11
        for j in range(count):
            c, out, b2 = rig[round((0.14 + 0.72 * j / (count - 1)) * n)]
            fixture(black, lens, c - b2 * 0.78 + out * 0.1, out * 0.55 - Y * 0.75 + Z * 0.15, 'Shell%d' % i, mount=b2)

# ---------------------------------------------------------------- the moon screen: it fills the innermost arch
# The screen has the arch's own outline, drawn half a metre inside its centre line on a plane that
# runs through the arch's body: its edge is buried in the arch all the way round, with no gap.
moon = bmesh.new()
uvl = moon.loops.layers.uv.verify()
outline = []
for k in range(97):
    sx, sz = superpoint(math.pi - math.pi * k / 96, SCREEN_POWER)
    outline.append(moon.verts.new((sx * SCREEN_W, MOON_C.y, max(0.0, sz) * SCREEN_H)))
face = moon.faces.new(outline)
for loop in face.loops:
    # the picture's own square: the moon drawn on the screen is centred on MOON_C with radius MOON_R
    loop[uvl].uv = ((loop.vert.co.x - MOON_C.x) / (2 * MOON_R) + 0.5, (loop.vert.co.z - MOON_C.z) / (2 * MOON_R) + 0.5)
new_obj('ScreenMoon', moon, 'Screen', smooth=False)

# ---------------------------------------------------------------- the halo: a ring truss flown over the band
# Small and low enough to clear the underside of every ridge above it.
HALO_C, HALO_R = Vector((0, 5.0, 18.2)), 6.5
halo_tilt = Matrix.Rotation(math.radians(-10), 3, 'X')
halo_up = (halo_tilt @ Z).normalized()
halo = []
for k in range(48):
    a = 2 * math.pi * k / 48
    radial = (halo_tilt @ Vector((math.cos(a), math.sin(a), 0))).normalized()
    halo.append((HALO_C + radial * HALO_R, radial, halo_up))
truss(black, halo, closed=True)
# the light ring runs along the middle of the truss's underside, so it lines up with it from any angle
tube(led, [c - up * 0.3 for (c, n_, up) in halo] + [halo[0][0] - halo_up * 0.3], 0.05)
for k in range(0, 48, 4):
    c, radial, up = halo[k]
    # three heads per player, each aimed at its player's chest
    lamp = c - up * 0.95
    player = min(BAND.values(), key=lambda b: (Vector((b[0], b[1], 0)) - Vector((lamp.x, lamp.y, 0))).length)
    fixture(black, lens, lamp, Vector((player[0], player[1], player[2] + 1.2)) - lamp, 'Halo', mount=up)
for k in (6, 18, 30, 42):
    c = halo[k][0]
    cyl(black, c, c + Vector((0, 0, 7.5)), 0.02, 4)


# ---------------------------------------------------------------- crests: waves curling outward on both wings
def crest(name, base, height, mat, turn=0.0, lean=0.0):
    h = height
    local = [(0, 0), (-0.05 * h, 0.4 * h), (0.03 * h, 0.75 * h), (0.24 * h, 0.96 * h), (0.5 * h, 0.99 * h), (0.7 * h, 0.86 * h), (0.8 * h, 0.72 * h)]
    for side in (1, -1):
        m = Matrix.Translation(Vector((base[0] * side, base[1], 0))) @ Matrix.Rotation(turn * side, 4, 'Z') @ Matrix.Rotation(lean, 4, 'X')
        path = catmull([m @ Vector((x * side, 0, z)) for x, z in local], 72)
        axis = (m.to_3x3() @ Y).normalized()
        width = lambda t: 0.44 * h * (1 - t) ** 0.62 + 0.1
        loft('%s_%s' % (name, 'R' if side > 0 else 'L'), path, width, lambda t: 0.05 * h * (1 - t) ** 0.4 + 0.2,
             mat, depth_axis=axis, sides=24, power=2.0)
        fr = frames(path, axis)
        for sgn in (-1, 1):
            dots(led, [q + n_ * (sgn * (width(t) * 0.5 + 0.06)) - axis * 0.05 for (t, q, tan, n_, b) in fr[3:-1:2]])
        FIXTURES.append({'group': 'Sky', 'pos': path[40] - axis * (0.05 * h), 'dir': (Vector((0.25 * side, -0.35, 1))).normalized()})


crest('CrestA', (34.0, 15.0), 36.0, 'PaintCrest', turn=math.radians(-10), lean=math.radians(4))
crest('CrestB', (45.0, 12.5), 27.0, 'PaintCrest', turn=math.radians(-18), lean=math.radians(6))
crest('CrestC', (55.0, 9.0), 19.0, 'PaintCrest', turn=math.radians(-26), lean=math.radians(8))
crest('EchoA', (38.5, 10.0), 20.0, 'PaintEcho', turn=math.radians(-12), lean=math.radians(9))
crest('EchoB', (49.5, 7.5), 14.5, 'PaintEcho', turn=math.radians(-20), lean=math.radians(11))
crest('EchoC', (59.0, 4.0), 10.5, 'PaintEcho', turn=math.radians(-28), lean=math.radians(12))

# ---------------------------------------------------------------- wing screens and the ribbon over them
for side in (1, -1):
    tag = 'R' if side > 0 else 'L'
    base = catmull([(30 * side, 5.0, 0), (38 * side, 4.2, 0), (49 * side, 1.5, 0), (60 * side, -4.0, 0), (68 * side, -11.5, 0)], 48)
    fr = frames(base, Z)
    top = lambda t: 8.6 - 4.6 * t + 0.9 * math.sin(t * math.pi * 2.0)
    wall = bmesh.new()
    uvl = wall.loops.layers.uv.verify()
    rows = 8
    grid = []
    for (t, p, tan, n_, b) in fr:
        face = n_ if n_.y < 0 else -n_
        # the screen ends below the ribbon that rides the wall, so the two never share a surface
        grid.append([wall.verts.new(p + face * 0.35 + Z * (0.9 + (top(t) - 1.8) * r / rows)) for r in range(rows + 1)])
    for i in range(len(grid) - 1):
        for r in range(rows):
            f = wall.faces.new((grid[i][r], grid[i + 1][r], grid[i + 1][r + 1], grid[i][r + 1]))
            for loop, (ii, rr) in zip(f.loops, ((i, r), (i + 1, r), (i + 1, r + 1), (i, r + 1))):
                loop[uvl].uv = (fr[ii][0] if side > 0 else 1 - fr[ii][0], rr / rows)
    new_obj('ScreenWing' + tag, wall, 'Screen')
    # the wall body behind the screen
    loft('', [p + Z * (0.45 + top(t) / 2) for (t, p, tan, n_, b) in fr], lambda t: 0.36, lambda t: top(t) - 0.2, None, depth_axis=Z, sides=8, power=6, bm=black)
    # ribbon: from the ground far out, along the wall top, over the shell's shoulder to a peak
    crest_line = [p + Z * (top(t) + 0.9) for (t, p, tan, n_, b) in fr][::-1]
    # It leaves the wall before the shell and climbs outside and in front of the outer ridge and its
    # truss, then over the crown: it never passes between two ridges.
    ribbon = [Vector((77 * side, -19, 0.2)), Vector((73 * side, -15.5, 2.4))] + crest_line[:33:8] + [
        Vector((39 * side, 1.5, 12)), Vector((35.5 * side, -1.5, 16)), Vector((31.5 * side, -4.5, 21.5)), Vector((25.5 * side, -7, 28)),
        Vector((16.5 * side, -8.8, 35.5)), Vector((7 * side, -9.8, 41)), Vector((0.6 * side, -10.2, 44.5))]
    path = catmull(ribbon, 140)
    loft('Ribbon' + tag, path, lambda t: 0.4 + 3.6 * math.sin(math.pi * min(1.0, t * 1.03)) ** 0.5 * (1 - 0.35 * t), lambda t: 0.8 - 0.3 * t,
         'PaintRibbon', sides=16, power=2.0)
    tube(led, [p + Vector((0, -0.5, 0)) for p in path[10:-2]], 0.05)
    for k in (60, 84, 104, 120):
        FIXTURES.append({'group': 'Ribbon', 'pos': path[k] + Vector((0, -0.7, 0)), 'dir': Vector((0.3 * side * (1 if k < 100 else -0.4), -0.7, 0.55)).normalized()})
    tube(led, [p + (n_ if n_.y < 0 else -n_) * 0.4 + Z * 0.85 for (t, p, tan, n_, b) in fr], 0.05)

# ---------------------------------------------------------------- towers with line arrays, outside the shell and clear of the ribbon
for side in (1, -1):
    x, y, h, s = 40.0 * side, -4.0, 23.0, 0.6
    CLEAR.append((Vector((x, y, 0)), 2.4))
    for dx in (-s, s):
        for dy in (-s, s):
            cyl(black, (x + dx, y + dy, 0), (x + dx, y + dy, h), 0.07)
    bays = int(h / 1.2)
    for k in range(bays):
        z0, z1 = k * h / bays, (k + 1) * h / bays
        flip = 1 if k % 2 else -1
        cyl(black, (x - s * flip, y - s, z0), (x + s * flip, y - s, z1), 0.04, 5)
        cyl(black, (x - s * flip, y + s, z0), (x + s * flip, y + s, z1), 0.04, 5)
        cyl(black, (x - s, y - s * flip, z0), (x - s, y + s * flip, z1), 0.04, 5)
        cyl(black, (x + s, y - s * flip, z0), (x + s, y + s * flip, z1), 0.04, 5)
    # the arm and the array hanging from it
    ax = x - 2.6 * side
    box(black, (3.6, 0.9, 0.5), Vector((x - 1.3 * side, y - 0.2, h - 0.4)))
    pos = Vector((ax, y - 0.5, h - 1.0))
    ang = 0.0
    for k in range(13):
        ang += math.radians(0.6 + 0.42 * k)
        rot = Matrix.Rotation(-ang, 3, 'X')
        pos = pos + rot @ Vector((0, 0, -0.5))
        cabinet((1.5, 0.95, 0.46), pos + rot @ Vector((0, 0.1, 0)), rot, bevel=0.03)
    for dz in (0.5, 1.3):
        fixture(black, lens, (x, y - s - 0.3, h + dz - 0.4), (-0.35 * side, -0.8, -0.25), 'Truss')

# uplights along the front of the deck, and the crowd barrier
for j in range(11):
    a = math.pi * (1.14 + 0.72 * j / 10)
    sx, sy = superpoint(a, DECK_P)
    p = Vector((DECK_C.x + sx * DECK_A * 0.97, DECK_C.y + sy * DECK_B * 0.97, DECK_H + 0.3))
    fixture(black, lens, p, (sx * 0.5, -0.45, 1.0), 'Floor')
barrier = deck_outline(1.44, 0.6, 96, front_only=True)
loft('', barrier, lambda t: 0.12, lambda t: 1.2, None, depth_axis=Z, sides=6, power=6, bm=black)

# ---------------------------------------------------------------- backline and what stands around the deck
def mic_stand(pos, lean):
    """A boom stand: tripod, pole, a short boom toward the player and the microphone on it."""
    top = pos + Vector((0, 0, 1.42))
    for a in (0.4, 2.5, 4.6):
        cyl(black, pos + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.02)), pos + Vector((0, 0, 0.3)), 0.012, 5)
    cyl(black, pos + Vector((0, 0, 0.02)), top, 0.013, 6)
    tip = top + Vector((lean[0], lean[1], 0.12))
    cyl(black, top - Vector((lean[0], lean[1], 0.12)) * 0.3, tip, 0.01, 5)
    cyl(black, tip, tip + Vector((lean[0], lean[1], 0)).normalized() * 0.17, 0.024, 8)


# a monitor in front of every player who stands, turned to face them
for part in ('lead', 'vox', 'bass'):
    x, y, z = BAND[part]
    wedge(Vector((x * 1.06, y - 1.85, z)), math.radians(-x * 3.0))
# guitar and bass: an amp stack behind, a pedalboard at the feet, a stand for backing vocals
for part in ('lead', 'bass'):
    x, y, z = BAND[part]
    side = 1 if x > 0 else -1
    for col in range(2):
        for row in range(2):
            c = Vector((x + side * (0.5 + col * 1.3), y + 2.5, z + 0.53 + row * 1.06))
            cabinet((1.25, 0.6, 1.02), c)
            dots(led, [c + Vector((-0.4, -0.31, 0.38))], 0.05)
    stamp(black, cube((0.7, 0.32, 0.05)), Matrix.Translation((x - side * 0.15, y - 0.75, z + 0.03)), 0.01)
    dots(led, [Vector((x - side * 0.15 + dx, y - 0.75, z + 0.07)) for dx in (-0.24, -0.08, 0.08, 0.24)], 0.035)
    mic_stand(Vector((x - side * 0.75, y - 0.55, z)), (side * 0.22, 0.2))
for side in (1, -1):
    # side fills turned toward the band
    turn = Matrix.Rotation(math.radians(-70 * side), 3, 'Z')
    for row in range(2):
        cabinet((1.5, 1.0, 1.15), Vector((side * 19.5, 6.5, DECK_H + 0.6 + row * 1.2)), turn)
# subs in the pit, along the barrier
for j in range(15):
    a = math.pi * (1.17 + 0.66 * j / 14)
    sx, sy = superpoint(a, DECK_P)
    c = Vector((DECK_C.x + sx * DECK_A * 1.355, DECK_C.y + sy * DECK_B * 1.355, 0.36))
    cabinet((1.4, 0.95, 0.72), c, Matrix.Rotation(math.atan2(sx * DECK_A, -sy * DECK_B), 3, 'Z'))
# a camera jib in the pit
jib = Vector((DECK_C.x + 0.62 * DECK_A * 1.36, DECK_C.y - 0.72 * DECK_B * 1.36, 0))
for leg in ((0.5, 0.3), (-0.5, 0.3), (0, -0.55)):
    cyl(black, jib + Vector((leg[0], leg[1], 0)), jib + Vector((0, 0, 1.7)), 0.035, 5)
arm_a, arm_b = jib + Vector((1.4, 1.0, 1.25)), jib + Vector((-5.5, -3.6, 5.6))
cyl(black, arm_a, arm_b, 0.07, 6)
cyl(black, jib + Vector((0, 0, 1.7)), arm_a.lerp(arm_b, 0.2), 0.05, 5)
box(black, (0.5, 0.5, 0.5), arm_a)
box(black, (0.4, 0.6, 0.32), arm_b + Vector((0, 0.1, -0.3)))
dots(led, [arm_b + Vector((0, 0.42, -0.2))], 0.05)

# ---------------------------------------------------------------- the mix position and two delay towers in the crowd
FOH = Vector((0, -84, 0))
for sx in (-1, 1):
    for sy in (-1, 1):
        base = FOH + Vector((sx * 4.2, sy * 3.0, 0))
        truss(black, [(base + Vector((0, 0, z)), Vector((1, 0, 0)), Vector((0, 1, 0))) for z in (0, 1.2, 2.4, 3.6, 4.8, 6.0)], s=0.18)
box(black, (9.0, 6.6, 0.22), FOH + Vector((0, 0, 2.5)))
box(black, (9.6, 7.2, 0.2), FOH + Vector((0, 0, 6.1)), Matrix.Rotation(math.radians(-5), 3, 'X'))
box(black, (6.0, 1.1, 0.9), FOH + Vector((0, 1.6, 3.1)))
loft('', [FOH + Vector((x, y, 3.2)) for (x, y) in ((-4.5, 3.3), (4.5, 3.3), (4.5, -3.3), (-4.5, -3.3), (-4.5, 3.3))], lambda t: 0.06, lambda t: 1.1, None, depth_axis=Z, sides=4, power=6, bm=black)
dots(led, [FOH + Vector((x, 1.02, 3.72)) for x in (-2.4, -1.2, 0, 1.2, 2.4)], 0.09)
tube(led, [FOH + Vector((-4.7, 3.55, 6.0)), FOH + Vector((4.7, 3.55, 6.0))], 0.04)
for sx in (-1, 1):
    fixture(black, lens, FOH + Vector((sx * 3.4, 3.2, 6.7)), (-sx * 0.04, 1, 0.16), 'Foh', mount=(0, 0, -1))
CLEAR.append((FOH, 7.5))
for side in (1, -1):
    base = Vector((52 * side, -40, 0))
    truss(black, [(base + Vector((0, 0, z)), Vector((1, 0, 0)), Vector((0, 1, 0))) for z in [k * 1.2 for k in range(13)]], s=0.3)
    box(black, (2.2, 0.8, 0.4), base + Vector((0, -0.9, 14.2)))
    pos, ang = base + Vector((0, -1.5, 13.9)), 0.0
    for k in range(7):
        ang += math.radians(1.5 + 0.9 * k)
        rot = Matrix.Rotation(-ang, 3, 'X')
        pos = pos + rot @ Vector((0, 0, -0.48))
        cabinet((1.3, 0.8, 0.44), pos, rot)
    fixture(black, lens, base + Vector((0, 0.6, 15.0)), (-0.3 * side, 0.55, 0.78), 'Delay', mount=(0, 0, -1))
    dots(led, [base + Vector((0.34, -0.34, z)) for z in (3, 6, 9, 12)], 0.07)
    CLEAR.append((base, 2.6))

# ---------------------------------------------------------------- spray: small crests where the big forms meet the ground
SPRAY = [((31.5, 1.0), 6.5, 'PaintEcho', -4, 10), ((34.5, -1.5), 4.2, 'PaintCrest', -10, 14), ((30.2, -2.6), 3.0, 'PaintEcho', 6, 12),
         ((70.5, -15.0), 7.5, 'PaintCrest', -30, 10), ((74.5, -19.5), 5.0, 'PaintEcho', -36, 14), ((67.0, -17.5), 3.6, 'PaintCrest', -22, 12),
         ((64.0, 12.0), 9.0, 'PaintEcho', -34, 6)]
for index, (base, height, paint, turn, lean) in enumerate(SPRAY):
    crest('Spray%d' % index, base, height, paint, turn=math.radians(turn), lean=math.radians(lean))

new_obj('Leds', led, 'Led')
new_obj('Rigging', black, 'Black', sharp=35)
new_obj('Grilles', grille, 'Grille', smooth=False)
new_obj('Lenses', lens, 'Lens', smooth=False)

# ---------------------------------------------------------------- ground
ground = bmesh.new()
bmesh.ops.create_circle(ground, cap_ends=True, segments=64, radius=520, matrix=Matrix.Translation((0, -40, -0.02)))
uvl = ground.loops.layers.uv.verify()
for f in ground.faces:
    for loop in f.loops:
        loop[uvl].uv = (loop.vert.co.x, loop.vert.co.y)
new_obj('Ground', ground, 'Ground', smooth=False)

# =================================================================== CAMERAS AND MARKS
VIEWS = {
    'hero': ((84, -104, 27), (-8, 10, 17), 58.0),
    'front': ((0, -66, 4.6), (0, 14, 18), 80.0),
    'crowd': ((9, -44, 3.1), (0, 10, 15), 72.0),
    'close': ((-9, -19, 5.2), (0, 8, 9), 76.0),
    'aerial': ((44, -118, 62), (0, 6, 8), 56.0),
}
# Extra viewpoints for the clay preview only (not sent to the game).
CHECKS = {'check-band': ((5.5, -9, 6.5), (0, 4, 3.2), 62.0), 'check-gear': ((3.5, -5.5, 4.2), (1.5, 0, 2.7), 60.0), 'check-heads': ((6, -9, 4), (4, -2, 3.2), 50.0), 'check-side': ((46, -30, 14), (22, 2, 14), 60.0), 'check-stage': ((0, -14, 5), (0, 14, 13), 86.0), 'check-wing': ((44, -22, 6), (48, 2, 5), 60.0)}
# Pyro: fans of sparks from behind the skyline (origin, rays, spread and lean in degrees, ray length)
# and CO2 jets along the front of the deck.
FIREWORKS = [
    {'origin': (0, 30, 47), 'n': 18, 'spread': 62, 'length': [26, 38], 'lean': 0},
    {'origin': (-31, 26, 38), 'n': 14, 'spread': 50, 'length': [20, 30], 'lean': -14},
    {'origin': (31, 26, 38), 'n': 14, 'spread': 50, 'length': [20, 30], 'lean': 14},
    {'origin': (-47, 22, 29), 'n': 12, 'spread': 46, 'length': [17, 26], 'lean': -22},
    {'origin': (47, 22, 29), 'n': 12, 'spread': 46, 'length': [17, 26], 'lean': 22},
    {'origin': (-61, 16, 21), 'n': 10, 'spread': 42, 'length': [14, 22], 'lean': -28},
    {'origin': (61, 16, 21), 'n': 10, 'spread': 42, 'length': [14, 22], 'lean': 28},
]
CO2 = []
for j in range(8):
    a = math.pi * (1.16 + 0.68 * j / 7)
    sx, sy = superpoint(a, DECK_P)
    CO2.append(Vector((DECK_C.x + sx * DECK_A * 1.04, DECK_C.y + sy * DECK_B * 1.04, 1.9)))



def to_three(v):
    """Blender (Z up) to three.js (Y up)."""
    return [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]


# =================================================================== PREVIEW
def preview(path):
    loc, tgt, hfov = {**VIEWS, **CHECKS}[args.view]
    cam_data = bpy.data.cameras.new('Preview')
    cam_data.sensor_width = 36
    cam_data.lens = 18 / math.tan(math.radians(hfov) / 2)
    cam_data.clip_end = 2000
    cam = bpy.data.objects.new('Preview', cam_data)
    scene.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    scene.display.shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


if args.preview:
    preview(args.preview)


# =================================================================== EXPORT
def bake_contact_shading(objs, samples):
    """Ambient occlusion from the whole scene into vertex colours (the forms are dense enough)."""
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.device = 'CPU'
    world = bpy.data.worlds.new('World')
    scene.world = world
    world.light_settings.distance = 14.0
    for o in objs:
        me = o.data
        attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def export(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    painted = [o for o in scene.objects if o.type == 'MESH' and o.data.materials[0].name.startswith('Paint')]
    bake_contact_shading(painted, args.ao_samples)
    groups = {}
    for o in painted:
        groups.setdefault(o.data.materials[0].name, []).append(o)
    for mname, objs in groups.items():
        join(objs, mname)
    data = {
        'version': 1,
        'cameras': {k: {'pos': to_three(loc), 'target': to_three(tgt), 'hfov': hfov} for k, (loc, tgt, hfov) in VIEWS.items()},
        'band': {k: to_three(v) for k, v in BAND.items()},
        'island': {'center': to_three(Vector((ISLAND_C.x, ISLAND_C.y, ISLAND_H))), 'a': ISLAND_A, 'b': ISLAND_B},
        'fixtures': [{'group': f['group'], 'pos': to_three(f['pos']), 'dir': to_three(f['dir'])} for f in FIXTURES],
        'moon': {'center': to_three(MOON_C), 'radius': MOON_R, 'arch': {'halfWidth': SCREEN_W, 'height': SCREEN_H, 'power': SCREEN_POWER}},
        'fireworks': [{**f, 'origin': to_three(f['origin'])} for f in FIREWORKS],
        'co2': [to_three(c) for c in CO2],
        'clear': [{'pos': to_three(c), 'radius': r} for c, r in CLEAR],
        'deck': {'center': to_three(DECK_C), 'a': DECK_A, 'b': DECK_B, 'power': DECK_P, 'height': DECK_H, 'barrier': 1.44},
    }
    glb = os.path.join(out_dir, 'venue.glb')
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=True, export_yup=True, export_lights=False, export_cameras=False,
                              export_texcoords=True, export_normals=True, export_extras=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_active_vertex_color_when_no_material=True, export_animations=False,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    with open(os.path.join(out_dir, 'venue.json'), 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    meshes = [o for o in scene.objects if o.type == 'MESH']
    print('exported', glb, 'objects', len(meshes), 'tris', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes), 'fixtures', len(FIXTURES))


if args.save:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save))
if args.out:
    export(args.out)
