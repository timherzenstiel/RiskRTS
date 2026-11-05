"""Detailed buildings and defences (Red Alert level of detail) for tools/bake/models.py via hires.build().

Houses and the church are modelled in a unit frame (footprint x, z in -.5...5, walls 1 high) and scaled per house by the terrain;
the wall plaster is house-colour (alpha 1) so each house takes its own wall tint. Defences are in game units (a soldier is ~0.21).
Frame: x right, y up, z forward (the side facing the camera, where doors and the main windows are).
"""
import math, random
from models import Kit, srgb
from hires import P

B = dict(P)
B.update({
    'plaster': srgb('#d8d2c0'), 'quoin': srgb('#b7ae98'), 'plinth': srgb('#8f877a'), 'tile': srgb('#a8432f'), 'tile2': srgb('#8e3626'),
    'tile3': srgb('#b9573c'), 'slate1': srgb('#4e535b'), 'slate2': srgb('#5d636b'), 'slate3': srgb('#42464d'), 'shutter': srgb('#3f5f52'),
    'shutter2': srgb('#5a4a7a'), 'door': srgb('#5a3a22'), 'sill': srgb('#c9c2ae'), 'pot': srgb('#9a5a3a'), 'iron': srgb('#5f5a52'),
    'net': srgb('#4f553a'), 'net2': srgb('#6a6248'), 'conc': srgb('#a29e92'), 'conc2': srgb('#8a867b'), 'conc3': srgb('#b4b0a4'),
    'earth': srgb('#5c4a34'), 'earth2': srgb('#4a3b29'), 'turf': srgb('#56603a'), 'turf2': srgb('#46502e'), 'scar': srgb('#6e6a60'),
})

def jit(rng, c, a=.08):
    j = 1 + (rng.random() - .5) * 2 * a
    return (min(1, c[0] * j), min(1, c[1] * j), min(1, c[2] * j))

# ---------------------------------------------------------------- roofs
def tiled_roof(k, x, y, z, w, h, l, cols, axis='x', courses=7, step=.018, gable=True, segs=4):
    """Pitched roof of overlapping tile courses: ridge along `axis`, eaves `w` apart at height y, ridge h higher, `l` long.
    Each course is a slab whose lower edge stands proud of the one above, so the sun picks out the rows; each course is split
    into a few patches of slightly different colour (weathered, re-laid tiles)."""
    rng = k.rng
    for sd in (-1, 1):
        for i in range(courses):
            t0, t1 = i / courses, min(1, (i + 1) / courses + .04)
            for s in range(segs):
                a0, a1 = -l / 2 + l * s / segs, -l / 2 + l * (s + 1) / segs
                c = jit(rng, cols[rng.randrange(len(cols))], .07)
                def P_(t, a, lift):
                    # point on the slope at fraction t (0 eave, 1 ridge), position a along the ridge, lifted off the slope
                    ny, nz = w / 2, h   # outward normal of the slope (unnormalised): up and out
                    L = math.hypot(ny, nz); ly, lz = nz / L * lift, ny / L * lift
                    yy = y + h * t + ly; off = sd * (w / 2 * (1 - t) + lz)
                    return (a + x, yy, z + off) if axis == 'x' else (x + off, yy, a + z)
                lift0 = step * (1 - i / courses * .3)
                pts = [P_(t0, a0, lift0), P_(t0, a1, lift0), P_(t1, a1, .002), P_(t1, a0, .002)]
                if (sd > 0) == (axis == 'x'): pts = pts[::-1]
                k.poly(pts, c, thick=.012)
    # ridge capping
    if axis == 'x': k.limb((x - l / 2, y + h + .01, z), (x + l / 2, y + h + .01, z), .028, .028, jit(rng, cols[-1], .05), seg=6)
    else: k.limb((x, y + h + .01, z - l / 2), (x, y + h + .01, z + l / 2), .028, .028, jit(rng, cols[-1], .05), seg=6)
    if gable:   # gable ends in the wall plaster (house colour)
        if axis == 'x':
            for e in (-1, 1): k.poly([(x + e * l / 2 * .93, y, z - w / 2 * .9), (x + e * l / 2 * .93, y, z + w / 2 * .9), (x + e * l / 2 * .93, y + h * .92, z)][::e], B['plaster'], house=True, thick=.02)
        else:
            for e in (-1, 1): k.poly([(x - w / 2 * .9, y, z + e * l / 2 * .93), (x + w / 2 * .9, y, z + e * l / 2 * .93), (x, y + h * .92, z + e * l / 2 * .93)][::-e], B['plaster'], house=True, thick=.02)

def chimney(k, x, y, z, s=1.0, c='brick2'):
    k.box(x, y, z, .13 * s, .42 * s, .13 * s, jit(k.rng, B[c]), bevel=.008)
    k.box(x, y + .22 * s, z, .16 * s, .03 * s, .16 * s, B['stone'], bevel=.006)
    for dx in (-.03, .03): k.cyl(x + dx * s, y + .27 * s, z, .022 * s, .018 * s, .07 * s, B['pot'], seg=6)

def window(k, x, y, z, w, h, face=1, axis='z', shutters=True, scol='shutter'):
    """Window on a wall facing +/-axis: stone surround, dark glazing with glazing bars and a lit pane, sill and open shutters."""
    def bx(a, yy, d, sa, sy, sd, c):
        if axis == 'z': k.box(x + a, yy, z + face * d, sa, sy, sd, c)
        else: k.box(z + face * d, yy, x + a, sd, sy, sa, c)
    bx(0, y, .006, w + .05, h + .05, .02, B['sill'])
    bx(0, y, .014, w, h, .02, B['window'])
    bx(0, y, .022, .012, h, .008, B['timber2']); bx(0, y + h * .1, .022, w, .012, .008, B['timber2'])
    if k.rng.random() < .3: bx(-w / 4, y + h * .3, .02, w / 2 - .01, h * .3, .006, B['lit'])
    bx(0, y - h / 2 - .02, .03, w + .08, .025, .05, B['sill'])
    if shutters:
        c = jit(k.rng, B[scol], .1)
        for sd in (-1, 1):
            bx(sd * (w / 2 + w * .28), y, .018, w * .5, h, .014, c)
            for r in range(3): bx(sd * (w / 2 + w * .28), y - h / 3 + r * h / 3, .027, w * .44, .008, .004, (c[0] * .75, c[1] * .75, c[2] * .75))

def door(k, x, y0, z, w=.2, h=.42, face=1):
    k.box(x, y0 + h / 2 + .02, z + face * .006, w + .06, h + .05, .02, B['sill'], bevel=.004)
    k.box(x, y0 + h / 2, z + face * .014, w, h, .02, jit(k.rng, B['door']), bevel=.003)
    for i in range(3): k.box(x - w / 3 + i * w / 3, y0 + h / 2, z + face * .026, .01, h * .9, .006, B['timber2'])
    k.box(x + w * .32, y0 + h * .5, z + face * .03, .02, .02, .01, B['brass'])
    k.box(x, y0 + .015, z + face * .05, w + .1, .03, .08, B['stone'], bevel=.006)   # step

def plinth_quoins(k, w, d, H):
    k.box(0, .07, 0, w + .03, .14, d + .03, B['plinth'], bevel=.01)
    for sx in (-1, 1):
        for sz in (-1, 1):
            for i in range(int(H / .14)):
                a = .09 if i % 2 else .06
                k.box(sx * (w / 2 - a / 2 + .006), .2 + i * .14, sz * (d / 2 + .006), a, .12, .02, jit(k.rng, B['quoin'], .05))
                k.box(sx * (w / 2 + .006), .2 + i * .14, sz * (d / 2 - (.15 - a) / 2 - .006), .02, .12, .15 - a, jit(k.rng, B['quoin'], .05))

def plaster_stains(k, w, d, H, n=6):
    """Damp patches and missing plaster showing brick, flat on the walls."""
    for _ in range(n):
        side = k.rng.choice((-1, 1)); a = (k.rng.random() - .5) * (w - .3); yy = .25 + k.rng.random() * (H - .4)
        if k.rng.random() < .5:
            k.box(a, yy, side * (d / 2 + .004), .1 + k.rng.random() * .1, .06 + k.rng.random() * .06, .01, jit(k.rng, B['brick'], .1))
        else:
            k.box(side * (w / 2 + .004), yy, a, .01, .06 + k.rng.random() * .06, .1 + k.rng.random() * .1, jit(k.rng, B['brick'], .1))

def barrel(k, x, z, s=1.0):
    k.cyl(x, .09 * s, z, .07 * s, .065 * s, .18 * s, B['timber'], seg=10)
    for yy in (.04, .14): k.cyl(x, yy * s, z, .072 * s, .072 * s, .015 * s, B['iron'], seg=10)

def woodpile(k, x, z, n=7, axis='x'):
    for i in range(n):
        r, c = i % 4, i // 4
        if axis == 'x': k.limb((x - .12, .035 + c * .055, z + (r - 1.5) * .05 + c * .025), (x + .12, .035 + c * .055, z + (r - 1.5) * .05 + c * .025), .026, .026, jit(k.rng, B['timber'], .15), seg=6)

# ---------------------------------------------------------------- houses
def house_a():
    """Cottage: plastered stone, tiled roof (ridge along x), chimney, shuttered windows, a lean-to shed and a woodpile."""
    k = Kit('house_a', jitter=.04); rng = k.rng
    H = .95
    plinth_quoins(k, 1, 1, H)
    k.box(0, .14 + H / 2, 0, 1, H - .02, 1, B['plaster'], house=True, bevel=.015)
    plaster_stains(k, 1, 1, H, 5)
    tiled_roof(k, 0, H + .1, 0, 1.22, .62, 1.14, [B['tile'], B['tile2'], B['tile3']], axis='x', courses=7)
    chimney(k, .3, H + .74, -.14)
    door(k, -.18, .14, .5)
    window(k, .22, .6, .5, .2, .24); window(k, .22, .6, -.5, .2, .24, face=-1, shutters=False)
    for sd in (-1, 1): window(k, 0, .6, sd * .5, .18, .22, face=sd, axis='x', scol='shutter2')
    # eaves board
    for sd in (-1, 1): k.box(0, H + .1, sd * .6, 1.16, .04, .03, B['timber2'])
    # lean-to shed on the right gable, plank walls and a sagging iron roof
    k.box(.66, .22, .1, .3, .44, .62, jit(rng, B['timber']), bevel=.01)
    for i in range(6): k.box(.815, .22, -.18 + i * .1, .01, .42, .006, B['timber2'])
    k.poly([(.5, .5, -.25), (.86, .4, -.25), (.86, .4, .45), (.5, .5, .45)][::-1], B['iron'], thick=.015)
    barrel(k, -.62, .38); woodpile(k, .66, .58)
    return k.done()

def house_b():
    """Two-storey townhouse: string course, three bays of shuttered windows, slate roof (ridge along z) with dormers and two chimneys."""
    k = Kit('house_b', jitter=.04)
    H = .98
    plinth_quoins(k, 1, 1, H)
    k.box(0, .14 + H / 2, 0, 1, H - .02, 1, B['plaster'], house=True, bevel=.015)
    plaster_stains(k, 1, 1, H, 6)
    for sd in (-1, 1): k.box(0, .58, sd * .505, 1.0, .035, .03, B['quoin'], bevel=.006)   # string course
    k.box(0, H + .14, 0, 1.06, .05, 1.06, B['quoin'], bevel=.01)                              # cornice
    tiled_roof(k, 0, H + .16, 0, 1.12, .48, 1.12, [B['slate1'], B['slate2'], B['slate3']], axis='z', courses=8, step=.014)
    for yy in (.38, .82):
        for xx in (-.32, 0, .32):
            if yy < .5 and xx == 0: continue
            window(k, xx, yy, .5, .16, .24 if yy > .5 else .22)
    door(k, 0, .14, .5, .2, .38)
    k.box(0, .58, .53, .3, .02, .06, B['timber2'])   # door canopy
    for yy in (.38, .82):
        for xx in (-.25, .25): window(k, xx, yy, -.5, .16, .22, face=-1, shutters=False)
    # dormers on the front slope
    for xx in (-.24, .24):
        k.box(xx, H + .38, .3, .18, .2, .16, B['plaster'], house=True, bevel=.01)
        k.box(xx, H + .38, .385, .1, .12, .02, B['window'])
        k.roof(xx, H + .48, .3, .22, .1, .2, B['slate3'], axis='z', thick=.02)
    for sd in (-1, 1): chimney(k, sd * .36, H + .6, 0, 1.05, 'brick')
    return k.done()

def church():
    """Village church: stone nave with buttresses and lancet windows, slate roof, west tower with belfry openings and spire."""
    k = Kit('church', jitter=.04)
    k.box(0, .05, -.1, .7, .1, 1.3, B['plinth'], bevel=.01)
    k.box(0, .4, -.1, .6, .7, 1.2, B['stone'], bevel=.015)
    # coursed stone: faint bands
    for i in range(5): k.box(0, .12 + i * .14, -.1, .612, .012, 1.212, jit(k.rng, B['quoin'], .05))
    for i in range(5):
        zz = -.6 + i * .25
        for sd in (-1, 1):
            k.box(sd * .33, .25, zz, .07, .5, .07, B['quoin'], bevel=.01)
            k.poly([(sd * .3, .5, zz - .035), (sd * .37, .5, zz - .035), (sd * .3, .62, zz - .035)][::sd], B['slate3'], thick=.07)
            if i < 4:
                k.box(sd * .305, .45, zz + .125, .02, .3, .08, B['window'])
                k.box(sd * .31, .62, zz + .125, .02, .05, .05, B['window'], rx=.785)
    tiled_roof(k, 0, .75, -.1, .7, .42, 1.26, [B['slate1'], B['slate2'], B['slate3']], axis='z', courses=8, step=.014)
    # tower
    k.box(0, .82, .66, .38, 1.64, .38, B['stone'], bevel=.015)
    for i in range(7): k.box(0, .2 + i * .22, .66, .392, .014, .392, jit(k.rng, B['quoin'], .05))
    for sd in (-1, 1):
        for zz in (.48, .84):
            k.box(sd * .2, .5 + (zz > .6) * .5, zz, .05, .9, .05, B['quoin'], bevel=.008)
    for (fx, fz, ax) in ((0, .855, 'z'), (0, .465, 'z'), (.195, .66, 'x'), (-.195, .66, 'x')):
        if ax == 'z': k.box(fx, 1.42, fz, .1, .2, .02, B['black']); k.box(fx, 1.3, fz, .16, .02, .03, B['sill'])
        else: k.box(fx, 1.42, fz, .02, .2, .1, B['black'])
    k.cyl(0, 1.08, .855, .07, .07, .01, B['white'], axis='z', seg=16)   # clock face
    k.box(0, 1.08, .862, .006, .05, .004, B['black']); k.box(.015, 1.08, .862, .03, .006, .004, B['black'])
    door(k, 0, .0, .85, .16, .32)
    k.box(0, 1.66, .66, .42, .04, .42, B['quoin'], bevel=.01)
    k.cyl(0, 2.02, .66, .27, .0, .7, B['slate1'], seg=8, smooth=False)
    k.limb((0, 2.36, .66), (0, 2.5, .66), .008, .006, B['iron'], seg=4); k.box(0, 2.46, .66, .06, .008, .008, B['iron'])
    return k.done()

# ---------------------------------------------------------------- defences
def bag(k, x, y, z, rot=0.0, s=1.0, c=None):
    """One sandbag: a soft bevelled block, tied end a touch narrower."""
    c = c or jit(k.rng, B['bag'] if k.rng.random() < .6 else B['bag2'], .08)
    k.box(x, y, z, .034 * s, .013 * s, .019 * s, c, rz=rot, bevel=.0055 * s)

def bag_wall(k, x0, z0, x1, z1, rows=3, y0=0.0, s=1.0):
    L = math.hypot(x1 - x0, z1 - z0); n = max(1, int(L / (.032 * s))); rot = math.atan2(z1 - z0, x1 - x0)
    for r in range(rows):
        off = (r % 2) * .5
        for i in range(n - (1 if r % 2 else 0)):
            t = (i + .5 + off) / n
            bag(k, x0 + (x1 - x0) * t, y0 + .0065 * s + r * .0125 * s, z0 + (z1 - z0) * t, -rot, s)

def bag_ring(k, cx, cz, R, rows=2, y0=0.0, gap=None, gapw=.45):
    for r in range(rows):
        n = max(8, int(math.tau * R / .031))
        for i in range(n):
            a = (i + (r % 2) * .5) / n * math.tau
            if gap is not None and abs(math.atan2(math.sin(a - gap), math.cos(a - gap))) < gapw: continue
            bag(k, cx + math.sin(a) * R, y0 + .0065 + r * .0125, cz + math.cos(a) * R, -a)

def camo_net(k, x, y, z, w, d, n=14):
    for _ in range(n):
        px, pz = x + (k.rng.random() - .5) * w, z + (k.rng.random() - .5) * d
        k.box(px, y + k.rng.random() * .004, pz, .03 + k.rng.random() * .04, .004, .03 + k.rng.random() * .04, jit(k.rng, B['net'] if k.rng.random() < .6 else B['net2'], .1), rz=k.rng.random() * 3, bevel=.0015)

def berm(k, x, z, w, d, h, seg=12, c='earth'):
    """Low earth berm around a footprint (an octagonal ring of sloped slabs)."""
    for i in range(seg):
        a0, a1 = i / seg * math.tau, (i + 1) / seg * math.tau
        p = lambda a, r, y: (x + math.sin(a) * w * r, y, z + math.cos(a) * d * r)
        k.poly([p(a0, 1.25, 0), p(a1, 1.25, 0), p(a1, 1.0, h), p(a0, 1.0, h)][::-1], jit(k.rng, B[c], .06), thick=.004)

def pillbox_hi():
    """Hexagonal concrete pillbox: chamfered walls with a slit in each face, shell scars, earth on the roof, sandbag ring and berm."""
    k = Kit('pill', jitter=.03)
    berm(k, 0, 0, .1, .1, .03, c='earth')
    k.cyl(0, .034, 0, .088, .08, .068, B['conc'], seg=6, smooth=False)
    k.cyl(0, .072, 0, .084, .07, .01, B['conc2'], seg=6, smooth=False)
    k.cyl(0, .078, 0, .066, .04, .012, B['turf'], seg=6, smooth=False)   # turfed roof
    for i in range(6):
        a = (i + .5) / 6 * math.tau
        k.box(math.sin(a) * .079, .05, math.cos(a) * .079, .036, .009, .012, B['black'], rz=a)
        k.box(math.sin(a) * .082, .057, math.cos(a) * .082, .044, .004, .016, B['conc3'], rz=a)   # slit hood
        if k.rng.random() < .6:
            b = a + (k.rng.random() - .5) * .6
            k.box(math.sin(b) * .086, .03 + k.rng.random() * .03, math.cos(b) * .086, .014, .012, .008, B['scar'], rz=b, bevel=.003)
    k.limb((.0, .05, .07), (.0, .05, .1), .0028, .0028, B['gun'], seg=5)
    bag_ring(k, 0, 0, .118, rows=2, gap=math.pi, gapw=.35)
    k.box(0, .022, -.09, .03, .042, .02, B['black']); k.box(0, .046, -.092, .042, .008, .026, B['timber2'])
    return k.done()

def bunker_hi():
    """Concrete casemate dug into an earth bank: two MG embrasures, sandbagged front, camouflage net, timber-framed rear entrance."""
    k = Kit('bunk', jitter=.03)
    # earth bank all round
    berm(k, 0, 0, .15, .12, .05, c='earth2')
    k.box(0, .025, 0, .27, .05, .2, B['earth'], bevel=.02)
    # concrete front and roof
    k.box(0, .052, .045, .24, .05, .09, B['conc'], bevel=.008)
    k.box(0, .08, .02, .26, .014, .16, B['conc2'], bevel=.004)
    for sd in (-1, 1):
        k.box(sd * .06, .06, .092, .06, .012, .012, B['black'])
        k.box(sd * .06, .069, .095, .074, .006, .018, B['conc3'], bevel=.002)
        k.limb((sd * .06, .061, .085), (sd * .06, .061, .118), .0028, .0028, B['gun'], seg=5)
    for _ in range(5):
        k.box((k.rng.random() - .5) * .22, .045 + k.rng.random() * .03, .091, .016, .01, .006, B['scar'], bevel=.002)
    # earth and turf over the roof, net on top
    k.box(0, .092, -.01, .24, .012, .14, B['earth'], bevel=.006)
    k.box(0, .1, -.02, .2, .008, .1, B['turf2'], bevel=.004)
    camo_net(k, 0, .106, -.01, .24, .13, 16)
    # sandbags either side of the embrasures and in front
    bag_wall(k, -.15, .11, -.1, .125, rows=3); bag_wall(k, .1, .125, .15, .11, rows=3)
    bag_wall(k, -.09, .135, .09, .135, rows=1)
    # rear entrance: timber frame, steps down, corrugated sheet, stove pipe
    k.box(0, .02, -.105, .05, .04, .03, B['black'])
    for sd in (-1, 1): k.box(sd * .03, .028, -.108, .008, .056, .008, B['timber2'])
    k.box(0, .058, -.108, .07, .008, .01, B['timber2'])
    k.poly([(-.05, .066, -.09), (.05, .066, -.09), (.05, .06, -.14), (-.05, .06, -.14)], B['iron'], thick=.003)
    k.limb((.08, .09, -.05), (.08, .14, -.05), .005, .005, B['iron'], seg=6)
    bag_wall(k, -.06, -.14, -.035, -.115, rows=2); bag_wall(k, .035, -.115, .06, -.14, rows=2)
    return k.done()

# ---------------------------------------------------------------- trees
# Leaves are house-colour (the terrain tints each tree by biome). The renderer scales the tint by clamp(luma * 4.2, .55, 1.35), so leaf
# values are kept between ~.13 and .32 luma: light on the sunny outside, dark inside the crown, and the clumps keep their shading.
def leaf(k, v):
    v = max(.36, min(.62, v)); return (v, v, v * .96)

def clump(k, x, y, z, r, v, seg=5, sy=.8):
    k.ball(x, y, z, r, leaf(k, v), house=True, sy=sy, seg=seg)

def tree_broad():
    """Oak/beech: a forked trunk and a crown of small faceted leaf clumps, lighter towards the sunlit top-left."""
    k = Kit('tree_broad', jitter=.06); rng = random.Random(11)
    k.limb((0, 0, 0), (.02, .34, 0), .05, .034, B['timber2'], seg=6)
    for a, h, l in ((.6, .3, .2), (2.4, .34, .18), (4.3, .28, .2), (5.5, .4, .14)):
        k.limb((.02, h, 0), (math.cos(a) * l, h + .22, math.sin(a) * l), .022, .012, B['timber2'], seg=4)
    for i in range(26):
        u = rng.random() * math.tau; t = rng.random() * .85 + .15
        x, z = math.cos(u) * .26 * t, math.sin(u) * .24 * t; y = .48 + rng.random() * .36 - t * .1
        lit = (-x - z) * 1.1 + (y - .5) * 1.2
        clump(k, x, y, z, .075 + rng.random() * .045, .46 + lit * .35 + (rng.random() - .5) * .08)
    return k.done()

def tree_pine():
    """Spruce: tiers of drooping branch spikes round a central leader, narrowing to the tip."""
    k = Kit('tree_pine', jitter=.05); rng = random.Random(12)
    k.limb((0, 0, 0), (0, .28, 0), .035, .028, B['timber2'], seg=5)
    tiers = 7
    for i in range(tiers):
        y = .18 + i * .12; R = .3 * (1 - i / tiers) + .04; n = 12 - i
        for j in range(n):
            a = (j + (i % 2) * .5) / n * math.tau + rng.random() * .3
            tip = (math.cos(a) * R, y - .07, math.sin(a) * R)
            v = .44 + (-(tip[0] + tip[2]) * .5 + i / tiers * .12) + (rng.random() - .5) * .06
            k.limb((0, y + .03, 0), tip, .075 * (1 - i / tiers * .5), .01, leaf(k, v), house=True, seg=3)
        k.cyl(0, y, 0, R * .75, R * .25, .12, leaf(k, .38), True, seg=6, smooth=False)
    k.cyl(0, .18 + tiers * .12, 0, .05, 0, .16, leaf(k, .5), True, seg=4, smooth=False)
    return k.done()

def tree_acacia():
    k = Kit('tree_acacia', jitter=.05); rng = random.Random(13)
    k.limb((0, 0, 0), (.03, .42, 0), .03, .022, B['timber2'], seg=5)
    for a in (.4, 2.3, 4.2): k.limb((.03, .38, 0), (math.cos(a) * .22, .55, math.sin(a) * .22), .015, .01, B['timber2'], seg=4)
    for i in range(12):
        u = rng.random() * math.tau; t = math.sqrt(rng.random())
        x, z = math.cos(u) * .34 * t, math.sin(u) * .3 * t
        clump(k, x, .58 + rng.random() * .05, z, .1 + rng.random() * .05, .48 + (-x - z) * .4, sy=.4)
    return k.done()

def tree_palm():
    k = Kit('tree_palm', jitter=.05)
    pts = [(0, 0, 0), (.03, .25, .01), (.08, .5, .02), (.15, .72, .03)]
    for a, b in zip(pts, pts[1:]): k.limb(a, b, .03, .025, B['timber'], seg=5)
    for i in range(9):
        a = i / 9 * math.tau; tip = (.15 + math.cos(a) * .34, .58, .03 + math.sin(a) * .34); mid = (.15 + math.cos(a) * .18, .8, .03 + math.sin(a) * .18)
        v = .48 - (math.cos(a) + math.sin(a)) * .08
        k.limb((.15, .74, .03), mid, .012, .035, leaf(k, v), True, seg=3); k.limb(mid, tip, .035, .004, leaf(k, v - .04), True, seg=3)
    return k.done()

def shrub():
    k = Kit('shrub', jitter=.05); rng = random.Random(14)
    for i in range(8):
        u = rng.random() * math.tau; t = rng.random()
        x, z = math.cos(u) * .16 * t, math.sin(u) * .14 * t
        clump(k, x, .07 + rng.random() * .1, z, .07 + rng.random() * .05, .46 + (-x - z) * .5 + (rng.random() - .5) * .06)
    return k.done()

# ---------------------------------------------------------------- ruins (shown instead of a house where the ground is shelled)
def rubble(k, x, z, r, n=14, cols=('stone', 'plaster', 'brick', 'tile2', 'timber2')):
    rng = k.rng
    for _ in range(n):
        a = rng.random() * math.tau; t = math.sqrt(rng.random()) * r
        c = B[rng.choice(cols)]; s = .05 + rng.random() * .09
        k.box(x + math.cos(a) * t, s * .3 + rng.random() * .04, z + math.sin(a) * t, s, s * .6, s * .8, jit(rng, c, .12), rz=rng.random() * 3, rx=(rng.random() - .5) * .8, bevel=.01)

def house_ruin(name='house_ruin', tall=False):
    """A shelled house: broken wall stumps with jagged tops and empty window holes, a charred beam or two, rubble heaps, no roof."""
    k = Kit(name, jitter=.05); rng = random.Random(name)
    H = .98 if tall else .8
    k.box(0, .07, 0, 1.03, .14, 1.03, B['plinth'], bevel=.01)
    k.box(0, .145, 0, .96, .01, .96, B['earth2'])
    # four walls, each cut into vertical strips of random height (the jagged break)
    for side in range(4):
        for i in range(8):
            a = -.5 + (i + .5) / 8
            h = H * (.25 + .75 * rng.random() ** .7) if side in (1, 2) else H * (.12 + .6 * rng.random())
            if rng.random() < .15: continue
            x, z, sx, sz = (a, .5 - .05, .126, .1) if side == 0 else (a, -.5 + .05, .126, .1) if side == 1 else (.5 - .05, a, .1, .126) if side == 2 else (-.5 + .05, a, .1, .126)
            burnt = rng.random() < .35
            k.box(x, .14 + h / 2, z, sx, h, sz, jit(rng, B['scar'], .15) if burnt else B['plaster'], house=not burnt, bevel=.006)
            if h > .5 and rng.random() < .5:   # a window hole left in the stump
                k.box(x * 1.02, .14 + .45, z * 1.02, sx * .55 if sx > .11 else sx * 1.1, .2, sz * 1.1 if sx > .11 else sz * .55, B['black'])
            if rng.random() < .3: k.box(x * 1.01, .14 + h - .04, z * 1.01, sx * 1.01, .05, sz * 1.01, B['brick'])   # brick showing at the break
    # scorch marks and a charred roof beam leaning into the shell
    for _ in range(3): k.box((rng.random() - .5) * .8, .16, (rng.random() - .5) * .8, .3, .006, .25, B['tar'], rz=rng.random() * 3)
    k.limb((-.35, .2, -.3), (.3, H * .9, .25), .035, .03, B['tar'], seg=5)
    if tall: k.limb((.3, .2, -.35), (-.2, H * .7, .1), .03, .028, B['tar'], seg=5)
    chimney(k, .3, .14 + H * .62, -.3, .9) if tall else k.box(.3, .5, -.32, .13, .7, .13, B['brick2'], bevel=.008)
    k.ball(0, .14, 0, .34, jit(rng, B['scar'], .1), sy=.45, seg=7)   # heap of fallen masonry inside
    rubble(k, 0, 0, .42, 34); rubble(k, .4, .55, .25, 10); rubble(k, -.5, .2, .2, 8)
    return k.done()

def house_ruin_b(): return house_ruin('house_ruin_b', tall=True)
