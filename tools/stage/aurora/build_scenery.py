"""
Builds the scenery around the Moonrise stage: the land, the lake and the festival grounds.

    blender -b --factory-startup -P tools/stage/aurora/build_scenery.py -- --out public/stage/aurora

The stage stands on a point of land in a lake. This file makes the ground (a gentle amphitheatre in
front, banks falling into the water behind the stage and in a cove beside each wing), the lake, a
jetty with lanterns in each cove, and,
behind the audience, the grounds: a big wheel, a row of stalls under strings of lamps, an entrance
arch, flags, floodlight towers, a campsite of small lights and trees framing it all. Like the
stage, everything is generated, original, and carries only shape and material roles; the look is
made in the game's shaders. The far hills, the moon and the aurora are drawn in the sky itself.

Output: scenery.glb and scenery.json (the land's shape for standing people on it, the wheel's
axle, any far lights the water should mirror, where the moon hangs).

Axes: Z up, metres; the stage is around y = 10, the audience toward -y.
"""
import argparse
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terrain  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', default='')
ap.add_argument('--save', default='')
ap.add_argument('--preview', default='')
args = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
random.seed(23)
Z = Vector((0, 0, 1))
H = terrain.height

# ---------------------------------------------------------------- materials (roles for the game's shaders)
MATS = {}


def material(name, color, **props):
    m = bpy.data.materials.new(name)
    pr = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    pr.inputs['Base Color'].default_value = (*color, 1)
    m.diffuse_color = (*color, 1)
    for k, v in props.items():
        m[k] = v
    MATS[name] = m
    return m


material('Ground', (0.02, 0.03, 0.04), kind='ground')
material('Water', (0.01, 0.03, 0.08), kind='water')
material('Black', (0.01, 0.01, 0.015), kind='black')
material('Foliage', (0.01, 0.03, 0.03), kind='foliage')
material('Lens', (1.0, 0.9, 0.8), kind='lens')
# Steady lamps (they do not follow the music): colour, and how much they twinkle.
material('LampWarm', (1.0, 0.7, 0.4), kind='lamp', tint='#ffb066', twinkle=0.25)
material('LampCool', (0.6, 0.8, 1.0), kind='lamp', tint='#9ad0ff', twinkle=0.25)
material('LampPink', (1.0, 0.4, 0.7), kind='lamp', tint='#ff6ab4', twinkle=0.1)
material('LampCyan', (0.3, 0.9, 1.0), kind='lamp', tint='#55e4ff', twinkle=0.1)
# Cloth lit from inside: stalls, tents, flags, the wheel's cabins.
CANVAS = ['#ff4d8f', '#35d6ff', '#ffd23d', '#9a5cff', '#ff8a2a', '#f4f0ff']
for i, c in enumerate(CANVAS):
    material('Canvas%d' % i, (0.6, 0.4, 0.5), kind='canvas', tint=c)


# ---------------------------------------------------------------- helpers
def new_obj(name, bm, mat, smooth=True, sharp=None):
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


def cyl(bm, a, b, r, sides=6, r2=None):
    a, b = Vector(a), Vector(b)
    axis = b - a
    bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=r, radius2=r if r2 is None else r2, depth=axis.length,
                          matrix=Matrix.Translation((a + b) / 2) @ axis.to_track_quat('Z', 'Y').to_matrix().to_4x4())


def box(bm, size, center, rot=None):
    m = Matrix.Translation(center) @ (rot.to_4x4() if rot else Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def dot(bm, p, size):
    box(bm, (size, size, size), Vector(p))


def on_ground(x, y, z=0.0):
    return Vector((x, y, H(x, y) + z))


def strung(bm, a, b, sag, step, size):
    """Lamps on a line hung between two points."""
    a, b = Vector(a), Vector(b)
    n = max(2, int((b - a).length / step))
    for i in range(n + 1):
        t = i / n
        dot(bm, a.lerp(b, t) - Z * (sag * 4 * t * (1 - t)), size)


black = bmesh.new()
lens = bmesh.new()
lamps = {k: bmesh.new() for k in ('LampWarm', 'LampCool', 'LampPink', 'LampCyan')}
canvas = [bmesh.new() for _ in CANVAS]

# =================================================================== THE LAND AND THE LAKE
land = bmesh.new()
# A grid that is fine near the stage and coarse far away.
xs = sorted({round(s * (abs(k) ** 1.6) * 0.34, 2) for k in range(0, 61) for s in (-1, 1)}
            # finer still where the coves' shores run, so the waterline is a smooth curve
            | {round(s * (58 + 2.0 * i), 2) for i in range(48) for s in (-1, 1)})
ys = sorted({round(10 + s * (abs(k) ** 1.6) * 0.34, 2) for k in range(0, 61) for s in (-1, 1) if -470 < 10 + s * (abs(k) ** 1.6) * 0.34 < 70}
            | {round(-114 + 2.5 * i, 2) for i in range(66)})
verts = [[land.verts.new((x, y, H(x, y) - 0.02)) for x in xs] for y in ys]
for j in range(len(ys) - 1):
    for i in range(len(xs) - 1):
        land.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
new_obj('Terrain', land, 'Ground')

water = bmesh.new()
level = terrain.PARAMS['water']
quad = [water.verts.new(p) for p in ((-2600, -112, level), (2600, -112, level), (2600, 2600, level), (-2600, 2600, level))]
water.faces.new(quad)
lake = new_obj('Water', water, 'Water', smooth=False)
# one face by itself has no outside to tell which way it should look: make sure it looks up
if lake.data.polygons[0].normal.z < 0:
    lake.data.flip_normals()

# The far shore is dark: nothing over there but hills against the sky. (The game can still be
# handed lights for the water to mirror; there are none.)
SHORE = []

# A jetty runs out into each cove beside the stage, lanterns on its posts, and a few lanterns float
# on the water round it.
for side in (1, -1):
    jy, x0, x1, top = -4.0, 76.0, 104.0, level + 0.95
    box(black, (x1 - x0, 2.2, 0.16), Vector(((x0 + x1) / 2 * side, jy, top)))
    box(black, (5.0, 6.0, 0.16), Vector(((x1 + 1.5) * side, jy, top)))
    for i in range(8):
        x = (x0 + 2.0 + i * 3.6) * side
        for dy in (-1.0, 1.0):
            cyl(black, (x, jy + dy, level - 1.6), (x, jy + dy, top + 0.12), 0.09, 6)
    for x in (84.0, 94.0, 104.0):
        cyl(black, (x * side, jy + 1.0, top), (x * side, jy + 1.0, top + 2.3), 0.05, 5)
        dot(lamps['LampWarm'], (x * side, jy + 1.0, top + 2.45), 0.32)
    for (x, y), kind in zip(((90, -24), (99, 9), (110, -17), (93, 20), (116, 2)), ('LampWarm', 'LampPink', 'LampWarm', 'LampCool', 'LampWarm')):
        dot(lamps[kind], (x * side, y, level + 0.16), 0.4)

# =================================================================== THE GROUNDS BEHIND THE AUDIENCE
# ---------------------------------------------------------------- the big wheel
WHEEL_C = on_ground(-78, -178, 29.0)
WHEEL_R = 25.0
wheel_frame = bmesh.new()
wheel_lamps = bmesh.new()
wheel_cabins = [bmesh.new() for _ in CANVAS]
for side in (-1.6, 1.6):
    ring = [WHEEL_C + Vector((math.cos(a) * WHEEL_R, side, math.sin(a) * WHEEL_R)) for a in [2 * math.pi * k / 64 for k in range(65)]]
    for a, b in zip(ring, ring[1:]):
        cyl(wheel_frame, a, b, 0.14, 5)
    inner = [WHEEL_C + Vector((math.cos(a) * WHEEL_R * 0.55, side, math.sin(a) * WHEEL_R * 0.55)) for a in [2 * math.pi * k / 32 for k in range(33)]]
    for a, b in zip(inner, inner[1:]):
        cyl(wheel_frame, a, b, 0.09, 4)
    for k in range(16):
        a = 2 * math.pi * k / 16
        rim = WHEEL_C + Vector((math.cos(a) * WHEEL_R, side, math.sin(a) * WHEEL_R))
        cyl(wheel_frame, WHEEL_C + Vector((0, side, 0)), rim, 0.08, 4)
for k in range(16):
    a = 2 * math.pi * k / 16
    rim = WHEEL_C + Vector((math.cos(a) * WHEEL_R, 0, math.sin(a) * WHEEL_R))
    cyl(wheel_frame, rim + Vector((0, -1.6, 0)), rim + Vector((0, 1.6, 0)), 0.08, 4)
    # round cabins, so it does not show that they turn with the wheel
    bmesh.ops.create_uvsphere(wheel_cabins[k % len(CANVAS)], u_segments=10, v_segments=6, radius=1.25,
                              matrix=Matrix.Translation(rim + Vector((math.cos(a) * 1.5, 0, math.sin(a) * 1.5))) @ Matrix.Diagonal((1, 1.1, 0.9, 1)))
    # lamps along every spoke and round the rim, on the face the audience sees
    for t in range(3, 25):
        dot(wheel_lamps, WHEEL_C + Vector((math.cos(a) * t, 1.85, math.sin(a) * t)), 0.2)
for k in range(128):
    a = 2 * math.pi * k / 128
    dot(wheel_lamps, WHEEL_C + Vector((math.cos(a) * (WHEEL_R + 0.3), 1.85, math.sin(a) * (WHEEL_R + 0.3))), 0.24)
cyl(wheel_frame, WHEEL_C + Vector((0, -2.6, 0)), WHEEL_C + Vector((0, 2.6, 0)), 0.9, 12)
for o, m in ((wheel_frame, 'Black'), (wheel_lamps, 'LampPink')):
    new_obj('Wheel_' + m, o, m, smooth=False)
for i, o in enumerate(wheel_cabins):
    new_obj('Wheel_Canvas%d' % i, o, 'Canvas%d' % i)
# the legs stand still
foot = H(WHEEL_C.x, WHEEL_C.y)
for side in (-2.6, 2.6):
    for dx in (-13, 13):
        cyl(black, WHEEL_C + Vector((0, side, 0)), Vector((WHEEL_C.x + dx, WHEEL_C.y + side * 1.6, foot)), 0.3, 6)
    cyl(black, Vector((WHEEL_C.x - 13, WHEEL_C.y + side * 1.6, foot + 0.3)), Vector((WHEEL_C.x + 13, WHEEL_C.y + side * 1.6, foot + 0.3)), 0.2, 5)


# ---------------------------------------------------------------- the midway: stalls under strings of lamps
def stall(x, y, i):
    g = on_ground(x, y)
    w, d, h = 5.2, 4.0, 2.9
    cloth = canvas[i % len(CANVAS)]
    box(black, (w, d, 0.9), g + Vector((0, 0, 0.45)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(black, g + Vector((sx * w / 2, sy * d / 2, 0)), g + Vector((sx * w / 2, sy * d / 2, h)), 0.07, 5)
    # a pitched roof and a glowing back wall
    top = g + Vector((0, 0, h))
    a, b, c, e = (top + Vector((sx * (w / 2 + 0.3), sy * (d / 2 + 0.3), 0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)))
    r1, r2 = top + Vector((-w / 2 - 0.3, 0, 1.3)), top + Vector((w / 2 + 0.3, 0, 1.3))
    vs = [cloth.verts.new(p) for p in (a, b, c, e, r1, r2)]
    for f in ((0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5)):
        cloth.faces.new([vs[k] for k in f])
    box(canvas[(i + 3) % len(CANVAS)], (w - 0.3, 0.08, h - 1.0), g + Vector((0, -d / 2 + 0.1, 0.95 + (h - 1.0) / 2)))
    strung(lamps['LampWarm'], top + Vector((-w / 2, d / 2 + 0.25, 0)), top + Vector((w / 2, d / 2 + 0.25, 0)), 0.2, 0.55, 0.11)


MIDWAY_Y = -152
STALLS = [x for x in range(-34, 118, 9)]
for i, x in enumerate(STALLS):
    stall(x, MIDWAY_Y, i)
# poles along the path in front of the stalls, lamps strung between them and across the path
poles = []
for x in range(-40, 124, 12):
    for y in (MIDWAY_Y + 5, MIDWAY_Y + 14):
        g = on_ground(x, y)
        cyl(black, g, g + Z * 6.2, 0.07, 5)
        poles.append(g + Z * 6.1)
for a, b in zip(poles, poles[2:]):
    strung(lamps['LampWarm'], a, b, 0.7, 0.6, 0.12)
for a, b in zip(poles[::2], poles[1::2]):
    strung(lamps['LampCool'], a, b, 0.6, 0.6, 0.12)

# ---------------------------------------------------------------- the entrance arch
gate = on_ground(26, -206)
for k in range(48):
    a0, a1 = math.pi * k / 48, math.pi * (k + 1) / 48
    for radius, bm_ in ((13.0, canvas[1]), (10.6, canvas[3]), (8.4, canvas[0])):
        cyl(bm_, gate + Vector((math.cos(a0) * radius, 0, math.sin(a0) * radius)), gate + Vector((math.cos(a1) * radius, 0, math.sin(a1) * radius)), 0.55, 8)
for k in range(60):
    a = math.pi * k / 59
    dot(lamps['LampCyan'], gate + Vector((math.cos(a) * 14.0, 0.5, math.sin(a) * 14.0)), 0.22)

# ---------------------------------------------------------------- flags
for i, (x, y) in enumerate([(-112, -92), (-96, -128), (-56, -148), (132, -108), (118, -138), (-128, -60), (148, -76), (-18, -196), (70, -198), (-140, -160), (156, -150), (8, -168)]):
    g = on_ground(x, y)
    hgt = 9.5 + (i % 3) * 1.4
    cyl(black, g, g + Z * hgt, 0.06, 5)
    cloth = canvas[i % len(CANVAS)]
    rows = []
    for c in range(7):
        u = c / 6
        wave = math.sin(u * 5 + i) * 0.35 * u
        rows.append((cloth.verts.new(g + Vector((u * 3.4, wave, hgt - 0.1 - u * 0.3))), cloth.verts.new(g + Vector((u * 3.4, wave, hgt - 2.0 + u * 0.5)))))
    for (a, b), (c, d) in zip(rows, rows[1:]):
        cloth.faces.new((a, c, d, b))

# ---------------------------------------------------------------- floodlight towers round the field
for x, y in ((-104, -72), (104, -72), (-128, -150), (136, -150)):
    g = on_ground(x, y)
    for dx in (-0.5, 0.5):
        for dy in (-0.5, 0.5):
            cyl(black, g + Vector((dx, dy, 0)), g + Vector((dx, dy, 17)), 0.06, 5)
    for k in range(14):
        z0, z1 = k * 17 / 14, (k + 1) * 17 / 14
        s = 0.5 if k % 2 else -0.5
        cyl(black, g + Vector((-s, -0.5, z0)), g + Vector((s, -0.5, z1)), 0.035, 4)
        cyl(black, g + Vector((-0.5, -s, z0)), g + Vector((-0.5, s, z1)), 0.035, 4)
    box(black, (3.4, 0.5, 1.6), g + Vector((0, 0, 17.6)))
    toward = (Vector((0, -40, 0)) - Vector((x, y, 0))).normalized()
    side = toward.cross(Z)
    for c in range(4):
        for r in range(2):
            p = g + side * ((c - 1.5) * 0.8) + Z * (17.25 + r * 0.7) + toward * 0.3
            bmesh.ops.create_circle(lens, cap_ends=True, segments=10, radius=0.28, matrix=Matrix.Translation(p) @ toward.to_track_quat('Z', 'Y').to_matrix().to_4x4())

# ---------------------------------------------------------------- the campsite: small lights up the slope
for i in range(420):
    x = random.uniform(-260, 280)
    y = random.uniform(-430, -228)
    if abs(x - 26) < 14 and y > -250:
        continue
    kind = random.choice(('LampWarm', 'LampWarm', 'LampCool', 'LampPink', 'LampCyan'))
    dot(lamps[kind], on_ground(x, y, random.uniform(0.5, 1.6)), random.uniform(0.25, 0.5))

# ---------------------------------------------------------------- trees framing the field and the shore
trees = bmesh.new()


def tree(x, y, hgt):
    g = on_ground(x, y)
    cyl(trees, g, g + Z * hgt * 0.3, hgt * 0.035, 5)
    for k in range(3):
        z0 = hgt * (0.2 + 0.24 * k)
        cyl(trees, g + Z * z0, g + Z * (z0 + hgt * 0.42), hgt * (0.26 - 0.06 * k), 7, r2=0.02)


def clump(cx, cy, count, spread, tall):
    for _ in range(count):
        a = random.uniform(0, 2 * math.pi)
        d = spread * math.sqrt(random.random())
        x, y = cx + math.cos(a) * d, cy + math.sin(a) * d * 0.7
        if H(x, y) > terrain.PARAMS['water'] + 0.4:
            tree(x, y, random.uniform(tall * 0.6, tall))


for cx, cy, count, spread, tall in [(-150, -40, 34, 30, 17), (160, -44, 34, 30, 17), (-178, -110, 40, 36, 19), (188, -112, 40, 36, 19),
                                    (-120, 4, 16, 16, 13), (128, 2, 16, 16, 13), (-210, -200, 46, 44, 20), (220, -210, 46, 44, 20),
                                    (-40, -250, 22, 30, 15), (110, -256, 22, 30, 15), (-250, -20, 26, 30, 18), (262, -16, 26, 30, 18)]:
    clump(cx, cy, count, spread, tall)
new_obj('Trees', trees, 'Foliage', sharp=50)

new_obj('Structures', black, 'Black', sharp=35)
new_obj('Floods', lens, 'Lens', smooth=False)
for name, o in lamps.items():
    new_obj(name, o, name, smooth=False)
for i, o in enumerate(canvas):
    new_obj('Cloth%d' % i, o, 'Canvas%d' % i, sharp=40)


# =================================================================== OUTPUT
def to_three(v):
    """Blender (Z up) to three.js (Y up)."""
    return [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]


def preview(path):
    cam_data = bpy.data.cameras.new('Preview')
    cam_data.lens = 22
    cam_data.clip_end = 4000
    cam = bpy.data.objects.new('Preview', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (-10, 30, 26)
    cam.rotation_euler = (Vector((20, -170, 12)) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


if args.preview:
    preview(args.preview)
if args.save:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save))
if args.out:
    os.makedirs(args.out, exist_ok=True)
    # The moon hangs low to the left behind the stage (direction to it, three.js axes).
    az, el = math.radians(-32), math.radians(15)
    moon = [round(math.sin(az) * math.cos(el), 4), round(math.sin(el), 4), round(-math.cos(az) * math.cos(el), 4)]
    data = {'version': 1, 'terrain': terrain.PARAMS, 'wheel': {'center': to_three(WHEEL_C), 'radius': WHEEL_R},
            'shore': [{'pos': to_three(s['pos']), 'color': s['color']} for s in SHORE], 'moon': moon}
    with open(os.path.join(args.out, 'scenery.json'), 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, 'scenery.glb'), export_format='GLB', export_apply=True, export_yup=True,
                              export_texcoords=False, export_normals=True, export_extras=True, export_animations=False, export_vertex_color='NONE',
                              export_cameras=False, export_lights=False, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    meshes = [o for o in scene.objects if o.type == 'MESH']
    print('scenery', len(meshes), 'objects', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes), 'tris',
          os.path.getsize(os.path.join(args.out, 'scenery.glb')), 'bytes')
