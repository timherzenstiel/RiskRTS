"""Side-by-side look check: renders a few models from a units.glb at the game's camera pitch and sun, close up.

    python3 tools/bake/preview.py [glb] [out.png] [faction]

Textured models (TEXCOORD_0 + a base-colour texture with the house mask in alpha) and vertex-coloured ones both render with the
game's tint rule, so an old and a new glb can be compared.
"""
import math, os, sys
import bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cameos as cm

GLB = sys.argv[1] if len(sys.argv) > 1 else cm.GLB
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/preview.png'
F = int(sys.argv[3]) if len(sys.argv) > 3 else 3
if len(sys.argv) > 4: cm.ATLAS = sys.argv[4]

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    lib = {}
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.context.view_layer.objects.active = o; o.select_set(True)
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); o.select_set(False)
            lib[o.name] = o; o.hide_render = True
    cm.ground()
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 4.2; sun.data.angle = .05
    sun.rotation_euler = Vector((.62, -.42, 1)).to_track_quat('Z', 'Y').to_euler()
    w = bpy.data.worlds.new('w'); sc.world = w; w.color = (.45, .43, .36)
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 32; sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 960, 540; sc.view_settings.view_transform = 'Standard'
    fac, uni, tank = cm.faction_colours()
    helm = cm.HELM_OF[F]; tk = cm.TANK_OF[F]
    U = ('u', uni[F], cm.lin(cm.DRESS_UNI[F])); T = ('t', tank[F], cm.lin(cm.DRESS_VEH[F]))
    parts = [('soldier_aim', -.36, .06, .5, U), (helm, -.36, .06, .5, U, .19), ('soldier_kneel_aim', -.25, .12, .3, U), (helm, -.25, .12, .3, U, .145),
             ('soldier', -.3, -.08, .6, U), (helm, -.3, -.08, .6, U, .19),
             (tk, .02, 0, .5, T), ('art', .34, .06, .4, T), ('mg', .3, -.14, .3, T)]
    for name, x, z, face, mat, *hy in parts:
        if name not in lib: print('missing', name); continue
        o = cm.place(lib[name], x, z, face, 1, mat); o.hide_render = False
        if hy: o.location.z = hy[0]
    pitch = math.radians(46); d = 3.0
    Z = float(os.environ.get('ZOOM', '1')); cx = float(os.environ.get('CX', '0'))
    cam.data.ortho_scale = .95 / Z; cam.location = (cx, -d * math.cos(pitch), .06 + d * math.sin(pitch)); cam.rotation_euler = (math.pi / 2 - pitch, 0, 0)
    sc.render.filepath = OUT; bpy.ops.render.render(write_still=True); print('wrote', OUT)

if __name__ == '__main__':
    main()
