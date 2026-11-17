"""
The lie of the land around the Moonrise stage, shared by the build scripts.

The stage stands on a point of land in a lake. In front of it the ground rises gently away from the
stage, a natural amphitheatre, so the back of the audience looks over the front. Behind the stage
it falls away under the water, and so it does close beside both wings: there the lake comes round
in a cove on each side, its shore swinging outward toward the back of the field to leave the
audience its ground, and closing where the festival grounds begin. The game needs the same shape
to stand people on it: `PARAMS` is written to scenery.json and src/render/aurora/terrain.ts
mirrors `height`.

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
    'bank': 14.0,        # width of that bank
    'side': 78.0,        # |x| beside the wings where the coves' banks start ...
    'turn': -25.0,       # ... as far forward as this y; from there the shore swings outward
    'sweep': 0.75,       # by this much for every metre toward the audience
    'cove': 16.0,        # width of the coves' banks
    'end': -105.0,       # y where the coves close
    'fade': 20.0,        # metres over which they do
    'drop': 1.6,         # depth the land falls to under the water
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
    edge = p['side'] + p['sweep'] * max(0.0, p['turn'] - y)
    side = clamp01((abs(x) - edge) / p['cove']) * clamp01((y - p['end']) / p['fade'])
    wet = max(back, side)
    wet = wet * wet * (3.0 - 2.0 * wet)
    return rise * (1.0 - wet) - p['drop'] * wet
