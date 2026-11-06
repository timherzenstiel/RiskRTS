"""Painted texture atlas for the unit models (Classic RTS look, design §1.2: "one shared texture atlas with baked AO and
hand-painted wear").

Every model gets a UV map packed into one shared atlas. Cycles bakes, per texel: the part's paint and house mask (vertex
colours), its material class (`cls` face attribute from models.Kit), object-space position and normal, a bevel-based edge
mask and ambient occlusion. numpy then paints the surface per class from those maps:

  wool      folds and creases, seams of darker cloth, worn lighter edges
  canvas    weave speckle, water stains
  leather   dark creases, scuffed lighter edges
  wood      grain along the part, darker knots
  paint     painted steel: mottled paint, chipped edges showing steel, rust streaks running down
  steel     dark gunmetal, polished edges, rust in the creases
  concrete  blotches, pockmarks, rain streaks
  earth/sand, brass, skin, plain   light variation only

and over everything: grime in occluded corners, mud splashed up from the ground (also taking the house tint away there),
light catching the edges, and the baked occlusion. Output: RGB albedo (sRGB) + A house mask, one WebP.

Used by models.py (`texture(objs)` before the vertex AO bake). Run standalone for a quick test of a few models:
    python3 tools/bake/texture.py
"""
import math, os, sys, time
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from models import MATS

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'packages', 'client', 'public', 'art', 'units.webp')
SIZE = int(os.environ.get('ATLAS', '2048'))
M = {k: i for i, k in enumerate(MATS)}
NAMES = []

# texel density per model, relative: things seen close and often get more of the atlas
def weight(name):
    if name.startswith(('soldier', 'helm')): return 1.6
    if name.startswith(('tank', 'mg', 'art', 'plane', 'prop')): return 1.25
    if name.endswith('_lo'): return .5
    if name.startswith(('pill', 'bunk', 'mark')): return .9
    return .7

# ------------------------------------------------------------------ noise (deterministic, numpy)
def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h &= 0xFFFFFFFF; h ^= h >> 13; h = (h * 1274126177) & 0xFFFFFFFF; h ^= h >> 16
    return (h & 0xFFFF).astype(np.float32) / 65535.0

def vnoise(p, seed=0):
    """Smooth value noise in 3D, p: (n, 3) already scaled. 0..1."""
    f = np.floor(p); i = f.astype(np.int64); t = p - f; t = t * t * (3 - 2 * t)
    x0, y0, z0 = i[:, 0], i[:, 1], i[:, 2]; x1, y1, z1 = x0 + 1, y0 + 1, z0 + 1
    tx, ty, tz = t[:, 0], t[:, 1], t[:, 2]
    def L(a, b, w): return a + (b - a) * w
    return L(L(L(_hash(x0, y0, z0, seed), _hash(x1, y0, z0, seed), tx), L(_hash(x0, y1, z0, seed), _hash(x1, y1, z0, seed), tx), ty),
             L(L(_hash(x0, y0, z1, seed), _hash(x1, y0, z1, seed), tx), L(_hash(x0, y1, z1, seed), _hash(x1, y1, z1, seed), tx), ty), tz)

def fbm(p, oct=4, seed=0):
    a, s, n = .5, 1.0, np.zeros(len(p), np.float32)
    for o in range(oct): n += a * vnoise(p * s, seed + o * 17); a *= .5; s *= 2.03
    return n / (1 - .5 ** oct)

def ss(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

# ------------------------------------------------------------------ UVs
def unwrap(objs):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        if 'UV' not in o.data.uv_layers: o.data.uv_layers.new(name='UV')
        o.data.uv_layers.active = o.data.uv_layers['UV']; o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT'); bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    import bmesh
    for o in objs:   # tiny parts (rivets, track links, bolts) only need their colour: shrink their islands so the big surfaces get the room
        bm = bmesh.new(); bm.from_mesh(o.data); uvl = bm.loops.layers.uv['UV']; seen = set()
        for f in bm.faces:
            if f.index in seen: continue
            part, stack = [], [f]; seen.add(f.index)
            while stack:
                g = stack.pop(); part.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen: seen.add(h.index); stack.append(h)
            vs = {v for g in part for v in g.verts}; co = np.array([v.co for v in vs])
            size = np.linalg.norm(co.max(0) - co.min(0))
            if size < .016:
                ls = [l for g in part for l in g.loops]; c = sum((l[uvl].uv for l in ls), ls[0][uvl].uv * 0) / len(ls)
                for l in ls: l[uvl].uv = c + (l[uvl].uv - c) * .3
        bm.to_mesh(o.data); bm.free()
    for o in objs:   # density weighting: islands are scaled in place, packing then keeps their relative size
        w = weight(o.name); uv = o.data.uv_layers['UV'].data; a = np.empty(len(uv) * 2, np.float32); uv.foreach_get('uv', a)
        uv.foreach_set('uv', a * w)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin_method='FRACTION', margin=4 / SIZE, shape_method='CONCAVE', scale=True)
    bpy.ops.object.mode_set(mode='OBJECT')

# ------------------------------------------------------------------ bake passes
def _img(name, alpha=False):
    im = bpy.data.images.get(name)
    if im: bpy.data.images.remove(im)
    im = bpy.data.images.new(name, SIZE, SIZE, alpha=alpha, float_buffer=True); im.colorspace_settings.name = 'Non-Color'
    return im

def _bake_mat(obj_id, kind):
    """Emission material that writes one pass; returns (material, image node)."""
    m = bpy.data.materials.new(f'bk_{kind}_{obj_id}'); m.use_nodes = True; N = m.node_tree.nodes; Ln = m.node_tree.links
    for n in list(N): N.remove(n)
    out = N.new('ShaderNodeOutputMaterial'); em = N.new('ShaderNodeEmission'); Ln.new(em.outputs[0], out.inputs['Surface'])
    if kind == 'col':
        at = N.new('ShaderNodeVertexColor'); at.layer_name = 'Col'; Ln.new(at.outputs['Color'], em.inputs['Color'])
    elif kind == 'mask':   # R house mask, G class/16, B object id/256
        at = N.new('ShaderNodeVertexColor'); at.layer_name = 'Col'
        cl = N.new('ShaderNodeAttribute'); cl.attribute_name = 'cls'; cl.attribute_type = 'GEOMETRY'
        dv = N.new('ShaderNodeMath'); dv.operation = 'DIVIDE'; dv.inputs[1].default_value = 16; Ln.new(cl.outputs['Fac'], dv.inputs[0])
        cmb = N.new('ShaderNodeCombineXYZ'); Ln.new(at.outputs['Alpha'], cmb.inputs[0]); Ln.new(dv.outputs[0], cmb.inputs[1])
        cmb.inputs[2].default_value = obj_id / 256; Ln.new(cmb.outputs[0], em.inputs['Color'])
    elif kind == 'pos':
        tc = N.new('ShaderNodeTexCoord'); Ln.new(tc.outputs['Object'], em.inputs['Color'])
    elif kind == 'nrm':   # object-space normal of the flat face, and the edge mask (how far a bevelled normal leans away from it)
        geo = N.new('ShaderNodeNewGeometry'); bev = N.new('ShaderNodeBevel'); bev.samples = 8; bev.inputs['Radius'].default_value = .0035
        dot = N.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'; Ln.new(geo.outputs['True Normal'], dot.inputs[0]); Ln.new(bev.outputs[0], dot.inputs[1])
        e = N.new('ShaderNodeMath'); e.operation = 'SUBTRACT'; e.inputs[0].default_value = 1; Ln.new(dot.outputs['Value'], e.inputs[1])
        tr = N.new('ShaderNodeVectorTransform'); tr.vector_type = 'NORMAL'; tr.convert_from = 'WORLD'; tr.convert_to = 'OBJECT'
        Ln.new(geo.outputs['True Normal'], tr.inputs[0])
        sep = N.new('ShaderNodeSeparateXYZ'); Ln.new(tr.outputs[0], sep.inputs[0])
        cmb = N.new('ShaderNodeCombineXYZ'); Ln.new(sep.outputs['Y'], cmb.inputs[0]); Ln.new(e.outputs[0], cmb.inputs[1]); Ln.new(sep.outputs['Z'], cmb.inputs[2])
        Ln.new(cmb.outputs[0], em.inputs['Color'])
    tex = N.new('ShaderNodeTexImage'); N.active = tex; tex.select = True
    return m, tex

def bake_pass(objs, kind, img, ground=None):
    sc = bpy.context.scene
    saved = [list(o.data.materials) for o in objs]
    for i, o in enumerate(objs):
        m, tex = _bake_mat(i, kind); tex.image = img; o.data.materials.clear(); o.data.materials.append(m)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    sc.render.bake.margin = 6; sc.render.bake.margin_type = 'EXTEND'; sc.render.bake.use_clear = True
    sc.render.bake.target = 'IMAGE_TEXTURES'
    if kind == 'ao':
        for o in objs:
            m = bpy.data.materials.new('bk_ao'); m.use_nodes = True; tex = m.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = img
            m.node_tree.nodes.active = tex; o.data.materials.clear(); o.data.materials.append(m)
        sc.cycles.samples = 32
        locs = [o.location.copy() for o in objs]
        for i, o in enumerate(objs): o.location = (i % 16 * 4.0, i // 16 * 4.0, 0)   # apart, so they don't occlude each other
        bpy.ops.object.bake(type='AO', use_selected_to_active=False)
        for o, l in zip(objs, locs): o.location = l
    else:
        sc.cycles.samples = 8 if kind == 'nrm' else 4; bpy.ops.object.bake(type='EMIT')
    for o, mats in zip(objs, saved):
        o.data.materials.clear()
        for m in mats: o.data.materials.append(m)
    a = np.empty(SIZE * SIZE * 4, np.float32); img.pixels.foreach_get(a)
    return a.reshape(SIZE, SIZE, 4)

# ------------------------------------------------------------------ painting
def lin(h): h = h.lstrip('#'); return np.array([(int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)], np.float32)
MUD, MUD_WET, RUST, STEEL, DUST = lin('#4a3a28'), lin('#2e2519'), lin('#6b3d22'), lin('#6e6c66'), lin('#8d8064')

def paint(col, msk, pos, nrm, ao, hgt, oname):
    """Per-texel albedo + house mask from the baked maps (all flattened to (n, ...)). Frequencies are per game unit
    (a soldier is 0.21 tall): detail finer than ~250/unit falls below a texel and is left out."""
    c = col[:, :3].copy(); base = msk[:, 0].copy(); house = np.ones(len(c), np.float32); cls = np.rint(msk[:, 1] * 16).astype(int)
    p = pos[:, :3]; ny = nrm[:, 0]; edge = np.clip(nrm[:, 1] * 4, 0, 1); occ = np.clip(ao[:, 0], 0, 1)
    is_ = lambda k: cls == M[k]
    big = fbm(p * 22, 3, 1); mid = fbm(p * 70, 3, 2)
    c *= (.8 + .4 * big)[:, None] * (.88 + .24 * mid)[:, None]

    # camouflage on vehicles: big soft blotches in three shades of the house paint (tint keeps the nation readable)
    veh = np.isin(oname, [i for i, n in enumerate(NAMES) if n.startswith(('tank', 'plane'))]) & (base > .25) & (base < .75)
    if veh.any():
        q = p[veh]; b1 = ss(.52, .58, fbm(q * 14, 3, 30)); b2 = ss(.55, .6, fbm(q * 18 + 7.3, 3, 31))
        c[veh] *= ((1 - b1) * (1 - b2) + b1 * .62 + b2 * (1 - b1) * 1.3)[:, None]

    w = is_('wool')
    if w.any():
        q = p[w]; fold = fbm(q * np.array([170, 34, 170]), 3, 3)          # creases run mostly down the garment
        c[w] *= (1 - .45 * ss(.5, .78, fold) + .16 * ss(.35, .15, fold))[:, None]
        c[w] *= (.9 + .2 * vnoise(q * 240, 4))[:, None] * (1 + .3 * edge[w])[:, None]
    w = is_('canvas')
    if w.any():
        q = p[w]; c[w] *= (.86 + .28 * vnoise(q * 230, 5))[:, None]
        c[w] *= (1 - .35 * ss(.55, .72, fbm(q * 60, 3, 6)))[:, None] * (1 + .25 * edge[w])[:, None]
    w = is_('leather')
    if w.any():
        q = p[w]; c[w] *= (.75 + .5 * fbm(q * 160, 3, 7))[:, None] * (1 + .8 * edge[w])[:, None]
    w = is_('wood')
    if w.any():
        q = p[w]; warp = fbm(q * 40, 2, 8)
        grain = .5 + .5 * np.sin((q[:, 0] * 31 + q[:, 2] * 29 + q[:, 1] * 7) * 9 + warp * 9)
        knot = ss(.75, .88, vnoise(q * 90, 9))
        c[w] *= (.7 + .5 * grain)[:, None] * (1 - .45 * knot)[:, None] * (1 + .4 * edge[w])[:, None]
    for k in ('paint', 'steel'):
        w = is_(k)
        if not w.any(): continue
        q = p[w]; e = edge[w]
        if k == 'paint':   # chipped paint at the edges and in scattered flecks, steel showing through
            chip = np.maximum(ss(.45, .6, e + (vnoise(q * 200, 10) - .5) * .5), ss(.8, .86, vnoise(q * 160, 20)) * .9)
            c[w] = c[w] * (1 - chip[:, None]) + STEEL * .55 * chip[:, None]
            house[w] *= 1 - chip
        else:              # bare gunmetal: polished where hands and rounds wear it
            c[w] *= (1 + .5 * e)[:, None]
        # rust streaks running down
        streak = fbm(q * np.array([160, 12, 160]), 3, 11) * (.55 + .45 * fbm(q * 30, 2, 12))
        rust = np.clip(ss(.4, .62, streak) * (.55 if k == 'paint' else .45) * (.5 + .8 * (1 - occ[w])), 0, .75)
        c[w] = c[w] * (1 - rust[:, None]) + RUST * rust[:, None]
        house[w] *= 1 - rust
    w = is_('concrete')
    if w.any():
        q = p[w]; c[w] *= (.75 + .5 * fbm(q * 60, 4, 13))[:, None]
        c[w] *= (1 - .5 * ss(.78, .86, vnoise(q * 220, 14)))[:, None]
        c[w] *= (1 - .3 * ss(.45, .72, fbm(q * np.array([180, 10, 180]), 2, 15)))[:, None] * (1 + .4 * edge[w])[:, None]
    w = is_('brass')
    if w.any(): c[w] *= (1 + 1.2 * edge[w])[:, None]
    w = is_('skin')
    if w.any(): c[w] *= (.92 + .16 * vnoise(p[w] * 200, 16))[:, None]

    # everything: dust on upward faces, grime in the creases, mud splashed up from the ground, light catching edges
    up = np.clip(ny, 0, 1)
    dust = up * ss(.4, .65, fbm(p * 90, 3, 17)) * .55
    c = c * (1 - dust[:, None]) + DUST * dust[:, None]
    house *= 1 - dust * .6
    mudn = fbm(p * np.array([110, 45, 110]), 4, 18)
    reach = np.where(np.isin(oname, [i for i, n in enumerate(NAMES) if n.startswith('tank')]), .5, .3)   # tracks churn it high
    mud = ss(reach, reach * .4, hgt + (mudn - .5) * .4) * ~is_('skin')
    wet = ss(.55, .7, fbm(p * 140, 2, 19))
    mc = MUD * (1 - wet[:, None]) + MUD_WET * wet[:, None]
    c = c * (1 - mud[:, None] * .9) + mc * mud[:, None] * .9
    house *= 1 - mud * .95
    c *= (1 + .35 * edge * (1 - mud))[:, None]
    c *= (.35 + .65 * np.power(occ, .9))[:, None]
    # the mask keeps its levels (1 team colour, .5 nation dress, 0 own paint): wear and mud cut it off rather than fade it,
    # so a half-worn team stripe never reads as dress. The painted value underneath still darkens the tint smoothly.
    return np.clip(c, 0, 1), base * (house > .5)

# ------------------------------------------------------------------ rasteriser (the emission passes, without Cycles)
EDGE_R = .0035   # how far from a convex sharp edge the edge mask reaches (game units)

def gather(objs):
    """Every loop triangle of every object: UVs (texels), corner colours, game-space corners, flat normal, class, object id, and
    for each triangle side whether it lies on a convex sharp edge of the model (edge wear and highlights)."""
    T = {k: [] for k in ('uv', 'col', 'p', 'n', 'cls', 'oid', 'sharp')}
    for oi, o in enumerate(objs):
        me = o.data; me.calc_loop_triangles()
        nl, nv, nf, nt = len(me.loops), len(me.vertices), len(me.polygons), len(me.loop_triangles)
        uv = np.empty(nl * 2, np.float32); me.uv_layers['UV'].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        ca = me.color_attributes['Col']; col = np.empty(nl * 4, np.float32); ca.data.foreach_get('color', col); col = col.reshape(-1, 4)
        co = np.empty(nv * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        lv = np.empty(nl, np.int64); me.loops.foreach_get('vertex_index', lv)
        fn = np.empty(nf * 3, np.float32); me.polygons.foreach_get('normal', fn); fn = fn.reshape(-1, 3)
        fc = np.empty(nf * 3, np.float32); me.polygons.foreach_get('center', fc); fc = fc.reshape(-1, 3)
        cls = np.zeros(nf, np.int64)
        if 'cls' in me.attributes: me.attributes['cls'].data.foreach_get('value', cls)
        tl = np.empty(nt * 3, np.int64); me.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
        tp = np.empty(nt, np.int64); me.loop_triangles.foreach_get('polygon_index', tp)
        # convex sharp edges: dihedral > 25 degrees and bending away (or open boundary)
        ek = {}
        for pi, poly in enumerate(me.polygons):
            for e in poly.edge_keys: ek.setdefault(e, []).append(pi)
        sharp = set()
        for e, fs in ek.items():
            if len(fs) == 1: sharp.add(e); continue
            a, b = fs[0], fs[1]
            if np.dot(fn[a], fn[b]) < .9 and np.dot(fc[b] - fc[a], fn[a]) < 1e-6: sharp.add(e)
        tv = lv[tl]
        sh = np.zeros((nt, 3), bool)
        for i in range(3):
            va, vb = tv[:, i], tv[:, (i + 1) % 3]
            sh[:, i] = [(min(x, y), max(x, y)) in sharp for x, y in zip(va.tolist(), vb.tolist())]
        g = co[tv][:, :, [0, 2, 1]] * np.array([1, 1, -1], np.float32)        # Blender (x, y, z up) -> game (x, y up, z)
        T['uv'].append(uv[tl] * SIZE); T['col'].append(col[tl]); T['p'].append(g)
        T['n'].append((fn[tp][:, [0, 2, 1]] * np.array([1, 1, -1], np.float32))); T['cls'].append(cls[tp]); T['oid'].append(np.full(nt, oi)); T['sharp'].append(sh)
    return {k: np.concatenate(v) for k, v in T.items()}

def rasterise(T):
    """Triangle id and barycentrics for every texel centre covered by a UV triangle. Small triangles go in one batch on a fixed
    window; large ones one by one."""
    tri = np.full(SIZE * SIZE, -1, np.int64); bar = np.zeros((SIZE * SIZE, 3), np.float32)
    uv = T['uv'].astype(np.float64); lo = np.floor(uv.min(1) - .5).astype(int); hi = np.ceil(uv.max(1) - .5).astype(int)
    span = (hi - lo).max(1)
    def put(ids, px, py):
        a, b, c = uv[ids, 0], uv[ids, 1], uv[ids, 2]
        x, y = px + .5, py + .5
        d = (b[..., 1] - c[..., 1]) * (a[..., 0] - c[..., 0]) + (c[..., 0] - b[..., 0]) * (a[..., 1] - c[..., 1])
        ok = np.abs(d) > 1e-12; d = np.where(ok, d, 1)
        w0 = ((b[..., 1] - c[..., 1]) * (x - c[..., 0]) + (c[..., 0] - b[..., 0]) * (y - c[..., 1])) / d
        w1 = ((c[..., 1] - a[..., 1]) * (x - c[..., 0]) + (a[..., 0] - c[..., 0]) * (y - c[..., 1])) / d
        w2 = 1 - w0 - w1
        e = -1e-6; m = ok & (w0 >= e) & (w1 >= e) & (w2 >= e) & (px >= 0) & (py >= 0) & (px < SIZE) & (py < SIZE)
        k = (py * SIZE + px)[m]; tri[k] = np.broadcast_to(ids, m.shape)[m]; bar[k] = np.stack([w0, w1, w2], -1)[m]
    W = 8
    small = np.nonzero(span < W)[0]
    for s in range(0, len(small), 20000):
        ids = small[s:s + 20000]; gx, gy = np.meshgrid(np.arange(W), np.arange(W)); gx, gy = gx.ravel(), gy.ravel()
        px = lo[ids, 0][:, None] + gx[None]; py = lo[ids, 1][:, None] + gy[None]
        put(ids[:, None], px, py)
    for i in np.nonzero(span >= W)[0]:
        xs, ys = np.meshgrid(np.arange(lo[i, 0], hi[i, 0] + 1), np.arange(lo[i, 1], hi[i, 1] + 1))
        put(np.array([i]), xs.ravel()[None], ys.ravel()[None])
    return tri, bar

def edge_mask(T, tid, P):
    """0..1: closeness of each texel's surface point to a convex sharp edge of its own triangle."""
    d = np.full(len(tid), np.inf, np.float32)
    for i in range(3):
        A = T['p'][tid, i]; B = T['p'][tid, (i + 1) % 3]; AB = B - A
        t = np.clip(((P - A) * AB).sum(1) / np.maximum((AB * AB).sum(1), 1e-12), 0, 1)
        di = np.linalg.norm(P - (A + AB * t[:, None]), axis=1)
        d = np.where(T['sharp'][tid, i], np.minimum(d, di), d)
    return ss(EDGE_R, 0, d)

def bake_ao_image(objs, size):
    """Ambient occlusion per texel at `size` (Cycles), objects pulled apart so they don't shade each other."""
    global SIZE
    keep = SIZE; SIZE = size
    try:
        img = _img('bk_ao'); a = bake_pass(objs, 'ao', img); bpy.data.images.remove(img)
    finally:
        SIZE = keep
    return a[..., 0]

def texture(objs, out=OUT, ao_size=None):
    """UV-unwrap `objs` into one atlas and paint it. Leaves a 'UV' map on every object; writes `out` (WebP, RGBA)."""
    from scipy import ndimage
    t0 = time.time(); sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
    sc.world = sc.world or bpy.data.worlds.new('w'); sc.world.light_settings.distance = .03
    unwrap(objs); print(f'unwrapped {len(objs)} models ({time.time() - t0:.0f}s)')
    T = gather(objs); print(f'{len(T["cls"])} triangles ({time.time() - t0:.0f}s)')
    tri, bar = rasterise(T); print(f'rasterised ({time.time() - t0:.0f}s)')
    # margins: every empty texel takes the nearest covered one, so mipmaps and filtering never pull in the background
    cov = (tri >= 0).reshape(SIZE, SIZE)
    idx = ndimage.distance_transform_edt(~cov, return_distances=False, return_indices=True)
    near = (idx[0] * SIZE + idx[1]).ravel(); tri, bar = tri[near], bar[near]
    pick = lambda a: (a[tri] * bar[..., None]).sum(1).astype(np.float32)
    P = pick(T['p']); col = pick(T['col']); nrm = T['n'][tri]; cls = T['cls'][tri]; oid = T['oid'][tri]
    edge = edge_mask(T, tri, P); print(f'maps ({time.time() - t0:.0f}s)')
    aos = ao_size or min(SIZE, 2048)
    ao = bake_ao_image(objs, aos); print(f'baked ao ({time.time() - t0:.0f}s)')
    if aos != SIZE: ao = ndimage.zoom(ao, SIZE / aos, order=1)
    ao = ndimage.gaussian_filter(ao, 1.0).ravel()
    # height above ground relative to the model's own height (mud reaches the lower third of anything)
    hgt = np.ones(len(P), np.float32)
    for i, o in enumerate(objs):
        if o.name.startswith(('helm', 'plane', 'prop', 'mark', 'dreadnought', 'turret', 'destroyer', 'liner', 'carrier', 'lighter')): continue
        sel = oid == i; ys = T['p'][T['oid'] == i][:, :, 1]
        if not sel.any() or not ys.size: continue
        lo, hi = ys.min(), ys.max(); hgt[sel] = np.clip((P[sel, 1] - lo) / max(hi - lo, .08), 0, 1)
    global NAMES; NAMES = [o.name for o in objs]
    del tri, bar, T
    img = np.empty((SIZE * SIZE, 4), np.float32)
    for s in range(0, len(P), 1 << 20):   # in chunks: the painting makes many temporaries per texel
        e = s + (1 << 20); sl = slice(s, e)
        msk = np.stack([col[sl, 3], cls[sl] / 16, oid[sl] / 256, np.ones(len(cls[sl]))], -1).astype(np.float32)
        nm = np.stack([nrm[sl, 1], edge[sl] / 4, nrm[sl, 2], np.ones(len(cls[sl]))], -1).astype(np.float32)
        rgb, house = paint(col[sl].astype(np.float32), msk, P[sl].astype(np.float32), nm, np.repeat(ao[sl, None], 4, 1), hgt[sl], oid[sl])
        img[sl, :3] = rgb; img[sl, 3] = house
    img = img.reshape(SIZE, SIZE, 4)[::-1]   # file rows top-down = Blender v from 1 to 0
    srgb = np.where(img[..., :3] <= .0031308, img[..., :3] * 12.92, 1.055 * np.power(img[..., :3], 1 / 2.4) - .055)
    from PIL import Image
    a = np.concatenate([srgb, img[..., 3:]], -1)
    Image.fromarray(np.clip(a * 255 + .5, 0, 255).astype(np.uint8), 'RGBA').save(out, 'WEBP', quality=86, method=6, exact=True)
    print(f'wrote {out} ({os.path.getsize(out) // 1024} KB, {time.time() - t0:.0f}s)')
    return out

if __name__ == '__main__':
    # quick test: a few models into /tmp/test.glb + /tmp/test.webp
    import importlib.util
    import models
    bpy.ops.wm.read_factory_settings(use_empty=True)
    spec = importlib.util.spec_from_file_location('hires', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hires.py'))
    hires = importlib.util.module_from_spec(spec); sys.modules['models'] = models; spec.loader.exec_module(hires)
    objs = [hires.figure('soldier', 'stand'), hires.figure('soldier_aim', 'stand', 'aim'), hires.figure('soldier_kneel_aim', 'kneel', 'aim')] + \
        hires.helmets_hi() + [hires.tank_mk4(), hires.tank_a7v(), hires.vickers(), hires.field_gun75()]
    texture(objs, '/tmp/test.webp')
    models.bake_ao(objs, ground_for=lambda o: not o.name.startswith('helm'))
    for o in objs: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath='/tmp/test.glb', export_format='GLB', use_selection=True, export_vertex_color='NAME', export_vertex_color_name='Col',
                              export_active_vertex_color_when_no_material=True, export_all_vertex_colors=False, export_normals=True, export_texcoords=True,
                              export_materials='PLACEHOLDER', export_yup=True, export_apply=True)
    print('wrote /tmp/test.glb')
