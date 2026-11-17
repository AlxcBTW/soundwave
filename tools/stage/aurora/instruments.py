"""
The band's instruments, modelled from measurements: a drum kit with its hardware, an electric guitar,
a bass, a hand-held microphone and a pair of sticks. build_cast.py fits them to each player.

Everything is made in metres at real size, in a frame handed in by the caller, and sorted by what
its surface is like: lacquer and polished wood ('paint'), things that do not shine ('matte': drum
heads, rubber, felt, fretboards) and bare metal ('metal': chrome and cymbal bronze). The colour is
painted per face. Every piece is a closed shell, so its faces can be turned outward afterwards.

Axes: Z up, players face -Y (their left is +X).
"""
import math

import bmesh
from mathutils import Matrix, Vector

TAU = 2 * math.pi
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

# Colours, linear.
CHROME = (0.74, 0.76, 0.8)
STEEL = (0.5, 0.52, 0.56)
BRONZE = (0.9, 0.58, 0.17)
BLACK = (0.012, 0.012, 0.015)
RUBBER = (0.025, 0.025, 0.028)
FELT = (0.11, 0.1, 0.1)
SKIN = (0.74, 0.72, 0.66)
WORN = (0.5, 0.48, 0.44)
MAPLE = (0.6, 0.4, 0.17)
ROSEWOOD = (0.05, 0.026, 0.016)
HICKORY = (0.66, 0.47, 0.24)
PEARL = (0.8, 0.8, 0.76)
VINYL = (0.03, 0.03, 0.035)


def frame(origin, axis, toward=None):
    """A frame at `origin` whose Z runs along `axis`; its X leans toward `toward` when given."""
    z = Vector(axis).normalized()
    if toward is None:
        return Matrix.Translation(origin) @ z.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    x = Vector(toward) - z * Vector(toward).dot(z)
    x = x.normalized() if x.length > 1e-6 else z.orthogonal().normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    return Matrix.Translation(origin) @ m


def shade(color, k):
    return tuple(min(1.0, c * k) for c in color)


def rounded(points, steps=4):
    """A closed outline through `points`, smoothed (Catmull-Rom)."""
    n = len(points)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = (Vector(points[(i + d) % n]) for d in (-1, 0, 1, 2))
        for s in range(steps):
            t = s / steps
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    return [(p.x, p.y) for p in out]


def inset(outline, d):
    """The outline moved inward by `d`."""
    n = len(outline)
    area = sum(outline[i][0] * outline[(i + 1) % n][1] - outline[(i + 1) % n][0] * outline[i][1] for i in range(n))
    turn = 1.0 if area > 0 else -1.0
    out = []
    for i in range(n):
        a, b, c = Vector(outline[i - 1]), Vector(outline[i]), Vector(outline[(i + 1) % n])
        e0, e1 = (b - a).normalized(), (c - b).normalized()
        n0, n1 = Vector((-e0.y, e0.x)) * turn, Vector((-e1.y, e1.x)) * turn
        m = n0 + n1
        m = m.normalized() if m.length > 1e-6 else n0
        k = d / max(0.5, m.dot(n0))
        out.append((b.x + m.x * k, b.y + m.y * k))
    return out


class Parts:
    """Geometry in one frame, sorted by surface, each face with its colour."""

    KINDS = ('paint', 'matte', 'metal')

    def __init__(self, base=None):
        self.base = base if base is not None else Matrix.Identity(4)
        self.bm = {k: bmesh.new() for k in self.KINDS}
        self.col = {k: self.bm[k].loops.layers.float_color.new('Col') for k in self.KINDS}

    def vert(self, kind, m, p):
        return self.bm[kind].verts.new(self.base @ (m @ Vector(p)))

    def face(self, kind, verts, color):
        try:
            f = self.bm[kind].faces.new(verts)
        except ValueError:
            return
        layer = self.col[kind]
        for loop in f.loops:
            loop[layer] = (color[0], color[1], color[2], 0.0)

    def lathe(self, kind, profile, m, color, segs=24, closed=False):
        """
        `profile`, points (radius, height), turned round the frame's Z. A point on the axis is a
        pole; an open end off the axis is closed flat; with `closed` the profile is a ring's
        cross-section. `color` is one colour or a function of (profile segment, step round).
        """
        rings = []
        for r, z in profile:
            if r < 1e-6:
                rings.append([self.vert(kind, m, (0, 0, z))])
            else:
                rings.append([self.vert(kind, m, (r * math.cos(TAU * k / segs), r * math.sin(TAU * k / segs), z)) for k in range(segs)])
        tint = color if callable(color) else (lambda i, k: color)
        spans = [(i, i + 1) for i in range(len(rings) - 1)] + ([(len(rings) - 1, 0)] if closed else [])
        for i, j in spans:
            a, b = rings[i], rings[j]
            for k in range(segs):
                k2 = (k + 1) % segs
                if len(a) == 1 and len(b) == 1:
                    continue
                if len(a) == 1:
                    self.face(kind, (a[0], b[k], b[k2]), tint(i, k))
                elif len(b) == 1:
                    self.face(kind, (a[k], a[k2], b[0]), tint(i, k))
                else:
                    self.face(kind, (a[k], a[k2], b[k2], b[k]), tint(i, k))
        if not closed:
            for ring, i in ((rings[0], 0), (rings[-1], len(rings) - 2)):
                if len(ring) > 1:
                    self.face(kind, ring, tint(i, 0))

    def tube(self, kind, a, b, r, color, segs=8, r2=None):
        a, b = Vector(a), Vector(b)
        if (b - a).length < 1e-6:
            return
        self.lathe(kind, [(r, 0.0), (r if r2 is None else r2, (b - a).length)], frame(a, b - a), color, segs)

    def path(self, kind, points, r, color, segs=6):
        for a, b in zip(points, points[1:]):
            self.tube(kind, a, b, r, color, segs)

    def ball(self, kind, center, r, color, segs=10, rings=5, squash=1.0):
        prof = [(r * math.sin(math.pi * i / rings), -r * squash * math.cos(math.pi * i / rings)) for i in range(rings + 1)]
        prof[0], prof[-1] = (0.0, -r * squash), (0.0, r * squash)
        self.lathe(kind, prof, Matrix.Translation(center), color, segs)

    def box(self, kind, size, m, color, taper=1.0):
        """A box centred in frame `m`; `taper` narrows its top (+Z) face."""
        sx, sy, sz = (v / 2 for v in size)
        vs = [self.vert(kind, m, (x * sx * (taper if z > 0 else 1.0), y * sy * (taper if z > 0 else 1.0), z * sz))
              for z in (-1, 1) for y in (-1, 1) for x in (-1, 1)]
        for quad in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            self.face(kind, [vs[i] for i in quad], color)

    def slab(self, kind, outline, m, z0, z1, color, bevel=0.0, edge=None):
        """A flat shape, points (x, y) in the frame's plane, from height z0 to z1, its rim rounded by `bevel`."""
        if bevel > 0:
            small = inset(outline, bevel)
            layers = [(small, z0), (outline, z0 + bevel), (outline, z1 - bevel), (small, z1)]
        else:
            layers = [(outline, z0), (outline, z1)]
        rings = [[self.vert(kind, m, (x, y, z)) for x, y in pts] for pts, z in layers]
        n = len(outline)
        for a, b in zip(rings, rings[1:]):
            for k in range(n):
                k2 = (k + 1) % n
                self.face(kind, (a[k], a[k2], b[k2], b[k]), edge or color)
        self.face(kind, rings[0], edge or color)
        self.face(kind, rings[-1], color)


# ---------------------------------------------------------------- drums
def drum(p, top, axis, r, depth, shell, lugs=8, rows=1, wood=None, batter=SKIN, reso=SKIN, turn=0.0, toward=None, kind='paint'):
    """
    A drum: its batter head faces along `axis` with its middle at `top`. Shell, both heads, a hoop
    on each, lugs on the shell and a tension rod from each lug to each hoop. `wood` gives hoops of
    that colour held by claws, as on a bass drum.
    """
    m = frame(top, axis, toward) @ Matrix.Rotation(turn, 4, 'Z')
    segs = 36 if r > 0.2 else 28
    # the heads: thin pucks, the batter with the mark the sticks leave
    worn = (lambda i, k: WORN if i == 0 else batter) if batter == SKIN else batter
    p.lathe('matte', [(0, 0), (r * 0.3, 0), (r - 0.011, 0), (r + 0.0015, -0.004), (r + 0.0015, -0.018), (0, -0.018)], m, worn, segs)
    if callable(reso):
        reso(m @ Matrix.Translation((0, 0, -depth)) @ Matrix.Rotation(math.pi, 4, 'X'))
    else:
        p.lathe('matte', [(0, -depth), (r - 0.011, -depth), (r + 0.0015, -depth + 0.004), (r + 0.0015, -depth + 0.018), (0, -depth + 0.018)], m, reso, segs)
    # the shell, with a little wall to it
    p.lathe(kind, [(r, -0.012), (r, -depth + 0.012), (r - 0.007, -depth + 0.012), (r - 0.007, -0.012)], m, shell, segs, closed=True)
    hoop_top = 0.009 if not wood else 0.012
    hoop_low = -0.016 if not wood else -0.034
    for sign, z0 in ((1, 0.0), (-1, -depth)):
        if wood:
            ring = [(r - 0.003, z0 + sign * hoop_top), (r + 0.015, z0 + sign * hoop_top), (r + 0.015, z0 + sign * hoop_low), (r - 0.003, z0 + sign * hoop_low)]
            p.lathe('paint', ring, m, lambda i, k: wood, segs, closed=True)
            # an inlay round the middle of the hoop
            zi = z0 + sign * (hoop_top + hoop_low) / 2
            p.lathe('paint', [(r + 0.0155, zi - 0.006), (r + 0.0155, zi + 0.006), (r + 0.012, zi + 0.006), (r + 0.012, zi - 0.006)], m, PEARL, segs, closed=True)
        else:
            ring = [(r + 0.003, z0 + sign * hoop_top), (r + 0.013, z0 + sign * hoop_top), (r + 0.013, z0 + sign * 0.004),
                    (r + 0.009, z0 + sign * 0.004), (r + 0.009, z0 + sign * hoop_low), (r + 0.003, z0 + sign * hoop_low)]
            p.lathe('metal', ring, m, CHROME, segs, closed=True)
    # lugs and tension rods
    length = min(0.07, depth * 0.36)
    heights = [-depth / 2] if rows == 1 else [-depth * 0.24, -depth * 0.76]
    if rows == 1 and depth > 0.2:
        length = min(0.11, depth * 0.3)
    for k in range(lugs):
        a = TAU * (k + 0.5) / lugs
        spin = m @ Matrix.Rotation(a, 4, 'Z')
        for z in heights:
            p.box('metal', (0.016, 0.022, length), spin @ Matrix.Translation((r + 0.008, 0, z)), CHROME, taper=0.75)
        rr = r + 0.011
        ends = [(heights[0] + length / 2, 0.006 if not wood else 0.0), (heights[-1] - length / 2, -depth - (0.006 if not wood else 0.0))]
        for z_lug, z_hoop in ends:
            p.tube('metal', spin @ Vector((rr, 0, z_lug)), spin @ Vector((rr + (0.008 if wood else 0.0), 0, z_hoop)), 0.0028, STEEL, 5)
        if wood:
            for sign, z0 in ((1, 0.0), (-1, -depth)):
                p.box('metal', (0.014, 0.022, 0.05), spin @ Matrix.Translation((r + 0.02, 0, z0 - sign * 0.008)), CHROME, taper=0.8)
        else:
            for sign, z0 in ((1, 0.0), (-1, -depth)):
                p.box('metal', (0.012, 0.016, 0.008), spin @ Matrix.Translation((r + 0.014, 0, z0 + sign * 0.005)), CHROME)
    return m


def cymbal(p, center, normal, r, seed=0, thickness=0.0024):
    """A lathed bronze cymbal: bell, bow and edge, its mounting hole at `center`, cup opening against `normal`."""
    m = frame(center, normal)
    rb, hb, hw = 0.2 * r, 0.085 * r, 0.105 * r
    radii = [0.006, rb * 0.45, rb * 0.8, rb] + [rb + (r - rb) * (i / 8) ** 0.92 for i in range(1, 9)]

    def height(q):
        if q <= rb:
            return hw + hb * max(0.0, math.cos(math.pi / 2 * q / rb)) ** 0.75 - (hw + hb)
        return hw * (1 - ((q - rb) / (r - rb)) ** 1.7) - (hw + hb)

    over = [(q, height(q)) for q in radii]
    under = [(q, height(q) - thickness) for q in reversed(radii)]
    n = len(radii)

    def tint(i, k):
        # lathing: every ring catches the light a little differently, and so does every direction
        ring = i if i < n else 2 * n - 2 - i
        grain = 0.5 + 0.5 * math.sin((k * 7 + seed * 13 + ring * 3) * 12.9898) * math.cos((k + seed) * 4.1)
        streak = 0.5 + 0.5 * math.cos(TAU * 2 * (k / 40) + seed)
        bright = (1.12 if ring < 3 else 0.9 + 0.12 * (ring % 2)) * (0.86 + 0.1 * grain + 0.16 * streak ** 3)
        return shade(BRONZE, bright if i < n else bright * 0.8)

    p.lathe('metal', over + under, m, tint, 40, closed=True)
    return m


def tripod(p, base, height, spread=0.3, r=0.012, turn=0.0, collar=0.36):
    """A stand's foot: a tube up from the floor on three double-braced legs. Gives the tube's top."""
    base = Vector((base[0], base[1], 0.0))
    top = base + Z * height
    p.tube('metal', base + Z * 0.05, top, r, CHROME, 10)
    for z in (collar, 0.1):
        p.tube('metal', base + Z * (z - 0.018), base + Z * (z + 0.018), r * 1.9, CHROME, 10)
    for k in range(3):
        a = turn + TAU * k / 3
        out = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-out.y, out.x, 0))
        foot = base + out * spread + Z * 0.016
        hip = base + out * r * 1.6 + Z * collar
        for off in (-0.007, 0.007):
            p.tube('metal', hip + side * off, foot + side * off, 0.0042, CHROME, 5)
        # the brace from the lower collar out to the leg
        p.tube('metal', base + out * r * 1.6 + Z * 0.1, hip.lerp(foot, 0.6), 0.0038, CHROME, 5)
        p.tube('matte', foot - out * 0.022 + Z * 0.004, foot + out * 0.022 - Z * 0.006, 0.014, RUBBER, 8)
    return top


def clamp(p, at, r=0.022, height=0.036):
    """A height or tilt adjuster on a stand, with its wing bolt."""
    at = Vector(at)
    p.tube('metal', at - Z * height / 2, at + Z * height / 2, r, CHROME, 10)
    p.box('metal', (0.012, 0.034, 0.014), Matrix.Translation(at + X * (r + 0.004)), CHROME)


def cymbal_stand(p, base, center, normal, r, seed=0, boom=True, turn=0.0):
    """A cymbal on its stand; with `boom` the stand's foot is at `base` and an arm reaches over."""
    normal = Vector(normal).normalized()
    center = Vector(center)
    seat = center - normal * 0.012
    if boom:
        post = tripod(p, base, center.z - 0.32, 0.32, 0.013, turn, collar=0.42)
        upper = post + Z * 0.16
        p.tube('metal', post, upper, 0.0095, CHROME, 8)
        clamp(p, post)
        clamp(p, upper, 0.02, 0.03)
        # the boom runs through its clamp, a short end sticking out behind
        aim = (seat - upper).normalized()
        p.tube('metal', upper - aim * 0.1, seat - normal * 0.05, 0.0075, CHROME, 8)
        p.tube('matte', upper - aim * 0.13, upper - aim * 0.1, 0.012, RUBBER, 8)
    else:
        foot = seat - normal * 0.07
        post = tripod(p, (foot.x, foot.y), foot.z - 0.24, 0.3, 0.013, turn, collar=0.4)
        clamp(p, post)
        p.tube('metal', post, foot, 0.0095, CHROME, 8)
    # tilter, felts either side of the cymbal, and the wing nut
    p.tube('metal', seat - normal * 0.07, seat - normal * 0.045, 0.014, CHROME, 8)
    p.tube('metal', seat - normal * 0.05, seat + normal * 0.05, 0.0035, STEEL, 6)
    p.tube('matte', seat - normal * 0.016, seat, 0.021, FELT, 10)
    p.tube('matte', seat + normal * 0.016, seat + normal * 0.03, 0.019, FELT, 10)
    p.box('metal', (0.036, 0.012, 0.01), frame(seat + normal * 0.037, normal), CHROME)
    cymbal(p, center, normal, r, seed)


def pedal(p, heel, toe, rise, width=0.085):
    """A footboard from the heel plate up to its far end, on its frame. Gives the board's far end."""
    heel, toe = Vector(heel), Vector(toe)
    along = (toe - heel).normalized()
    side = along.cross(Z).normalized()
    far = toe + Z * rise
    board = (far - (heel + Z * 0.022))
    m = frame((heel + Z * 0.022 + far) / 2, side.cross(board), along)
    p.box('metal', (board.length, width, 0.007), m, STEEL)
    # grip ribs across the board
    for k in range(5):
        p.box('metal', (0.006, width * 0.86, 0.004), m @ Matrix.Translation(((k - 2) * board.length * 0.17, 0, 0.005)), CHROME)
    p.box('metal', (0.07, width + 0.012, 0.02), frame(heel - along * 0.03 + Z * 0.011, Z, along), BLACK)
    for off in (-1, 1):
        p.tube('metal', heel + side * off * (width / 2 + 0.006) + Z * 0.006, toe + along * 0.03 + side * off * (width / 2 + 0.006) + Z * 0.006, 0.004, STEEL, 5)
    return far


def drum_kit(p):
    """
    A five-piece kit round a drummer sitting at the origin: bass drum, snare, two rack toms and a
    floor tom, hi-hat, ride and two crashes, pedals and a throne. Gives the points the playing
    is aimed at: where the sticks land, how high the seat is and where the feet rest.
    """
    shell = (0.1, 0.035, 0.42)
    shell_dark = (0.05, 0.018, 0.2)

    # throne
    post = tripod(p, (0, 0.07), 0.44, 0.27, 0.014, math.radians(90), collar=0.3)
    clamp(p, post - Z * 0.06)
    p.lathe('matte', [(0, 0.44), (0.13, 0.44), (0.168, 0.452), (0.178, 0.48), (0.17, 0.512), (0.13, 0.53), (0.06, 0.536), (0, 0.536)],
            Matrix.Translation((0, 0.07, 0)), lambda i, k: BLACK if i == 0 else VINYL, 28)

    # bass drum, lying along Y, its batter head toward the drummer
    kx, kr, kd = -0.2, 0.279, 0.44
    k_top = Vector((kx, -0.68, kr + 0.017))

    def front_head(m):
        # a black head with a ring on it
        tint = lambda i, k: PEARL if i in (2, 3) else BLACK
        p.lathe('matte', [(0, 0), (kr * 0.62, 0), (kr * 0.72, 0), (kr * 0.75, 0.0005), (kr * 0.78, 0), (kr - 0.011, 0), (kr + 0.0015, -0.004), (kr + 0.0015, -0.018), (0, -0.018)],
                m, tint, 36)

    drum(p, k_top, Y, kr, kd, shell, lugs=8, rows=2, wood=shell_dark, reso=front_head, toward=X)
    front = k_top.y - kd
    for sx in (-1, 1):
        # spurs out to the sides at the front
        a = Vector((kx + sx * 0.262, front + 0.1, k_top.z - 0.1))
        b = Vector((kx + sx * 0.4, front - 0.02, 0.012))
        p.box('metal', (0.03, 0.05, 0.045), frame(a, Vector((sx, 0, 0.2))), CHROME)
        p.tube('metal', a, b, 0.0065, CHROME, 6)
        p.tube('matte', b + (a - b).normalized() * 0.03, b - Z * 0.006, 0.011, RUBBER, 8)
    # bass drum pedal under the right foot
    heel = Vector((kx, -0.4, 0))
    far = pedal(p, heel, Vector((kx, k_top.y + 0.085, 0)), 0.075)
    axle = 0.2
    for off in (-1, 1):
        p.tube('metal', Vector((kx + off * 0.065, k_top.y + 0.06, 0.006)), Vector((kx + off * 0.065, k_top.y + 0.06, axle + 0.012)), 0.008, CHROME, 8)
    p.tube('metal', Vector((kx - 0.075, k_top.y + 0.06, axle)), Vector((kx + 0.075, k_top.y + 0.06, axle)), 0.007, CHROME, 8)
    p.tube('metal', Vector((kx - 0.022, k_top.y + 0.06, axle)), Vector((kx + 0.022, k_top.y + 0.06, axle)), 0.022, CHROME, 12)
    p.tube('metal', far + Z * 0.004, Vector((kx, k_top.y + 0.078, axle)), 0.0035, STEEL, 5)
    beater = Vector((kx, k_top.y + 0.032, k_top.z + 0.01))
    p.tube('metal', Vector((kx, k_top.y + 0.06, axle)), beater + Y * 0.006, 0.004, STEEL, 6)
    p.tube('matte', beater - Y * 0.018, beater + Y * 0.024, 0.026, (0.5, 0.48, 0.44), 12)
    p.box('metal', (0.11, 0.05, 0.02), Matrix.Translation((kx, k_top.y + 0.02, 0.012)), BLACK)

    # rack toms on a holder out of the bass drum, turned toward the drummer
    mount = Vector((kx - 0.01, k_top.y - 0.25, k_top.z + kr - 0.004))
    p.box('metal', (0.07, 0.09, 0.016), Matrix.Translation(mount + Z * 0.008), CHROME)
    hub = mount + Z * 0.19
    p.tube('metal', mount, hub, 0.0125, CHROME, 10)
    p.tube('metal', hub - Z * 0.02, hub + Z * 0.02, 0.022, CHROME, 10)
    toms = []
    for sx, r, depth, lean, yaw in ((1, 0.127, 0.19, 24, 10), (-1, 0.152, 0.22, 22, -12)):
        axis = (Matrix.Rotation(math.radians(yaw), 3, 'Z') @ Matrix.Rotation(math.radians(-lean), 3, 'X')) @ Z
        top = Vector((kx + sx * 0.185 + (0.0 if sx > 0 else -0.01), k_top.y - 0.19, 0.865))
        m = drum(p, top, axis, r, depth, shell, lugs=6, toward=X)
        middle = top - axis * depth / 2
        grab = middle + (hub - middle).normalized() * (r + 0.02)
        p.box('metal', (0.035, 0.03, 0.05), frame(grab, hub - middle, axis), CHROME)
        elbow = Vector((grab.x * 0.5 + hub.x * 0.5, hub.y, hub.z + 0.03))
        p.path('metal', [hub, elbow, grab], 0.0075, CHROME, 8)
        p.ball('metal', elbow, 0.014, CHROME)
        toms.append(top)

    # snare on its stand, between the knees
    s_top = Vector((0.03, -0.48, 0.77))
    drum(p, s_top, Z, 0.178, 0.14, STEEL, lugs=8, turn=0.2, kind='metal')
    post = tripod(p, (s_top.x, s_top.y), 0.46, 0.25, 0.013, math.radians(30), collar=0.3)
    clamp(p, post - Z * 0.07)
    under = s_top.z - 0.14 - 0.016
    for k in range(3):
        a = math.radians(90) + TAU * k / 3
        out = Vector((math.cos(a), math.sin(a), 0))
        hand = Vector((s_top.x, s_top.y, 0)) + out * 0.186 + Z * (under - 0.004)
        p.path('metal', [post, post.lerp(hand, 0.9) - Z * 0.012, hand], 0.006, CHROME, 6)
        p.tube('matte', hand - Z * 0.006, hand + Z * 0.03, 0.01, RUBBER, 8)

    # floor tom on three legs, by the right knee
    f_top = Vector((-0.57, -0.14, 0.67))
    fr, fd = 0.203, 0.4
    drum(p, f_top, Z, fr, fd, shell, lugs=8, rows=2, turn=0.3)
    for k in range(3):
        a = math.radians(40) + TAU * k / 3
        out = Vector((math.cos(a), math.sin(a), 0))
        at = Vector((f_top.x, f_top.y, 0)) + out * (fr + 0.024)
        p.box('metal', (0.022, 0.04, 0.05), frame(at + Z * (f_top.z - fd * 0.62), out, Z), CHROME)
        foot = at + out * 0.07 + Z * 0.014
        p.path('metal', [at + Z * (f_top.z - fd * 0.35), at + Z * 0.16, foot], 0.0052, CHROME, 6)
        p.tube('matte', foot + Z * 0.012, foot - Z * 0.01, 0.012, RUBBER, 8)

    # hi-hat: a pedal under the left foot, the two cymbals a finger apart
    hx, hy, hz = 0.35, -0.68, 0.89
    post = tripod(p, (hx, hy), 0.72, 0.28, 0.013, math.radians(-90), collar=0.34)
    clamp(p, post - Z * 0.02)
    p.tube('metal', post, Vector((hx, hy, hz - 0.03)), 0.0105, CHROME, 8)
    p.tube('metal', Vector((hx, hy, hz - 0.03)), Vector((hx, hy, hz + 0.2)), 0.0035, STEEL, 6)
    p.tube('matte', Vector((hx, hy, hz - 0.045)), Vector((hx, hy, hz - 0.03)), 0.024, FELT, 10)
    cymbal(p, Vector((hx, hy, hz - 0.028)), -Z, 0.178, seed=1)
    cymbal(p, Vector((hx, hy, hz + 0.052)), Z, 0.178, seed=2)
    p.tube('metal', Vector((hx, hy, hz + 0.054)), Vector((hx, hy, hz + 0.088)), 0.012, CHROME, 8)
    p.box('metal', (0.03, 0.01, 0.009), Matrix.Translation((hx, hy, hz + 0.094)), CHROME)
    far = pedal(p, Vector((hx, -0.4, 0)), Vector((hx, hy + 0.07, 0)), 0.07)
    p.tube('metal', far + Z * 0.004, Vector((hx, hy + 0.016, 0.26)), 0.003, STEEL, 5)

    # ride over the floor tom, crashes on boom stands at the front corners
    ride_n = (Vector((0.16, 0.3, 1.0))).normalized()
    ride_c = Vector((-0.66, -0.6, 0.99))
    cymbal_stand(p, None, ride_c, ride_n, 0.254, seed=3, boom=False, turn=math.radians(200))
    cymbal_stand(p, (0.62, -1.2), Vector((0.5, -1.02, 1.3)), Vector((-0.1, 0.28, 1.0)), 0.216, seed=4, turn=math.radians(-40))
    cymbal_stand(p, (-0.78, -1.26), Vector((-0.56, -1.12, 1.38)), Vector((0.1, 0.26, 1.0)), 0.229, seed=5, turn=math.radians(-120))

    toward = (Vector((0, 0.3, 0)) - ride_c)
    toward = (toward - ride_n * toward.dot(ride_n)).normalized()
    return {'seat': 0.62, 'hat': Vector((hx - 0.06, hy + 0.13, hz + 0.03)), 'snare': s_top + Vector((-0.01, 0.03, 0.012)),
            'ride': ride_c + toward * 0.15 - ride_n * 0.012, 'foot_l': (hx, -0.47), 'foot_r': (kx, -0.47)}


def stick(p):
    """A drumstick along +Z from the butt at the origin: shaft, taper and tip."""
    prof = [(0, 0), (0.0055, 0.001), (0.0074, 0.008), (0.0074, 0.27), (0.0058, 0.33), (0.0036, 0.375), (0.0034, 0.385),
            (0.0052, 0.392), (0.0056, 0.4), (0.004, 0.408), (0, 0.411)]
    p.lathe('paint', prof, Matrix.Identity(4), lambda i, k: shade(HICKORY, 0.82) if i > 5 else HICKORY, 8)


# ---------------------------------------------------------------- strings
BODY = [(-0.195, 0.0), (-0.188, 0.085), (-0.155, 0.148), (-0.095, 0.166), (-0.03, 0.14), (0.03, 0.118), (0.085, 0.128), (0.16, 0.15),
        (0.225, 0.152), (0.25, 0.128), (0.215, 0.098), (0.165, 0.072), (0.135, 0.036),
        (0.135, -0.036), (0.15, -0.075), (0.185, -0.1), (0.2, -0.128), (0.165, -0.145), (0.095, -0.13), (0.03, -0.118),
        (-0.03, -0.142), (-0.095, -0.166), (-0.155, -0.148), (-0.188, -0.085)]


# Where the strap is buttoned to the upper horn, in the instrument's frame.
STRAP_GUITAR = (0.243, 0.132, -0.022)
STRAP_BASS = (0.298, 0.137, -0.022)


def string_instrument(p, bass, color):
    """
    An electric guitar or bass in its own frame: X runs up the neck from the middle of the body, Y
    to the side the player's head is on, Z out of the front. Gives where the nut is along X.
    """
    scale = 0.864 if bass else 0.648
    strings = 4 if bass else 6
    bridge = -0.085 if bass else -0.07
    nut = bridge + scale
    thick = 0.044
    stretch = 1.1 if bass else 1.0
    outline = rounded([(x * stretch + (0.03 * (x > 0.14) if bass else 0.0), y * (1.04 if bass else 1.0)) for x, y in BODY], 4)
    ident = Matrix.Identity(4)
    # the body: lacquered front, darker toward the rim
    p.slab('paint', outline, ident, -thick, 0.0, color, 0.007, shade(color, 0.45))
    # pickguard on the lower half, under the strings
    guard = rounded([(-0.1, -0.02), (-0.12, -0.075), (-0.07, -0.128), (0.0, -0.1), (0.07, -0.108), (0.125, -0.09), (0.125, 0.03), (0.04, 0.05), (-0.05, 0.045)], 3)
    p.slab('paint', [(x * stretch, y) for x, y in guard], ident, -0.001, 0.0022, BLACK if not bass else PEARL)
    # pickups, bridge, controls
    span = 0.0105 * (strings - 1) * (1.75 if bass else 1.0) + 0.016
    for x in ((-0.015, 0.055) if not bass else (-0.01, 0.07)):
        p.box('metal', (0.038 if not bass else 0.03, span + 0.012, 0.008), Matrix.Translation((x * stretch, 0, 0.0055)), CHROME if not bass else BLACK)
        for k in range(strings):
            y = (k - (strings - 1) / 2) * (span - 0.016) / (strings - 1)
            p.tube('metal', (x * stretch, y, 0.009), (x * stretch, y, 0.0105), 0.0026, STEEL, 6)
    p.box('metal', (0.03, span + 0.016, 0.011), Matrix.Translation((bridge - 0.004, 0, 0.0055)), CHROME)
    if not bass:
        p.box('metal', (0.014, span + 0.03, 0.009), Matrix.Translation((bridge - 0.04, 0, 0.0045)), CHROME)
    for x, y in ((-0.115, -0.085), (-0.145, -0.05), (-0.075, -0.108)):
        p.lathe('metal', [(0.0115, 0.0), (0.0115, 0.008), (0.009, 0.0125), (0, 0.0125)], Matrix.Translation((x * stretch, y, 0.002)), BLACK if not bass else CHROME, 12)
    p.lathe('metal', [(0.009, 0.0), (0.009, 0.004), (0.0045, 0.006), (0.0045, 0.012), (0, 0.012)], Matrix.Translation((-0.165 * stretch, -0.02, 0.0)), CHROME, 10)
    # strap buttons
    p.tube('metal', (outline[0][0] + 0.002, 0, -thick / 2), (outline[0][0] - 0.012, 0, -thick / 2), 0.006, CHROME, 8)

    # neck: a flat fingerboard on a rounded back, from the body to the nut
    start = 0.1 * stretch
    w0, w1 = (0.064, 0.042) if bass else (0.056, 0.043)
    width = lambda x: w0 + (w1 - w0) * (x - start) / (nut - start)
    top = 0.011
    stations = [start, start + 0.06, (start + nut) / 2, nut]
    rings = []
    for x in stations:
        w = width(x) / 2
        depth = 0.02 if x > start + 0.03 else 0.03
        ring = [(x, -w, top - 0.005), (x, -w, top - 0.009)]
        ring += [(x, -w * math.cos(math.pi * i / 6), top - 0.009 - depth * math.sin(math.pi * i / 6)) for i in range(1, 6)]
        ring += [(x, w, top - 0.009), (x, w, top - 0.005)]
        rings.append([p.vert('paint', ident, v) for v in ring])
    for a, b in zip(rings, rings[1:]):
        for k in range(len(a)):
            k2 = (k + 1) % len(a)
            p.face('paint', (a[k], a[k2], b[k2], b[k]), MAPLE)
    p.face('paint', rings[0], MAPLE)
    p.face('paint', rings[-1], MAPLE)
    # fingerboard, frets, markers
    end = start - 0.012
    board = [(end, -width(start) / 2), (nut, -w1 / 2), (nut, w1 / 2), (end, width(start) / 2)]
    p.slab('matte', board, ident, top - 0.005, top, ROSEWOOD)
    for n in range(1, 21 if bass else 22):
        x = nut - scale * (1 - 2 ** (-n / 12))
        if x < end + 0.004:
            break
        p.box('metal', (0.0022, width(max(x, start)) - 0.001, 0.0016), Matrix.Translation((x, 0, top + 0.0006)), CHROME)
        if n in (3, 5, 7, 9, 12, 15, 17):
            mid = nut - scale * (1 - 2 ** (-(n - 0.5) / 12))
            for y in ((-0.012, 0.012) if n == 12 else (0.0,)):
                p.lathe('matte', [(0.0034, 0.0), (0.0034, 0.0006), (0, 0.0006)], Matrix.Translation((mid, y, top)), PEARL, 8)
    p.box('matte', (0.005, w1 + 0.001, 0.007), Matrix.Translation((nut + 0.0025, 0, top - 0.0005)), PEARL)

    # headstock, set a little below the fingerboard, with a tuner for each string
    if bass:
        head = rounded([(nut, -0.021), (nut + 0.03, -0.03), (nut + 0.1, -0.04), (nut + 0.19, -0.05), (nut + 0.215, -0.028), (nut + 0.2, 0.012),
                        (nut + 0.14, 0.04), (nut + 0.06, 0.036), (nut + 0.02, 0.026), (nut, 0.021)], 3)
        posts = [(nut + 0.05 + 0.047 * k, 0.012 - 0.013 * k) for k in range(4)]
        keys = [(x, y + 0.045 - 0.004 * k, 1) for k, (x, y) in enumerate(posts)]
    else:
        head = rounded([(nut, -0.0215), (nut + 0.03, -0.028), (nut + 0.09, -0.03), (nut + 0.165, -0.034), (nut + 0.19, -0.014), (nut + 0.185, 0.02),
                        (nut + 0.15, 0.046), (nut + 0.09, 0.05), (nut + 0.035, 0.036), (nut, 0.0215)], 3)
        posts = [(nut + 0.035 + 0.025 * k, 0.03 - 0.0035 * k) for k in range(6)]
        keys = [(x, y + 0.024, 1) for x, y in posts]
    p.slab('paint', head, ident, -0.008, top - 0.005, shade(color, 0.8) if not bass else MAPLE, 0.002, shade(color, 0.4) if not bass else shade(MAPLE, 0.8))
    for (x, y), (kx, ky, _) in zip(posts, keys):
        p.tube('metal', (x, y, top - 0.005), (x, y, top + 0.008), 0.0032 if not bass else 0.0055, CHROME, 8)
        p.tube('metal', (x, y, top - 0.005), (x, y, top - 0.0035), 0.0058 if not bass else 0.009, CHROME, 8)
        p.box('metal', (0.014, 0.016, 0.012) if not bass else (0.024, 0.02, 0.016), Matrix.Translation((x, y, -0.014)), CHROME)
        p.tube('metal', (x, y, -0.014), (kx, ky + 0.012, -0.014), 0.0022, STEEL, 5)
        p.ball('metal', Vector((kx, ky + 0.02, -0.014)), 0.009 if not bass else 0.015, CHROME, 8, 4, squash=0.45)
    # the strings: bridge, nut, then each to its post
    for k in range(strings):
        t = (k - (strings - 1) / 2) / (strings - 1)
        y0, y1 = t * (span - 0.016), t * (w1 - 0.009)
        gauge = (0.0007 + 0.00014 * k) if bass else (0.00034 + 0.00009 * k)
        post = posts[strings - 1 - k]
        p.path('metal', [Vector((bridge, y0, top + 0.0045)), Vector((nut + 0.002, y1, top + 0.0032)), Vector((post[0], post[1], top + 0.002))],
               gauge * 1.6, (0.62, 0.56, 0.44) if k >= strings // 2 else (0.78, 0.8, 0.84), 4)
    return nut


def strap(p, points, width=0.05, color=BLACK):
    """A flat strap along `points`, each (place, the way its face looks)."""
    rings = []
    for i, (at, out) in enumerate(points):
        a = points[max(0, i - 1)][0]
        b = points[min(len(points) - 1, i + 1)][0]
        along = (Vector(b) - Vector(a)).normalized()
        side = along.cross(Vector(out)).normalized() * width / 2
        out = Vector(out).normalized() * 0.002
        at = Vector(at)
        rings.append([p.vert('matte', Matrix.Identity(4), v) for v in (at - side - out, at + side - out, at + side + out, at - side + out)])
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            k2 = (k + 1) % 4
            p.face('matte', (a[k], a[k2], b[k2], b[k]), color)
    p.face('matte', rings[0], color)
    p.face('matte', rings[-1], color)


# ---------------------------------------------------------------- microphone
def microphone(p):
    """A hand-held wireless microphone along +Z, the hand round the origin: body, ring, grille and its tail."""
    body = [(0, -0.105), (0.012, -0.104), (0.0155, -0.096), (0.0165, -0.07), (0.0175, 0.03), (0.0205, 0.075), (0.0215, 0.083), (0, 0.083)]
    p.lathe('matte', body, Matrix.Identity(4), lambda i, k: (0.05, 0.3, 0.42) if i == 1 else BLACK, 16)
    p.lathe('metal', [(0.0225, 0.08), (0.0235, 0.084), (0.0235, 0.09), (0.0225, 0.094), (0.018, 0.094), (0.018, 0.08)], Matrix.Identity(4), CHROME, 18, closed=True)
    grille = [(0.022, 0.09), (0.0255, 0.1), (0.0272, 0.114)]
    grille += [(0.0272 * math.cos(a), 0.114 + 0.03 * math.sin(a)) for a in (math.radians(d) for d in (20, 40, 58, 74))] + [(0, 0.1445)]
    tint = lambda i, k: shade(STEEL, 0.8 if (i + k) % 2 else 1.05)
    p.lathe('metal', [(0, 0.09)] + grille, Matrix.Identity(4), tint, 18)
    p.lathe('metal', [(0.0278, 0.111), (0.0282, 0.114), (0.0278, 0.117), (0.026, 0.117), (0.026, 0.111)], Matrix.Identity(4), CHROME, 18, closed=True)
