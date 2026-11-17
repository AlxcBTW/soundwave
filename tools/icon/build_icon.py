"""
Renders the app icon: the stage as a tunnel of three glowing arches with the moon rising inside,
mirrored in a wet deck.

    blender -b --factory-startup -P tools/icon/build_icon.py -- --out src-tauri/icons/icon.png

The scene is built here, rendered with Cycles, and finished here as well (glow, tone, the rounded
tile and its rim), so the icon comes out of this one file. `--out` gets a 1024 px PNG with a
transparent margin round the tile, the layout the platform icon tools expect; run
`npx tauri icon src-tauri/icons/icon.png` afterwards to make every size from it.

The picture is laid out in fractions of the tile (0 at the left and bottom, 1 at the right and
top) and each thing is then put at its own depth and sized to match, so the arches nest the same
way whatever the lens.
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
ap.add_argument('--samples', type=int, default=320)
ap.add_argument('--over', type=int, default=2, help='render this many times larger and scale down')
args = ap.parse_args(argv)

# ---------------------------------------------------------------- layout, in fractions of the tile
HORIZON = 0.27                      # where the deck meets the sky
CENTRE = (0.5, 0.455)               # the middle of the moon and of every arch's curve
MOON = 0.142                        # radius
# colour, radius of the middle of the band, how wide the band is, how far away its front is
ARCHES = [((1.0, 0.07, 0.36), 0.398, 0.064, 19.0),
          ((0.42, 0.16, 1.0), 0.302, 0.060, 21.2),
          ((0.03, 0.72, 1.0), 0.208, 0.056, 23.4)]
ARCH_DEPTH = 1.5
MOON_AWAY = 28.5
FOV = math.radians(30)
EYE = 0.9                           # how high the camera is above the deck
TILE = 896 / 1024                   # the tile's share of the picture, the rest is margin
CORNER = 200 / 896                  # its corner radius, as a share of the tile


def width_at(distance):
    return 2 * distance * math.tan(FOV / 2)


def place(u, v, distance):
    """The point that shows at (u, v) of the tile when it is `distance` in front of the camera."""
    w = width_at(distance)
    return Vector(((u - 0.5) * w, distance, EYE + (v - HORIZON) * w))


# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    return m, m.node_tree.nodes, m.node_tree.links


def principled(nodes):
    return next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')


def obj(name, bm, mats, smooth=False):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = smooth
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def arch(color, radius, band, away, index):
    """One arch: a band on two legs, its face glowing, its inside a dark gloss that takes the light of the rest."""
    w = width_at(away)
    r, t = radius * w, band * w
    c = place(CENTRE[0], CENTRE[1], away)
    # the middle line of the band: up the left leg, over, down the right
    line = [(Vector((-r, 0, 0)), Vector((-1, 0, 0)))]
    n = 72
    line += [(Vector((-r * math.cos(math.pi * i / n), 0, c.z + r * math.sin(math.pi * i / n))),
              Vector((-math.cos(math.pi * i / n), 0, math.sin(math.pi * i / n)))) for i in range(n + 1)]
    line += [(Vector((r, 0, 0)), Vector((1, 0, 0)))]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    rings = []
    for p, out in line:
        rings.append([bm.verts.new((p.x + out.x * s * t / 2, y, p.z + out.z * s * t / 2)) for s, y in ((1, away), (1, away + ARCH_DEPTH), (-1, away + ARCH_DEPTH), (-1, away))])
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            f = bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
            f.material_index = 0 if k == 3 else 1
            if k == 3:
                # across the face: 0 at the inner edge, 1 at the outer
                for loop, v in zip(f.loops, (0.0, 1.0, 1.0, 0.0)):
                    loop[uv].uv = (0.5, v)
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])

    glow, nodes, links = material('Glow%d' % index)
    for node in list(nodes):
        nodes.remove(node)
    out = nodes.new('ShaderNodeOutputMaterial')
    emit = nodes.new('ShaderNodeEmission')
    coord = nodes.new('ShaderNodeUVMap')
    split = nodes.new('ShaderNodeSeparateXYZ')
    arc = nodes.new('ShaderNodeMath')
    arc.operation = 'MULTIPLY'
    arc.inputs[1].default_value = math.pi
    sine = nodes.new('ShaderNodeMath')
    sine.operation = 'SINE'
    level = nodes.new('ShaderNodeMapRange')
    level.inputs['To Min'].default_value = 0.32
    level.inputs['To Max'].default_value = 1.7
    # a hot core that goes toward white, as a tube of light does
    core = nodes.new('ShaderNodeMixRGB')
    core.inputs['Color1'].default_value = (*color, 1)
    core.inputs['Color2'].default_value = (*[c * 0.62 + 0.38 for c in color], 1)
    sharp = nodes.new('ShaderNodeMath')
    sharp.operation = 'POWER'
    sharp.inputs[1].default_value = 9.0
    links.new(coord.outputs['UV'], split.inputs[0])
    links.new(split.outputs['Y'], arc.inputs[0])
    links.new(arc.outputs[0], sine.inputs[0])
    links.new(sine.outputs[0], level.inputs['Value'])
    links.new(sine.outputs[0], sharp.inputs[0])
    links.new(sharp.outputs[0], core.inputs['Fac'])
    links.new(core.outputs[0], emit.inputs['Color'])
    links.new(level.outputs[0], emit.inputs['Strength'])
    links.new(emit.outputs[0], out.inputs['Surface'])

    shell, nodes, _ = material('Shell%d' % index)
    pr = principled(nodes)
    pr.inputs['Base Color'].default_value = (*[c * 0.05 for c in color], 1)
    pr.inputs['Metallic'].default_value = 0.25
    pr.inputs['Roughness'].default_value = 0.42
    pr.inputs['Emission Color'].default_value = (*color, 1)
    pr.inputs['Emission Strength'].default_value = 0.075
    o = obj('Arch%d' % index, bm, [glow, shell])
    return o


for i, (color, radius, band, away) in enumerate(ARCHES):
    arch(color, radius, band, away, i)

# the moon: its own light, mottled like the real one, a little darker toward the limb
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=MOON * width_at(MOON_AWAY))
moon = obj('Moon', bm, [], smooth=True)
moon.location = place(CENTRE[0], CENTRE[1], MOON_AWAY)
moon.rotation_euler = (math.radians(20), math.radians(-12), math.radians(35))
mat, nodes, links = material('Moon')
for node in list(nodes):
    nodes.remove(node)
out = nodes.new('ShaderNodeOutputMaterial')
emit = nodes.new('ShaderNodeEmission')
coord = nodes.new('ShaderNodeTexCoord')
seas = nodes.new('ShaderNodeTexNoise')
seas.inputs['Scale'].default_value = 1.9
seas.inputs['Detail'].default_value = 7.0
seas.inputs['Roughness'].default_value = 0.62
shade = nodes.new('ShaderNodeValToRGB')
shade.color_ramp.elements[0].position = 0.36
shade.color_ramp.elements[0].color = (0.58, 0.7, 0.94, 1)
shade.color_ramp.elements[1].position = 0.7
shade.color_ramp.elements[1].color = (0.93, 0.97, 1.0, 1)
pits = nodes.new('ShaderNodeTexVoronoi')
pits.inputs['Scale'].default_value = 5.5
rim = nodes.new('ShaderNodeValToRGB')
rim.color_ramp.elements[0].position = 0.0
rim.color_ramp.elements[0].color = (0.8, 0.8, 0.8, 1)
rim.color_ramp.elements[1].position = 0.22
rim.color_ramp.elements[1].color = (1, 1, 1, 1)
mix = nodes.new('ShaderNodeMixRGB')
mix.blend_type = 'MULTIPLY'
mix.inputs['Fac'].default_value = 1.0
limb = nodes.new('ShaderNodeLayerWeight')
limb.inputs['Blend'].default_value = 0.35
fall = nodes.new('ShaderNodeMapRange')
fall.inputs['To Min'].default_value = 2.1
fall.inputs['To Max'].default_value = 1.15
links.new(coord.outputs['Object'], seas.inputs['Vector'])
links.new(coord.outputs['Object'], pits.inputs['Vector'])
links.new(seas.outputs[0], shade.inputs['Fac'])
links.new(pits.outputs['Distance'], rim.inputs['Fac'])
links.new(shade.outputs['Color'], mix.inputs['Color1'])
links.new(rim.outputs['Color'], mix.inputs['Color2'])
links.new(limb.outputs['Facing'], fall.inputs['Value'])
links.new(mix.outputs[0], emit.inputs['Color'])
links.new(fall.outputs[0], emit.inputs['Strength'])
links.new(emit.outputs[0], out.inputs['Surface'])
moon.data.materials.append(mat)

# the deck: dark and wet, so everything above it shows in it, drawn out toward the camera
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
deck = obj('Deck', bm, [])
deck.scale = (400, 400, 1)
deck.location = (0, 150, 0)
mat, nodes, links = material('Deck')
pr = principled(nodes)
pr.inputs['Base Color'].default_value = (0.003, 0.003, 0.012, 1)
pr.inputs['Metallic'].default_value = 0.0
pr.inputs['Roughness'].default_value = 0.09
ripple = nodes.new('ShaderNodeTexNoise')
ripple.inputs['Scale'].default_value = 5.0
ripple.inputs['Detail'].default_value = 3.0
coord = nodes.new('ShaderNodeTexCoord')
stretch = nodes.new('ShaderNodeMapping')
stretch.inputs['Scale'].default_value = (1.0, 0.16, 1.0)
bump = nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.05
bump.inputs['Distance'].default_value = 0.05
links.new(coord.outputs['Object'], stretch.inputs['Vector'])
links.new(stretch.outputs[0], ripple.inputs['Vector'])
links.new(ripple.outputs[0], bump.inputs['Height'])
links.new(bump.outputs[0], pr.inputs['Normal'])
deck.data.materials.append(mat)

# the night: deep blue overhead, a violet glow along the horizon, and stars
world = bpy.data.worlds.new('Night')
scene.world = world
try:
    world.use_nodes = True
except Exception:
    pass
nodes, links = world.node_tree.nodes, world.node_tree.links
bg = next(n for n in nodes if n.type == 'BACKGROUND')
coord = nodes.new('ShaderNodeTexCoord')
split = nodes.new('ShaderNodeSeparateXYZ')
ramp = nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = (0.085, 0.02, 0.2, 1)
ramp.color_ramp.elements[1].position = 0.42
ramp.color_ramp.elements[1].color = (0.002, 0.004, 0.026, 1)
mid = ramp.color_ramp.elements.new(0.12)
mid.color = (0.014, 0.008, 0.075, 1)
links.new(coord.outputs['Generated'], split.inputs[0])
links.new(split.outputs['Z'], ramp.inputs['Fac'])
links.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.0

rand = np.random.default_rng(7)
bm = bmesh.new()
far = 90.0
for _ in range(170):
    u, v = rand.uniform(-0.1, 1.1), rand.uniform(HORIZON + 0.04, 1.1)
    if math.hypot(u - CENTRE[0], v - CENTRE[1]) < MOON * 1.5:
        continue
    size = width_at(far) * rand.choice([0.0011, 0.0016, 0.0024, 0.0036], p=[0.5, 0.3, 0.15, 0.05])
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size, matrix=Matrix.Translation(place(u, v, far)))
stars = obj('Stars', bm, [])
mat, nodes, links = material('Stars')
for node in list(nodes):
    nodes.remove(node)
out = nodes.new('ShaderNodeOutputMaterial')
emit = nodes.new('ShaderNodeEmission')
emit.inputs['Color'].default_value = (0.85, 0.92, 1.0, 1)
emit.inputs['Strength'].default_value = 5.0
links.new(emit.outputs[0], out.inputs['Surface'])
stars.data.materials.append(mat)

# the camera: level, a long lens, the picture shifted up so the horizon sits low in it
cam = bpy.data.cameras.new('Camera')
cam.sensor_fit = 'HORIZONTAL'
cam.sensor_width = 36
cam.lens = 18 / math.tan(FOV / 2)
cam.shift_y = 0.5 - HORIZON
cam.clip_end = 1000
eye = bpy.data.objects.new('Camera', cam)
eye.location = (0, 0, EYE)
eye.rotation_euler = (math.pi / 2, 0, 0)
scene.collection.objects.link(eye)
scene.camera = eye

tile = round(args.size * TILE)
side = tile * args.over
scene.render.engine = 'CYCLES'
scene.render.resolution_x = scene.render.resolution_y = side
scene.render.resolution_percentage = 100
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.cycles.sample_clamp_indirect = 8.0
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
scene.render.image_settings.color_depth = '32'
raw = os.path.join(tempfile.gettempdir(), 'festival-icon.exr')
scene.render.filepath = raw
bpy.ops.render.render(write_still=True)

# ---------------------------------------------------------------- finishing
img = bpy.data.images.load(raw)
px = np.empty(side * side * 4, dtype=np.float32)
img.pixels.foreach_get(px)
rgb = px.reshape(side, side, 4)[::-1, :, :3].astype(np.float64)       # top row first


def blur(a, sigma):
    """A Gaussian blur, done in frequency space so wide ones cost the same as narrow ones."""
    pad = int(sigma * 3)
    b = np.pad(a, ((pad, pad), (pad, pad), (0, 0)), mode='reflect')
    fy = np.fft.fftfreq(b.shape[0])[:, None]
    fx = np.fft.rfftfreq(b.shape[1])[None, :]
    kernel = np.exp(-2 * (math.pi * sigma) ** 2 * (fx * fx + fy * fy))
    out = np.empty_like(b)
    for ch in range(3):
        out[:, :, ch] = np.fft.irfft2(np.fft.rfft2(b[:, :, ch]) * kernel, s=b.shape[:2])
    return out[pad:pad + a.shape[0], pad:pad + a.shape[1]]


# glow: the bright parts spill light round themselves, tightly and widely
hot = np.maximum(rgb - 0.75, 0.0)
k = side / 1792
rgb = rgb + 0.42 * blur(hot, 5 * k) + 0.3 * blur(hot, 22 * k) + 0.2 * blur(hot, 80 * k)

# tone: a soft shoulder, so bright colour stays colour instead of clipping to white
rgb = 1.0 - np.exp(-1.1 * rgb)
grey = rgb @ np.array([0.2126, 0.7152, 0.0722])
rgb = np.clip(grey[:, :, None] + (rgb - grey[:, :, None]) * 1.18, 0, 1)

yy, xx = np.mgrid[0:side, 0:side]
u, v = (xx + 0.5) / side, (yy + 0.5) / side
# a little darker toward the corners, to hold the eye in the middle
rgb *= (1.0 - 0.3 * np.clip(((u - 0.5) ** 2 + (v - 0.48) ** 2) / 0.5, 0, 1) ** 1.3)[:, :, None]

# the tile: a rounded square; how far inside its edge each pixel is, in pixels
rad = CORNER * side
qx, qy = np.abs(xx + 0.5 - side / 2) - (side / 2 - rad), np.abs(yy + 0.5 - side / 2) - (side / 2 - rad)
inside = rad - (np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0))
alpha = np.clip(inside + 0.5, 0, 1)
# its rim: a hairline of light along the top edge, and a touch of shade along the bottom
edge = np.clip(1 - inside / (5.0 * args.over), 0, 1) ** 2
rgb += (edge * np.clip(1.15 - 1.9 * v, 0, 1) * 0.3)[:, :, None]
rgb *= (1 - edge * np.clip(1.6 * v - 0.9, 0, 1) * 0.35)[:, :, None]
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
