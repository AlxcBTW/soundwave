"""
Builds the people of the venue (crowd figures and the band) and bakes their animation loops.

    blender -b --factory-startup -P tools/stage/aurora/build_figures.py -- --out public/stage/aurora

A figure is a jointed doll: smooth rounded parts (head, chest, hips, upper and lower arms and legs,
a prop), each riding one joint. The loops are posed here with a small rig (torso rotations, two-bone
reach for hands and feet) and baked to one matrix per joint per frame, so the game can animate
thousands of instances in a vertex shader from a single small texture.

Output: figures.glb (the meshes; uv.x = colour region, uv.y = joint), figures.bin (float32, per
frame and joint a 3x4 matrix in three.js space) and figures.json (the loops and meshes).

Axes: Z up, metres, a figure stands at the origin facing -Y (the crowd side of the stage).
"""
import argparse
import json
import math
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', default='public/stage/aurora')
ap.add_argument('--save', default='')
args = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# joints
HIPS, CHEST, HEAD, UARM_L, FARM_L, UARM_R, FARM_R, THIGH_L, SHIN_L, THIGH_R, SHIN_R, PROP, STATIC = range(13)
JOINTS = 13
# colour regions
SKIN, TOP, BOTTOM, SHOES, HAIR, PROP_A, PROP_B, GLOW = range(8)

# rest pose (the character's left is +X)
HIP_C = Vector((0, 0, 0.96))
WAIST = Vector((0, 0, 1.06))
NECK = Vector((0, 0, 1.5))
SHOULDER = {1: Vector((0.215, 0, 1.43)), -1: Vector((-0.215, 0, 1.43))}
HIPJ = {1: Vector((0.095, 0, 0.92)), -1: Vector((-0.095, 0, 0.92))}
UPPER, FORE = 0.28, 0.27
THIGH, SHIN = 0.43, 0.45
DOWN = Vector((0, 0, -1))
FRAMES_PER_BEAT = 16


# =================================================================== MESHES
def tag(faces, uv, region, joint):
    for f in faces:
        f.smooth = True
        for loop in f.loops:
            loop[uv].uv = ((region + 0.5) / 8, (joint + 0.5) / 16)


def capsule(bm, a, b, ra, rb, segs, caps):
    """A tapered capsule from a to b. Returns its faces."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    length = axis.length
    rot = axis.to_track_quat('Z', 'Y').to_matrix()
    prof = [(-ra * math.sin(math.pi / 2 * i / caps), ra * math.cos(math.pi / 2 * i / caps)) for i in range(caps, 0, -1)]
    prof += [(0.0, ra), (length, rb)]
    prof += [(length + rb * math.sin(math.pi / 2 * i / caps), rb * math.cos(math.pi / 2 * i / caps)) for i in range(1, caps + 1)]
    rings = []
    for z, r in prof:
        if r < 1e-5:
            rings.append([bm.verts.new(a + rot @ Vector((0, 0, z)))])
        else:
            rings.append([bm.verts.new(a + rot @ Vector((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), z))) for k in range(segs)])
    faces = []
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(segs):
            k2 = (k + 1) % segs
            if len(r0) == 1:
                faces.append(bm.faces.new((r0[0], r1[k2], r1[k])))
            elif len(r1) == 1:
                faces.append(bm.faces.new((r0[k], r0[k2], r1[0])))
            else:
                faces.append(bm.faces.new((r0[k], r0[k2], r1[k2], r1[k])))
    return faces


def ellipsoid(bm, center, radii, segs, rings, rot=None):
    m = Matrix.Translation(center) @ (rot.to_matrix().to_4x4() if rot else Matrix.Identity(4)) @ Matrix.Diagonal((*radii, 1))
    res = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=m)
    return list({f for v in res['verts'] for f in v.link_faces})


def barrel(bm, z0, z1, width, depth, segs, rings, power=2.8, y_of=None):
    """A rounded body between two heights: superellipse sections, domed ends."""
    levels = []
    for i in range(rings + 1):
        s = i / rings
        dome = math.sin(math.pi * min(1.0, max(0.0, s / 0.16))/ 2) if s < 0.16 else (math.sin(math.pi * min(1.0, (1 - s) / 0.16) / 2) if s > 0.84 else 1.0)
        levels.append((z0 + (z1 - z0) * s, width(s) * dome, depth(s) * dome, (y_of(s) if y_of else 0.0)))
    e = 2.0 / power
    out = []
    for z, w, d, y in levels:
        if w < 1e-5:
            out.append([bm.verts.new((0, y, z))])
        else:
            ring = []
            for k in range(segs):
                c, s_ = math.cos(2 * math.pi * k / segs), math.sin(2 * math.pi * k / segs)
                ring.append(bm.verts.new((math.copysign(abs(c) ** e, c) * w / 2, y + math.copysign(abs(s_) ** e, s_) * d / 2, z)))
            out.append(ring)
    faces = []
    for r0, r1 in zip(out, out[1:]):
        for k in range(segs):
            k2 = (k + 1) % segs
            if len(r0) == 1:
                faces.append(bm.faces.new((r0[0], r1[k2], r1[k])))
            elif len(r1) == 1:
                faces.append(bm.faces.new((r0[k], r0[k2], r1[0])))
            else:
                faces.append(bm.faces.new((r0[k], r0[k2], r1[k2], r1[k])))
    return faces


def cylinder(bm, a, b, r, segs=16, r2=None):
    a, b = Vector(a), Vector(b)
    axis = b - a
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=axis.length,
                                matrix=Matrix.Translation((a + b) / 2) @ axis.to_track_quat('Z', 'Y').to_matrix().to_4x4())
    return list({f for v in res['verts'] for f in v.link_faces})


def figure(name, detail, hair='short', sleeves=True, prop=None):
    """detail: -1 = crowd seen from afar, 0 = crowd near a camera, 1 = band."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    segs, caps = {-1: (4, 1), 0: (6, 1), 1: (14, 4)}[detail]
    su, sv = {-1: (6, 4), 0: (8, 6), 1: (22, 14)}[detail]
    around = 6 if detail < 0 else max(8, segs)
    # legs and shoes
    for side, thigh, shin in ((1, THIGH_L, SHIN_L), (-1, THIGH_R, SHIN_R)):
        j = HIPJ[side]
        knee = j + DOWN * THIGH
        ankle = knee + DOWN * SHIN
        tag(capsule(bm, j, knee, 0.088, 0.07, segs, caps), uv, BOTTOM, thigh)
        tag(capsule(bm, knee, ankle + Vector((0, 0, 0.03)), 0.068, 0.055, segs, caps), uv, BOTTOM, shin)
        tag(ellipsoid(bm, ankle + Vector((0, -0.055, 0.005)), (0.058, 0.125, 0.052), su, max(4, sv - 2)), uv, SHOES, shin)
    # hips and chest
    tag(barrel(bm, 0.84, 1.1, lambda s: 0.33, lambda s: 0.21, around, 5), uv, BOTTOM, HIPS)
    tag(barrel(bm, 1.03, 1.51, lambda s: 0.3 + 0.13 * s ** 0.8, lambda s: 0.19 + 0.045 * math.sin(math.pi * s), around, 10 if detail > 0 else 6), uv, TOP, CHEST)
    if detail >= 0:
        tag(capsule(bm, (0, 0, 1.46), (0, 0, 1.56), 0.055, 0.05, segs, 1), uv, SKIN, CHEST)
    # arms
    for side, upper, fore in ((1, UARM_L, FARM_L), (-1, UARM_R, FARM_R)):
        s = SHOULDER[side]
        elbow = s + DOWN * UPPER
        wrist = elbow + DOWN * FORE
        tag(capsule(bm, s, elbow, 0.062, 0.05, segs, caps), uv, TOP if sleeves else SKIN, upper)
        tag(capsule(bm, elbow, wrist + (DOWN * 0.06 if detail < 0 else Vector()), 0.048, 0.04, segs, caps), uv, SKIN, fore)
        if detail >= 0:
            tag(ellipsoid(bm, wrist + DOWN * 0.045, (0.045, 0.036, 0.06), su, max(4, sv - 2)), uv, SKIN, fore)
    # head and hair
    hc = Vector((0, -0.01, 1.665))
    tag(ellipsoid(bm, hc, (0.112, 0.122, 0.138), su, sv), uv, SKIN, HEAD)
    if hair == 'short':
        tag(ellipsoid(bm, hc + Vector((0, 0.022, 0.03)), (0.12, 0.124, 0.13), su, sv), uv, HAIR, HEAD)
    elif hair == 'long':
        tag(ellipsoid(bm, hc + Vector((0, 0.025, 0.028)), (0.124, 0.128, 0.134), su, sv), uv, HAIR, HEAD)
        tag(barrel(bm, 1.38, 1.72, lambda s: 0.23 + 0.03 * s, lambda s: 0.11, around, 5, power=2.4, y_of=lambda s: 0.085 - 0.02 * s), uv, HAIR, HEAD)
    elif hair == 'cap':
        tag(ellipsoid(bm, hc + Vector((0, 0.008, 0.045)), (0.122, 0.13, 0.115), su, sv), uv, TOP, HEAD)
        tag(ellipsoid(bm, hc + Vector((0, -0.13, 0.03)), (0.085, 0.085, 0.012), su, 4), uv, TOP, HEAD)
    if detail > 0:
        for sx in (-1, 1):
            tag(ellipsoid(bm, hc + Vector((sx * 0.042, -0.112, 0.022)), (0.011, 0.008, 0.015), 10, 6), uv, PROP_B, HEAD)
    if prop == 'guitar':
        tilt = Euler((0, math.radians(-30), 0))
        c = Vector((-0.05, -0.2, 1.0))
        tag(ellipsoid(bm, c, (0.2, 0.04, 0.155), 24, 12, tilt), uv, PROP_A, PROP)
        tag(ellipsoid(bm, c + tilt.to_matrix() @ Vector((-0.12, 0, 0)), (0.15, 0.042, 0.19), 24, 12, tilt), uv, PROP_A, PROP)
        d = tilt.to_matrix() @ Vector((1, 0, 0))
        tag(capsule(bm, c + d * 0.1, c + d * 0.72, 0.022, 0.018, 8, 2), uv, PROP_B, PROP)
        tag(ellipsoid(bm, c + d * 0.76, (0.07, 0.016, 0.03), 12, 6, tilt), uv, PROP_B, PROP)
        tag(ellipsoid(bm, c + Vector((0.0, -0.035, 0)), (0.06, 0.012, 0.045), 12, 6, tilt), uv, GLOW, PROP)
        # strap
        tag(capsule(bm, c + d * 0.2 + Vector((0, 0.03, 0)), Vector((-0.2, 0.06, 1.47)), 0.012, 0.012, 6, 1), uv, PROP_B, CHEST)
    if prop == 'mic':
        hand = Vector((-0.07, -0.21, 1.47))
        mouth = Vector((0, -0.14, 1.63))
        d = (mouth - hand).normalized()
        tag(capsule(bm, hand - d * 0.07, hand + d * 0.1, 0.014, 0.017, 8, 2), uv, PROP_B, PROP)
        tag(ellipsoid(bm, hand + d * 0.125, (0.03, 0.03, 0.034), 12, 8), uv, PROP_A, PROP)
    if prop == 'drums':
        shell = lambda fs: tag(fs, uv, PROP_A, STATIC)
        metal = lambda fs: tag(fs, uv, PROP_B, STATIC)
        metal(cylinder(bm, (0, 0.02, 0.5), (0, 0.02, 0.57), 0.17))
        metal(cylinder(bm, (0, 0.02, 0.0), (0, 0.02, 0.5), 0.03, 8))
        shell(cylinder(bm, (0, -0.55, 0.3), (0, -1.0, 0.3), 0.29, 24))
        tag(cylinder(bm, (0, -1.0, 0.3), (0, -1.012, 0.3), 0.26, 24), uv, GLOW, STATIC)
        shell(cylinder(bm, (0.26, -0.42, 0.5), (0.26, -0.42, 0.64), 0.18, 20))
        shell(cylinder(bm, (-0.5, -0.32, 0.28), (-0.5, -0.32, 0.6), 0.21, 20))
        for sx in (-1, 1):
            shell(cylinder(bm, (sx * 0.19, -0.74, 0.7), (sx * 0.19, -0.82, 0.86), 0.145, 20))
            metal(cylinder(bm, (sx * 0.66, -0.8, 0.0), (sx * 0.66, -0.8, 1.22), 0.014, 6))
            tag(cylinder(bm, (sx * 0.66, -0.8, 1.22), (sx * 0.655, -0.79, 1.235), 0.24, 24, 0.02), uv, GLOW, STATIC)
        metal(cylinder(bm, (0.56, -0.38, 0.0), (0.56, -0.38, 0.86), 0.014, 6))
        tag(cylinder(bm, (0.56, -0.38, 0.86), (0.56, -0.38, 0.875), 0.17, 20), uv, GLOW, STATIC)
        for leg in ((0.26, -0.42), (-0.5, -0.32)):
            metal(cylinder(bm, (leg[0], leg[1], 0.0), (leg[0], leg[1], 0.3), 0.014, 6))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MAT)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


MAT = bpy.data.materials.new('Figure')
MESHES = [
    figure('CrowdA', 0, hair='short', sleeves=True),
    figure('CrowdB', 0, hair='long', sleeves=False),
    figure('CrowdC', 0, hair='cap', sleeves=True),
    figure('CrowdFarA', -1, hair='short', sleeves=True),
    figure('CrowdFarB', -1, hair='long', sleeves=False),
    figure('CrowdFarC', -1, hair='cap', sleeves=True),
    figure('Guitarist', 1, hair='long', sleeves=False, prop='guitar'),
    figure('Singer', 1, hair='short', sleeves=True, prop='mic'),
    figure('Drummer', 1, hair='cap', sleeves=False, prop='drums'),
]


# =================================================================== RIG
def pivot(point, rot):
    return Matrix.Translation(point) @ Euler(rot, 'XYZ').to_matrix().to_4x4() @ Matrix.Translation(-point)


def reach(root, target, l1, l2, pole):
    """Two-bone reach: the middle joint and the end point actually reached."""
    d = target - root
    dist = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-3, d.length))
    axis = d.normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    side = pole - axis * pole.dot(axis)
    if side.length < 1e-5:
        side = Vector((0, -1, 0))
    side.normalize()
    return root + axis * a + side * h, root + axis * dist


def segment(joint_world, to_world, joint_rest):
    """A part hanging down from `joint_rest`, now running from joint_world toward to_world."""
    rot = DOWN.rotation_difference((to_world - joint_world).normalized()).to_matrix().to_4x4()
    return Matrix.Translation(joint_world) @ rot @ Matrix.Translation(-joint_rest)


def solve(p):
    """Pose description to one matrix per joint."""
    m = [Matrix.Identity(4) for _ in range(JOINTS)]
    hips = Matrix.Translation(Vector(p.get('root', (0, 0, 0)))) @ pivot(HIP_C, p.get('hips', (0, 0, 0)))
    chest = hips @ pivot(WAIST, p.get('chest', (0, 0, 0)))
    head = chest @ pivot(NECK, p.get('head', (0, 0, 0)))
    m[HIPS], m[CHEST], m[HEAD] = hips, chest, head
    for side, upper, fore, key in ((1, UARM_L, FARM_L, 'hand_l'), (-1, UARM_R, FARM_R, 'hand_r')):
        s = chest @ SHOULDER[side]
        target = chest @ Vector(p.get(key, (side * 0.27, -0.03, 0.93)))
        pole = chest.to_3x3() @ Vector(p.get('elbow_' + key[-1], (side * 0.7, 0.5, -0.4)))
        elbow, hand = reach(s, target, UPPER, FORE, pole)
        m[upper] = segment(s, elbow, SHOULDER[side])
        m[fore] = segment(elbow, hand, SHOULDER[side] + DOWN * UPPER)
    for side, thigh, shin, key in ((1, THIGH_L, SHIN_L, 'foot_l'), (-1, THIGH_R, SHIN_R, 'foot_r')):
        j = hips @ HIPJ[side]
        target = Vector(p.get(key, (side * 0.11, 0, 0.04)))
        knee, ankle = reach(j, target, THIGH, SHIN, Vector(p.get('knee', (side * 0.25, -1, 0.1))))
        m[thigh] = segment(j, knee, HIPJ[side])
        m[shin] = segment(knee, ankle, HIPJ[side] + DOWN * THIGH)
    m[PROP] = chest
    return m


# =================================================================== LOOPS
TAU = 2 * math.pi
cosb = lambda ph, shift=0.0: 0.5 + 0.5 * math.cos(TAU * (ph - shift))


def bounce(ph):
    dip = cosb(ph)
    return {'root': (0, 0, -0.07 * dip), 'chest': (0.05 + 0.05 * dip, 0, 0), 'head': (0.12 * cosb(ph, 0.1), 0, 0),
            'hand_l': (0.25, -0.12, 1.0 + 0.05 * cosb(ph, 0.15)), 'hand_r': (-0.25, -0.12, 1.0 + 0.05 * cosb(ph, 0.15))}


def pump(ph):
    up = cosb(ph, 0.06)
    return {'root': (0, 0, -0.06 * cosb(ph)), 'chest': (0.02, 0, 0.1), 'head': (-0.08 + 0.08 * cosb(ph, 0.1), 0, 0),
            'hand_r': (-0.27, -0.2, 1.74 + 0.27 * up), 'elbow_r': (-1, 0.3, 0), 'hand_l': (0.25, -0.1, 0.98)}


def hands_up(ph):
    sway = math.sin(TAU * ph)
    return {'root': (0.05 * sway, 0, -0.04 * cosb(ph * 2)), 'chest': (-0.04, 0.12 * sway, 0), 'head': (-0.1, 0.05 * sway, 0),
            'hand_l': (0.27 + 0.2 * sway, -0.08, 2.0), 'hand_r': (-0.27 + 0.2 * sway, -0.08, 2.0), 'elbow_l': (1, 0.2, 0), 'elbow_r': (-1, 0.2, 0)}


def clap(ph):
    gap = 0.03 + 0.22 * (1 - cosb(ph)) ** 0.7
    return {'root': (0, 0, -0.05 * cosb(ph)), 'chest': (-0.03, 0, 0), 'head': (-0.12, 0, 0),
            'hand_l': (gap, -0.2, 1.93), 'hand_r': (-gap, -0.2, 1.93), 'elbow_l': (1, 0.1, -0.2), 'elbow_r': (-1, 0.1, -0.2)}


def jump(ph):
    s = min(1.0, max(0.0, (ph - 0.12) / 0.62))
    air = 4 * s * (1 - s)
    crouch = cosb(ph, 0.02) ** 3
    lift = 0.26 * air
    return {'root': (0, 0, lift - 0.12 * crouch), 'chest': (0.1 * crouch - 0.05 * air, 0, 0), 'head': (-0.1 * air, 0, 0),
            'foot_l': (0.11, 0.02 * air, 0.04 + lift * 0.92), 'foot_r': (-0.11, 0.02 * air, 0.04 + lift * 0.92),
            'hand_l': (0.3, -0.1, 1.86 + 0.18 * air), 'hand_r': (-0.3, -0.1, 1.86 + 0.18 * air), 'elbow_l': (1, 0.2, 0), 'elbow_r': (-1, 0.2, 0)}


def guitar(ph):
    rock = cosb(ph * 2)
    return {'root': (0, 0, -0.07 - 0.04 * rock), 'hips': (0, 0, -0.18), 'chest': (-0.1 + 0.09 * rock, 0, 0.06),
            'head': (0.12 + 0.2 * cosb(ph * 2, 0.08), 0, 0.12), 'foot_l': (0.24, -0.05, 0.04), 'foot_r': (-0.2, 0.06, 0.04),
            'hand_l': (0.44, -0.24, 1.3), 'elbow_l': (0.6, 0.3, -0.8),
            'hand_r': (-0.04, -0.29, 1.02 + 0.07 * math.sin(TAU * ph * 4)), 'elbow_r': (-1, 0.5, -0.1)}


def sing(ph):
    sway = math.sin(TAU * ph)
    return {'root': (0.05 * sway, 0, -0.03 * cosb(ph * 4)), 'chest': (-0.06, 0.07 * sway, 0.05 * sway), 'head': (-0.1 + 0.05 * math.sin(TAU * ph * 2), 0, 0),
            'foot_l': (0.16, 0, 0.04), 'foot_r': (-0.16, 0, 0.04),
            'hand_r': (-0.07, -0.21, 1.47), 'elbow_r': (-0.8, 0.2, -0.6),
            'hand_l': (0.36 + 0.1 * sway, -0.26 - 0.08 * math.cos(TAU * ph), 1.22 + 0.34 * cosb(ph, 0.25)), 'elbow_l': (0.8, 0.4, -0.5)}


def drums(ph):
    hit_r = max(0.0, math.sin(TAU * ph * 4)) ** 0.6
    hit_l = max(0.0, math.sin(TAU * ph * 2 + math.pi * 0.5)) ** 0.6
    return {'root': (0, 0.02, -0.33 - 0.015 * cosb(ph * 2)), 'chest': (0.14 + 0.03 * cosb(ph * 2), 0, 0.04 * math.sin(TAU * ph)),
            'head': (0.05 + 0.14 * cosb(ph * 2, 0.06), 0, 0), 'foot_l': (0.2, -0.4, 0.05), 'foot_r': (-0.2, -0.42, 0.05 + 0.03 * cosb(ph * 2)),
            'knee': (0, -1, 0.6), 'hand_r': (-0.38, -0.36, 1.0 + 0.2 * hit_r), 'elbow_r': (-1, 0.4, -0.3),
            'hand_l': (0.25, -0.42, 1.0 + 0.22 * hit_l), 'elbow_l': (1, 0.4, -0.3)}


# name, pose function, length in beats
CLIPS = [('bounce', bounce, 1), ('pump', pump, 1), ('hands_up', hands_up, 2), ('clap', clap, 1), ('jump', jump, 1),
         ('guitar', guitar, 2), ('sing', sing, 4), ('drums', drums, 2)]

# Blender to three.js: (x, y, z) -> (x, z, -y)
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
CI = C.inverted()


def bake(out_dir):
    rows = bytearray()
    clips = []
    start = 0
    for name, fn, beats in CLIPS:
        frames = beats * FRAMES_PER_BEAT
        for f in range(frames):
            for m in solve(fn(f / frames)):
                t = C @ m @ CI
                for r in range(3):
                    rows += struct.pack('<4f', *t[r])
        clips.append({'name': name, 'start': start, 'frames': frames, 'beats': beats})
        start += frames
    with open(os.path.join(out_dir, 'figures.bin'), 'wb') as f:
        f.write(rows)
    return clips, start


os.makedirs(args.out, exist_ok=True)
clips, total = bake(args.out)
with open(os.path.join(args.out, 'figures.json'), 'w') as f:
    json.dump({'version': 1, 'joints': JOINTS, 'frames': total, 'clips': clips,
               'crowd': ['CrowdA', 'CrowdB', 'CrowdC'], 'crowdFar': ['CrowdFarA', 'CrowdFarB', 'CrowdFarC'], 'band': {'lead': 'Guitarist', 'bass': 'Guitarist', 'vox': 'Singer', 'drums': 'Drummer'}}, f, separators=(',', ':'))
if args.save:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save))
bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, 'figures.glb'), export_format='GLB', export_apply=True, export_yup=True,
                          export_texcoords=True, export_normals=True, export_animations=False, export_vertex_color='NONE',
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6, export_draco_texcoord_quantization=12)
print('figures', {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in MESHES}, 'frames', total)
