"""Low-poly unit models for the Classic RTS look (design: claude/design-graphics-classic-rts.md §1.2, §4).

Builds every model from primitives with bpy, paints it with vertex colours and exports one glTF binary:
packages/client/public/art/units.glb

Conventions (match render/models.ts):
  - game model units: a soldier is ~0.21 tall; +z (game) is forward = -Y in Blender (the glTF exporter turns Y up)
  - COLOR_0 = RGBA: RGB albedo (linear in the file), A = house-colour mask (1 where the faction tint replaces the paint: uniforms,
    tank hulls, fuselages), so one model serves all six nations.

Run inside Blender (or with the bpy module):
    blender -b -P tools/bake/models.py          or          python3 tools/bake/models.py
"""
import math, os, random
import bpy, bmesh
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'packages', 'client', 'public', 'art', 'units.glb')

def srgb(h):
    """sRGB triple; the byte colour layer stores sRGB and the glTF exporter writes linear COLOR_0."""
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

C = {
    'cloth': srgb('#8a8a7e'), 'cloth2': srgb('#6f6f64'), 'boot': srgb('#2b2119'), 'puttee': srgb('#6b5a40'), 'skin': srgb('#c79a78'),
    'leather': srgb('#5a3d24'), 'wood': srgb('#6b4a2c'), 'steel': srgb('#4a4d4f'), 'gun': srgb('#2e3133'), 'brass': srgb('#a8853a'),
    'khaki': srgb('#8c7e58'), 'canvas': srgb('#b7ab88'), 'pack': srgb('#6e6448'), 'helm': srgb('#5e6450'), 'hull': srgb('#7d7a6a'),
    'track': srgb('#2f2a24'), 'concrete': srgb('#9d9a8e'), 'concrete2': srgb('#7c796f'), 'slit': srgb('#121212'), 'wing': srgb('#c9bf9c'),
    'tyre': srgb('#1e1c1a'), 'sand': srgb('#a8946a'), 'earth': srgb('#5a4a34'), 'shield': srgb('#5b6152'),
}
HOUSE = 1.0

class Kit:
    """Accumulates primitives into one bmesh with per-loop RGBA colours."""
    def __init__(self, name, jitter=.05):
        self.name = name; self.bm = bmesh.new(); self.col = self.bm.loops.layers.color.new('Col')
        self.rng = random.Random(name); self.jitter = jitter

    def _paint(self, faces, c, house):
        j = 1 + (self.rng.random() - .5) * 2 * self.jitter   # each part a touch lighter or darker: hand-painted variation
        rgba = (min(1, c[0] * j), min(1, c[1] * j), min(1, c[2] * j), HOUSE if house else 0.0)
        for f in faces:
            for l in f.loops: l[self.col] = rgba

    def _add(self, res, c, house, smooth=False):
        faces = list({f for v in res for f in v.link_faces})
        for f in faces: f.smooth = smooth
        self._paint(faces, c, house)

    def box(self, x, y, z, sx, sy, sz, c, house=False, rz=0.0, rx=0.0, ry=0.0, bevel=0.0):
        """Box centred at game coords (x right, y up, z forward), sizes in game units. `bevel` chamfers the edges (catches the light)."""
        m = Matrix.Translation((x, -z, y)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Diagonal((sx, sz, sy, 1))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m); vs = r['verts']
        if bevel > 0:
            es = list({e for v in vs for e in v.link_edges})
            b = bmesh.ops.bevel(self.bm, geom=vs + es, offset=min(bevel, sx * .45, sy * .45, sz * .45), segments=1, affect='EDGES', profile=.5)
            vs = [v for v in ({v for f in b['faces'] for v in f.verts} | set(vs)) if v.is_valid]
        self._add(vs, c, house)

    def limb(self, p0, p1, r0, r1, c, house=False, seg=7, cap=True):
        """Tapered cylinder between two game-space points (arms, legs, barrels, struts)."""
        a, b = Vector((p0[0], -p0[2], p0[1])), Vector((p1[0], -p1[2], p1[1])); d = b - a; L = d.length
        if L < 1e-6: return
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        m = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
        r = bmesh.ops.create_cone(self.bm, cap_ends=cap, segments=seg, radius1=r0, radius2=r1, depth=L, matrix=m); self._add(r['verts'], c, house, True)

    def ring(self, x, y, z, R, r, c, house=False, axis='x', seg=16, seg2=4):
        """Torus (wheel rims, cowlings, helmet brims)."""
        rot = {'y': Matrix.Identity(4), 'x': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'z': Matrix.Rotation(math.pi / 2, 4, 'X')}[axis]
        m = Matrix.Translation((x, -z, y)) @ rot; vs = []; grid = []
        for i in range(seg):
            a = i / seg * math.tau; row = []
            for j in range(seg2):
                t = j / seg2 * math.tau; rr = R + r * math.cos(t)
                row.append(self.bm.verts.new(m @ Vector((rr * math.cos(a), rr * math.sin(a), r * math.sin(t))))); vs.append(row[-1])
            grid.append(row)
        for i in range(seg):
            for j in range(seg2):
                self.bm.faces.new((grid[i][j], grid[(i + 1) % seg][j], grid[(i + 1) % seg][(j + 1) % seg2], grid[i][(j + 1) % seg2]))
        self._add(vs, c, house, True)

    def poly(self, pts, c, house=False, thick=0.0, smooth=False):
        """A face from game-space points; with `thick`, extruded along its normal into a slab (roof panels, side plates)."""
        vs = [self.bm.verts.new((p[0], -p[2], p[1])) for p in pts]; f = self.bm.faces.new(vs); allv = list(vs)
        if thick:
            r = bmesh.ops.extrude_face_region(self.bm, geom=[f]); nv = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
            f.normal_update(); bmesh.ops.translate(self.bm, verts=nv, vec=-f.normal * thick); allv += nv
            bmesh.ops.recalc_face_normals(self.bm, faces=list({fc for v in allv for fc in v.link_faces}))
        self._add(allv, c, house, smooth)

    def roof(self, x, y, z, w, h, l, c, house=False, axis='z', thick=.004):
        """Pitched roof: ridge along `axis`, eaves `w` wide at height y, ridge h above, l long."""
        if axis == 'z':
            A, B = (x - w / 2, y, z - l / 2), (x + w / 2, y, z - l / 2); R0, R1 = (x, y + h, z - l / 2), (x, y + h, z + l / 2)
            A2, B2 = (x - w / 2, y, z + l / 2), (x + w / 2, y, z + l / 2)
        else:
            A, B = (x - l / 2, y, z - w / 2), (x - l / 2, y, z + w / 2); R0, R1 = (x - l / 2, y + h, z), (x + l / 2, y + h, z)
            A2, B2 = (x + l / 2, y, z - w / 2), (x + l / 2, y, z + w / 2)
        self.poly([A, R0, R1, A2], c, house, thick); self.poly([B2, R1, R0, B], c, house, thick)
        self.poly([A, B, R0], c, house); self.poly([A2, R1, B2], c, house)

    def cyl(self, x, y, z, r1, r2, h, c, house=False, axis='y', seg=8, smooth=True, cap=True):
        """Cylinder (cone if r1 != r2) centred at game coords, along a game axis."""
        rot = {'y': Matrix.Identity(4), 'x': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'z': Matrix.Rotation(math.pi / 2, 4, 'X')}[axis]
        m = Matrix.Translation((x, -z, y)) @ rot
        r = bmesh.ops.create_cone(self.bm, cap_ends=cap, segments=seg, radius1=r1, radius2=r2, depth=h, matrix=m); self._add(r['verts'], c, house, smooth)

    def ball(self, x, y, z, r, c, house=False, sy=1.0, seg=8):
        m = Matrix.Translation((x, -z, y)) @ Matrix.Diagonal((1, 1, sy, 1))
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=max(4, seg // 2 + 1), radius=r, matrix=m); self._add(res['verts'], c, house, True)

    def done(self):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
        me = bpy.data.meshes.new(self.name); self.bm.to_mesh(me); self.bm.free()
        me.color_attributes.active_color = me.color_attributes['Col']; me.color_attributes.render_color_index = 0
        ob = bpy.data.objects.new(self.name, me); bpy.context.scene.collection.objects.link(ob)
        mat = bpy.data.materials.get('unit') or bpy.data.materials.new('unit')
        me.materials.append(mat)
        return ob

# ---------------------------------------------------------------- figures
def soldier(name, kneel=False):
    k = Kit(name); d = -.045 if kneel else 0
    if not kneel:
        for sd in (-1, 1):
            x = sd * .016
            k.box(x, .007, .007, .028, .014, .042, C['boot'])
            k.cyl(x, .033, 0, .013, .012, .038, C['puttee'], seg=6)
            k.cyl(x, .067, 0, .015, .014, .036, C['cloth2'], True, seg=6)
    else:
        k.box(-.016, .007, .052, .028, .014, .042, C['boot']); k.cyl(-.016, .026, .048, .012, .012, .036, C['puttee'], seg=6)
        k.box(-.016, .046, .028, .028, .024, .05, C['cloth2'], True)
        k.box(.016, .012, -.035, .026, .022, .05, C['puttee']); k.box(.016, .008, -.066, .024, .016, .016, C['boot'])
        k.cyl(.016, .036, -.004, .015, .014, .042, C['cloth2'], True, seg=6)
    # skirted tunic, chest, belt, collar
    k.cyl(0, .085 + d, 0, .036, .04, .032, C['cloth2'], True, seg=8)
    k.cyl(0, .121 + d, 0, .033, .037, .056, C['cloth'], True, seg=8)
    k.cyl(0, .093 + d, 0, .039, .039, .009, C['leather'], seg=8)
    for sd in (-1, 1):
        k.box(sd * .025, .098 + d, .028, .018, .016, .008, C['leather'])            # ammunition pouches
        k.box(sd * .02, .124 + d, .024, .006, .046, .003, C['leather'], rz=sd * .25)  # braces
    k.box(0, .118 + d, -.035, .052, .05, .024, C['pack'])                           # pack
    k.cyl(0, .15 + d, -.037, .011, .011, .066, C['khaki'], axis='x', seg=6)          # blanket roll
    k.box(.041, .075 + d, -.006, .013, .022, .016, C['khaki'])                       # canteen
    k.box(-.03, .07 + d, -.03, .012, .03, .008, C['wood'])                           # entrenching tool
    # head and neck
    k.cyl(0, .152 + d, 0, .011, .012, .012, C['skin'], seg=6)
    k.ball(0, .172 + d, .002, .021, C['skin'], sy=1.08, seg=8)
    # arms holding the rifle at the ready
    k.cyl(.043, .122 + d, .008, .01, .009, .038, C['cloth'], True, seg=6)
    k.box(.031, .104 + d, .024, .016, .016, .032, C['cloth'], True, ry=.3)
    k.ball(.022, .103 + d, .04, .008, C['skin'], seg=6)
    k.cyl(-.043, .122 + d, .012, .01, .009, .038, C['cloth'], True, seg=6)
    k.box(-.022, .11 + d, .044, .042, .016, .016, C['cloth'], True, ry=-.5)
    k.ball(.004, .11 + d, .068, .008, C['skin'], seg=6)
    rx, ry = .013, .108 + d
    k.box(rx, ry - .004, .02, .012, .022, .042, C['wood'])                           # stock
    k.box(rx, ry, .074, .01, .012, .07, C['wood'])                                   # fore-end
    k.cyl(rx, ry + .003, .1, .0035, .0035, .07, C['steel'], axis='z', seg=5)          # barrel
    k.cyl(rx, ry + .003, .148, .0015, .0012, .03, C['steel'], axis='z', seg=4)        # bayonet
    return k.done()

def helmets():
    out = []
    k = Kit('helm_brodie')   # Britain: wide flat brim, shallow bowl
    k.cyl(0, .002, 0, .046, .046, .006, C['helm'], seg=12); k.cyl(0, .012, 0, .03, .022, .018, C['helm'], seg=12); out.append(k.done())
    k = Kit('helm_adrian')   # France: peaked front and back, crest
    k.box(0, .001, .002, .062, .006, .08, C['helm']); k.ball(0, .012, 0, .027, C['helm'], sy=.75, seg=10); k.box(0, .03, 0, .01, .012, .05, C['helm']); out.append(k.done())
    k = Kit('helm_cap')      # Russia: peaked field cap (house colour)
    k.cyl(0, .005, 0, .023, .023, .012, C['boot'], seg=10); k.cyl(0, .016, -.002, .027, .029, .012, C['cloth'], True, seg=10); k.box(0, -.001, .03, .04, .004, .02, C['boot']); out.append(k.done())
    k = Kit('helm_stahl')    # Germany / Austria-Hungary: flared skirt, tall dome, lugs
    k.cyl(0, -.002, -.003, .036, .031, .016, C['helm'], seg=12); k.ball(0, .014, 0, .029, C['helm'], sy=.95, seg=12)
    for sd in (-1, 1): k.cyl(sd * .03, .012, 0, .004, .004, .006, C['steel'], axis='x', seg=5)
    out.append(k.done())
    k = Kit('helm_kabalak')  # Ottoman: cloth wound round a frame
    for i, r in enumerate((.031, .029, .025)): k.cyl(0, .001 + i * .011, 0, r, r - .002, .011, C['khaki'] if i != 1 else C['canvas'], seg=10)
    out.append(k.done())
    return out

def mg():
    """Maxim/Vickers on a tripod with a water jacket, belt box and shield (crew drawn as soldiers)."""
    k = Kit('mg')
    for a in (-.6, .6, math.pi):
        k.cyl(math.sin(a) * .03, .018, math.cos(a) * .03 - .01, .004, .004, .05, C['steel'], seg=5)
    k.box(0, .045, 0, .03, .02, .06, C['gun'])                                     # receiver
    k.cyl(0, .047, .07, .011, .011, .08, C['steel'], axis='z', seg=10)              # water jacket
    k.cyl(0, .047, .118, .0035, .0035, .02, C['gun'], axis='z', seg=5)              # muzzle
    k.box(0, .03, .03, .07, .05, .004, C['shield'], rx=-.15)                       # shield
    k.box(.03, .02, -.02, .022, .022, .03, C['khaki'])                             # belt box
    k.box(0, .05, -.04, .008, .02, .02, C['wood'])                                 # spade grips
    return k.done()

def field_gun():
    """75 mm field gun: box trail, shield, barrel with recuperator, two spoked wheels."""
    k = Kit('art')
    k.box(0, .03, -.09, .03, .02, .15, C['shield'], house=True, rx=.18)           # trail
    k.box(0, .012, -.165, .03, .012, .02, C['steel'])                              # spade
    k.box(0, .07, .02, .11, .07, .006, C['shield'], house=True, rx=-.1)           # shield
    k.box(0, .062, .03, .03, .028, .07, C['gun'])                                  # cradle
    k.cyl(0, .068, .1, .009, .007, .15, C['gun'], axis='z', seg=10)                # barrel
    k.cyl(0, .055, .06, .008, .008, .09, C['steel'], axis='z', seg=8)              # recuperator
    k.cyl(0, .045, 0, .006, .006, .12, C['steel'], axis='x', seg=6)                # axle
    for sd in (-1, 1):
        k.cyl(sd * .058, .045, 0, .045, .045, .008, C['wood'], axis='x', seg=16, smooth=False)
        k.cyl(sd * .058, .045, 0, .036, .036, .01, C['earth'], axis='x', seg=16, smooth=False)  # dark between the spokes
        for i in range(6):
            a = i * math.pi / 6
            k.box(sd * .058, .045, 0, .006, .072, .005, C['wood'], rx=a)
        k.cyl(sd * .058, .045, 0, .008, .008, .016, C['steel'], axis='x', seg=6)
    return k.done()

def tank():
    """Rhomboid heavy tank: lozenge hull with tracks running all round, side sponsons with guns, exhausts, unditching beam."""
    k = Kit('tank')
    bm = k.bm; L, H, W = .36, .13, .055
    # track frames: rhomboid side plates, extruded
    for sd in (-1, 1):
        prof = [(-L / 2, .01), (L / 2 - .05, .01), (L / 2 + .02, H * .55), (L / 2 - .03, H), (-L / 2 + .02, H), (-L / 2 - .02, H * .45)]
        verts = [bm.verts.new((sd * (W + .03), -z, y)) for z, y in prof]
        f = bm.faces.new(verts); r = bmesh.ops.extrude_face_region(bm, geom=[f])
        nv = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, verts=nv, vec=(-sd * .036, 0, 0))
        bmesh.ops.recalc_face_normals(bm, faces=list({fc for v in verts + nv for fc in v.link_faces}))
        k._paint(list({fc for v in verts + nv for fc in v.link_faces}), C['hull'], True)
        # track shoes along the outer run
        for i in range(18):
            t = i / 18; z = -L / 2 + t * L
            k.box(sd * (W + .015), .007, z, .04, .008, .012, C['track'])
            k.box(sd * (W + .015), H + .004, z * .92, .04, .008, .012, C['track'])
        # sponson with a 6-pdr
        k.box(sd * (W + .045), .06, .01, .03, .045, .07, C['hull'], True)
        k.cyl(sd * (W + .07), .065, .03, .006, .005, .06, C['gun'], axis='z', seg=6)
    k.box(0, H * .62, 0, W * 2, H * .55, L * .7, C['hull'], True)                  # body between the frames
    k.box(0, H + .018, .06, .07, .03, .06, C['hull'], True)                        # cab
    k.box(0, H + .02, .092, .05, .008, .002, C['slit'])
    k.cyl(-.02, H + .03, -.12, .006, .006, .04, C['gun'], seg=6)                    # exhausts
    k.cyl(.02, H + .03, -.12, .006, .006, .04, C['gun'], seg=6)
    k.box(0, H + .02, -.06, .17, .016, .016, C['wood'])                            # unditching beam
    return k.done()

def plane():
    """Biplane: fuselage (house colour), two wings, struts, tail, rotary engine, wheels."""
    k = Kit('plane')
    k.cyl(0, 0, .03, .028, .016, .2, C['canvas'], True, axis='z', seg=8)          # fuselage tapering aft
    k.cyl(0, 0, .135, .03, .028, .02, C['steel'], axis='z', seg=10)               # cowling
    k.box(0, .06, .04, .38, .008, .065, C['wing']); k.box(0, -.022, .045, .34, .008, .06, C['wing'])
    for sd in (-1, 1):
        for zz in (.02, .065): k.box(sd * .13, .019, zz, .005, .08, .005, C['wood'])
        k.cyl(sd * .036, -.062, .06, .013, .013, .008, C['tyre'], axis='x', seg=10)
        k.box(sd * .022, -.044, .06, .005, .04, .005, C['wood'])
    k.box(0, 0, -.125, .13, .006, .035, C['wing']); k.box(0, .024, -.128, .006, .042, .03, C['canvas'], True)
    k.box(0, .027, -.005, .022, .012, .03, C['slit']); k.ball(0, .035, -.01, .009, C['leather'], seg=6)
    k.cyl(0, .034, .062, .004, .004, .045, C['gun'], axis='z', seg=5)
    return k.done()

def prop():
    k = Kit('prop'); k.box(0, 0, .148, .15, .012, .004, C['wood']); return k.done()

def pillbox():
    k = Kit('pill')
    k.cyl(0, .03, 0, .09, .08, .06, C['concrete'], seg=8, smooth=False)
    k.cyl(0, .066, 0, .08, .06, .014, C['concrete2'], seg=8, smooth=False)
    k.box(0, .045, .08, .07, .012, .02, C['slit'])
    for i in range(10):
        a = i / 10 * math.pi * 2; k.box(math.sin(a) * .1, .012, math.cos(a) * .1, .03, .022, .018, C['sand'], rz=-a)
    return k.done()

def bunker():
    k = Kit('bunk')
    k.box(0, .02, 0, .26, .045, .17, C['earth'])
    k.box(0, .05, .01, .2, .03, .14, C['concrete'])
    k.box(0, .068, .01, .18, .012, .12, C['concrete2'])
    for sd in (-1, 1): k.box(sd * .05, .048, .082, .05, .012, .01, C['slit'])
    k.box(0, .03, -.09, .05, .04, .03, C['slit'])
    return k.done()

def bake_ao(objs, ground_for=lambda o: True, dist=.03, strength=.62):
    """Bake ambient occlusion (with a ground plane under ground models) and multiply it into the paint: the pre-rendered depth."""
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.cycles.device = 'CPU'
    sc.render.bake.target = 'VERTEX_COLORS'; sc.world = sc.world or bpy.data.worlds.new('w')
    sc.world.light_settings.distance = dist
    bpy.ops.mesh.primitive_plane_add(size=6); ground = bpy.context.object
    for o in objs:
        for other in objs: other.hide_render = other is not o
        ground.hide_render = not ground_for(o)
        me = o.data; ao = me.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER'); me.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type='AO')
        n = len(me.loops); a = np.empty(n * 4, np.float32); c = np.empty(n * 4, np.float32)
        ao.data.foreach_get('color', a); col = me.color_attributes['Col']; col.data.foreach_get('color', c)
        a = a.reshape(-1, 4)[:, 0]; c = c.reshape(-1, 4)
        c[:, :3] *= (1 - strength + strength * np.power(a, .8))[:, None]
        col.data.foreach_set('color', c.reshape(-1)); me.color_attributes.remove(ao)
        me.color_attributes.active_color = me.color_attributes['Col']; me.color_attributes.render_color_index = 0
    bpy.data.objects.remove(ground, do_unlink=True)
    for o in objs: o.hide_render = False

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import importlib.util, sys
    spec = importlib.util.spec_from_file_location('hires', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hires.py'))
    hires = importlib.util.module_from_spec(spec); sys.modules['models'] = sys.modules[__name__]; spec.loader.exec_module(hires)
    lo = [soldier('soldier_lo'), soldier('soldier_kneel_lo', True)]
    hi = hires.build()
    objs = lo + hi
    print('baking ambient occlusion ...')
    big = {'house_a', 'house_b', 'church', 'house_ruin', 'house_ruin_b', 'house_a_lo', 'house_b_lo'}   # modelled in a unit frame (scaled down per house): occlusion reaches further
    bake_ao([o for o in objs if o.name not in big], ground_for=lambda o: not (o.name.startswith(('helm', 'plane', 'prop', 'mark'))))  # scenery bakes with the ground too
    bake_ao([o for o in objs if o.name in big], dist=.16, strength=.55)
    for o in objs:
        o.select_set(True)
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        print(f'{o.name:14s} {tris:5d} tris')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_vertex_color='NAME', export_vertex_color_name='Col', export_active_vertex_color_when_no_material=True,
                              export_all_vertex_colors=False, export_normals=True, export_texcoords=False, export_materials='PLACEHOLDER',
                              export_yup=True, export_apply=True)
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')

if __name__ == '__main__':
    main()
