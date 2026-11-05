"""Detailed unit and building models (Red Alert 2 level of detail) for tools/bake/models.py.

Game model frame: x right, y up, z forward (towards the enemy); a soldier is ~0.21 tall. Every part is a bevelled box,
tapered limb, ring or slab painted with vertex colours; COLOR_0 alpha marks house-colour paint (uniforms, team panels
and stripes, flags). models.py bakes ambient occlusion into the paint and exports everything into units.glb.
"""
import math
from models import Kit, C, srgb

P = dict(C)
P.update({
    'drab': srgb('#6f6a52'), 'drab2': srgb('#5a5643'), 'rust': srgb('#6b4a32'), 'rivet': srgb('#8c8770'), 'glass': srgb('#7f98a0'),
    'brick': srgb('#8a4a36'), 'brick2': srgb('#6e3a2b'), 'slate': srgb('#4b4f55'), 'timber': srgb('#7a5a3a'), 'timber2': srgb('#5e4429'),
    'tar': srgb('#2a2622'), 'window': srgb('#2b3236'), 'lit': srgb('#c9b56a'), 'stone': srgb('#a39d8c'), 'grass': srgb('#56603a'),
    'white': srgb('#e6e2d6'), 'red': srgb('#b0302a'), 'blue': srgb('#2c4f9a'), 'black': srgb('#151515'), 'olive': srgb('#5b6146'),
    'mud': srgb('#4a3d2c'), 'bag': srgb('#a8956b'), 'bag2': srgb('#8f7d58'), 'cloth3': srgb('#7c7c70'),
})

# ---------------------------------------------------------------- soldiers
POSES = {
    #          hip L/R                  knee L / R                           ankle L / R                     body drop
    'stand':  dict(kn=((-.017, .052, .004), (.017, .052, .004)), an=((-.017, .014, 0), (.017, .014, 0)), d=0),
    'walk_a': dict(kn=((-.017, .055, .024), (.017, .05, -.01)), an=((-.017, .016, .034), (.017, .02, -.032)), d=-.002),
    'walk_b': dict(kn=((-.017, .05, -.01), (.017, .055, .024)), an=((-.017, .02, -.032), (.017, .016, .034)), d=-.002),
    'kneel':  dict(kn=((-.017, .056, .046), (.017, .011, -.012)), an=((-.017, .013, .05), (.017, .013, -.062)), d=-.045),
}

def figure(name, pose, arms='ready', lie=None):
    k = Kit(name, jitter=.04); Q = POSES[pose]; d = Q['d']; hy = .095 + d
    # legs: trousers (house colour) to the knee, puttees below, ammunition boots
    for i, sd in enumerate((-1, 1)):
        hip = (sd * .017, hy, 0); kn = Q['kn'][i]; an = Q['an'][i]
        k.limb(hip, kn, .0125, .0105, P['cloth2'], True, seg=8)
        k.ball(*kn, .0108, P['cloth2'], True, seg=8)
        k.limb(kn, an, .0108, .0088, P['puttee'], seg=8)
        for t in (.3, .55, .8):  # puttee wraps
            p = tuple(kn[j] + (an[j] - kn[j]) * t for j in range(3)); k.limb((p[0], p[1] - .0015, p[2]), (p[0], p[1] + .0015, p[2]), .0101, .0101, P['tar'] if t == .8 else P['puttee'], seg=8, cap=False)
        flat = pose == 'kneel' and i == 1
        k.box(an[0], an[1] - .006, an[2] + (.0 if flat else .008), .022, .012, .034, P['boot'], bevel=.003, rx=(-1.2 if flat else 0))
        if not flat: k.ball(an[0], an[1] - .007, an[2] + .024, .0105, P['boot'], sy=.7, seg=8)
    # tunic: skirt, waist, chest (oval), shoulders
    k.limb((0, hy - .022, 0), (0, hy + .006, 0), .032, .028, P['cloth2'], True, seg=10)
    k.limb((0, hy + .004, 0), (0, hy + .05, 0), .027, .032, P['cloth'], True, seg=10)
    k.ball(0, hy + .05, -.002, .031, P['cloth'], True, sy=.36, seg=10)
    for sd in (-1, 1): k.ball(sd * .03, hy + .047, 0, .0105, P['cloth'], True, seg=8)  # shoulders
    k.limb((0, hy + .058, .002), (0, hy + .064, .002), .016, .015, P['cloth2'], True, seg=8)  # collar
    # webbing: belt, buckle, cross braces, pouches, bayonet frog
    k.limb((0, hy - .002, 0), (0, hy + .006, 0), .0345, .0345, P['leather'], seg=12, cap=False)
    k.box(0, hy + .002, .034, .01, .008, .003, P['brass'], bevel=.001)
    for sd in (-1, 1):
        k.limb((sd * .02, hy + .004, .03), (sd * .028, hy + .058, .012), .0025, .0025, P['leather'], seg=4)
        k.limb((sd * .02, hy + .004, -.03), (sd * .028, hy + .058, -.012), .0025, .0025, P['leather'], seg=4)
        for j in (0, 1): k.box(sd * (.012 + j * .013), hy + .009, .032, .012, .015, .009, P['leather'], bevel=.002)
    k.box(-.034, hy - .018, -.006, .004, .03, .007, P['leather'], rx=.2)
    # pack, blanket roll, mess tin, canteen, entrenching tool
    k.box(0, hy + .028, -.036, .046, .045, .02, P['pack'], bevel=.004)
    k.limb((-.032, hy + .058, -.036), (.032, hy + .058, -.036), .0095, .0095, P['khaki'], seg=8)
    k.box(0, hy + .03, -.048, .02, .018, .006, P['steel'], bevel=.002)
    k.limb((.04, hy - .004, -.008), (.04, hy + .016, -.008), .0085, .0085, P['khaki'], seg=8); k.ball(.04, hy + .018, -.008, .003, P['steel'], seg=6)
    k.box(-.028, hy - .018, -.03, .01, .028, .006, P['wood'], bevel=.001); k.box(-.028, hy - .036, -.03, .015, .012, .003, P['steel'])
    # head: neck, head, nose, ears, eyes, moustache
    hz = hy + .078
    k.limb((0, hy + .06, .002), (0, hy + .07, .002), .0085, .009, P['skin'], seg=8)
    k.ball(0, hz, .003, .0195, P['skin'], sy=1.12, seg=12)
    k.box(0, hz - .002, .023, .005, .008, .006, P['skin'], bevel=.0015)
    for sd in (-1, 1):
        k.ball(sd * .0195, hz, .001, .0045, P['skin'], sy=1.3, seg=6)
        k.box(sd * .0072, hz + .004, .0205, .0045, .0025, .002, P['tar'])
    k.box(0, hz - .009, .0205, .011, .003, .003, P['boot'])
    # arms and rifle. ready: at the ready; aim: shouldered and levelled; up: pointing along the body (prone after rotation);
    # throw: right arm cocked back with a grenade, rifle slung across the back
    sh = hy + .047
    A = {
        'ready': ((.043, sh - .028, .018), (.021, sh - .035, .04), (-.04, sh - .024, .026), (.001, sh - .03, .066), sh - .036, .07, 0.0),
        'aim':   ((.04, sh - .012, .02), (.016, sh + .004, .035), (-.03, sh - .016, .045), (.004, sh + .006, .1), sh + .006, 0.0, -.045),
        'up':    ((.036, sh + .004, .03), (.016, sh + .03, .03), (-.03, sh + .02, .035), (.006, sh + .07, .035), None, 0.0, 0.0),
        'throw': ((.05, sh + .02, -.02), (.045, sh + .055, -.035), (-.04, sh - .01, .03), (-.03, sh + .005, .065), None, 0.0, 0.0),
    }[arms]
    rE, rW, lE, lW, ry, up, zb = A
    rS, lS = (.031, sh, 0), (-.031, sh, .002)
    for S_, E_, W_ in ((rS, rE, rW), (lS, lE, lW)):
        k.limb(S_, E_, .0092, .008, P['cloth'], True, seg=7); k.ball(*E_, .0081, P['cloth'], True, seg=7)
        k.limb(E_, W_, .0078, .0064, P['cloth'], True, seg=7)
        k.ball(W_[0], W_[1], W_[2] + .004, .0068, P['skin'], sy=.8, seg=8)
    if arms == 'throw':
        k.ball(rW[0], rW[1] + .008, rW[2] - .004, .0075, P['steel'], seg=8)                       # grenade
        k.limb((.03, hy + .06, -.04), (-.03, hy - .01, -.045), .0045, .004, P['wood'], seg=6)    # slung rifle
        k.limb((.03, hy + .06, -.044), (.045, hy + .085, -.046), .0018, .0018, P['steel'], seg=5)
    elif arms == 'up':
        # rifle along the body axis: after the prone rotation it points forward along the ground
        def rq(t, dx=0.0): return (.012 + dx, sh - .01 + t, .04)
        k.limb(rq(-.02), rq(.02), .0075, .0055, P['wood'], seg=6); k.limb(rq(.02), rq(.12), .0052, .0046, P['wood'], seg=6)
        k.limb(rq(.03), rq(.17), .0022, .0022, P['steel'], seg=6); k.limb(rq(.17), rq(.21), .0016, .0008, P['steel'], seg=4)
    else:
        def rp(z, dy=0.0): return (.012, ry + dy + z * up, z + zb)
        k.limb(rp(-.02, -.01), rp(.02, -.002), .0075, .0055, P['wood'], seg=6)
        k.limb(rp(.02, -.001), rp(.12, .001), .0052, .0046, P['wood'], seg=6)
        k.limb(rp(.03, .006), rp(.17, .005), .0022, .0022, P['steel'], seg=6)
        k.box(.019, ry + .03 * up + .005, .03 + zb, .009, .003, .003, P['steel']); k.ball(.024, ry + .03 * up + .005, .03 + zb, .0022, P['steel'], seg=6)
        k.box(.012, ry + .045 * up - .009, .045 + zb, .006, .012, .012, P['gun'], bevel=.001)
        k.limb(rp(.17, .005), rp(.215, .004), .0016, .0008, P['steel'], seg=4)
        k.limb(rp(-.01, -.012), rp(.1, -.006), .0012, .0012, P['leather'], seg=4)
    if lie:
        # lay the whole figure down: 'prone' face down, head forward; 'dead' on the back, sprawled a little to one side
        import bmesh as _bm
        from mathutils import Matrix as _M
        ang = math.pi / 2 if lie == 'prone' else -math.pi / 2
        _bm.ops.rotate(k.bm, verts=k.bm.verts, cent=(0, 0, 0), matrix=_M.Rotation(ang, 3, 'X'))
        if lie == 'dead': _bm.ops.rotate(k.bm, verts=k.bm.verts, cent=(0, 0, 0), matrix=_M.Rotation(.35, 3, 'Y') @ _M.Rotation(.5, 3, 'Z'))
        zmin = min(v.co.z for v in k.bm.verts)
        _bm.ops.translate(k.bm, verts=k.bm.verts, vec=(0, 0, -zmin))
    return k.done()

def helmets_hi():
    out = []
    k = Kit('helm_brodie')
    k.ring(0, .003, 0, .031, .0035, P['helm'], axis='y', seg=20, seg2=4); k.cyl(0, .003, 0, .033, .033, .002, P['helm'], seg=20)
    k.ball(0, .006, 0, .024, P['helm'], sy=.62, seg=14); k.box(0, -.014, .016, .036, .003, .003, P['leather']); out.append(k.done())
    k = Kit('helm_adrian')
    k.ball(0, .008, 0, .027, P['helm'], sy=.8, seg=14); k.cyl(0, .001, 0, .03, .03, .003, P['helm'], seg=16)
    k.box(0, .0, .03, .05, .003, .022, P['helm'], bevel=.002, rx=-.25); k.box(0, .002, -.029, .048, .003, .018, P['helm'], bevel=.002, rx=.3)
    k.box(0, .03, 0, .006, .008, .05, P['helm'], bevel=.002); k.box(0, .014, .027, .009, .009, .002, P['brass'], bevel=.001); out.append(k.done())
    k = Kit('helm_cap')
    k.cyl(0, .005, 0, .022, .022, .011, P['cloth2'], True, seg=14); k.cyl(0, .016, -.002, .026, .029, .011, P['cloth'], True, seg=14)
    k.box(0, -.0, .028, .04, .003, .02, P['boot'], bevel=.002, rx=-.25); k.box(0, .008, .023, .007, .007, .002, P['brass'], bevel=.001); out.append(k.done())
    k = Kit('helm_stahl')
    k.cyl(0, -.002, -.004, .035, .03, .016, P['helm'], seg=16); k.ball(0, .013, 0, .0285, P['helm'], sy=.98, seg=14)
    k.ring(0, -.009, -.004, .034, .002, P['helm'], axis='y', seg=16, seg2=3)
    for sd in (-1, 1): k.cyl(sd * .029, .011, 0, .0045, .0045, .006, P['steel'], axis='x', seg=8)
    k.box(0, .003, .031, .044, .004, .008, P['helm'], bevel=.002, rx=-.35); out.append(k.done())
    k = Kit('helm_kabalak')
    for i, r in enumerate((.031, .03, .028, .025)):
        k.cyl(0, .001 + i * .008, 0, r, r - .002, .009, P['khaki'] if i % 2 == 0 else P['canvas'], seg=14)
        k.ring(0, .005 + i * .008, 0, r - .001, .0025, P['canvas'] if i % 2 == 0 else P['khaki'], axis='y', seg=12, seg2=3)
    k.ball(0, .033, 0, .02, P['khaki'], sy=.45, seg=12); out.append(k.done())
    return out

# ---------------------------------------------------------------- weapons
def vickers():
    k = Kit('mg')
    for a in (-.62, .62, math.pi):  # tripod
        top = (0, .036, -.005); foot = (math.sin(a) * .05, .002, math.cos(a) * .05 - .01)
        k.limb(top, foot, .0035, .003, P['steel'], seg=6); k.box(foot[0], .002, foot[2], .012, .004, .008, P['steel'], bevel=.001)
    k.limb((0, .03, -.005), (0, .042, -.005), .008, .008, P['gun'], seg=8)
    k.box(0, .049, 0, .028, .022, .06, P['gun'], bevel=.003)
    k.limb((0, .052, .03), (0, .052, .11), .0105, .0105, P['steel'], seg=12)
    for t in range(6): k.ring(0, .052, .036 + t * .014, .0105, .0016, P['gun'], axis='z', seg=12, seg2=3)
    k.limb((0, .052, .11), (0, .052, .124), .006, .0045, P['gun'], seg=8); k.limb((0, .052, .124), (0, .052, .13), .003, .003, P['steel'], seg=6)
    k.limb((0, .045, .05), (0, .036, .11), .002, .002, P['brass'], seg=5)  # steam pipe
    for sd in (-1, 1): k.limb((sd * .009, .05, -.03), (sd * .009, .05, -.045), .0035, .0035, P['wood'], seg=6)
    k.box(0, .062, -.012, .006, .01, .004, P['steel'])
    k.box(.034, .018, .005, .022, .03, .04, P['olive'], bevel=.003); k.box(.034, .034, .005, .023, .003, .041, P['drab2'], bevel=.001)
    for t in range(9): k.limb((.018 - t * .0005, .045 - t * .0025, .006 - t * .002), (.02, .045 - t * .0025, .006 - t * .002), .002, .002, P['brass'], seg=4)
    k.box(0, .038, .05, .07, .045, .004, P['olive'], house=False, rx=-.12, bevel=.002); k.box(0, .055, .052, .016, .006, .005, P['black'])
    return k.done()

def wheel(k, x, y, z, R, w, spokes=12, house=False):
    k.ring(x, y, z, R - .004, .0045, P['wood'], axis='x', seg=24, seg2=4)
    k.ring(x, y, z, R - .0005, .0022, P['steel'], axis='x', seg=24, seg2=3)
    for i in range(spokes):
        a = i / spokes * math.tau
        k.limb((x, y, z), (x, y + math.sin(a) * (R - .006), z + math.cos(a) * (R - .006)), .0022, .0017, P['wood'], seg=5)
    k.cyl(x, y, z, .009, .009, w, P['steel'], axis='x', seg=10); k.cyl(x, y, z, .004, .004, w + .01, P['gun'], axis='x', seg=8)

def field_gun75():
    k = Kit('art')
    for sd in (-1, 1): wheel(k, sd * .064, .056, 0, .056, .014)
    k.limb((-.07, .056, 0), (.07, .056, 0), .005, .005, P['steel'], seg=8)
    # shield with a sight hole and rivets, team band along the top
    k.box(0, .088, .012, .12, .066, .005, P['olive'], rx=-.09, bevel=.002)
    k.box(0, .118, .009, .12, .01, .006, P['olive'], house=True, rx=-.09, bevel=.002)
    k.box(-.024, .1, .016, .012, .01, .007, P['black'])
    for i in range(7):
        for yy in (.06, .114): k.ball(-.054 + i * .018, yy, .016, .0018, P['rivet'], seg=4)
    k.box(0, .07, .02, .032, .03, .08, P['gun'], bevel=.004)                             # cradle
    k.limb((0, .074, -.02), (0, .074, .2), .0085, .0068, P['gun'], seg=12)              # barrel
    k.ring(0, .074, .2, .0068, .0018, P['gun'], axis='z', seg=10, seg2=3)
    k.limb((0, .058, -.01), (0, .058, .09), .0095, .0095, P['steel'], seg=10)          # recuperator
    k.box(0, .074, -.03, .024, .024, .022, P['steel'], bevel=.003)                      # breech
    k.limb((.014, .082, -.03), (.03, .09, -.04), .002, .002, P['steel'], seg=4); k.ball(.03, .09, -.04, .004, P['gun'], seg=6)
    k.box(-.02, .09, -.005, .006, .016, .02, P['gun'], bevel=.001)                      # sight
    k.box(0, .045, -.1, .032, .02, .17, P['olive'], rx=.16, bevel=.004)                 # trail
    k.box(0, .016, -.182, .05, .03, .01, P['steel'], bevel=.002); k.limb((0, .03, -.17), (.03, .05, -.2), .003, .003, P['wood'], seg=5)
    for sd in (-1, 1): k.box(sd * .045, .07, -.01, .022, .004, .02, P['leather'], bevel=.002)   # axle seats
    k.box(-.13, .014, -.09, .05, .028, .05, P['wood'], bevel=.003)                      # ammunition
    for i in range(4): k.limb((-.145 + i * .01, .03, -.105), (-.145 + i * .01, .03, -.07), .004, .0035, P['brass'], seg=6)
    return k.done()

# ---------------------------------------------------------------- tanks
def track_loop(k, sd, x, pts, n, w=.044, t=.008):
    """Track shoes around a closed profile in the (z, y) plane, at lateral position x."""
    seg = []; total = 0
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]; L = math.hypot(b[0] - a[0], b[1] - a[1]); seg.append((a, b, L)); total += L
    step = total / n
    for i in range(n):
        s = i * step
        for a, b, L in seg:
            if s <= L:
                f = s / L; z = a[0] + (b[0] - a[0]) * f; y = a[1] + (b[1] - a[1]) * f
                ang = math.atan2(b[1] - a[1], -(b[0] - a[0])); nz, ny = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
                k.box(x, y - ny * t * .5, z - nz * t * .5, w, t, step * .82, P['track'] if i % 2 else P['tar'], rx=ang)
                break
            s -= L

def rivet_row(k, x, a, b, n, r=.0022, c=None):
    for i in range(n):
        f = (i + .5) / n; k.box(x, a[1] + (b[1] - a[1]) * f, a[0] + (b[0] - a[0]) * f, r * 1.6, r * 1.6, r * 1.6, c or P['rivet'])

def tank_mk4():
    k = Kit('tank_mk4'); L, H, W = .36, .135, .054
    prof = [(-L / 2 - .02, H * .45), (-L / 2 + .02, H), (L / 2 - .03, H), (L / 2 + .025, H * .55), (L / 2 - .05, .012), (-L / 2, .012)]
    for sd in (-1, 1):
        xo = sd * (W + .036); xi = sd * W
        k.poly([(xo, y, z) for z, y in prof], P['drab'], thick=.034 * sd * (1 if sd > 0 else 1))
        # raised inner plate, recognition stripes (team colour) on the front horns, rivets along every edge
        inner = [(z * .84, .02 + (y - .012) * .78) for z, y in prof]
        k.poly([(xo + sd * .0025, y, z) for z, y in inner], P['drab2'], house=True, thick=.002)
        for j, zz in enumerate((.135, .15, .165)):
            k.box(xo + sd * .003, .09, zz, .004, .07, .009, P['white'] if j != 1 else P['red'], house=(j == 1), rx=.55)
        for i in range(len(prof)):
            a, b = prof[i], prof[(i + 1) % len(prof)]; n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1]) / .016))
            rivet_row(k, xo + sd * .003, (a[0] * .93, a[1] * .96 + .004), (b[0] * .93, b[1] * .96 + .004), n)
        track_loop(k, sd, sd * (W + .018), [(z * 1.03, y * 1.03 - .004) for z, y in prof], 52)
        # sponson with a 6-pounder in a ball mantlet, team panel
        k.box(sd * (W + .052), .066, .012, .032, .05, .085, P['drab'], house=True, bevel=.004)
        k.poly([(sd * (W + .068), .042, .055), (sd * (W + .068), .09, .055), (sd * (W + .052), .09, .07), (sd * (W + .052), .042, .07)], P['drab'], house=True)
        k.ball(sd * (W + .07), .07, .03, .012, P['drab2'], seg=10)
        k.limb((sd * (W + .074), .07, .03), (sd * (W + .085), .072, .1), .005, .0042, P['gun'], seg=8)
        k.box(sd * (W + .069), .086, -.01, .002, .006, .02, P['black'])
        rivet_row(k, sd * (W + .069), (-.028, .044), (.05, .044), 6); rivet_row(k, sd * (W + .069), (-.028, .088), (.05, .088), 6)
    k.box(0, H * .6, -.01, W * 2, H * .55, L * .74, P['drab'], bevel=.004)              # hull between the frames
    k.box(0, H + .02, .06, .075, .034, .06, P['drab'], house=True, bevel=.004)          # driver's cab
    for i in range(3): k.box(-.022 + i * .022, H + .025, .0905, .012, .004, .002, P['black'])
    k.box(0, H + .039, .055, .03, .004, .028, P['drab2'], bevel=.002)                   # hatch
    rivet_row(k, .038, (.032, H + .006), (.088, H + .006), 5); rivet_row(k, -.038, (.032, H + .006), (.088, H + .006), 5)
    k.box(0, H + .006, -.04, .09, .012, .1, P['drab2'], bevel=.003)                     # engine roof
    k.limb((-.02, H + .012, -.1), (.02, H + .012, -.1), .009, .009, P['rust'], seg=10)  # silencer
    for sd in (-1, 1): k.limb((sd * .02, H + .012, -.1), (sd * .02, H + .05, -.11), .004, .004, P['rust'], seg=6)
    for sd in (-1, 1): k.box(sd * (W + .02), H + .016, -.02, .006, .004, .26, P['steel'])  # beam rails
    k.box(0, H + .026, -.11, .19, .018, .018, P['timber'], bevel=.003)                 # unditching beam
    for sd in (-1, 1): k.limb((sd * .07, H + .026, -.11), (sd * .07, H + .016, -.05), .0015, .0015, P['steel'], seg=4)
    return k.done()

def tank_ft():
    k = Kit('tank_ft'); L, W = .22, .04
    prof = [(-L / 2, .02), (-L / 2 + .01, .06), (L / 2 - .01, .065), (L / 2 + .02, .035), (L / 2, .008), (-L / 2 + .02, .008)]
    for sd in (-1, 1):
        k.poly([(sd * (W + .024), y, z) for z, y in prof], P['drab2'], thick=.022)
        track_loop(k, sd, sd * (W + .013), [(z * 1.04, y * 1.05 - .003) for z, y in prof], 40, w=.03)
        k.cyl(sd * (W + .013), .04, L / 2 - .005, .028, .028, .026, P['drab2'], axis='x', seg=16, smooth=False)  # front idler
        rivet_row(k, sd * (W + .026), (-.09, .058), (.09, .062), 9)
    k.box(0, .055, -.01, W * 2, .045, .17, P['drab'], house=True, bevel=.004)
    k.poly([(-W, .078, .075), (W, .078, .075), (W, .045, .11), (-W, .045, .11)], P['drab'], house=True, thick=.004)
    k.box(0, .07, .1, .035, .02, .004, P['drab2'], rx=-.8, bevel=.002)
    k.cyl(0, .098, .01, .03, .026, .04, P['drab'], house=True, seg=8, smooth=False)    # turret
    k.ball(0, .118, .01, .014, P['drab2'], sy=.7, seg=10)
    k.limb((0, .1, .03), (0, .1, .085), .0055, .005, P['gun'], seg=8)
    k.box(0, .015, -.13, .03, .01, .05, P['steel'], rx=.4, bevel=.002)                 # tail skid
    return k.done()

def tank_a7v():
    k = Kit('tank_a7v'); L, W = .3, .07
    for sd in (-1, 1):
        track_loop(k, sd, sd * (W - .01), [(-L / 2 + .02, .03), (L / 2 - .02, .03), (L / 2 - .03, .006), (-L / 2 + .03, .006)], 36, w=.03)
    k.poly([(-W, .03, -L / 2), (W, .03, -L / 2), (W, .03, L / 2), (-W, .03, L / 2)], P['drab'], thick=.004)
    for sd in (-1, 1):  # sloped armour skirts
        k.poly([(sd * W, .03, -L / 2), (sd * W, .03, L / 2), (sd * (W - .012), .1, L / 2 - .01), (sd * (W - .012), .1, -L / 2 + .01)], P['drab'], house=True, thick=.004 * sd)
        for i in range(3): k.box(sd * (W - .006), .07, -.08 + i * .08, .003, .012, .016, P['black'], ry=0)
        rivet_row(k, sd * (W - .002), (-L / 2 + .01, .036), (L / 2 - .01, .036), 14)
        rivet_row(k, sd * (W - .011), (-L / 2 + .02, .095), (L / 2 - .02, .095), 13)
        k.box(sd * (W - .004), .066, 0, .003, .02, .1, P['drab'], house=True)              # team panel
    k.box(0, .1, 0, (W - .012) * 2, .006, L - .02, P['drab2'], bevel=.002)
    k.box(0, .095, L / 2 - .015, (W - .012) * 2, .07, .008, P['drab'], rx=.3, bevel=.002)
    k.limb((0, .07, L / 2), (0, .072, L / 2 + .06), .007, .006, P['gun'], seg=8)         # 57 mm
    k.box(0, .118, .07, .05, .03, .05, P['drab'], house=True, bevel=.003)                # commander's cupola
    for i in range(4): k.box(-.015 + i * .01, .123, .096, .006, .004, .002, P['black'])
    rivet_row(k, 0, (-L / 2 + .02, .104), (L / 2 - .02, .104), 15)
    return k.done()

# ---------------------------------------------------------------- aircraft
def biplane():
    k = Kit('plane')
    secs = [(.13, .028, .03), (.1, .032, .034), (.05, .03, .032), (-.02, .025, .026), (-.08, .018, .02), (-.13, .009, .011)]
    for (z0, w0, h0), (z1, w1, h1) in zip(secs, secs[1:]):
        k.limb((0, 0, z0), (0, 0, z1), w0, w1, P['canvas'], house=True, seg=8)
    k.limb((0, 0, .13), (0, 0, .148), .031, .029, P['steel'], seg=14); k.ring(0, 0, .14, .03, .003, P['gun'], axis='z', seg=14)
    for wy, wz, span, ch in ((.062, .04, .4, .066), (-.022, .045, .36, .06)):
        k.box(0, wy, wz, span, .006, ch, P['wing'], bevel=.002)
        for i in range(-6, 7):
            if i: k.box(i * span / 14, wy + .0035, wz, .003, .002, ch * .96, P['canvas'])  # ribs
        for sd in (-1, 1): k.box(sd * span * .38, wy - .001, wz - ch * .38, span * .22, .006, ch * .24, P['canvas'], bevel=.001)  # ailerons
    for sd in (-1, 1):
        for zz in (.018, .066): k.limb((sd * .14, -.019, zz), (sd * .14, .059, zz), .0025, .0025, P['wood'], seg=5)
        k.limb((sd * .14, -.019, .02), (sd * .03, .059, .066), .0007, .0007, P['steel'], seg=3)    # flying wires
        k.limb((sd * .14, .059, .02), (sd * .03, -.019, .066), .0007, .0007, P['steel'], seg=3)
        k.limb((sd * .02, -.02, .07), (sd * .036, -.062, .06), .0025, .0025, P['wood'], seg=5)
        k.limb((sd * .02, -.02, .045), (sd * .036, -.062, .06), .0025, .0025, P['wood'], seg=5)
        k.cyl(sd * .038, -.062, .06, .015, .015, .008, P['tyre'], axis='x', seg=14); k.cyl(sd * .038, -.062, .06, .007, .007, .009, P['canvas'], axis='x', seg=10)
    k.limb((-.04, -.062, .06), (.04, -.062, .06), .002, .002, P['steel'], seg=4)
    k.box(0, 0, -.135, .14, .005, .038, P['wing'], bevel=.002); k.box(0, .024, -.138, .005, .044, .03, P['canvas'], house=True, bevel=.001)
    k.box(0, .025, .0, .024, .01, .034, P['black'], bevel=.002); k.ball(0, .036, -.006, .009, P['leather'], seg=8)
    for sd in (-1, 1): k.limb((sd * .007, .03, .03), (sd * .007, .03, .09), .003, .003, P['gun'], seg=6)
    k.box(0, .028, .045, .03, .01, .05, P['canvas'], house=True, bevel=.003)            # gun hump
    for i in range(7):  # rotary cylinders peeking out of the cowling
        a = i / 7 * math.tau; k.limb((math.cos(a) * .018, math.sin(a) * .018, .142), (math.cos(a) * .027, math.sin(a) * .027, .142), .004, .004, P['steel'], seg=5)
    return k.done()

def propeller():
    k = Kit('prop')
    for sd in (-1, 1): k.box(sd * .04, 0, .152, .075, .011, .004, P['wood'], ry=sd * .15, bevel=.0015)
    k.cyl(0, 0, .152, .007, .005, .012, P['steel'], axis='z', seg=8)
    return k.done()

def markings():
    """National markings on the plane (wings from above, fuselage sides, rudder): one mesh per faction."""
    out = []
    def roundel(k, x, y, z, r, rings, axis='y'):
        for i, (f, c) in enumerate(rings): k.cyl(x, y + i * .0006 * (1 if axis == 'y' else 0), z, r * f, r * f, .0012, c, axis=axis, seg=12, smooth=False)
    spec = {
        0: [(1, P['blue']), (.66, P['white']), (.33, P['red'])], 1: [(1, P['red']), (.66, P['white']), (.33, P['blue'])],
        2: [(1, P['white']), (.66, P['blue']), (.33, P['red'])],
        6: [(1, P['red']), (.66, P['blue']), (.33, P['white'])],   # US Air Service, 1918
    }
    for f in range(7):
        k = Kit(f'mark_{f}', jitter=0)
        for sd in (-1, 1):
            for x, y, z, r in ((sd * .13, .0658, .04, .024), (sd * .12, -.0178, .045, .021)):
                if f in spec: roundel(k, x, y, z, r, spec[f])
                elif f in (3, 4):
                    k.box(x, y, z, r * 2, .0012, r * 2, P['white']); k.box(x, y + .0007, z, r * 1.7, .0012, r * .5, P['black']); k.box(x, y + .0007, z, r * .5, .0012, r * 1.7, P['black'])
                else:
                    k.box(x, y, z, r * 2, .0012, r * 2, P['white']); k.box(x, y + .0007, z, r * 1.3, .0012, r * 1.3, P['black'])
        if f in (0, 1, 2, 6):
            cols = [P['blue'], P['white'], P['red']] if f in (0, 1, 6) else [P['white'], P['blue'], P['red']]
            for i, c in enumerate(cols): k.box(0, .026, -.143 - i * .0055, .0062, .04, .0056, c)
        else:
            k.box(0, .028, -.14, .0062, .022, .022, P['black'] if f != 5 else P['red'])
        out.append(k.done())
    return out

# ---------------------------------------------------------------- defences
def sandbag_ring(k, cx, cz, R, n, rows=2, y0=.0, gap=None):
    for r in range(rows):
        for i in range(n):
            a = (i + (r % 2) * .5) / n * math.tau
            if gap and abs(math.atan2(math.sin(a - gap), math.cos(a - gap))) < .45: continue
            k.ball(cx + math.sin(a) * R, y0 + .009 + r * .014, cz + math.cos(a) * R, .013, P['bag'] if (i + r) % 3 else P['bag2'], sy=.55, seg=6)

# ---------------------------------------------------------------- buildings (footprints match render/dynamic.ts plots)
def windows(k, x0, x1, y, z, n, w, h, face=1):
    for i in range(n):
        x = x0 + (x1 - x0) * (i + .5) / n
        k.box(x, y, z, w + .006, h + .006, .004, P['stone']); k.box(x, y, z + face * .002, w, h, .004, P['window'])
        k.box(x, y, z + face * .003, .0015, h, .002, P['stone'])

def factory():
    k = Kit('factory', jitter=.06)
    hx, hz, H = .46, .3, .16
    k.box(0, H / 2, 0, hx, H, hz, P['brick'], bevel=.003)
    k.box(0, .006, 0, hx + .01, .012, hz + .01, P['stone'], bevel=.002)
    for i in range(5):  # sawtooth roof: slate slopes and north lights
        x = -hx / 2 + (i + .5) * hx / 5; w = hx / 5
        k.poly([(x - w / 2, H, -hz / 2), (x + w / 2 - .004, H + .05, -hz / 2), (x + w / 2 - .004, H + .05, hz / 2), (x - w / 2, H, hz / 2)], P['slate'], thick=.004)
        k.poly([(x + w / 2 - .004, H + .05, hz / 2), (x + w / 2 - .004, H + .05, -hz / 2), (x + w / 2, H, -hz / 2), (x + w / 2, H, hz / 2)], P['glass'])
        for zz in (-hz / 2, hz / 2): k.poly([(x - w / 2, H, zz), (x + w / 2, H, zz), (x + w / 2 - .004, H + .05, zz)], P['brick2'])
    for sd in (-1, 1): windows(k, -hx / 2 + .02, hx / 2 - .02, H * .55, sd * (hz / 2 + .001), 7, .03, .05, sd)
    k.box(.06, .045, hz / 2 + .003, .07, .09, .006, P['timber2'], bevel=.002); k.box(.06, .093, hz / 2 + .004, .08, .008, .008, P['stone'])
    # office block with the owner's banner, chimneys, water tower, yard
    k.box(-hx / 2 - .05, .06, .06, .1, .12, .14, P['brick2'], bevel=.003); k.roof(-hx / 2 - .05, .12, .06, .11, .04, .15, P['slate'])
    windows(k, -hx / 2 - .095, -hx / 2 - .005, .085, .131, 3, .018, .03); windows(k, -hx / 2 - .095, -hx / 2 - .005, .04, .131, 3, .018, .03)
    k.box(-hx / 2 - .05, .1, .133, .03, .05, .003, P['red'], house=True)
    for cx, cz, h in ((.16, -.1, .52), (.1, -.11, .44)):
        k.limb((cx, .0, cz), (cx, h, cz), .026, .018, P['brick2'], seg=10)
        for t in (.3, .6, .9): k.ring(cx, h * t, cz, .026 - .008 * t, .0025, P['brick'], axis='y', seg=10, seg2=3)
        k.ring(cx, h, cz, .019, .004, P['tar'], axis='y', seg=10, seg2=3)
    k.cyl(-.15, .2, -.19, .04, .04, .05, P['timber'], seg=12); k.cyl(-.15, .227, -.19, .042, .02, .02, P['slate'], seg=12)
    for a in range(4): k.limb((-.15 + math.cos(a * 1.57 + .78) * .032, 0, -.19 + math.sin(a * 1.57 + .78) * .032), (-.15 + math.cos(a * 1.57 + .78) * .028, .176, -.19 + math.sin(a * 1.57 + .78) * .028), .003, .003, P['steel'], seg=4)
    for i in range(5): k.box(.2 + (i % 2) * .03, .012 + (i // 2) * .022, .17 + (i % 3) * .02, .025, .022, .025, P['timber'], bevel=.002)
    for i in range(3): k.cyl(-.02 + i * .02, .014, .19, .009, .009, .028, P['rust'], seg=8)
    for sd in (-1, 1): k.box(.0, .003, .23 + sd * .012, .5, .004, .004, P['steel'])          # rail siding
    for i in range(12): k.box(-.24 + i * .044, .001, .23, .008, .003, .04, P['timber2'])
    return k.done()

def barracks():
    k = Kit('barracks', jitter=.06)
    for zz in (-.07, .07):
        k.box(0, .04, zz, .5, .08, .1, P['timber'], bevel=.002)
        for i in range(12): k.box(-.245 + i * .045, .04, zz + .051, .002, .078, .002, P['timber2'])
        k.roof(0, .08, zz, .12, .045, .54, P['tar'], axis='x')
        for sd in (-1, 1): windows(k, -.22, .22, .045, zz + sd * .051, 6, .022, .026, sd)
        k.box(.26, .03, zz, .006, .06, .03, P['timber2']); k.limb((.12, .1, zz), (.12, .15, zz), .005, .005, P['tar'], seg=6)
    k.limb((-.3, 0, 0), (-.3, .3, 0), .003, .003, P['white'], seg=6)                      # flagpole and the owner's flag
    k.box(-.27, .27, 0, .06, .036, .003, P['red'], house=True, rz=0)
    for i in range(10): k.ball(-.28 + i * .06, .01, .17, .014, P['bag'] if i % 2 else P['bag2'], sy=.55, seg=6)
    for i in range(14): k.limb((-.33 + i * .05, 0, -.17), (-.33 + i * .05, .04, -.17), .002, .002, P['timber2'], seg=4)
    k.box(0, .028, -.17, .7, .002, .002, P['steel']); k.box(0, .015, -.17, .7, .002, .002, P['steel'])
    return k.done()

def hangar():
    k = Kit('hangar', jitter=.05)
    W, H, Lh = .3, .13, .26
    n = 8
    for side in (-1, 1):
        pts = []
        for i in range(n + 1):
            a = i / n * math.pi; pts.append((math.cos(a) * W / 2, .02 + math.sin(a) * H))
        for i in range(n):  # canvas arch
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            if side > 0: k.poly([(x0, y0, -Lh / 2), (x1, y1, -Lh / 2), (x1, y1, Lh / 2), (x0, y0, Lh / 2)], P['canvas'] if i % 2 else P['wing'])
        if side > 0:
            k.poly([(x, y, -Lh / 2) for x, y in reversed(pts)] + [(W / 2, 0, -Lh / 2), (-W / 2, 0, -Lh / 2)], P['canvas'])
    k.poly([(x, y, Lh / 2 - .002) for x, y in pts], P['black'])
    for i in range(5):
        z = -Lh / 2 + i * Lh / 4
        for j in range(n): (x0, y0), (x1, y1) = pts[j], pts[j + 1]; k.limb((x0, y0, z), (x1, y1, z), .0025, .0025, P['timber2'], seg=4)
    for sd in (-1, 1): k.limb((sd * W / 2, 0, Lh / 2), (sd * W / 2, .02, Lh / 2), .004, .004, P['timber2'], seg=4)
    k.limb((W / 2 + .05, 0, .1), (W / 2 + .05, .2, .1), .0025, .0025, P['white'], seg=4)    # windsock in the owner's colours
    k.limb((W / 2 + .05, .19, .1), (W / 2 + .1, .185, .1), .01, .005, P['red'], house=True, seg=8)
    return k.done()

# ---------------------------------------------------------------- scenery (foliage and walls take the instance colour: biome / town palette)
LEAF = srgb('#b9c2a4'); WALL = srgb('#d8d2c0')

def blob(k, x, y, z, r, c, house=True, sy=.85):
    k.ball(x, y, z, r, c, house, sy=sy, seg=7)

def tree_broad():
    k = Kit('tree_broad', jitter=.12)
    k.limb((0, 0, 0), (0, .5, 0), .045, .03, P['timber2'], seg=6)
    for a, l in ((.7, .3), (2.6, .28), (4.4, .3)): k.limb((0, .32, 0), (math.cos(a) * .16, .52, math.sin(a) * .16), .02, .012, P['timber2'], seg=5)
    for (x, y, z, r) in ((0, .62, 0, .27), (-.17, .55, -.1, .2), (.18, .5, .06, .2), (-.06, .5, .2, .19), (.1, .72, -.12, .18), (.03, .82, .03, .17), (-.12, .76, .08, .15)):
        blob(k, x, y, z, r, LEAF)
    return k.done()

def tree_pine():
    k = Kit('tree_pine', jitter=.1)
    k.limb((0, 0, 0), (0, .3, 0), .035, .03, P['timber2'], seg=6)
    for i in range(5):
        y = .16 + i * .16; r = .3 * (1 - i * .17)
        k.cyl(0, y + .09, 0, r, r * .25, .2, LEAF, True, seg=8, smooth=False)
    k.cyl(0, 1.0, 0, .06, .0, .14, LEAF, True, seg=6, smooth=False)
    return k.done()

def tree_palm():
    k = Kit('tree_palm', jitter=.1)
    pts = [(0, 0, 0), (.03, .25, .01), (.08, .5, .02), (.15, .72, .03)]
    for a, b in zip(pts, pts[1:]): k.limb(a, b, .03, .025, P['timber'], seg=6)
    for i in range(7):
        a = i / 7 * math.tau; tip = (.15 + math.cos(a) * .32, .6, .03 + math.sin(a) * .32); mid = (.15 + math.cos(a) * .16, .78, .03 + math.sin(a) * .16)
        k.limb((.15, .74, .03), mid, .012, .03, LEAF, True, seg=4); k.limb(mid, tip, .03, .004, LEAF, True, seg=4)
    return k.done()

def tree_acacia():
    k = Kit('tree_acacia', jitter=.1)
    k.limb((0, 0, 0), (.03, .45, 0), .03, .022, P['timber2'], seg=6)
    for a in (.4, 2.3, 4.2): k.limb((.03, .4, 0), (math.cos(a) * .2, .55, math.sin(a) * .2), .015, .01, P['timber2'], seg=5)
    for (x, z, r) in ((0, 0, .32), (-.18, .08, .2), (.17, -.08, .22), (.05, .2, .18)): blob(k, x, .6, z, r, LEAF, sy=.32)
    return k.done()

def shrub():
    k = Kit('shrub', jitter=.15)
    for (x, y, z, r) in ((0, .12, 0, .2), (-.14, .08, .06, .14), (.12, .09, -.05, .15), (.03, .2, .05, .12)): blob(k, x, y, z, r, LEAF, sy=.8)
    return k.done()

def windows_unit(k, xs, y, z, w, h, face=1, axis='x'):
    for x in xs:
        if axis == 'x':
            k.box(x, y, z, w + .04, h + .04, .02, P['stone']); k.box(x, y, z + face * .008, w, h, .02, P['window'])
        else:
            k.box(z, y, x, .02, h + .04, w + .04, P['stone']); k.box(z + face * .008, y, x, .02, h, w, P['window'])

def build():
    import buildings as bl
    figs = [figure('soldier', 'stand'), figure('soldier_walk_a', 'walk_a'), figure('soldier_walk_b', 'walk_b'), figure('soldier_kneel', 'kneel'),
            figure('soldier_aim', 'stand', 'aim'), figure('soldier_kneel_aim', 'kneel', 'aim'), figure('soldier_throw', 'walk_a', 'throw'),
            figure('soldier_prone', 'stand', 'up', 'prone'), figure('soldier_dead', 'stand', 'ready', 'dead')]
    return figs + helmets_hi() + [vickers(), field_gun75(), tank_mk4(), tank_ft(), tank_a7v(), biplane(), propeller()] + markings() + \
        [bl.pillbox_hi(), bl.bunker_hi(), factory(), barracks(), hangar()] + \
        [tree_broad(), tree_pine(), tree_palm(), tree_acacia(), shrub(), bl.house_a(), bl.house_b(), bl.church()]
