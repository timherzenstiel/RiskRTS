"""Ship models for the navy (design: claude/design-navy.md §6), built with the Kit of models.py and exported with the rest of
units.glb. Frame as in render/models.ts: game units, +z (game) forward, y up, waterline at y = 0, a dreadnought ~0.64 long.
COLOR_0 alpha marks the house colour (hull band, funnel bands), so one model serves every nation.

  dreadnought  hull, superstructure, tripod masts, funnels and barbettes (the five turrets are separate, they train on the target)
  turret       twin turret, rotation centre at the origin, guns along +z
  destroyer    narrow four-funnel destroyer
  liner        converted liner used as a troop transport
  carrier      HMS Furious style: flight deck forward, island and funnel midships, landing deck aft
  lighter      armoured X-lighter "Beetle" with its bow ramp
  harbour      quay, two cranes and a warehouse (water side towards +z)
"""
import math
import bmesh
from mathutils import Vector

NAVY = '#5f666b'; NAVY2 = '#454b50'; NAVY3 = '#7f878b'; DECK = '#7a6a4c'; RED = '#7d2a22'; BLK = '#151515'; GUN = '#2b2e30'
WHITE = '#d9d4c4'; MERCH = '#2f2a26'; FUNNEL = '#a8432e'; STONE = '#8c867a'; CONC = '#a29e92'; BRICK = '#7c4b37'; ROOF = '#4b4636'


def hull(k, srgb, prof, y_top, y_bot, col, house_band=None, keel=.72, deck=None, boot=None):
    """Lofted hull from a half-width profile [(z, half width), ...] bow to stern: deck outline at y_top, a narrower keel line at
    y_bot. Optional house-coloured band along the sides, a deck surface and a boot-topping stripe at the waterline."""
    bm = k.bm
    top = [bm.verts.new((w, -z, y_top)) for z, w in prof] + [bm.verts.new((-w, -z, y_top)) for z, w in reversed(prof)]
    bot = [bm.verts.new((w * keel, -z, y_bot)) for z, w in prof] + [bm.verts.new((-w * keel, -z, y_bot)) for z, w in reversed(prof)]
    n = len(top); faces = []
    for i in range(n):
        j = (i + 1) % n
        try: faces.append(bm.faces.new((top[i], top[j], bot[j], bot[i])))
        except ValueError: pass
    faces.append(bm.faces.new(top)); faces.append(bm.faces.new(list(reversed(bot))))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    k._paint(faces, srgb(col), False)
    for f in faces: f.smooth = False
    if deck: k.poly([(w * .94, y_top + .001, z) for z, w in prof] + [(-w * .94, y_top + .001, z) for z, w in reversed(prof)], srgb(deck))
    # side stripes: thin slabs following the profile
    def stripe(y, h, c, house):
        for sd in (-1, 1):
            for (z0, w0), (z1, w1) in zip(prof[:-1], prof[1:]):
                f = lambda yy: (y + yy - y_top) / (y_bot - y_top)
                a0 = w0 + (w0 * keel - w0) * f(0) + .0015; a1 = w1 + (w1 * keel - w1) * f(0) + .0015
                pts = [(sd * a0, y, z0), (sd * a1, y, z1), (sd * a1, y - h, z1), (sd * a0, y - h, z0)]
                if sd < 0: pts = list(reversed(pts))
                k.poly(pts, srgb(c), house)
    if house_band is not None: stripe(house_band, .008, col, True)
    if boot is not None: stripe(.004, .007, boot, False)


def dreadnought(Kit, srgb):
    k = Kit('dreadnought', .03)
    prof = [(.335, .0), (.3, .028), (.24, .055), (.16, .07), (.0, .074), (-.16, .07), (-.24, .058), (-.29, .036), (-.31, .012)]
    hull(k, srgb, prof, .05, -.02, NAVY, house_band=.038, deck=DECK, boot=RED)
    B = lambda *a, **kw: k.box(*a, **kw)
    c = lambda h: srgb(h)
    # forecastle step and casemates along the sides
    B(0, .058, .2, .1, .016, .2, c(NAVY)); B(0, .067, .2, .096, .002, .2, c(DECK))
    for sd in (-1, 1):
        for i in range(4): B(sd * .072, .04, .12 - i * .055, .012, .012, .022, c(NAVY2)); k.limb((sd * .078, .04, .12 - i * .055), (sd * .078, .04, .15 - i * .055), .003, .003, c(GUN), seg=5)
    # barbettes of the five turrets (A, B superfiring, Q midships, X superfiring, Y)
    for z, y in ((.21, .066), (.145, .088), (-.045, .052), (-.15, .072), (-.215, .052)):
        k.cyl(0, y - .008, z, .028, .028, .016, c(NAVY2), seg=12)
    if True:
        B(0, .062, -.15, .07, .02, .07, c(NAVY))
    # bridge and conning tower, tripod foremast with spotting top
    B(0, .085, .075, .07, .032, .05, c(NAVY3)); B(0, .108, .08, .085, .01, .04, c(NAVY3)); B(0, .12, .085, .03, .02, .03, c(NAVY2))
    for sd in (-1, 1): k.limb((sd * .022, .1, .045), (0, .23, .06), .0035, .0025, c(BLK), seg=5)
    k.limb((0, .1, .07), (0, .26, .06), .004, .003, c(BLK), seg=5)
    B(0, .235, .06, .028, .018, .026, c(NAVY2)); B(0, .262, .06, .07, .003, .003, c(BLK))
    # funnels with the house band and black caps
    for z in (.005, -.075):
        k.cyl(0, .11, z, .018, .018, .1, c(NAVY2), seg=10)
        k.cyl(0, .142, z, .0185, .0185, .014, c(NAVY), True, seg=10)
        k.cyl(0, .163, z, .0188, .0188, .008, c(BLK), seg=10)
    # mainmast, boats, ventilators
    k.limb((0, .07, -.11), (0, .2, -.11), .004, .0025, c(BLK), seg=5); B(0, .175, -.11, .05, .003, .003, c(BLK))
    for sd in (-1, 1):
        B(sd * .045, .068, -.035, .016, .012, .045, c(WHITE)); B(sd * .045, .075, -.035, .015, .003, .04, c(ROOF))
        k.cyl(sd * .03, .08, .03, .004, .006, .03, c(NAVY3), seg=6)
    k.limb((0, .07, .31), (0, .1, .31), .0015, .0015, c(BLK), seg=4)
    return k.done()


def turret(Kit, srgb):
    k = Kit('turret', .02)
    c = lambda h: srgb(h)
    k.box(0, .013, -.004, .05, .026, .05, c('#7f878b'), bevel=.004)
    k.poly([(-.025, .026, .021), (.025, .026, .021), (.025, .012, .03), (-.025, .012, .03)], c('#7f878b'))
    k.box(0, .027, -.012, .03, .004, .022, c('#5f666b'))
    for sd in (-1, 1): k.limb((sd * .011, .012, .02), (sd * .011, .012, .095), .0042, .0034, c(GUN), seg=6)
    return k.done()


def destroyer(Kit, srgb):
    k = Kit('destroyer', .03)
    prof = [(.235, .0), (.2, .02), (.13, .034), (.0, .037), (-.14, .034), (-.2, .025), (-.215, .01)]
    hull(k, srgb, prof, .036, -.012, NAVY, house_band=.026, deck=DECK, boot=RED)
    c = lambda h: srgb(h)
    k.box(0, .046, .15, .07, .016, .07, c(NAVY)); k.box(0, .06, .12, .04, .024, .03, c(NAVY3)); k.box(0, .075, .122, .044, .006, .024, c(NAVY3))
    for i in range(4):
        z = .065 - i * .045
        k.cyl(0, .068, z, .011, .011, .05, c(NAVY2), seg=8); k.cyl(0, .085, z, .0115, .0115, .008, c(NAVY), True, seg=8); k.cyl(0, .095, z, .0118, .0118, .005, c(BLK), seg=8)
    for z in (.19, -.17): k.box(0, .045, z, .018, .01, .02, c(NAVY2)); k.limb((0, .048, z), (0, .048, z + (.04 if z > 0 else -.04)), .0025, .002, c(GUN), seg=5)
    for sd in (-1, 1): k.limb((sd * .016, .042, -.08), (sd * .016, .042, -.02), .006, .006, c(GUN), seg=6)
    k.limb((0, .07, .115), (0, .17, .115), .003, .002, c(BLK), seg=4); k.limb((0, .04, -.12), (0, .13, -.12), .002, .0015, c(BLK), seg=4)
    return k.done()


def liner(Kit, srgb):
    k = Kit('liner', .03)
    prof = [(.3, .0), (.26, .03), (.18, .058), (.0, .062), (-.18, .06), (-.25, .045), (-.28, .02)]
    hull(k, srgb, prof, .058, -.018, MERCH, house_band=.045, deck=DECK, boot=RED)
    c = lambda h: srgb(h)
    # two decks of white superstructure with rows of windows, bridge forward
    k.box(0, .074, .0, .1, .03, .3, c(WHITE)); k.box(0, .1, -.01, .085, .022, .22, c(WHITE)); k.box(0, .118, .07, .07, .014, .05, c(WHITE))
    for sd in (-1, 1):
        k.box(sd * .0505, .078, 0, .002, .006, .28, c('#33454c'))
        for i in range(5): k.box(sd * .046, .105, .08 - i * .045, .014, .01, .03, c(WHITE)); k.box(sd * .046, .112, .08 - i * .045, .013, .003, .028, c(ROOF))
    for z in (.02, -.07):
        k.cyl(0, .14, z, .019, .019, .07, c(FUNNEL), True, seg=10); k.cyl(0, .178, z, .0195, .0195, .008, c(BLK), seg=10)
    k.limb((0, .07, .2), (0, .22, .2), .003, .002, c(BLK), seg=4); k.limb((0, .07, -.2), (0, .2, -.2), .003, .002, c(BLK), seg=4)
    for z in (.16, -.16): k.box(0, .07, z, .07, .014, .05, c('#56583f'))
    return k.done()


def carrier(Kit, srgb):
    k = Kit('carrier', .03)
    prof = [(.34, .0), (.3, .03), (.22, .058), (.0, .066), (-.2, .064), (-.27, .05), (-.3, .02)]
    hull(k, srgb, prof, .05, -.02, NAVY, house_band=.038, boot=RED)
    c = lambda h: srgb(h)
    # flying-off deck forward on trusses, landing-on deck aft; island bridge and funnel between
    k.box(0, .074, .17, .13, .006, .26, c(DECK)); k.box(0, .062, .17, .11, .018, .22, c(NAVY2))
    k.box(0, .074, -.18, .13, .006, .2, c(DECK)); k.box(0, .062, -.18, .11, .018, .18, c(NAVY2))
    for z in range(7): k.box(0, .0775, .07 + z * .03, .002, .001, .012, c('#e8e6dc'))
    k.box(0, .0775, -.18, .1, .001, .003, c('#e8e6dc'))
    k.box(0, .085, -.01, .055, .05, .08, c(NAVY3)); k.box(0, .115, .0, .04, .012, .04, c(NAVY3))
    k.cyl(0, .13, -.035, .016, .016, .07, c(NAVY2), seg=10); k.cyl(0, .155, -.035, .0165, .0165, .01, c(NAVY), True, seg=10)
    k.limb((0, .11, .02), (0, .22, .02), .003, .002, c(BLK), seg=4)
    for sd in (-1, 1): k.limb((sd * .06, .07, .03), (sd * .06, .07, .06), .003, .003, c(GUN), seg=5)
    return k.done()


def lighter(Kit, srgb):
    k = Kit('lighter', .04)
    prof = [(.08, .02), (.07, .03), (.0, .032), (-.07, .03), (-.08, .02)]
    hull(k, srgb, prof, .022, -.008, BLK, house_band=.016)
    c = lambda h: srgb(h)
    k.poly([(-.022, .022, .08), (.022, .022, .08), (.018, .006, .1), (-.018, .006, .1)], c('#26241f'), thick=.003)
    k.box(0, .032, -.045, .03, .02, .03, c(NAVY2)); k.cyl(0, .05, -.055, .005, .005, .02, c(BLK), seg=6)
    return k.done()


def harbour(Kit, srgb):
    k = Kit('harbour', .04)
    c = lambda h: srgb(h)
    k.box(0, .015, .05, .52, .03, .09, c(STONE)); k.box(0, .031, .05, .52, .003, .09, c(CONC))
    for i in range(6): k.cyl(-.24 + i * .095, .036, .09, .004, .004, .01, c(BLK), seg=6)
    k.box(-.13, .06, -.04, .17, .09, .08, c(BRICK)); k.roof(-.13, .105, -.04, .09, .03, .18, c(ROOF), axis='x')
    for cx in (.07, .19):
        k.box(cx, .02, .04, .05, .02, .05, c(NAVY2))
        for sd in (-1, 1): k.limb((cx + sd * .015, .03, .04), (cx, .17, .04), .0035, .003, c(GUN), seg=5)
        k.box(cx, .17, .04, .02, .02, .02, c(GUN)); k.limb((cx, .175, .03), (cx, .2, .14), .003, .002, c(GUN), seg=5)
        k.limb((cx, .2, .14), (cx, .13, .14), .0008, .0008, c(BLK), seg=3)
    for i in range(3): k.box(.0 + i * .03, .045, -.02, .02, .025, .02, c('#7a6040'))
    return k.done()


def build(Kit, srgb):
    return [dreadnought(Kit, srgb), turret(Kit, srgb), destroyer(Kit, srgb), liner(Kit, srgb), carrier(Kit, srgb), lighter(Kit, srgb), harbour(Kit, srgb)]
