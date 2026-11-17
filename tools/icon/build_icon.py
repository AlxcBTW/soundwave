"""
Renders the app icon: the game's note highway running off into the night, tiles coming down its
five lanes and one of them struck on the line.

    blender -b --factory-startup -P tools/icon/build_icon.py -- --out src-tauri/icons/icon.png

The highway is built here the way the game draws it (src/render/Highway.ts): a violet glass deck
cut in facets between two lit rails, pill-shaped tiles in the lane colours, a pill outline per lane
on the strike line, a sustain as a beam of light. It is rendered with Cycles and finished here as
well (glow, tone, the rounded tile and its rim), so the icon comes out of this one file. `--out`
gets a 1024 px PNG with a transparent margin round the tile, the layout the platform icon tools
expect; run `npx tauri icon src-tauri/icons/icon.png` afterwards to make every size from it.

Axes: the highway runs away along +Y from the strike line at y = 0, lanes are 1 wide, Z is up.
"""
import argparse
import math
import os
import struct
import sys
import tempfile
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', default='src-tauri/icons/icon.png')
ap.add_argument('--size', type=int, default=1024, help='the PNG is this many pixels square')
ap.add_argument('--samples', type=int, default=400)
ap.add_argument('--over', type=int, default=2, help='render this many times larger and scale down')
ap.add_argument('--seed', type=int, default=5)
args = ap.parse_args(argv)

TILE = 896 / 1024                   # the tile's share of the picture, the rest is margin
CORNER = 200 / 896                  # its corner radius, as a share of the tile


def linear(code):
    """A colour written as 0xrrggbb, in linear light."""
    out = []
    for shift in (16, 8, 0):
        c = ((code >> shift) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


LANES = [linear(c) for c in (0x3ddc5a, 0xff3b4e, 0xffd23d, 0x3a8bff, 0xff8a1f)]
RAIL = (0.74, 0.47, 1.0)
LENGTH, FRONT = 90.0, 3.0
# The tiles on the deck: (lane, how far up the highway). The one at 0 is being struck.
TILES = [(2, 0.0), (0, 1.75), (3, 3.3), (1, 5.4), (4, 7.6), (0, 9.7), (2, 11.6), (3, 14.2), (1, 16.6), (0, 19.5), (4, 21.5), (2, 24.5), (1, 27.5), (3, 30.0)]
STRUCK = 2
SUSTAIN = (4, 7.6, 13.4)            # lane, from, to


def lane_x(i):
    return i - 2.0


# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
rand = np.random.default_rng(args.seed)


def material(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    return m, m.node_tree.nodes, m.node_tree.links


def principled(nodes):
    return next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')


def glowing(name, color, strength):
    m, nodes, links = material(name)
    for node in list(nodes):
        nodes.remove(node)
    out = nodes.new('ShaderNodeOutputMaterial')
    emit = nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (*color, 1)
    emit.inputs['Strength'].default_value = strength
    links.new(emit.outputs[0], out.inputs['Surface'])
    return m


def gloss(name, color, glow=0.0, roughness=0.3, metallic=0.0):
    m, nodes, _ = material(name)
    pr = principled(nodes)
    pr.inputs['Base Color'].default_value = (*color, 1)
    pr.inputs['Roughness'].default_value = roughness
    pr.inputs['Metallic'].default_value = metallic
    pr.inputs['Emission Color'].default_value = (*color, 1)
    pr.inputs['Emission Strength'].default_value = glow
    return m


def soft(name, color, strength):
    """Light with soft edges: full in the middle of the strip (u = 0.5), fading by v toward its far end."""
    m, nodes, links = material(name)
    for node in list(nodes):
        nodes.remove(node)
    out = nodes.new('ShaderNodeOutputMaterial')
    mix = nodes.new('ShaderNodeMixShader')
    clear = nodes.new('ShaderNodeBsdfTransparent')
    emit = nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (*color, 1)
    emit.inputs['Strength'].default_value = strength
    coord = nodes.new('ShaderNodeUVMap')
    split = nodes.new('ShaderNodeSeparateXYZ')
    across = nodes.new('ShaderNodeMath')
    across.operation = 'MULTIPLY'
    across.inputs[1].default_value = math.pi
    bell = nodes.new('ShaderNodeMath')
    bell.operation = 'SINE'
    sharp = nodes.new('ShaderNodeMath')
    sharp.operation = 'POWER'
    sharp.inputs[1].default_value = 2.2
    along = nodes.new('ShaderNodeMath')
    along.operation = 'SUBTRACT'
    along.inputs[0].default_value = 1.0
    both = nodes.new('ShaderNodeMath')
    both.operation = 'MULTIPLY'
    links.new(coord.outputs['UV'], split.inputs[0])
    links.new(split.outputs['X'], across.inputs[0])
    links.new(across.outputs[0], bell.inputs[0])
    links.new(bell.outputs[0], sharp.inputs[0])
    links.new(split.outputs['Y'], along.inputs[1])
    links.new(sharp.outputs[0], both.inputs[0])
    links.new(along.outputs[0], both.inputs[1])
    links.new(both.outputs[0], mix.inputs['Fac'])
    links.new(clear.outputs[0], mix.inputs[1])
    links.new(emit.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs['Surface'])
    return m


def obj(name, bm, mats, smooth=False):
    me = bpy.data.meshes.new(name)
    for f in bm.faces:
        f.smooth = smooth
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def pill(w, h, r, n=10):
    """The outline of a rounded rectangle, w along X and h along Y."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        pts += [(cx + r * math.cos(math.radians(a0 + 90 * i / n)), cy + r * math.sin(math.radians(a0 + 90 * i / n))) for i in range(n + 1)]
    return pts


def flat(bm, outline, at, z, mat=0):
    f = bm.faces.new([bm.verts.new((at[0] + x, at[1] + y, z)) for x, y in outline])
    f.material_index = mat
    return f


def strip(bm, x0, x1, y0, y1, z, mat=0):
    """A flat strip with u across it and v along it."""
    uv = bm.loops.layers.uv.verify()
    f = bm.faces.new([bm.verts.new(p) for p in ((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))])
    f.material_index = mat
    for loop, at in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = at


# the deck: violet glass cut in large facets, a shade lighter toward the far end and toward both
# rails, each facet catching the light a little differently
bm = bmesh.new()
shade = bm.loops.layers.float_color.new('Shade')
cells = int((LENGTH + FRONT) / 2) + 1
for cy in range(cells):
    for cx in range(-2, 3):
        x0, x1 = max(-2.5, cx * 2 - 1.5), min(2.5, cx * 2 + 0.5)
        y0, y1 = -FRONT + cy * 2, min(LENGTH, -FRONT + cy * 2 + 2)
        if x1 <= x0 or y1 <= y0:
            continue
        corners = [bm.verts.new((x, y, 0)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        for tri in ((0, 1, 3), (1, 2, 3)):
            f = bm.faces.new([corners[i] for i in tri])
            c = f.calc_center_median()
            depth = min(1.0, max(0.0, c.y / 26.0))
            side = abs(c.x) / 2.5
            base = Vector((0.07, 0.038, 0.19)).lerp(Vector((0.115, 0.062, 0.31)), depth) + Vector((0.085, 0.06, 0.2)) * side ** 2.4
            base *= (1 + 0.07 * ((int(math.floor(c.x + 2.5)) % 2) - 0.5)) * (1 + (rand.uniform() - 0.5) * 0.3)
            gone = min(1.0, max(0.0, (c.y - 30.0) / (LENGTH - 30.0)))
            for loop in f.loops:
                loop[shade] = (*base, 1 - gone * gone * (3 - 2 * gone))
deck_mat, nodes, links = material('Deck')
pr = principled(nodes)
attr = nodes.new('ShaderNodeAttribute')
attr.attribute_name = 'Shade'
links.new(attr.outputs['Color'], pr.inputs['Base Color'])
links.new(attr.outputs['Color'], pr.inputs['Emission Color'])
pr.inputs['Emission Strength'].default_value = 0.34
pr.inputs['Roughness'].default_value = 0.22
pr.inputs['Coat Weight'].default_value = 0.6
pr.inputs['Coat Roughness'].default_value = 0.07
# ... and it thins out into the light at its far end
out = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
mix = nodes.new('ShaderNodeMixShader')
clear = nodes.new('ShaderNodeBsdfTransparent')
links.new(attr.outputs['Alpha'], mix.inputs['Fac'])
links.new(clear.outputs[0], mix.inputs[1])
links.new(pr.outputs[0], mix.inputs[2])
links.new(mix.outputs[0], out.inputs['Surface'])
obj('Deck', bm, [deck_mat])

# hairlines between the lanes, the two rails, and the lip across the near end of the strike line
bm = bmesh.new()
for x in (-1.5, -0.5, 0.5, 1.5):
    strip(bm, x - 0.014, x + 0.014, -FRONT, LENGTH, 0.004)
obj('Lines', bm, [glowing('Line', (0.3, 0.22, 0.62), 0.6)])
bm = bmesh.new()
for sx in (-1, 1):
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((sx * 2.535, (LENGTH - FRONT) / 2, 0.03)) @ Matrix.Diagonal((0.07, LENGTH + FRONT, 0.06, 1)))
obj('Rails', bm, [glowing('Rail', RAIL, 2.3)])

# the strike line: a pill outline per lane in its colour, dark inside until the lane is played
bm = bmesh.new()
mats = [gloss('PadDark', (0.012, 0.006, 0.03), roughness=0.35)]
for i, color in enumerate(LANES):
    mats.append(glowing('Pad%d' % i, color, 1.6 if i != STRUCK else 4.0))
    flat(bm, pill(0.9, 0.36, 0.18), (lane_x(i), 0), 0.008, 1 + i)
    if i != STRUCK:
        flat(bm, pill(0.8, 0.26, 0.13), (lane_x(i), 0), 0.014, 0)
obj('Pads', bm, mats)

# the tiles: a pill with a bright rim, its top a deeper shade of the lane's colour under a gloss
rim_mats = [gloss('Tile%d' % i, c, glow=0.9, roughness=0.28) for i, c in enumerate(LANES)]
core_mats = [gloss('Core%d' % i, tuple(v * 0.5 for v in c), glow=1.0, roughness=0.12) for i, c in enumerate(LANES)]
shine_mat = glowing('Shine', (1, 1, 1), 1.6)
white_hot = gloss('Struck', (1.0, 0.8, 0.3), glow=5.0, roughness=0.2)
bm = bmesh.new()
outline = pill(0.84, 0.34, 0.12)
small = pill(0.84 - 0.06, 0.34 - 0.06, 0.09)
for lane, y in TILES:
    at = (lane_x(lane), y)
    struck = y == 0.0
    lift = 0.02
    layers = [(small, lift), (outline, lift + 0.035), (outline, lift + 0.125), (small, lift + 0.16)]
    rings = [[bm.verts.new((at[0] + px, at[1] + py, z)) for px, py in pts] for pts, z in layers]
    index = len(LANES) * 2 + 1 if struck else lane
    for a, b in zip(rings, rings[1:]):
        for k in range(len(a)):
            f = bm.faces.new((a[k], a[(k + 1) % len(a)], b[(k + 1) % len(a)], b[k]))
            f.material_index = index
            f.smooth = True
    bm.faces.new(rings[-1]).material_index = index
    flat(bm, pill(0.73, 0.23, 0.075), at, lift + 0.162, index if struck else len(LANES) + lane)
    flat(bm, pill(0.5, 0.05, 0.025), (at[0], at[1] + 0.055), lift + 0.164, len(LANES) * 2)
tiles = bpy.data.meshes.new('Tiles')
bm.to_mesh(tiles)
bm.free()
for m in rim_mats + core_mats + [shine_mat, white_hot]:
    tiles.materials.append(m)
o = bpy.data.objects.new('Tiles', tiles)
scene.collection.objects.link(o)

# light on the deck: the struck lane lit along its length, and the sustain as a beam with a white-hot core
bm = bmesh.new()
x = lane_x(STRUCK)
strip(bm, x - 0.5, x + 0.5, 0.0, 10.5, 0.006, 0)
lane, y0, y1 = SUSTAIN
x = lane_x(lane)
strip(bm, x - 0.3, x + 0.3, y1, y0, 0.03, 1)
strip(bm, x - 0.07, x + 0.07, y1, y0, 0.034, 2)
obj('Beams', bm, [soft('LaneLit', LANES[STRUCK], 1.3), soft('Trail', LANES[lane], 6.0), soft('TrailCore', (1.0, 0.95, 0.85), 14.0)])

# the strike: a burst of light over the pad and sparks flying off it
bm = bmesh.new()
origin = Vector((lane_x(STRUCK), 0.0, 0.2))
for _ in range(26):
    a = rand.uniform(0, 2 * math.pi)
    up = rand.uniform(0.25, 1.0)
    d = Vector((math.cos(a) * (1 - up * 0.5), -abs(math.sin(a)) * 0.5 - 0.1, up)).normalized()
    start, length = rand.uniform(0.25, 0.9), rand.uniform(0.12, 0.42)
    m = Matrix.Translation(origin + d * (start + length / 2)) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.014, radius2=0.002, depth=length, matrix=m)
obj('Sparks', bm, [glowing('Spark', (1.0, 0.72, 0.25), 14.0)])
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.13, matrix=Matrix.Translation(origin + Vector((0, 0, 0.0))) @ Matrix.Diagonal((1.9, 0.9, 0.5, 1)))
obj('Flash', bm, [glowing('Flash', (1.0, 0.78, 0.3), 12.0)], smooth=True)

# the night the highway runs into: dark overhead, and a light at the far end that lies along the deck
world = bpy.data.worlds.new('Night')
scene.world = world
try:
    world.use_nodes = True
except Exception:
    pass
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (0.012, 0.007, 0.045, 1)
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, segments=48, radius=9.0, matrix=Matrix.Translation((0, 150, 10)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
far_light = obj('FarLight', bm, [glowing('FarLight', (1.0, 0.5, 0.95), 7.0)])
far_light.visible_camera = False

# a soft light from above the player, for the gloss on the tiles
key = bpy.data.lights.new('Key', 'AREA')
key.energy = 150
key.specular_factor = 0.2
key.size = 5.0
key.color = (0.85, 0.9, 1.0)
lamp = bpy.data.objects.new('Key', key)
lamp.location = (-1.5, -2.5, 6.0)
lamp.rotation_euler = (Vector((0, 3, 0)) - lamp.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(lamp)

# the camera: above the player's end, looking down the highway
cam = bpy.data.cameras.new('Camera')
cam.sensor_fit = 'HORIZONTAL'
cam.sensor_width = 36
cam.lens = 18 / math.tan(math.radians(54) / 2)
cam.clip_end = 1000
eye = bpy.data.objects.new('Camera', cam)
eye.location = (0, -5.0, 3.4)
eye.rotation_euler = (Vector((0, 5.0, 0.55)) - eye.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(eye)
scene.camera = eye

tile = round(args.size * TILE)
side = tile * args.over
scene.render.engine = 'CYCLES'
scene.render.resolution_x = scene.render.resolution_y = side
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.cycles.transparent_max_bounces = 16
prefs = bpy.context.preferences.addons['cycles'].preferences
for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        found = [d for d in prefs.devices if d.type == kind]
        if found:
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = 'GPU'
            print('rendering on', kind, found[0].name)
            break
    except Exception:
        continue
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '32'
raw = os.path.join(tempfile.gettempdir(), 'festival-icon.exr')
scene.render.filepath = raw
bpy.context.view_layer.update()
# where the highway vanishes in the picture, for the sky that is painted round it
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
vanish = world_to_camera_view(scene, eye, Vector((0, 1e6, 0)))
bpy.ops.render.render(write_still=True)

# ---------------------------------------------------------------- finishing
img = bpy.data.images.load(raw)
px = np.empty(side * side * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(side, side, 4)[::-1].astype(np.float64)               # top row first
front, cover = px[:, :, :3], px[:, :, 3:4]


def blur(a, sx, sy=None):
    """A Gaussian blur, done in frequency space so wide ones cost the same as narrow ones."""
    sy = sx if sy is None else sy
    px_, py_ = int(sx * 3), int(sy * 3)
    b = np.pad(a, ((py_, py_), (px_, px_), (0, 0)), mode='reflect')
    fy = np.fft.fftfreq(b.shape[0])[:, None]
    fx = np.fft.rfftfreq(b.shape[1])[None, :]
    kernel = np.exp(-2 * math.pi ** 2 * (sx * sx * fx * fx + sy * sy * fy * fy))
    out = np.empty_like(b)
    for ch in range(a.shape[2]):
        out[:, :, ch] = np.fft.irfft2(np.fft.rfft2(b[:, :, ch]) * kernel, s=b.shape[:2])
    return out[py_:py_ + a.shape[0], px_:px_ + a.shape[1]]


k = side / 1792
yy, xx = np.mgrid[0:side, 0:side]
u, v = (xx + 0.5) / side, 1 - (yy + 0.5) / side                       # v: 0 at the bottom

# the night: dark overhead, light gathering along the horizon and most of all where the highway
# runs into it; below the horizon just the dark the deck hangs in
du, dv = u - vanish.x, v - vanish.y
above = np.clip(dv / 0.02 + 0.5, 0, 1)
band = np.exp(-(dv / 0.11) ** 2 * np.where(dv > 0, 1.0, 5.0))
back = np.empty((side, side, 3))
back[:] = np.array([0.004, 0.004, 0.022])
back += band[:, :, None] * np.exp(-(du / 0.5) ** 2)[:, :, None] * np.array([0.3, 0.05, 0.5])[None, None, :]
back += (np.exp(-((du / 0.2) ** 2 + (dv / 0.075) ** 2)) * above)[:, :, None] * np.array([0.95, 0.22, 0.85])[None, None, :]
back += ((1 - above) * np.exp(dv / 0.3))[:, :, None] * np.array([0.02, 0.008, 0.05])[None, None, :]
for _ in range(42):
    su, sv = rand.uniform(0, 1), rand.uniform(vanish.y + 0.06, 1.0)
    size = rand.choice([0.0013, 0.002, 0.003], p=[0.6, 0.3, 0.1])
    back += (np.exp(-((u - su) ** 2 + (v - sv) ** 2) / size ** 2) * rand.uniform(0.5, 2.5))[:, :, None] * np.array([0.8, 0.9, 1.0])[None, None, :]
rgb = front + back * (1 - cover)
# the light the highway runs into lies over its far end too
rgb += np.exp(-((du / 0.085) ** 2 + (dv / 0.04) ** 2))[:, :, None] * np.array([1.0, 0.5, 0.95])[None, None, :] * 0.9
rgb += np.exp(-((du / 0.03) ** 2 + (dv / 0.016) ** 2))[:, :, None] * 1.2

# glow: the bright parts spill light round themselves, tightly and widely
hot = np.maximum(rgb - 0.85, 0.0)
rgb = rgb + 0.4 * blur(hot, 5 * k) + 0.26 * blur(hot, 20 * k) + 0.16 * blur(hot, 75 * k)

# tone: a soft shoulder, so bright colour stays colour instead of clipping to white
rgb = 1.0 - np.exp(-1.15 * np.maximum(rgb, 0))
grey = rgb @ np.array([0.2126, 0.7152, 0.0722])
rgb = np.clip(grey[:, :, None] + (rgb - grey[:, :, None]) * 1.15, 0, 1)
rgb *= (1.0 - 0.3 * np.clip(((u - 0.5) ** 2 + (v - 0.45) ** 2) / 0.5, 0, 1) ** 1.2)[:, :, None]

# the tile: a rounded square; how far inside its edge each pixel is, in pixels
rad = CORNER * side
qx, qy = np.abs(xx + 0.5 - side / 2) - (side / 2 - rad), np.abs(yy + 0.5 - side / 2) - (side / 2 - rad)
inside = rad - (np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0))
alpha = np.clip(inside + 0.5, 0, 1)
# its rim: a hairline of light along the top edge, and a touch of shade along the bottom
edge = np.clip(1 - inside / (5.0 * args.over), 0, 1) ** 2
rgb += (edge * np.clip(1.9 * v - 0.75, 0, 1) * 0.28)[:, :, None]
rgb *= (1 - edge * np.clip(0.7 - 1.6 * v, 0, 1) * 0.4)[:, :, None]
rgb = np.clip(rgb, 0, 1)

# down to size (in linear light, colour weighted by coverage), then onto the margin
f = args.over
a = alpha.reshape(tile, f, tile, f).mean(axis=(1, 3))
c = (rgb * alpha[:, :, None]).reshape(tile, f, tile, f, 3).mean(axis=(1, 3)) / np.maximum(a, 1e-6)[:, :, None]
srgb = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 1e-9), 1 / 2.4) - 0.055)
canvas = np.zeros((args.size, args.size, 4), dtype=np.uint8)
m = (args.size - tile) // 2
canvas[m:m + tile, m:m + tile, :3] = np.round(np.clip(srgb, 0, 1) * 255).astype(np.uint8)
canvas[m:m + tile, m:m + tile, 3] = np.round(a * 255).astype(np.uint8)


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


rows = b''.join(b'\x00' + canvas[y].tobytes() for y in range(args.size))
out_path = os.path.abspath(args.out)
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, 'wb') as fh:
    fh.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', args.size, args.size, 8, 6, 0, 0, 0))
             + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))
print('icon written to', out_path)
