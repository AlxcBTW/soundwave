"""
Builds the band and the crowd from openly licensed characters and bakes them for the game.

    blender -b --factory-startup -P tools/stage/aurora/build_cast.py -- \
        --src local-audio/open-characters --out public/stage/aurora

Everything that goes in is CC0 (public domain), so the result is part of the repository:

- the people: "Ultimate Modular Men" and "Ultimate Modular Women" by Quaternius (quaternius.com),
  the versions on a plain humanoid skeleton;
- one crowd loop, the dance, taken from the "Universal Animation Library" by Quaternius and fitted
  to those skeletons;
- everything else is made here: the other crowd loops (clap, headbang, cheer, fist pump, jumping)
  and the band's four loops are written as motion in this file, to the beat, with the hands and
  feet solved onto their targets; the instruments are modelled in instruments.py and fitted to
  each player here.

The packs themselves are not in the repository (they are large): download them from quaternius.com
and unpack each into its own folder under --src, as modular-men, modular-women and ual1. Only the
files this script names are read.

Two sets are written, each as <set>.glb, <set>.bin and <set>.json:

- band: the four musicians at full detail, each with its loop and its instrument;
- crowd: eight people reduced to a few hundred triangles (a nearer and a farther version), each
  with all six crowd loops.

A mesh is plain geometry in its rest pose that carries, per vertex, up to four joints and weights
(packed into two extra UV sets as joint + weight / 2) and its colour (alpha marks tops and bottoms
so the game can recolour them). The .bin holds one 3x4 matrix per joint per baked frame of each
loop (half floats, three.js space), so the game can skin thousands of instances in a vertex shader.
Every character is brought onto the same small skeleton of 24 joints; the four fingers move as one,
bending at two knuckles.

Axes: Z up, metres, characters face -Y (their left is +X).
"""
import argparse
import glob
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import instruments  # noqa: E402  (the band's instruments are modelled there)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--src', default='local-audio/open-characters')
ap.add_argument('--out', default='public/stage/aurora')
ap.add_argument('--near', type=int, default=1700, help='triangles of a crowd figure near a camera')
ap.add_argument('--far', type=int, default=520, help='triangles of a crowd figure far away')
ap.add_argument('--only', default='', help='band or crowd: build just that set')
args = ap.parse_args(argv)

# The band: which character plays what, and how tall they stand.
BAND = {
    'lead': {'key': 'riff', 'pack': 'modular-men', 'file': 'Punk', 'clip': 'guitar', 'height': 1.80},
    'bass': {'key': 'pulse', 'pack': 'modular-women', 'file': 'Punk', 'clip': 'bass', 'height': 1.70},
    'vox': {'key': 'aria', 'pack': 'modular-women', 'file': 'Formal', 'clip': 'sing', 'height': 1.72},
    'drums': {'key': 'kick', 'pack': 'modular-men', 'file': 'Casual', 'clip': 'drums', 'height': 1.78},
}
# The crowd: key, pack, file, height.
CROWD = [
    ('m_tee', 'modular-men', 'Casual2', 1.80), ('m_beach', 'modular-men', 'Beach', 1.76), ('m_hood', 'modular-men', 'Casual', 1.83),
    ('m_trek', 'modular-men', 'Adventurer', 1.78), ('w_casual', 'modular-women', 'Casual', 1.68), ('w_suit', 'modular-women', 'Suit', 1.72),
    ('w_trek', 'modular-women', 'Adventurer', 1.64), ('w_dress', 'modular-women', 'Formal', 1.66),
]
# Parts of a pack's characters that are props, not people.
DROP = ('backpack', 'pistol', 'sword', 'gun', 'icosphere')
# Materials that are the person, not their clothes: the game never recolours those.
PERSON = ('skin', 'hair', 'eye', 'brow', 'beard', 'earring', 'mouth', 'teeth', 'lip', 'mustache', 'moustache')
CLASS_TOP, CLASS_BOTTOM, CLASS_NONE = 1.0, 0.7, 0.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
# Blender to three.js: (x, y, z) -> (x, z, -y)
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
CI = C.inverted()
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
IDENT = Quaternion()
TAU = 2 * math.pi
FRAMES_PER_BEAT = 12

# ---------------------------------------------------------------- the skeleton everything is brought onto
JOINTS = ['hips', 'spine', 'chest', 'upper', 'neck', 'head',
          'clav_l', 'uarm_l', 'larm_l', 'hand_l', 'fingers_l', 'clav_r', 'uarm_r', 'larm_r', 'hand_r', 'fingers_r',
          'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r', 'tips_l', 'tips_r']
PARENT = {'spine': 'hips', 'chest': 'spine', 'upper': 'chest', 'neck': 'upper', 'head': 'neck',
          'clav_l': 'upper', 'uarm_l': 'clav_l', 'larm_l': 'uarm_l', 'hand_l': 'larm_l', 'fingers_l': 'hand_l',
          'clav_r': 'upper', 'uarm_r': 'clav_r', 'larm_r': 'uarm_r', 'hand_r': 'larm_r', 'fingers_r': 'hand_r',
          'thigh_l': 'hips', 'shin_l': 'thigh_l', 'foot_l': 'shin_l', 'thigh_r': 'hips', 'shin_r': 'thigh_r', 'foot_r': 'shin_r',
          'tips_l': 'fingers_l', 'tips_r': 'fingers_r'}
# The bone that carries on from each limb bone: its direction at rest is what gets matched between skeletons.
NEXT = {'uarm_l': 'larm_l', 'larm_l': 'hand_l', 'uarm_r': 'larm_r', 'larm_r': 'hand_r',
        'thigh_l': 'shin_l', 'shin_l': 'foot_l', 'thigh_r': 'shin_r', 'shin_r': 'foot_r'}


def sided(table):
    out = {}
    for k, v in table.items():
        if k.endswith('_l'):
            out[k] = v
            out[k[:-2] + '_r'] = v.replace('.L', '.R').replace('_l', '_r').replace('.l', '.r')
        else:
            out[k] = v
    return out


# Which bone of each skeleton is which joint.
MODULAR = sided({'hips': 'Hips', 'spine': 'Abdomen', 'chest': 'Torso', 'upper': 'Chest', 'neck': 'Neck', 'head': 'Head',
                 'clav_l': 'Shoulder.L', 'uarm_l': 'UpperArm.L', 'larm_l': 'LowerArm.L', 'hand_l': 'Hand.L',
                 'thigh_l': 'UpperLeg.L', 'shin_l': 'LowerLeg.L', 'foot_l': 'Foot.L'})
UAL = sided({'hips': 'pelvis', 'spine': 'spine_01', 'chest': 'spine_02', 'upper': 'spine_03', 'neck': 'neck_01', 'head': 'Head',
             'clav_l': 'clavicle_l', 'uarm_l': 'upperarm_l', 'larm_l': 'lowerarm_l', 'hand_l': 'hand_l',
             'thigh_l': 'thigh_l', 'shin_l': 'calf_l', 'foot_l': 'foot_l'})
FINGERS = ('index', 'middle', 'ring', 'pinky')


def found(pattern):
    hits = sorted(glob.glob(os.path.join(os.path.abspath(args.src), pattern)))
    return hits[0] if hits else None


def use_action(arm, action):
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = action
    if getattr(ad, 'action_slot', None) is None and getattr(action, 'slots', None):
        ad.action_slot = action.slots[0]


# ---------------------------------------------------------------- loops taken from the motion libraries
def sample(path, mapping, action_name, rows):
    """
    One loop of a library, as `rows` evenly spaced poses: for every joint how far it has turned from
    its rest (in world space), and where the hips are relative to theirs. Also the skeleton's rest
    positions, to match proportions and limb directions.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    action = bpy.data.actions[action_name]
    use_action(arm, action)
    start, end = action.frame_range
    world = arm.matrix_world
    rest = {j: (world @ arm.data.bones[b].matrix_local) for j, b in mapping.items()}
    rest_rot = {j: m.to_quaternion() for j, m in rest.items()}
    poses = []
    for i in range(rows):
        at = start + (end - start) * i / rows
        scene.frame_set(int(math.floor(at)), subframe=at - math.floor(at))
        turned = {j: (world @ arm.pose.bones[b].matrix).to_quaternion() @ rest_rot[j].inverted() for j, b in mapping.items()}
        hips = (world @ arm.pose.bones[mapping['hips']].matrix).translation - rest['hips'].translation
        ankles = min((world @ arm.pose.bones[mapping[f]].matrix).translation.z - rest[f].translation.z for f in ('foot_l', 'foot_r'))
        poses.append({'turned': turned, 'hips': hips.copy(), 'grounded': ankles < 0.04 * rest['hips'].translation.z})
    out = {'poses': poses, 'rest': {j: m.translation.copy() for j, m in rest.items()}}
    for o in new:
        bpy.data.objects.remove(o)
    return out


def fitted(loop, rig):
    """A library loop on a character's own skeleton: rows of (positions, turns)."""
    src = loop['rest']
    # Where a limb points at rest differs a little between skeletons: turn each to the library's.
    match = {}
    for j, nxt in NEXT.items():
        if j in src and nxt in src:
            match[j] = rig.dir[j].rotation_difference((src[nxt] - src[j]).normalized())
    ratio = rig.rest['hips'].z / src['hips'].z
    n = len(loop['poses'])
    offsets = [p['hips'] * ratio for p in loop['poses']]
    # Keep the character on its mark: no drift over the loop, centred on where it stands on average.
    drift = offsets[-1] - offsets[0]
    drift.z = 0
    offsets = [o - drift * (i / max(1, n - 1)) for i, o in enumerate(offsets)]
    centre = sum(offsets, Vector()) / n
    out = []
    for p, off in zip(loop['poses'], offsets):
        D = {}
        for j in JOINTS:
            if j in p['turned']:
                D[j] = p['turned'][j] @ match.get(j, IDENT)
            elif j.startswith(('fingers', 'tips')):
                D[j] = D[PARENT[j]] @ Quaternion(Y, 0.4 if j.endswith('_l') else -0.4)
            else:
                D[j] = D[PARENT[j]]
        P = {'hips': rig.rest['hips'] + Vector((off.x - centre.x, off.y - centre.y, off.z))}
        for j in JOINTS[1:]:
            P[j] = P[PARENT[j]] + D[PARENT[j]] @ (rig.rest[j] - rig.rest[PARENT[j]])
        if p['grounded']:
            # Longer or shorter legs than the library's: stand the lower foot back on the ground.
            sink = min(P[f].z - rig.rest[f].z for f in ('foot_l', 'foot_r'))
            for j in JOINTS:
                P[j] = P[j] - Z * sink
        out.append((P, D))
    return out


# ---------------------------------------------------------------- loops written here
def two_bone(a, target, l1, l2, pole):
    """Where the middle joint and the end of a two-bone limb go for its end to reach `target`."""
    to = target - a
    d = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-3, to.length))
    n = to.normalized() if to.length > 1e-6 else -Z
    along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    side = pole - n * pole.dot(n)
    side = side.normalized() if side.length > 1e-6 else n.orthogonal().normalized()
    mid = a + n * along + side * math.sqrt(max(0.0, l1 * l1 - along * along))
    return mid, a + n * d


def solve(rig, c):
    """
    A pose from a few wishes: where the hips are and how they are turned, how the spine and the head
    lean, where each hand and foot should be (a point, or a point riding a joint as (joint, point at
    rest)), which way elbows and knees point, what a hand aims at, how far the fingers curl.
    """
    R = rig.rest
    D, P = {}, {}

    def place(j):
        P[j] = P[PARENT[j]] + D[PARENT[j]] @ (R[j] - R[PARENT[j]])

    def point(spec):
        if isinstance(spec, tuple):
            j, v = spec
            return P[j] + D[j] @ (v - R[j])
        return spec

    D['hips'] = c.get('hips_rot', IDENT)
    P['hips'] = R['hips'] + c.get('hips', Vector())
    step = IDENT.slerp(c.get('spine', IDENT), 1 / 3)
    for j in ('spine', 'chest', 'upper'):
        D[j] = step @ D[PARENT[j]]
        place(j)
    head = c.get('head', IDENT)
    D['neck'] = IDENT.slerp(head, 0.4) @ D['upper']
    place('neck')
    D['head'] = IDENT.slerp(head, 0.6) @ D['neck']
    place('head')
    for s, sx in (('l', 1.0), ('r', -1.0)):
        clav, ua, la, hand, fing = 'clav_' + s, 'uarm_' + s, 'larm_' + s, 'hand_' + s, 'fingers_' + s
        D[clav] = D['upper']
        place(clav)
        place(ua)
        l1, l2 = (R[la] - R[ua]).length, (R[hand] - R[la]).length
        target = point(c.get('hand_' + s, ('upper', R[ua] + Vector((sx * 0.1 * rig.s, -0.05 * rig.s, -(l1 + l2) * 0.97)))))
        elbow, wrist = two_bone(P[ua], target, l1, l2, c.get('elbow_' + s, Vector((sx * 0.4, 1.0, 0.0))))
        D[ua] = (D[clav] @ rig.dir[ua]).rotation_difference(elbow - P[ua]) @ D[clav]
        P[la] = elbow
        D[la] = (D[ua] @ rig.dir[la]).rotation_difference(wrist - elbow) @ D[ua]
        P[hand] = wrist
        D[hand] = D[la]
        aim = c.get('aim_' + s)
        if aim:
            axis, to = aim
            want = to[1] if isinstance(to, tuple) and to[0] == 'dir' else point(to) - wrist
            D[hand] = (D[la] @ axis).rotation_difference(want) @ D[la]
        place(fing)
        D[fing] = D[hand] @ Quaternion(Y, sx * c.get('curl_' + s, 0.4))
        # the fingers bend once more past the first knuckle, so a hand can close round what it holds
        place('tips_' + s)
        D['tips_' + s] = D[fing] @ Quaternion(Y, sx * 1.1 * c.get('curl_' + s, 0.4))
        thigh, shin, foot = 'thigh_' + s, 'shin_' + s, 'foot_' + s
        place(thigh)
        l1, l2 = (R[shin] - R[thigh]).length, (R[foot] - R[shin]).length
        knee, ankle = two_bone(P[thigh], point(c.get('foot_' + s, R[foot])), l1, l2, c.get('knee_' + s, Vector((sx * 0.12, -1.0, 0.1))))
        D[thigh] = (D['hips'] @ rig.dir[thigh]).rotation_difference(knee - P[thigh]) @ D['hips']
        P[shin] = knee
        D[shin] = (D[thigh] @ rig.dir[shin]).rotation_difference(ankle - knee) @ D[thigh]
        P[foot] = ankle
        D[foot] = c.get('foot_rot_' + s, IDENT)
    return P, D


def on(b):
    """1 on the beat, 0 half way to the next."""
    return 0.5 + 0.5 * math.cos(TAU * b)


def lean(pitch=0.0, roll=0.0, yaw=0.0):
    """Forward, to the character's left, and turning left, in degrees."""
    return Quaternion(Z, math.radians(yaw)) @ Quaternion(Y, math.radians(roll)) @ Quaternion(X, math.radians(pitch))


def clap(b, rig):
    s, R = rig.s, rig.rest
    gap = (0.035 + 0.17 * (1 - on(b)) ** 0.8) * s
    mid = R['upper'] + Vector((0, -0.3, -0.03)) * s
    return {'hips': Vector((0.02 * s * math.sin(math.pi * b), 0, -0.03 * s * on(b))), 'spine': lean(3, 3 * math.sin(math.pi * b)),
            'head': lean(4 * on(b)),
            'hand_l': ('upper', mid + X * gap), 'hand_r': ('upper', mid - X * gap),
            'elbow_l': Vector((0.7, 0.3, -1)), 'elbow_r': Vector((-0.7, 0.3, -1)),
            'aim_l': (-Z, ('dir', Vector((-1, 0, 0.25)))), 'aim_r': (-Z, ('dir', Vector((1, 0, 0.25)))), 'curl_l': 0.15, 'curl_r': 0.15}


def cheer(b, rig):
    """Arms up, clapping over the head on every beat, swaying from foot to foot."""
    s, R = rig.s, rig.rest
    sway = math.sin(TAU * b / 4)
    gap = (0.04 + 0.2 * (1 - on(b)) ** 0.8) * s
    mid = Vector((0.05 * s * sway, R['uarm_l'].y - 0.07 * s, R['uarm_l'].z + 0.36 * s))
    return {'hips': Vector((0.04 * s * sway, 0, -0.03 * s * on(b))), 'spine': lean(-3, 4 * sway), 'head': lean(-9, -3 * sway),
            'hand_l': ('upper', mid + X * gap), 'hand_r': ('upper', mid - X * gap),
            'elbow_l': Vector((1, 0.1, -0.3)), 'elbow_r': Vector((-1, 0.1, -0.3)),
            'aim_l': (-Z, ('dir', Vector((-1, 0, 0.1)))), 'aim_r': (-Z, ('dir', Vector((1, 0, 0.1)))), 'curl_l': 0.1, 'curl_r': 0.1}


def headbang(b, rig):
    s = rig.s
    down = on(b) ** 1.5
    swing = math.sin(math.pi * b)
    return {'hips': Vector((0, 0.03 * s * down, -0.055 * s * down)), 'spine': lean(7 + 20 * down, 2 * swing), 'head': lean(6 + 22 * down),
            'hand_l': ('upper', rig.rest['uarm_l'] + Vector((0.12, -0.12 - 0.05 * down, -0.5)) * s),
            'hand_r': ('upper', rig.rest['uarm_r'] + Vector((-0.12, -0.12 - 0.05 * down, -0.5)) * s), 'curl_l': 0.9, 'curl_r': 0.9}


def fistpump(b, rig):
    s, R = rig.s, rig.rest
    up = on(b)
    return {'hips': Vector((0.015 * s * math.sin(math.pi * b), 0, 0.03 * s * up - 0.025 * s)), 'spine': lean(-2, -3 * math.sin(math.pi * b)),
            'head': lean(-5 * up),
            'hand_r': ('upper', R['uarm_r'] + Vector((-0.06, -0.1, 0.16 + 0.24 * up)) * s), 'elbow_r': Vector((-1, 0.3, -0.3)), 'curl_r': 1.5,
            'hand_l': ('upper', R['uarm_l'] + Vector((0.1, -0.15, -0.3)) * s), 'elbow_l': Vector((0.8, 0.6, -0.2)), 'curl_l': 0.9}


def excited(b, rig):
    s, R = rig.s, rig.rest
    jump = abs(math.sin(math.pi * b)) ** 1.2 * 0.14 * s
    wave = math.sin(TAU * b / 2)
    feet = Z * (jump * 0.92)
    return {'hips': Vector((0, 0, jump - 0.05 * s * on(b) ** 2)), 'spine': lean(-4, 2 * wave), 'head': lean(-8),
            'hand_l': ('upper', R['uarm_l'] + Vector((0.1 + 0.07 * wave, -0.06, 0.36 + 0.05 * math.sin(TAU * b))) * s),
            'hand_r': ('upper', R['uarm_r'] + Vector((-0.1 + 0.07 * wave, -0.06, 0.36 - 0.05 * math.sin(TAU * b))) * s),
            'elbow_l': Vector((1, 0.2, -0.2)), 'elbow_r': Vector((-1, 0.2, -0.2)), 'curl_l': 0.2, 'curl_r': 0.2,
            'foot_l': R['foot_l'] + feet, 'foot_r': R['foot_r'] + feet}


def strings(bass):
    def play(b, rig):
        s, R, g = rig.s, rig.rest, rig.gear
        fret = g['body'] + g['along'] * (g['nut'] - 0.16 + 0.07 * math.sin(TAU * b / 4)) + g['front'] * 0.035 * s
        stroke = 0.022 * math.sin(TAU * b * 2) if bass else 0.06 * math.sin(TAU * b)
        pick = g['body'] - g['along'] * 0.03 * s + g['front'] * 0.07 * s + g['across'] * stroke * s
        sway = math.sin(TAU * b / 4)
        return {'hips': Vector((0.03 * s * sway, 0, -0.035 * s * on(b))), 'hips_rot': lean(yaw=4 * sway),
                'spine': lean(-3 + 4 * on(b)), 'head': lean(4 + (9 if bass else 6) * on(b), yaw=8 * sway),
                'hand_l': ('chest', fret), 'hand_r': ('chest', pick), 'elbow_l': Vector((0.5, 0.4, -1)), 'elbow_r': Vector((-1, 0.8, 0.1)),
                'aim_l': (-Z, ('dir', Vector((-0.2, -0.3, 1)))), 'curl_l': 1.3, 'curl_r': 0.8,
                'foot_l': R['foot_l'] + X * 0.07 * s, 'foot_r': R['foot_r'] - X * 0.07 * s}
    return play


def sing(b, rig):
    s, R, g = rig.s, rig.rest, rig.gear
    sway = math.sin(TAU * b / 4)
    slow = math.sin(TAU * b / 8)
    return {'hips': Vector((0.045 * s * sway, 0, -0.025 * s * on(b))), 'hips_rot': lean(yaw=8 * slow),
            'spine': lean(-2, 4 * sway), 'head': lean(-6 + 4 * math.sin(TAU * b / 2), -5 * sway),
            'hand_r': ('head', g['mouth'] + Vector((-0.035, -0.1, -0.13)) * s), 'aim_r': (-Y, ('head', g['mouth'])),
            'elbow_r': Vector((-0.8, 0.2, -0.6)), 'curl_r': 1.4,
            'hand_l': ('upper', R['uarm_l'] + Vector((0.22 + 0.1 * slow, -0.22 - 0.06 * math.cos(TAU * b / 4), -0.18 + 0.16 * math.sin(TAU * b / 8 + 1.0))) * s),
            'elbow_l': Vector((0.6, 0.5, -0.8)), 'curl_l': 0.5}


def drums(b, rig):
    s, R, g = rig.s, rig.rest, rig.gear
    # the left hand keeps time on the hi-hat; the right goes between the ride and the snare
    tick = 0.1 * abs(math.sin(TAU * b)) ** 0.7
    blow = 0.2 * abs(math.sin(math.pi * b)) ** 0.7
    k = 0.5 + 0.5 * math.cos(math.pi * b)
    k = k * k * (3 - 2 * k)
    hit = g['snare'].lerp(g['ride'], k)
    tip_l, tip_r = g['hat'] + Z * tick * s, hit + Z * blow * s
    # a stick is held a forearm's length back from where it lands, coming in from the player's side
    back_l = Vector((-0.04, 0.32, 0.06)) * s
    back_r = Vector((-0.2, 0.25, 0.08)).lerp(Vector((0.05, 0.32, 0.06)), k) * s
    # the right foot works the bass drum pedal on the beat
    kick = 0.02 * s * (1 - on(b)) ** 2
    return {'hips': Vector((0, 0.07 * s, g['seat'] - R['hips'].z - 0.012 * s * on(b))), 'spine': lean(6 + 3 * on(b)),
            'head': lean(2 + 8 * on(b), yaw=6 * math.sin(TAU * b / 4)),
            'hand_l': tip_l + back_l + Z * 0.45 * tick * s, 'hand_r': tip_r + back_r + Z * 0.45 * blow * s,
            'aim_l': (-Y, tip_l), 'aim_r': (-Y, tip_r), 'elbow_l': Vector((0.8, 0.5, -0.5)), 'elbow_r': Vector((-0.8, 0.5, -0.5)),
            'curl_l': 1.45, 'curl_r': 1.45,
            'foot_l': g['foot_l'] + Z * (R['foot_l'].z + 0.03 * s), 'foot_r': g['foot_r'] + Z * (R['foot_r'].z + 0.03 * s + kick),
            'knee_l': Vector((0.55, -1, 0.5)), 'knee_r': Vector((-0.3, -1, 0.5))}


def written(rig, move, beats):
    return [solve(rig, move(beats * i / (beats * FRAMES_PER_BEAT), rig)) for i in range(beats * FRAMES_PER_BEAT)]


def rows_of(rig, poses, close=False):
    """Skinning matrices (rest to pose, three.js axes) per row; joint 0 stays at rest."""
    rows = []
    for P, D in poses:
        mats = [Matrix.Identity(4)]
        for j in JOINTS:
            mats.append(C @ (Matrix.Translation(P[j]) @ D[j].to_matrix().to_4x4() @ Matrix.Translation(-rig.rest[j])) @ CI)
        rows.append(mats)
    if close:
        # Ease the last frames into the first so a captured loop closes without a pop.
        n = len(rows)
        blend = min(4, n // 4)
        for k in range(blend):
            t = (k + 1) / (blend + 1)
            i = n - blend + k
            rows[i] = [a.lerp(b, t * 0.85) for a, b in zip(rows[i], rows[0])]
    return rows


# ---------------------------------------------------------------- characters
class Rig:
    """A character at its final size: its parts, and where its joints are at rest."""


def fold(bone, names):
    """Which of the joints a bone of a character's skeleton belongs to."""
    b = bone
    while b is not None:
        if b.name in names:
            return names[b.name]
        low = b.name.lower()
        side = '_l' if low.endswith('.l') else '_r' if low.endswith('.r') else None
        if side and low.startswith(FINGERS):
            # past the first knuckle the fingers bend again
            return ('tips' if b.parent and b.parent.name.lower().startswith(FINGERS) else 'fingers') + side
        if side and low.startswith(('thumb', 'wrist')):
            return 'hand' + side
        b = b.parent
    return 'hips'


def load(pack, file, height):
    path = found('%s/files/*/Humanoid Rig*/Individual Characters/FBX/%s.fbx' % (pack, file))
    if not path:
        print('missing', pack, file)
        return None
    before = set(bpy.data.objects)
    bpy.ops.wm.fbx_import(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    meshes = []
    for o in new:
        if o.type == 'MESH' and not any(k in o.name.lower() for k in DROP):
            meshes.append(o)
        elif o is not arm:
            bpy.data.objects.remove(o)
    names = {bone: joint for joint, bone in MODULAR.items()}
    world = arm.matrix_world
    head = {b.name: world @ b.head_local for b in arm.data.bones}
    rig = Rig()
    rig.s = height / 1.8
    # The pack's people differ in hair and hats: size them by where the head sits, not by the top of the hat.
    scale = height / (head[MODULAR['head']].z * 1.135)
    rig.scale = scale
    rig.rest = {j: head[MODULAR[j]] * scale for j in MODULAR}
    for s in ('l', 'r'):
        knuckles = [head[b.name] for b in arm.data.bones if b.name.lower().endswith('.' + s) and b.name.lower().startswith(FINGERS)
                    and not (b.parent and b.parent.name.lower().startswith(FINGERS))]
        hand = arm.data.bones[MODULAR['hand_' + s]]
        rig.rest['fingers_' + s] = (sum(knuckles, Vector()) / len(knuckles) if knuckles else world @ hand.tail_local) * scale
        second = [head[b.name] for b in arm.data.bones if b.name.lower().endswith('.' + s) and b.name.lower().startswith(FINGERS)
                  and b.parent and b.parent.name.lower().startswith(FINGERS) and not (b.parent.parent and b.parent.parent.name.lower().startswith(FINGERS))]
        rig.rest['tips_' + s] = sum(second, Vector()) / len(second) * scale if second else rig.rest['fingers_' + s] + (rig.rest['fingers_' + s] - rig.rest['hand_' + s]) * 0.4
    rig.dir = {j: (rig.rest[n] - rig.rest[j]).normalized() for j, n in NEXT.items()}
    rig.bone_joint = {b.name: fold(b, names) for b in arm.data.bones}
    rig.arm, rig.meshes = arm, meshes
    return rig


def weights_of(obj, rig):
    """Per vertex the four strongest (joint, weight), normalized."""
    groups = [g.name for g in obj.vertex_groups]
    out = []
    for v in obj.data.vertices:
        acc = {}
        for g in v.groups:
            j = rig.bone_joint.get(groups[g.group])
            if j and g.weight > 1e-4:
                acc[j] = acc.get(j, 0.0) + g.weight
        ws = sorted(((w, j) for j, w in acc.items()), reverse=True)[:4]
        total = sum(w for w, _ in ws) or 1.0
        out.append([(j, w / total) for w, j in ws] or [('hips', 1.0)])
    return out


def paint(obj, material):
    """Each face's material colour becomes a colour per corner; alpha says which garment it is."""
    me = obj.data
    low = obj.name.lower()
    part = CLASS_TOP if 'body' in low else CLASS_BOTTOM if ('legs' in low or 'pants' in low) else CLASS_NONE
    looks = []
    for slot in obj.material_slots:
        m = slot.material
        pr = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m and m.node_tree else None
        rgb = tuple(pr.inputs['Base Color'].default_value[:3]) if pr else (0.3, 0.3, 0.3)
        looks.append((rgb, CLASS_NONE if m and any(k in m.name.lower() for k in PERSON) else part))
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly in me.polygons:
        rgb, klass = looks[poly.material_index] if looks else ((0.3, 0.3, 0.3), CLASS_NONE)
        for li in poly.loop_indices:
            col.data[li].color = (*rgb, klass)
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = me.color_attributes.find('Col')
    me.materials.clear()
    me.materials.append(material)
    for poly in me.polygons:
        poly.material_index = 0


def pack_weights(obj, weights):
    """An empty first UV set, then the joints and weights packed into two more."""
    me = obj.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='UVMap').data.foreach_set('uv', [0.0] * (2 * len(me.loops)))
    w0 = me.uv_layers.new(name='W0')
    w1 = me.uv_layers.new(name='W1')
    for loop in me.loops:
        pairs = weights[loop.vertex_index]
        # joint 0 is the one that never moves: things that just stand there ride it
        packed = [(JOINTS.index(j) + 1 if j else 0) + 0.5 * min(w, 1.0) for j, w in pairs] + [0.0] * (4 - len(pairs))
        # glTF stores v flipped; write 1 - value so the file holds the value itself.
        w0.data[loop.index].uv = (packed[0], 1.0 - packed[1])
        w1.data[loop.index].uv = (packed[2], 1.0 - packed[3])


def detach(obj):
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mw


def join(parts, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(parts) > 1:
        bpy.ops.object.join()
    body = parts[0]
    body.name = body.data.name = name
    return body


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def reduce(obj, target):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('reduce', 'DECIMATE')
    mod.ratio = min(1.0, target / max(1, triangles(obj)))
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)


def soften(obj, degrees):
    """Smooth shading that keeps the creases of these faceted models."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    limit = math.radians(degrees)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0.0) > limit)
    bm.to_mesh(obj.data)
    bm.free()


MATERIALS = {}


def plain(name, color=(1, 1, 1)):
    if name not in MATERIALS:
        m = bpy.data.materials.new(name)
        pr = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        pr.inputs['Base Color'].default_value = (*color, 1)
        MATERIALS[name] = m
    return MATERIALS[name]


def body_of(rig, key, material):
    """The character's parts as one mesh at its final size, painted, each vertex knowing its joints."""
    rig.arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    weights = {}
    for o in rig.meshes:
        weights[o.name] = weights_of(o, rig)
        paint(o, material)
        detach(o)
        # carry the weights through the join as vertex groups of the joints
        o.vertex_groups.clear()
        made = {j: o.vertex_groups.new(name=j) for j in JOINTS}
        for i, pairs in enumerate(weights[o.name]):
            for j, w in pairs:
                made[j].add([i], w, 'REPLACE')
    body = join(rig.meshes, key)
    body.data.transform(Matrix.Scale(rig.scale, 4))
    bpy.data.objects.remove(rig.arm)
    return body


def joints_from_groups(obj):
    names = [g.name for g in obj.vertex_groups]
    out = []
    for v in obj.data.vertices:
        ws = sorted(((g.weight, names[g.group]) for g in v.groups if g.weight > 1e-4), reverse=True)[:4]
        total = sum(w for w, _ in ws) or 1.0
        out.append([(j, w / total) for w, j in ws] or [('hips', 1.0)])
    return out


# ---------------------------------------------------------------- instruments (built at the rest pose)
def props(name, parts, joint):
    """What was modelled, as one rigid object per kind of surface, riding one joint (None: it stays where it is)."""
    out = []
    for kind in parts.KINDS:
        bm = parts.bm[kind]
        if bm.faces:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new('%s_%s' % (name, kind))
            bm.to_mesh(me)
            me.materials.append(plain('Prop' + kind.title()))
            me.color_attributes.active_color = me.color_attributes['Col']
            me.color_attributes.render_color_index = me.color_attributes.find('Col')
            o = bpy.data.objects.new(me.name, me)
            scene.collection.objects.link(o)
            soften(o, 42)
            pack_weights(o, [[(joint, 1.0)]] * len(me.vertices))
            out.append(o)
        bm.free()
    return out


def string_instrument(rig, key, bass, wearer):
    """A guitar or bass slung across the player: body at the right hip, neck up to the left."""
    s, R = rig.s, rig.rest
    along = Vector((0.86, -0.1, 0.5)).normalized()
    front = (-Y - along * (-Y).dot(along)).normalized()
    across = along.cross(front).normalized()
    body = R['hips'] + Vector((-0.1, -0.2, 0.22)) * s
    # the instrument's own frame: up the neck, toward the player's head, out of its front
    base = Matrix.Translation(body + front * 0.02 * s) @ Matrix((along, -across, front)).transposed().to_4x4()
    parts = instruments.Parts(base)
    nut = instruments.string_instrument(parts, bass, (0.02, 0.42, 0.7) if bass else (0.72, 0.03, 0.2))
    rig.gear = {'body': body, 'along': along, 'front': front, 'across': across, 'nut': nut}
    # the strap: from the upper horn over the left shoulder and round the back to the end of the body
    horn, tail = base @ Vector(instruments.STRAP_BASS if bass else instruments.STRAP_GUITAR), base @ Vector(((-0.21 if bass else -0.195) - 0.012, 0, -0.022))
    over = (R['neck'] + R['uarm_l']) / 2 + Z * 0.12 * s
    worn = instruments.Parts()
    instruments.strap(worn, [(horn, front)] + round_body(wearer, R['chest'], horn, over, tail) + [(tail, front)])
    return props(key + '_strings', parts, 'chest') + props(key + '_strap', worn, 'chest')


def round_body(wearer, middle, a, over, b, steps=26, off=0.009):
    """Points on the surface of `wearer`, from near `a` over `over` to near `b`, each with the way out there."""
    tree = BVHTree.FromObject(wearer, bpy.context.evaluated_depsgraph_get())
    n = (a - over).cross(b - over).normalized()
    c = middle - n * (middle - over).dot(n)
    e1 = (a - c).normalized()
    e2 = n.cross(e1)
    angle = lambda q: math.atan2((q - c).dot(e2), (q - c).dot(e1)) % TAU
    end = angle(b)
    # go round the way that passes over the shoulder
    sweep = end if angle(over) < end else end - TAU
    out = []
    for i in range(1, steps):
        t = sweep * i / steps
        d = e1 * math.cos(t) + e2 * math.sin(t)
        hit = tree.ray_cast(c + d * 0.6, -d, 0.6)[0]
        if hit is not None:
            out.append((hit + d * off, d))
    return out


def grip(rig, side):
    """The middle of a closed hand at rest, and the way a thing held in it points (out past the thumb)."""
    hand, fingers = rig.rest['hand_' + side], rig.rest['fingers_' + side]
    return hand.lerp(fingers, 0.8) - Z * 0.025 * rig.s, -Y


def microphone(rig, key):
    s = rig.s
    rig.gear = {'mouth': rig.rest['head'] + Vector((0, -0.13, 0.055)) * s}
    at, d = grip(rig, 'r')
    parts = instruments.Parts(instruments.frame(at, d))
    instruments.microphone(parts)
    return props(key + '_mic', parts, 'hand_r')


def drum_kit(rig, key):
    """A kit round the seated drummer, and a stick in each hand."""
    s = rig.s
    o = Vector((rig.rest['hips'].x, rig.rest['hips'].y, 0))
    parts = instruments.Parts(Matrix.Translation(o) @ Matrix.Scale(s, 4))
    g = instruments.drum_kit(parts)
    rig.gear = {'seat': g['seat'] * s, **{k: o + g[k] * s for k in ('hat', 'snare', 'ride')},
                **{k: o + Vector((g[k][0], g[k][1], 0)) * s for k in ('foot_l', 'foot_r')}}
    out = props(key + '_kit', parts, None)
    for side in ('l', 'r'):
        at, d = grip(rig, side)
        held = instruments.Parts(instruments.frame(at - d * 0.075 * s, d) @ Matrix.Scale(s, 4))
        instruments.stick(held)
        out += props('%s_stick_%s' % (key, side), held, 'hand_' + side)
    return out


# ---------------------------------------------------------------- the two sets
def build_band(role, spec):
    rig = load(spec['pack'], spec['file'], spec['height'])
    if not rig:
        return None
    key = spec['key']
    body = body_of(rig, key, plain('Cast'))
    soften(body, 38)
    pack_weights(body, joints_from_groups(body))
    props = {'guitar': lambda: string_instrument(rig, key, False, body), 'bass': lambda: string_instrument(rig, key, True, body),
             'sing': lambda: microphone(rig, key), 'drums': lambda: drum_kit(rig, key)}[spec['clip']]()
    move, beats = {'guitar': (strings(False), 4), 'bass': (strings(True), 4), 'sing': (sing, 8), 'drums': (drums, 4)}[spec['clip']]
    rows = rows_of(rig, written(rig, move, beats))
    body = join([body] + props, key)
    print('band', key, 'tris', triangles(body), 'rows', len(rows))
    return {'key': key, 'role': role, 'objects': [body], 'meshes': {'mesh': key}, 'height': spec['height'],
            'clips': [{'name': spec['clip'], 'rows': rows, 'beats': beats}]}


def build_crowd(key, pack, file, height, loops):
    rig = load(pack, file, height)
    if not rig:
        return None
    near = body_of(rig, key, plain('Crowd'))
    for poly in near.data.polygons:
        poly.use_smooth = True
    far = near.copy()
    far.data = near.data.copy()
    scene.collection.objects.link(far)
    far.name = far.data.name = key + '_far'
    reduce(near, args.near)
    reduce(far, args.far)
    for o in (near, far):
        pack_weights(o, joints_from_groups(o))
    clips = [{'name': 'dance', 'rows': rows_of(rig, fitted(loops['dance'], rig), close=True), 'beats': 2},
             {'name': 'clap', 'rows': rows_of(rig, written(rig, clap, 2)), 'beats': 2},
             {'name': 'headbang', 'rows': rows_of(rig, written(rig, headbang, 2)), 'beats': 2},
             {'name': 'cheer', 'rows': rows_of(rig, written(rig, cheer, 4)), 'beats': 4},
             {'name': 'fistpump', 'rows': rows_of(rig, written(rig, fistpump, 2)), 'beats': 2},
             {'name': 'excited', 'rows': rows_of(rig, written(rig, excited, 2)), 'beats': 2}]
    print('crowd', key, 'tris', triangles(near), triangles(far))
    return {'key': key, 'objects': [near, far], 'meshes': {'mesh': key, 'far': key + '_far'}, 'height': height, 'clips': clips}


def write_set(name, done, extra):
    if not done:
        print('nothing for', name)
        return
    width = len(JOINTS) + 1
    total = sum(len(c['rows']) for d in done for c in d['clips'])
    data = np.zeros((total, width, 3, 4), dtype=np.float32)
    characters, row = {}, 0
    for d in done:
        clips = []
        for c in d['clips']:
            for i, mats in enumerate(c['rows']):
                for j, m in enumerate(mats):
                    data[row + i, j] = [list(m[r]) for r in range(3)]
            # The game plays a loop once per `beats` beats.
            clips.append({'name': c['name'], 'start': row, 'frames': len(c['rows']), 'beats': c['beats']})
            row += len(c['rows'])
        characters[d['key']] = {**d['meshes'], 'joints': width, 'height': round(d['height'], 3), 'clips': clips}
    data.astype('<f2').tofile(os.path.join(args.out, name + '.bin'))
    with open(os.path.join(args.out, name + '.json'), 'w') as f:
        json.dump({'version': 2, 'joints': width, 'frames': total, 'characters': characters, **extra}, f, separators=(',', ':'))
    bpy.ops.object.select_all(action='DESELECT')
    for d in done:
        for o in d['objects']:
            o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, name + '.glb'), export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_animations=False, export_skins=False,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
                              export_cameras=False, export_lights=False)
    print(name, list(characters), 'rows', total, 'joints', width,
          'files', {n: os.path.getsize(os.path.join(args.out, n)) for n in (name + '.glb', name + '.bin', name + '.json')})


args.out = os.path.abspath(args.out)
os.makedirs(args.out, exist_ok=True)
if args.only in ('', 'band'):
    band = [d for d in (build_band(role, spec) for role, spec in BAND.items()) if d]
    write_set('band', band, {'band': {d['role']: {'character': d['key'], 'clip': d['clips'][0]['name']} for d in band}})
    for d in band:
        for o in d['objects']:
            bpy.data.objects.remove(o)
if args.only in ('', 'crowd'):
    # The library's dance, sampled to the number of rows its length in beats asks for.
    ual = found('ual1/files/*/Unreal-Godot/UAL1_Standard.glb')
    if ual:
        library = {'dance': sample(ual, UAL, 'Dance_Loop', 2 * FRAMES_PER_BEAT)}
        crowd = [d for d in (build_crowd(*who, library) for who in CROWD) if d]
        # sync: every loop is made to the beat, so the game keeps everyone on it
        write_set('crowd', crowd, {'sync': True})
    else:
        print('missing the animation library: no crowd')
