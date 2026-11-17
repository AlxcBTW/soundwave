"""
The lie of the land around the Moonrise stage, shared by the build scripts.

The stage stands on a lake shore. In front of it the ground rises gently away from the stage, a
natural amphitheatre, so the back of the audience looks over the front; behind the stage and out
beyond the wings it falls away under the water. The game needs the same shape to stand people on
it: `PARAMS` is written to scenery.json and src/render/aurora/terrain.ts mirrors `height`.

Axes: Z up, metres; the stage is around y = 10, the audience toward -y.
"""
import math

PARAMS = {
    'centre': 10.0,      # y of the stage's middle: the rise is measured from here
    'flat': 24.0,        # radius around it that stays level
    'steep': 0.00048,    # rise = steep * (distance beyond the flat)^2 ...
    'cap': 7.5,          # ... up to this height
    'lead': 30.0,        # metres over which the rise fades in on the audience side
    'shore': 30.0,       # y behind the stage where the bank starts to fall
    'side': 85.0,        # |x| beyond the wings where it falls
    'bank': 14.0,        # width of the bank
    'drop': 1.6,         # depth it falls to
    'water': -0.55,      # level of the lake
}


def clamp01(v):
    return max(0.0, min(1.0, v))


def height(x, y):
    p = PARAMS
    toward = clamp01((-y + 5.0) / p['lead'])
    beyond = max(0.0, math.hypot(x, y - p['centre']) - p['flat'])
    rise = toward * min(p['cap'], p['steep'] * beyond * beyond)
    back = clamp01((y - p['shore']) / p['bank'])
    side = clamp01((abs(x) - p['side']) / p['bank']) * clamp01((y + 30.0) / 30.0)
    return rise - p['drop'] * max(back, side)
