"""
Renders the app icon: a mirror ball catching the five lane colours, hanging in the night.

    blender -b --factory-startup -P tools/icon/build_icon.py -- --out src-tauri/icons/icon.png

The ball is built here and rendered with Cycles; the night behind it, the glow, the glints, the
rounded tile and its rim are painted here as well, so the icon comes out of this one file. `--out`
gets a 1024 px PNG with a transparent margin round the tile, the layout the platform icon tools
expect; run `npx tauri icon src-tauri/icons/icon.png` afterwards to make every size from it.
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
ap.add_argument('--seed', type=int, default=11)
args = ap.parse_args(argv)

# ---------------------------------------------------------------- layout, in fractions of the tile
CENTRE = (0.5, 0.455)               # the middle of the ball (0 at the left and bottom)
RADIUS = 0.325
FOV = math.radians(18)
TILE = 896 / 1024                   # the tile's share of the picture, the rest is margin
CORNER = 200 / 896                  # its corner radius, as a share of the tile

# The lights round the ball, by where they stand as seen from the camera (0 = to the right, turning
# over the top): the game's five lane colours, closed into a ring with violet and cyan.
WHEEL = [(0, (1.0, 0.05, 0.1)), (50, (1.0, 0.25, 0.02)), (95, (1.0, 0.62, 0.04)), (150, (0.1, 0.72, 0.14)),
         (200, (0.02, 0.75, 1.0)), (245, (0.05, 0.22, 1.0)), (300, (0.45, 0.1, 1.0)), (335, (1.0, 0.04, 0.5)), (360, (1.0, 0.05, 0.1))]


def wheel(angle):
    angle %= 360
    for (a0, c0), (a1, c1) in zip(WHEEL, WHEEL[1:]):
        if a0 <= angle <= a1:
            t = (angle - a0) / (a1 - a0)
            return tuple(c0[i] + (c1[i] - c0[i]) * t for i in range(3))
    return WHEEL[0][1]


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


# the ball: rows of little mirrors, each set a touch differently, dark grout between them
mirror, nodes, _ = material('Mirror')
pr = principled(nodes)
pr.inputs['Base Color'].default_value = (0.94, 0.95, 1.0, 1)
pr.inputs['Metallic'].default_value = 1.0
pr.inputs['Roughness'].default_value = 0.035
grout, nodes, _ = material('Grout')
pr = principled(nodes)
pr.inputs['Base Color'].default_value = (0.004, 0.004, 0.01, 1)
pr.inputs['Roughness'].default_value = 0.6
chrome, nodes, _ = material('Chrome')
pr = principled(nodes)
pr.inputs['Base Color'].default_value = (0.8, 0.82, 0.9, 1)
pr.inputs['Metallic'].default_value = 1.0
pr.inputs['Roughness'].default_value = 0.16

bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=38, v_segments=20, radius=1.0)
rims = bmesh.ops.inset_individual(bm, faces=bm.faces[:], thickness=0.011, depth=0.0, use_even_offset=True)['faces']
for f in rims:
    f.material_index = 1
bm.normal_update()
for f in bm.faces:
    if f.material_index == 0:
        # no two mirrors look quite the same way
        centre = f.calc_center_median()
        normal = f.normal.copy()
        axis = normal.orthogonal().normalized()
        axis.rotate(Matrix.Rotation(rand.uniform(0, 2 * math.pi), 3, normal))
        turn = Matrix.Rotation(math.radians(rand.normal(0, 2.4)), 3, axis)
        for v in f.verts:
            v.co = centre + turn @ (v.co - centre) + normal * 0.004
ball = obj('Ball', bm, [mirror, grout])
ball.rotation_euler = (math.radians(-14), math.radians(9), math.radians(6))

# what it hangs from: a collar on top and a rod up out of the picture
bm = bmesh.new()
tilt = ball.rotation_euler.to_matrix()
top = tilt @ Vector((0, 0, 1))
bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=0.17, radius2=0.11, depth=0.09, matrix=Matrix.Translation(top * 0.985) @ tilt.to_4x4() @ Matrix.Translation((0, 0, 0.03)))
bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.05, radius2=0.05, depth=0.1, matrix=Matrix.Translation(top * 1.09) @ tilt.to_4x4())
bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.016, radius2=0.016, depth=3.0, matrix=Matrix.Translation(top * 1.1 + Vector((0, 0, 1.5))))
obj('Hanger', bm, [chrome], smooth=True)

# the lights the mirrors pick up: panels all round, coloured by where they stand, some left dark,
# and a few small hard ones for the glints. None of them shows in the picture itself.
count = 90
for i in range(count):
    z = 1 - 2 * (i + 0.5) / count
    r = math.sqrt(1 - z * z)
    a = i * math.pi * (3 - math.sqrt(5))
    d = Vector((r * math.cos(a), z, r * math.sin(a)))          # y: toward (-) or away from (+) the camera
    if rand.uniform() < 0.3:
        continue
    seen = math.degrees(math.atan2(d.z, d.x))
    color = wheel(seen + rand.normal(0, 14))
    hard = rand.uniform() < 0.14
    size = rand.uniform(0.5, 0.9) if hard else rand.uniform(1.6, 3.4)
    strength = rand.uniform(26, 60) if hard else rand.uniform(0.5, 3.6)
    if hard:
        color = tuple(0.75 + 0.25 * c for c in color)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    p = obj('Light%d' % i, bm, [glowing('Light%d' % i, color, strength)])
    p.location = d * 10
    p.rotation_euler = (-d).to_track_quat('Z', 'Y').to_euler()
    p.visible_camera = False

world = bpy.data.worlds.new('Night')
scene.world = world
try:
    world.use_nodes = True
except Exception:
    pass
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (0.012, 0.01, 0.05, 1)
bg.inputs['Strength'].default_value = 1.0

# the camera: a long lens straight on, the ball a little below the middle to leave room for the rod
width = 1.0 / RADIUS                 # how wide the picture is where the ball hangs, in ball radii
away = width / 2 / math.tan(FOV / 2)
cam = bpy.data.cameras.new('Camera')
cam.sensor_fit = 'HORIZONTAL'
cam.sensor_width = 36
cam.lens = 18 / math.tan(FOV / 2)
cam.shift_y = 0.5 - CENTRE[1]
eye = bpy.data.objects.new('Camera', cam)
eye.location = (0, -away, 0)
eye.rotation_euler = (math.pi / 2, 0, 0)
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
du, dv = u - CENTRE[0], v - CENTRE[1]
dist = np.hypot(du, dv)
seen = np.degrees(np.arctan2(dv, du))

# the night behind the ball: near black at the edges, the ball's own colours thrown faintly round it
back = np.empty((side, side, 3))
back[:] = np.array([0.006, 0.004, 0.028]) + np.array([0.02, 0.006, 0.05])[None, None, :] * (1 - v)[:, :, None]
ring = np.zeros((side, side, 3))
for a0 in range(0, 360, 3):
    c = np.array(wheel(a0))
    near = np.exp(-(((seen - a0 + 180) % 360 - 180) / 22.0) ** 2)
    ring += near[:, :, None] * c[None, None, :] * (3 / 22.0 / math.sqrt(math.pi))
back += ring * (0.5 * np.exp(-((dist - RADIUS * 1.02) / 0.13) ** 2) + 0.07 * np.exp(-(dist / 0.55) ** 2))[:, :, None]
# the spots a mirror ball throws about: soft dots, larger and fainter the farther out they land
spots = np.zeros((side, side, 3))
for _ in range(46):
    a, r = rand.uniform(0, 360), rand.uniform(RADIUS * 1.12, 0.78)
    su, sv = CENTRE[0] + r * math.cos(math.radians(a)), CENTRE[1] + r * math.sin(math.radians(a))
    size = 0.006 + 0.016 * (r - RADIUS) / 0.4 * rand.uniform(0.6, 1.3)
    dot = np.clip(1.3 - np.hypot(u - su, v - sv) / size, 0, 1) ** 2
    spots += dot[:, :, None] * np.array(wheel(a + rand.normal(0, 20)))[None, None, :] * rand.uniform(0.25, 1.0) * (0.02 / size) ** 0.7
back += blur(spots, 2.5 * k) * 0.55

rgb = front + back * (1 - cover)

# glow round the bright mirrors, and a four-pointed glint on the brightest
hot = np.maximum(rgb - 0.9, 0.0)
rgb = rgb + 0.35 * blur(hot, 4 * k) + 0.22 * blur(hot, 18 * k) + 0.12 * blur(hot, 70 * k)
flare = np.minimum(np.maximum(front - 4.0, 0.0), 40.0)
rgb = rgb + 0.9 * (blur(flare, 60 * k, 1.1 * k) + blur(flare, 1.1 * k, 60 * k)) + 0.25 * (blur(flare, 150 * k, 1.3 * k) + blur(flare, 1.3 * k, 150 * k))

# tone: a soft shoulder, so bright colour stays colour instead of clipping to white
rgb = 1.0 - np.exp(-1.15 * np.maximum(rgb, 0))
grey = rgb @ np.array([0.2126, 0.7152, 0.0722])
rgb = np.clip(grey[:, :, None] + (rgb - grey[:, :, None]) * 1.15, 0, 1)
rgb *= (1.0 - 0.35 * np.clip((du ** 2 + dv ** 2) / 0.5, 0, 1) ** 1.2)[:, :, None]

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
