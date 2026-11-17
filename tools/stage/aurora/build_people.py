"""
Imports the downloaded characters (FBX with a skeleton, skin weights and an animation) and bakes them
for the game.

    blender -b --factory-startup -P tools/stage/aurora/build_people.py -- \
        --src local-audio/mixamo --out public/stage/aurora/local

Neither the source files nor the baked result are part of the repository: the characters' licence
allows shipping them inside a game, not passing them on. The output folder is ignored by git; when
it exists the game uses it instead of the project's own cast (see build_cast.py). Two sets are
written, each as <set>.glb, <set>.bin and <set>.json:

- band: the four musicians at full detail with their textures, each with the loop it was fetched
  with and an instrument built to fit its hands.
- crowd: six people reduced to a few hundred triangles (a nearer and a farther version), their
  textures baked into vertex colours (alpha marks tops and bottoms so the game can recolour them),
  fingers folded into the hands, each with all six crowd loops retargeted onto its own skeleton.

A mesh is plain geometry in its rest pose that carries, per vertex, up to four joints and weights
(packed into two extra UV sets as joint + weight / 2). The .bin holds one 3x4 matrix per joint per
baked frame of each loop (half floats, three.js space), so the game can skin thousands of instances
in a vertex shader. Files that are missing are skipped.

Axes: Z up, metres, characters face -Y.
"""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--src', default='local-audio/mixamo')
ap.add_argument('--out', default='public/stage/aurora/local')
ap.add_argument('--texture', type=int, default=1024, help='largest texture side (band)')
ap.add_argument('--step', type=int, default=2, help='band: bake every n-th frame (the shader blends between them)')
ap.add_argument('--crowd-step', type=int, default=3)
ap.add_argument('--near', type=int, default=1700, help='triangles of a crowd figure near a camera')
ap.add_argument('--far', type=int, default=520, help='triangles of a crowd figure far away')
ap.add_argument('--only', default='', help='band or crowd: build just that set')
args = ap.parse_args(argv)

# The band: file, the loop it carries, the instrument built to fit its hands, and its height.
BAND = {
    'lead': {'key': 'aj', 'file': 'aj_guitar.fbx', 'clip': 'guitar', 'prop': 'guitar', 'height': 1.72},
    'bass': {'key': 'amy', 'file': 'amy_bass.fbx', 'clip': 'bass', 'prop': 'bass', 'height': 1.62},
    # roam: how much of her walk about the stage she keeps (her loop strolls several metres)
    'vox': {'key': 'michelle', 'file': 'michelle_singing.fbx', 'clip': 'sing', 'prop': 'mic', 'height': 1.74, 'roam': 0.3},
    'drums': {'key': 'abe', 'file': 'abe_drums.fbx', 'clip': 'drums', 'prop': 'drums', 'height': 1.7},
}
# The crowd: rest-pose characters with their heights, and the loops every one of them gets.
CROWD = {'remy': 1.8, 'megan': 1.66, 'bryce': 1.82, 'jackie': 1.64, 'josh': 1.78, 'jody': 1.68}
CROWD_CLIPS = {'dance': 'anim_dance.fbx', 'clap': 'anim_clap.fbx', 'headbang': 'anim_headbang.fbx',
               'cheer': 'anim_cheer.fbx', 'fistpump': 'anim_fistpump.fbx', 'excited': 'anim_excited.fbx'}
# Which garment a part is, from its name: the game recolours tops and bottoms per person.
TOP = ('top', 'shirt', 'hood', 'sweater', 'jacket', 'tank', 'blouse', 'dress', 'vest', 'coat', 'suit')
BOTTOM = ('bottom', 'pants', 'short', 'jean', 'skirt', 'trouser', 'legging')
CLASS_TOP, CLASS_BOTTOM, CLASS_NONE = 1.0, 0.7, 0.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
PREFIX = 'mixamorig:'
# Blender to three.js: (x, y, z) -> (x, z, -y)
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
CI = C.inverted()


# ---------------------------------------------------------------- materials
def base_image(mat):
    """The image feeding a material's base colour."""
    nt = mat.node_tree if mat else None
    if not nt:
        return None
    pr = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if pr and pr.inputs['Base Color'].is_linked:
        node = pr.inputs['Base Color'].links[0].from_node
        seen = 0
        while node and node.type != 'TEX_IMAGE' and seen < 8:
            node, seen = next((i.links[0].from_node for i in node.inputs if i.is_linked), None), seen + 1
        if node and node.type == 'TEX_IMAGE' and node.image:
            return node.image
    images = [n.image for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image]
    return next((i for i in images if 'diff' in i.name.lower()), images[0] if images else None)


def shrink(image, side):
    w, h = image.size
    if max(w, h) > side:
        k = side / max(w, h)
        image.scale(max(1, round(w * k)), max(1, round(h * k)))
    if not image.packed_file:
        image.pack()
    return image


MATERIALS = {}


def simple_material(name, image=None, color=(1, 1, 1), cutout=False):
    """One texture or one colour: all the game's own shader needs."""
    if name in MATERIALS:
        return MATERIALS[name]
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    pr = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    pr.inputs['Base Color'].default_value = (*color, 1)
    if image:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = shrink(image, args.texture)
        nt.links.new(tex.outputs['Color'], pr.inputs['Base Color'])
        if cutout:
            nt.links.new(tex.outputs['Alpha'], pr.inputs['Alpha'])
    MATERIALS[name] = m
    return m


# ---------------------------------------------------------------- props (built in world space at the rest pose)
def capsule(bm, a, b, ra, rb, segs=10, caps=3):
    a, b = Vector(a), Vector(b)
    axis = b - a
    rot = axis.to_track_quat('Z', 'Y').to_matrix()
    prof = [(-ra * math.sin(math.pi / 2 * i / caps), ra * math.cos(math.pi / 2 * i / caps)) for i in range(caps, 0, -1)]
    prof += [(0.0, ra), (axis.length, rb)]
    prof += [(axis.length + rb * math.sin(math.pi / 2 * i / caps), rb * math.cos(math.pi / 2 * i / caps)) for i in range(1, caps + 1)]
    rings = []
    for z, r in prof:
        if r < 1e-5:
            rings.append([bm.verts.new(a + rot @ Vector((0, 0, z)))])
        else:
            rings.append([bm.verts.new(a + rot @ Vector((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), z))) for k in range(segs)])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(segs):
            k2 = (k + 1) % segs
            if len(r0) == 1:
                bm.faces.new((r0[0], r1[k2], r1[k]))
            elif len(r1) == 1:
                bm.faces.new((r0[k], r0[k2], r1[0]))
            else:
                bm.faces.new((r0[k], r0[k2], r1[k2], r1[k]))


def ellipsoid(bm, center, radii, rot=None, segs=24, rings=12):
    m = Matrix.Translation(center) @ (rot.to_4x4() if rot else Matrix.Identity(4)) @ Matrix.Diagonal((*radii, 1))
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=m)


def cylinder(bm, a, b, r, segs=20, r2=None):
    a, b = Vector(a), Vector(b)
    axis = b - a
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=axis.length,
                          matrix=Matrix.Translation((a + b) / 2) @ axis.to_track_quat('Z', 'Y').to_matrix().to_4x4())


def prop_object(name, bm, material, joint):
    """A rigid part riding one joint (None: it stays where it is)."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    o['rigid_joint'] = joint or ''
    return o


def string_instrument(key, kind, arm, frames, chest='Spine2'):
    """
    A guitar or bass fitted to the animation: the body sits where the strumming hand plays, the
    neck runs to where the fretting hand holds it (both averaged over the loop, seen from the chest).
    """
    left, right = Vector(), Vector()
    for f in frames:
        scene.frame_set(f)
        inv = arm.pose.bones[PREFIX + chest].matrix.inverted()
        left += inv @ arm.pose.bones[PREFIX + 'LeftHand'].matrix.translation
        right += inv @ arm.pose.bones[PREFIX + 'RightHand'].matrix.translation
    bind = arm.matrix_world @ arm.data.bones[PREFIX + chest].matrix_local
    left = bind @ (left / len(frames))
    right = bind @ (right / len(frames))
    forward = Vector((0, -1, 0))
    along = (left - right).normalized()
    length = (left - right).length
    side = along.cross(forward).normalized()
    forward = side.cross(along).normalized()
    rot = Matrix((along, forward, side)).transposed()
    body_c = right - along * 0.05 + forward * 0.03
    scale = 1.12 if kind == 'bass' else 1.0
    wood = bmesh.new()
    ellipsoid(wood, body_c, (0.2 * scale, 0.042, 0.16 * scale), rot)
    ellipsoid(wood, body_c - along * 0.13 * scale, (0.16 * scale, 0.044, 0.2 * scale), rot)
    dark = bmesh.new()
    tip = right + along * (length + (0.3 if kind == 'bass' else 0.2))
    capsule(dark, body_c + along * 0.12, tip, 0.023, 0.019, 8, 2)
    ellipsoid(dark, tip + along * 0.05, (0.08, 0.016, 0.034), rot, 12, 6)
    ellipsoid(dark, body_c + forward * 0.04, (0.07, 0.012, 0.05), rot, 12, 6)
    return [prop_object(key + '_wood', wood, simple_material('PropBody_' + kind, color=(0.9, 0.12, 0.4) if kind == 'guitar' else (0.1, 0.7, 0.9)), PREFIX + chest),
            prop_object(key + '_neck', dark, simple_material('PropDark', color=(0.02, 0.02, 0.025)), PREFIX + chest)]


def microphone(key, arm, frames):
    """A handheld microphone in the right hand, pointing at the mouth (averaged over the loop)."""
    aim = Vector()
    for f in frames:
        scene.frame_set(f)
        hand = arm.pose.bones[PREFIX + 'RightHand'].matrix
        aim += hand.inverted() @ (arm.pose.bones[PREFIX + 'Head'].matrix @ Vector((0, 8, 6)))
    bind = arm.matrix_world @ arm.data.bones[PREFIX + 'RightHand'].matrix_local
    wrist = bind.translation
    d = (bind @ (aim / len(frames)) - wrist).normalized()
    grip = wrist + (bind.to_3x3() @ Vector((0, 1, 0))).normalized() * 0.08
    dark = bmesh.new()
    capsule(dark, grip - d * 0.08, grip + d * 0.1, 0.015, 0.018, 8, 2)
    head = bmesh.new()
    ellipsoid(head, grip + d * 0.13, (0.032, 0.032, 0.036), None, 12, 8)
    return [prop_object(key + '_mic', dark, simple_material('PropDark', color=(0.02, 0.02, 0.025)), PREFIX + 'RightHand'),
            prop_object(key + '_michead', head, simple_material('PropMetal', color=(0.55, 0.57, 0.62)), PREFIX + 'RightHand')]


def drum_kit(key, arm, frames):
    """A kit around the seated drummer: placed from where the hips and hands are during the loop."""
    world = arm.matrix_world
    hips, hands = Vector(), Vector()
    for f in frames:
        scene.frame_set(f)
        hips += world @ arm.pose.bones[PREFIX + 'Hips'].matrix.translation
        hands += world @ ((arm.pose.bones[PREFIX + 'LeftHand'].matrix.translation + arm.pose.bones[PREFIX + 'RightHand'].matrix.translation) / 2)
    hips /= len(frames)
    hands /= len(frames)
    # bake_clip re-centres the loop on the rest position of the hips: build the kit around that spot.
    rest = (world @ arm.data.bones[PREFIX + 'Hips'].matrix_local).translation
    o = Vector((rest.x, rest.y, 0))
    top = max(0.45, hands.z - 0.1)
    reach = min(-0.3, hands.y - hips.y)
    shell, metal, glow = bmesh.new(), bmesh.new(), bmesh.new()
    cylinder(metal, o + Vector((0, 0.03, hips.z - 0.2)), o + Vector((0, 0.03, hips.z - 0.12)), 0.18)
    cylinder(metal, o + Vector((0, 0.03, 0)), o + Vector((0, 0.03, hips.z - 0.2)), 0.03, 8)
    cylinder(shell, o + Vector((0, reach - 0.25, 0.3)), o + Vector((0, reach - 0.7, 0.3)), 0.29, 28)
    cylinder(glow, o + Vector((0, reach - 0.7, 0.3)), o + Vector((0, reach - 0.712, 0.3)), 0.26, 28)
    cylinder(shell, o + Vector((0.26, reach - 0.02, top - 0.14)), o + Vector((0.26, reach - 0.02, top)), 0.18)
    cylinder(shell, o + Vector((-0.5, reach + 0.1, top - 0.34)), o + Vector((-0.5, reach + 0.1, top - 0.02)), 0.21)
    for sx in (-1, 1):
        cylinder(shell, o + Vector((sx * 0.19, reach - 0.36, top + 0.08)), o + Vector((sx * 0.19, reach - 0.44, top + 0.24)), 0.145)
        cylinder(metal, o + Vector((sx * 0.68, reach - 0.42, 0)), o + Vector((sx * 0.68, reach - 0.42, top + 0.62)), 0.014, 6)
        cylinder(glow, o + Vector((sx * 0.68, reach - 0.42, top + 0.62)), o + Vector((sx * 0.675, reach - 0.41, top + 0.635)), 0.24, 24, 0.02)
    cylinder(metal, o + Vector((0.58, reach, 0)), o + Vector((0.58, reach, top + 0.24)), 0.014, 6)
    cylinder(glow, o + Vector((0.58, reach, top + 0.24)), o + Vector((0.58, reach, top + 0.255)), 0.17)
    return [prop_object(key + '_shells', shell, simple_material('PropBody_drums', color=(0.22, 0.07, 0.55)), None),
            prop_object(key + '_stands', metal, simple_material('PropDark', color=(0.02, 0.02, 0.025)), None),
            prop_object(key + '_cymbals', glow, simple_material('PropGlow', color=(0.75, 0.6, 0.3)), None)]


# ---------------------------------------------------------------- shared steps
def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.wm.fbx_import(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        if o.type not in ('ARMATURE', 'MESH'):
            bpy.data.objects.remove(o)
    # The skeletons differ only in their name prefix: give them all the same one.
    for b in arm.data.bones:
        b.name = PREFIX + b.name.split(':')[-1]
    return arm, meshes


def fold(name):
    """Crowd figures have no fingers, eyes or toe tips of their own: those ride the hand, head and foot."""
    short = name.split(':')[-1]
    for side in ('Left', 'Right'):
        if short.startswith(side + 'Hand') and short != side + 'Hand':
            return PREFIX + side + 'Hand'
        if short == side + 'Toe_End':
            return PREFIX + side + 'ToeBase'
    if short in ('HeadTop_End', 'LeftEye', 'RightEye'):
        return PREFIX + 'Head'
    return name


def top_weights(obj, bones, remap=None):
    """Per vertex the four strongest (bone name, weight), normalized."""
    names = [g.name for g in obj.vertex_groups]
    out = []
    for v in obj.data.vertices:
        acc = {}
        for g in v.groups:
            n = names[g.group]
            if g.weight > 1e-4 and n in bones:
                n = remap(n) if remap else n
                acc[n] = acc.get(n, 0.0) + g.weight
        ws = sorted(((w, n) for n, w in acc.items()), reverse=True)[:4]
        total = sum(w for w, _ in ws) or 1.0
        out.append([(n, w / total) for w, n in ws])
    return out


def prepare_mesh(obj, weights, joint_of):
    """Texture UVs first, then the packed joints and weights."""
    me = obj.data
    keep = me.uv_layers[0].name if me.uv_layers else None
    for layer in [u for u in me.uv_layers if u.name != keep]:
        me.uv_layers.remove(layer)
    if keep:
        me.uv_layers[keep].name = 'UVMap'
    else:
        me.uv_layers.new(name='UVMap').data.foreach_set('uv', [0.0] * (2 * len(me.loops)))
    w0 = me.uv_layers.new(name='W0')
    w1 = me.uv_layers.new(name='W1')
    for loop in me.loops:
        pairs = weights[loop.vertex_index]
        packed = [joint_of[n] + 0.5 * min(w, 1.0) for n, w in pairs] + [0.0] * (4 - len(pairs))
        # glTF stores v flipped; write 1 - value so the file holds the value itself.
        w0.data[loop.index].uv = (packed[0], 1.0 - packed[1])
        w1.data[loop.index].uv = (packed[2], 1.0 - packed[3])


def detach(obj):
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mw


def join(parts, name, scale=1.0):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(parts) > 1:
        bpy.ops.object.join()
    body = parts[0]
    body.name = body.data.name = name
    if scale != 1.0:
        body.data.transform(Matrix.Scale(scale, 4))
    return body


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def bake_clip(arm, joints, frames, hips_ratio=1.0, scale=1.0, roam=1.0):
    """
    Rows of skinning matrices (rest pose to pose, world space, three.js axes) for the loop.
    `hips_ratio` rescales how far the hips travel (a loop made for a taller skeleton moves them
    further); `scale` is the size the character is brought to; `roam` below 1 pulls the character
    back toward its mark by that share of however far the loop walks it away.
    """
    world = arm.matrix_world
    bind_inv = {j: (world @ arm.data.bones[j].matrix_local).inverted() for j in joints if j}
    rest = (world @ arm.data.bones[PREFIX + 'Hips'].matrix_local).translation
    poses, hips = [], []
    for f in frames:
        scene.frame_set(f)
        now = (world @ arm.pose.bones[PREFIX + 'Hips'].matrix).translation
        carry = Matrix.Translation((now - rest) * (hips_ratio - 1.0))
        poses.append({j: carry @ world @ arm.pose.bones[j].matrix for j in joints if j})
        hips.append(carry @ now)
    # Keep the character on its mark: no drift over the loop, centred on where it stands on average.
    n = len(frames)
    drift = hips[-1] - hips[0]
    drift.z = 0
    centre = sum((h - drift * (i / max(1, n - 1)) for i, h in enumerate(hips)), Vector()) / n
    rows = []
    for i in range(n):
        away = hips[i] - drift * (i / max(1, n - 1)) - centre
        away.z = 0
        shift = -drift * (i / max(1, n - 1)) - Vector((centre.x - rest.x, centre.y - rest.y, 0)) - away * (1.0 - roam)
        fix = Matrix.Translation(shift)
        rows.append([C @ ((fix @ poses[i][j] @ bind_inv[j]) if j else Matrix.Identity(4)) @ CI for j in joints])
    # Ease the last frames into the first so the loop closes without a pop.
    blend = min(4, n // 4)
    for k in range(blend):
        t = (k + 1) / (blend + 1)
        i = n - blend + k
        rows[i] = [a.lerp(b, t * 0.85) for a, b in zip(rows[i], rows[0])]
    if scale != 1.0:
        for mats in rows:
            for m in mats:
                m.translation = m.translation * scale
    return rows


def seconds(start, end):
    return (end - start) / scene.render.fps


# ---------------------------------------------------------------- the band
def process_band(role, spec):
    path = os.path.abspath(os.path.join(args.src, spec['file']))
    if not os.path.exists(path):
        print('skip', spec['key'], '(no file)')
        return None
    key = spec['key']
    arm, meshes = import_fbx(path)
    action = arm.animation_data.action
    start, end = (int(round(v)) for v in action.frame_range)
    frames = list(range(start, end, args.step))
    bones = {b.name for b in arm.data.bones}
    weights = {o.name: top_weights(o, bones) for o in meshes}
    height = max((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
    scale = spec['height'] / height
    props = {'guitar': lambda: string_instrument(key, 'guitar', arm, frames), 'bass': lambda: string_instrument(key, 'bass', arm, frames),
             'mic': lambda: microphone(key, arm, frames), 'drums': lambda: drum_kit(key, arm, frames)}[spec['prop']]()
    used = {n for ws in weights.values() for pairs in ws for n, _ in pairs} | {p['rigid_joint'] for p in props if p['rigid_joint']}
    # Joint 0 stays at rest: it carries anything that does not move with the skeleton.
    joints = [None] + [b.name for b in arm.data.bones if b.name in used]
    joint_of = {n: i for i, n in enumerate(joints)}
    rows = bake_clip(arm, joints, frames, scale=scale, roam=spec.get('roam', 1.0))
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    for o in meshes:
        for slot in o.material_slots:
            img = base_image(slot.material)
            cutout = bool(img and img.depth == 32 and 'facial' in img.name.lower())
            slot.material = simple_material('%s_%s' % (key, img.name.split('.')[0]) if img else '%s_plain' % key, img, cutout=cutout)
        prepare_mesh(o, weights[o.name], joint_of)
        detach(o)
    for p in props:
        j = joint_of[p['rigid_joint']] if p['rigid_joint'] else 0
        prepare_mesh(p, [[]] * len(p.data.vertices), joint_of)
        for layer, value in (('W0', (j + 0.5, 1.0)), ('W1', (0.0, 1.0))):
            for d in p.data.uv_layers[layer].data:
                d.uv = value
    body = join(meshes + props, key, scale)
    bpy.data.objects.remove(arm)
    print('band', key, 'tris', triangles(body), 'joints', len(joints), 'frames', len(frames), 'height', round(height, 2), '->', spec['height'])
    clip = {'name': spec['clip'], 'rows': rows, 'seconds': seconds(start, end)}
    return {'key': key, 'role': role, 'objects': [body], 'meshes': {'mesh': key}, 'joints': len(joints), 'height': spec['height'], 'clips': [clip]}


# ---------------------------------------------------------------- the crowd
def load_clips():
    """The crowd loops: each file is a skeleton with one action."""
    clips = []
    for name, file in CROWD_CLIPS.items():
        path = os.path.abspath(os.path.join(args.src, file))
        if not os.path.exists(path):
            print('skip loop', name, '(no file)')
            continue
        arm, _ = import_fbx(path)
        action = arm.animation_data.action
        action.name = 'loop_' + name
        action.use_fake_user = True
        start, end = (int(round(v)) for v in action.frame_range)
        hips = (arm.matrix_world @ arm.data.bones[PREFIX + 'Hips'].matrix_local).translation.z
        clips.append({'name': name, 'action': action, 'start': start, 'end': end, 'hips': hips})
        bpy.data.objects.remove(arm)
    return clips


def paint(obj, klass):
    """The texture, sampled into a colour per face corner; alpha says which garment this is."""
    me = obj.data
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    pixels = {}
    for slot in obj.material_slots:
        img = base_image(slot.material)
        if img and img.name not in pixels:
            shrink(img, 256)
            buf = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
            img.pixels.foreach_get(buf)
            pixels[img.name] = buf.reshape(img.size[1], img.size[0], 4)
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    uv = me.uv_layers[0].data if me.uv_layers else None
    for poly in me.polygons:
        img = base_image(obj.material_slots[poly.material_index].material) if obj.material_slots else None
        px = pixels.get(img.name) if img else None
        for li in poly.loop_indices:
            rgb = (0.5, 0.5, 0.5)
            if px is not None and uv is not None:
                u, v = uv[li].uv
                h, w = px.shape[:2]
                rgb = px[min(h - 1, int((v % 1.0) * h)), min(w - 1, int((u % 1.0) * w)), :3]
            col.data[li].color = (lin(float(rgb[0])), lin(float(rgb[1])), lin(float(rgb[2])), klass)
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = me.color_attributes.find('Col')
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.materials.clear()
    me.materials.append(simple_material('Crowd'))
    for poly in me.polygons:
        poly.material_index = 0
        poly.use_smooth = True


def reduce(obj, target):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('reduce', 'DECIMATE')
    mod.ratio = min(1.0, target / max(1, triangles(obj)))
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)


def process_crowd(key, target_height, clips):
    path = os.path.abspath(os.path.join(args.src, key + '.fbx'))
    if not os.path.exists(path):
        print('skip', key, '(no file)')
        return None
    arm, meshes = import_fbx(path)
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    kinds = {}
    parts = []
    for o in meshes:
        low = o.name.lower()
        if 'lash' in low or 'leash' in low:
            bpy.data.objects.remove(o)
            continue
        klass = CLASS_TOP if any(k in low for k in TOP) else CLASS_BOTTOM if any(k in low for k in BOTTOM) else CLASS_NONE
        kinds[o.name] = klass
        paint(o, klass)
        detach(o)
        parts.append(o)
    near = join(parts, key)
    height = max(v.co.z for v in near.data.vertices)
    scale = target_height / height
    far = near.copy()
    far.data = near.data.copy()
    scene.collection.objects.link(far)
    far.name = far.data.name = key + '_far'
    reduce(near, args.near)
    reduce(far, args.far)
    bones = {b.name for b in arm.data.bones}
    weights = {o.name: top_weights(o, bones, fold) for o in (near, far)}
    used = {n for ws in weights.values() for pairs in ws for n, _ in pairs}
    joints = [None] + [b.name for b in arm.data.bones if b.name in used]
    joint_of = {n: i for i, n in enumerate(joints)}
    arm.data.pose_position = 'POSE'
    hips = (arm.matrix_world @ arm.data.bones[PREFIX + 'Hips'].matrix_local).translation.z
    ad = arm.animation_data or arm.animation_data_create()
    baked = []
    for c in clips:
        ad.action = c['action']
        if getattr(ad, 'action_slot', None) is None and c['action'].slots:
            ad.action_slot = c['action'].slots[0]
        frames = list(range(c['start'], c['end'], args.crowd_step))
        baked.append({'name': c['name'], 'rows': bake_clip(arm, joints, frames, hips_ratio=hips / c['hips'], scale=scale), 'seconds': seconds(c['start'], c['end'])})
    for o in (near, far):
        prepare_mesh(o, weights[o.name], joint_of)
        o.data.transform(Matrix.Scale(scale, 4))
    bpy.data.objects.remove(arm)
    print('crowd', key, 'tris', triangles(near), triangles(far), 'joints', len(joints), 'height', round(height, 2), '->', target_height,
          'parts', {n: k for n, k in kinds.items()})
    return {'key': key, 'objects': [near, far], 'meshes': {'mesh': key, 'far': key + '_far'}, 'joints': len(joints), 'height': target_height, 'clips': baked}


# ---------------------------------------------------------------- output
def write_set(name, done, extra, vertex_colours):
    if not done:
        print('nothing for', name)
        return
    width = max(d['joints'] for d in done)
    total = sum(len(c['rows']) for d in done for c in d['clips'])
    data = np.zeros((total, width, 3, 4), dtype=np.float32)
    data[:, :, 0, 0] = data[:, :, 1, 1] = data[:, :, 2, 2] = 1.0
    characters, row = {}, 0
    for d in done:
        clips = []
        for c in d['clips']:
            for i, mats in enumerate(c['rows']):
                for j, m in enumerate(mats):
                    data[row + i, j] = [list(m[r]) for r in range(3)]
            # A loop's length in beats at 120 bpm: the game plays it once per that many beats.
            clips.append({'name': c['name'], 'start': row, 'frames': len(c['rows']), 'beats': round(c['seconds'] * 2, 3)})
            row += len(c['rows'])
        characters[d['key']] = {**d['meshes'], 'joints': d['joints'], 'height': round(d['height'], 3), 'clips': clips}
    data.astype('<f2').tofile(os.path.join(args.out, name + '.bin'))
    with open(os.path.join(args.out, name + '.json'), 'w') as f:
        json.dump({'version': 2, 'joints': width, 'frames': total, 'characters': characters, **extra}, f, separators=(',', ':'))
    bpy.ops.object.select_all(action='DESELECT')
    for d in done:
        for o in d['objects']:
            o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, name + '.glb'), export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_animations=False, export_skins=False,
                              export_vertex_color='ACTIVE' if vertex_colours else 'NONE', export_all_vertex_colors=False,
                              export_active_vertex_color_when_no_material=True,
                              export_image_format='AUTO', export_image_quality=85, export_cameras=False, export_lights=False)
    print(name, list(characters), 'rows', total, 'joints', width,
          'files', {n: os.path.getsize(os.path.join(args.out, n)) for n in (name + '.glb', name + '.bin', name + '.json')})


os.makedirs(args.out, exist_ok=True)
if args.only in ('', 'band'):
    band = [d for d in (process_band(role, spec) for role, spec in BAND.items()) if d]
    write_set('band', band, {'band': {d['role']: {'character': d['key'], 'clip': d['clips'][0]['name']} for d in band}}, False)
if args.only in ('', 'crowd'):
    loops = load_clips()
    crowd = [d for d in (process_crowd(key, h, loops) for key, h in CROWD.items()) if d] if loops else []
    write_set('crowd', crowd, {'loops': [c['name'] for c in loops]}, True)
