"""Sidebar cameos per nation (design §3.1): renders the baked unit models (public/art/units.glb, from models.py) on a patch
of painted ground with the game's camera pitch and sun, in each faction's house colours.

Writes packages/client/public/art/cameo/<unit>_<faction>.webp (256x192): unit in inf, mg, art, tank, plane; faction 0-5.
Run after models.py:   python3 tools/bake/cameos.py      (or: blender -b -P tools/bake/cameos.py)
"""
import math, os, re
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GLB = os.path.join(ROOT, 'packages', 'client', 'public', 'art', 'units.glb')
OUT = os.path.join(ROOT, 'packages', 'client', 'public', 'art', 'cameo')
FACTIONS_TS = os.path.join(ROOT, 'packages', 'shared', 'src', 'data', 'factions.ts')
HELM_OF = ['helm_brodie', 'helm_adrian', 'helm_cap', 'helm_stahl', 'helm_stahl', 'helm_kabalak', 'helm_brodie']  # US: M1917 = Brodie pattern
TANK_OF = ['tank_mk4', 'tank_ft', 'tank_mk4', 'tank_a7v', 'tank_a7v', 'tank_mk4', 'tank_ft']  # US: French-built Renault FT
SAMPLES = int(os.environ.get('CAMEO_SAMPLES', '24'))

def lin(h):
    h = h.lstrip('#'); return [(int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)]
def lerp(a, b, t): return [x + (y - x) * t for x, y in zip(a, b)]

def faction_colours():
    cols = re.findall(r"def\('\w+','[^']+','[^']+','(#[0-9a-fA-F]{6})'", open(FACTIONS_TS).read())
    fac = [lin(c) for c in cols]
    uni = [lerp(c, lin('#7d7454'), .18) for c in fac]          # palette.ts UNI
    tank = [lerp(c, lin('#6b6a52'), .3) for c in fac]          # palette.ts TANKC
    return fac, uni, tank

# nation dress (keep in sync with packages/client/src/render/palette.ts)
DRESS_UNI = ['#8b7d55', '#7f93a8', '#8d8a66', '#727866', '#8a9697', '#9a8658', '#6e6a48']
DRESS_VEH = ['#6e6247', '#7b7656', '#5f6448', '#717268', '#6c7066', '#8a7b55', '#5d5b40']
DRESS_AIR = ['#6b6444', '#b9b49c', '#a8a68e', '#9a9a86', '#a09c86', '#a89a76', '#757052']
ATLAS = os.path.join(ROOT, 'packages', 'client', 'public', 'art', 'units.webp')

def tint_material(name, rgb, dress=None, img=None):
    """Same rule as meshPools.ts. Mask (texture alpha with `img`, else vertex alpha): 1 team colour `rgb`, .5 nation `dress`,
    0 own paint; tinted parts = colour * clamp(luma * 4.2, lo, hi)."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = N['Principled BSDF']; bsdf.inputs['Roughness'].default_value = .75
    if img is not None:
        src = N.new('ShaderNodeTexImage'); src.image = img; img.alpha_mode = 'CHANNEL_PACKED'; lo, hi = .3, 1.6
    else:
        src = N.new('ShaderNodeVertexColor'); src.layer_name = 'Color'; lo, hi = .55, 1.35
    col, alpha = src.outputs['Color'], src.outputs['Alpha']
    bw = N.new('ShaderNodeRGBToBW'); L.new(col, bw.inputs[0])
    mul = N.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 4.2; L.new(bw.outputs[0], mul.inputs[0])
    cl = N.new('ShaderNodeClamp'); cl.inputs['Min'].default_value = lo; cl.inputs['Max'].default_value = hi; L.new(mul.outputs[0], cl.inputs['Value'])
    def shaded(c):
        tc = N.new('ShaderNodeMix'); tc.data_type = 'RGBA'; tc.blend_type = 'MULTIPLY'; tc.inputs['Factor'].default_value = 1
        tc.inputs[6].default_value = (*c, 1); L.new(cl.outputs[0], tc.inputs[7]); return tc.outputs[2]
    def step(a, b):
        mr = N.new('ShaderNodeMapRange'); mr.interpolation_type = 'SMOOTHSTEP'; mr.inputs['From Min'].default_value = a; mr.inputs['From Max'].default_value = b
        L.new(alpha, mr.inputs['Value']); return mr.outputs['Result']
    md = N.new('ShaderNodeMix'); md.data_type = 'RGBA'; L.new(step(.2, .4), md.inputs['Factor']); L.new(col, md.inputs[6]); L.new(shaded(dress or rgb), md.inputs[7])
    mt = N.new('ShaderNodeMix'); mt.data_type = 'RGBA'; L.new(step(.7, .9), mt.inputs['Factor']); L.new(md.outputs[2], mt.inputs[6]); L.new(shaded(rgb), mt.inputs[7])
    L.new(mt.outputs[2], bsdf.inputs['Base Color'])
    return m

def atlas():
    if not os.path.exists(ATLAS): return None
    im = bpy.data.images.get('units_atlas') or bpy.data.images.load(ATLAS); im.name = 'units_atlas'; return im

def ground():
    bpy.ops.mesh.primitive_plane_add(size=4)
    g = bpy.context.object; m = bpy.data.materials.new('ground'); m.use_nodes = True; nt = m.node_tree; N = nt.nodes
    bsdf = N['Principled BSDF']; bsdf.inputs['Roughness'].default_value = 1
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 18; nz.inputs['Detail'].default_value = 6
    ramp = N.new('ShaderNodeValToRGB'); e = ramp.color_ramp.elements
    e[0].position = .38; e[0].color = (*lin('#4e5a2c'), 1); e[1].position = .66; e[1].color = (*lin('#6e5a3a'), 1)
    nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    g.data.materials.append(m)

def place(src, x, z, face=0.0, s=1.0, mat=None):
    """Copy a model at game coords (x right, z forward towards the camera), turned by `face`. `mat` is a material, or a
    (name, team rgb, dress rgb) triple for the tint rule (textured when the model has UVs and the atlas exists)."""
    o = src.copy(); o.data = src.data.copy(); bpy.context.scene.collection.objects.link(o)
    o.location = (x, -z, 0); o.rotation_euler = (0, 0, face); o.scale = (s, s, s)
    if isinstance(mat, tuple):
        img = atlas() if o.data.uv_layers else None
        key = mat[0] + ('t' if img else 'v'); mat = bpy.data.materials.get(key) or tint_material(key, mat[1], mat[2], img)
    if mat: o.data.materials.clear(); o.data.materials.append(mat)
    return o

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    lib = {}
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            o.rotation_mode = 'XYZ'; bpy.context.view_layer.objects.active = o
            o.select_set(True); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); o.select_set(False)
            lib[o.name] = o; o.hide_render = True
    ground()
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 4.2; sun.data.angle = .05
    sun.rotation_euler = Vector((.62, -.42, 1)).to_track_quat('Z', 'Y').to_euler()   # the game's sun (top-left)
    w = bpy.data.worlds.new('w'); sc.world = w; w.color = (.45, .43, .36)
    sc.render.engine = 'CYCLES'; sc.cycles.samples = SAMPLES; sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 256, 192; sc.view_settings.view_transform = 'Standard'
    fac, uni, tank = faction_colours()
    os.makedirs(OUT, exist_ok=True)
    pitch = math.radians(46)

    def shoot(path, span, cz=0.0):
        cam.data.ortho_scale = span
        d = 3.0; cam.location = (0, -(cz) - d * math.cos(pitch), .06 + d * math.sin(pitch)); cam.rotation_euler = (math.pi / 2 - pitch, 0, 0)
        sc.render.filepath = path; bpy.ops.render.render(write_still=True)

    def portrait(path, f, U):
        """Head and shoulders of a staff officer, front-on, for the mission briefing."""
        made = [place(lib['soldier'], 0, 0, 0.0, 1, U)]
        hm = place(lib[HELM_OF[f]], 0, 0, 0.0, 1, U); hm.location.z = .19; made.append(hm)
        for o in made: o.hide_render = False
        cam.data.ortho_scale = .12; cam.location = (0, -.4, .165 + .4 * math.tan(.12)); cam.rotation_euler = (math.pi / 2 - .12, 0, 0)
        sc.render.filepath = path; bpy.ops.render.render(write_still=True)
        for o in made: bpy.data.objects.remove(o, do_unlink=True)

    for f in range(len(fac)):
        U, T, F = (f'u{f}', uni[f], lin(DRESS_UNI[f])), (f't{f}', tank[f], lin(DRESS_VEH[f])), (f'f{f}', fac[f], lin(DRESS_AIR[f]))
        def crew(spots):
            return [(lib['soldier_kneel'], x, z, a, 1, U) for x, z, a in spots] + [(lib[HELM_OF[f]], x, z, a, 1, U, .145) for x, z, a in spots]
        groups = {
            'inf': [(lib['soldier'], x, z, .3, 1, U) for x, z in ((-.07, .05), (.06, .07), (0, -.06), (-.1, -.09), (.1, -.05))]
                   + [(lib[HELM_OF[f]], x, z, .3, 1, U, .19) for x, z in ((-.07, .05), (.06, .07), (0, -.06), (-.1, -.09), (.1, -.05))],
            'mg': [(lib['mg'], 0, .03, .25, 1.1, T)] + crew(((-.03, -.06, .25), (.09, -.02, -.4))),
            'art': [(lib['art'], 0, .02, .35, 1.25, T)] + crew(((.13, -.06, .35), (-.12, -.1, .7))),
            'tank': [(lib[TANK_OF[f]], 0, 0, .45, 1.05 if f == 1 else 1, T)],
            'plane': [(lib['plane'], 0, 0, .55, 1.15, F), (lib['prop'], 0, 0, .55, 1.15, None), (lib[f'mark_{f}'], 0, 0, .55, 1.15, None)],
        }
        png = os.path.join(OUT, f'officer_{f}.png'); portrait(png, f, U)
        try:
            from PIL import Image
            Image.open(png).convert('RGB').save(png[:-4] + '.webp', quality=82, method=6); os.remove(png)
        except ImportError:
            pass
        span = {'inf': .5, 'mg': .44, 'art': .56, 'tank': .56, 'plane': .56}
        for key, parts in groups.items():
            made = []
            for src, x, z, face, s, mat, *hy in parts:
                o = place(src, x, z, face, s, mat); o.hide_render = False; made.append(o)
                if hy: o.location.z = hy[0]
                if key == 'plane': o.location.z = .12
            png = os.path.join(OUT, f'{key}_{f}.png'); shoot(png, span[key])
            for o in made: bpy.data.objects.remove(o, do_unlink=True)
            try:
                from PIL import Image
                Image.open(png).convert('RGB').save(png[:-4] + '.webp', quality=82, method=6); os.remove(png)
            except ImportError:
                pass
            print('cameo', key, f)

if __name__ == '__main__':
    main()
