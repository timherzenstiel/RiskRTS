"""Far-zoom sprite impostors (design §1.2): the infantry model pre-rendered in the game's camera and sun, the way the 90s
games did it. Beyond the battle band soldiers are drawn as these cards instead of meshes.

Atlas: packages/client/public/art/sprites/infantry.webp
  rows = factions (0..6), columns = 8 facings x 3 frames (stand, stride A, stride B), cells of CELL x CELL pixels.
  Facing k is the model turned by k * 45 degrees (game yaw, the same as Blender Z). The camera looks at model point
  (0, CY, 0) with an orthographic window of SPAN units, so a card of SPAN x SPAN world units centred CY above the
  feet reproduces the projection exactly (see render/impostors.ts, which reads the numbers from atlas.json).
Run after models.py:   python3 tools/bake/sprites.py
"""
import json, math, os
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GLB = os.path.join(ROOT, 'packages', 'client', 'public', 'art', 'units.glb')
OUT = os.path.join(ROOT, 'packages', 'client', 'public', 'art', 'sprites')
CELL, SPAN, CY, PITCH = 64, .3, .1, .8
FRAMES = ['soldier', 'soldier_walk_a', 'soldier_walk_b']

import importlib.util
_spec = importlib.util.spec_from_file_location('cameos', os.path.join(os.path.dirname(__file__), 'cameos.py'))
cam_mod = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(cam_mod)

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    lib = {}
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            o.rotation_mode = 'XYZ'  # glTF imports use quaternions; the copies are turned with Euler yaw
            bpy.context.view_layer.objects.active = o; o.select_set(True)
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); o.select_set(False)
            lib[o.name] = o; o.hide_render = True
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = SPAN
    d = 3.0; cam.location = (0, -d * math.cos(PITCH), CY + d * math.sin(PITCH)); cam.rotation_euler = (math.pi / 2 - PITCH, 0, 0)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 4.2; sun.data.angle = .05
    sun.rotation_euler = Vector((.62, -.42, 1)).to_track_quat('Z', 'Y').to_euler()
    w = bpy.data.worlds.new('w'); sc.world = w; w.color = (.45, .43, .36)
    sc.render.engine = 'CYCLES'; sc.cycles.samples = int(os.environ.get('SPRITE_SAMPLES', '12')); sc.cycles.device = 'CPU'
    sc.render.film_transparent = True; sc.render.resolution_x = sc.render.resolution_y = CELL
    sc.render.image_settings.color_mode = 'RGBA'; sc.view_settings.view_transform = 'Standard'
    fac, uni, _ = cam_mod.faction_colours()
    os.makedirs(OUT, exist_ok=True)
    from PIL import Image
    atlas = Image.new('RGBA', (CELL * 8 * len(FRAMES), CELL * len(fac)), (0, 0, 0, 0))
    tmp = os.path.join(OUT, '_cell.png')
    for f in range(len(fac)):
        U = cam_mod.tint_material(f'u{f}', uni[f])
        for k in range(8):
            for j, frame in enumerate(FRAMES):
                body = cam_mod.place(lib[frame], 0, 0, k * math.pi / 4, 1, U)
                helm = cam_mod.place(lib[cam_mod.HELM_OF[f]], 0, 0, k * math.pi / 4, 1, U); helm.location.z = .188 if j else .19
                body.hide_render = helm.hide_render = False
                sc.render.filepath = tmp; bpy.ops.render.render(write_still=True)
                atlas.paste(Image.open(tmp), ((k * len(FRAMES) + j) * CELL, f * CELL))
                for o in (body, helm): bpy.data.objects.remove(o, do_unlink=True)
        print('sprites', f)
    os.remove(tmp)
    atlas.save(os.path.join(OUT, 'infantry.webp'), quality=88, method=6)
    json.dump({'cell': CELL, 'span': SPAN, 'cy': CY, 'facings': 8, 'frames': len(FRAMES), 'rows': len(fac)}, open(os.path.join(OUT, 'atlas.json'), 'w'))
    print('wrote', os.path.join(OUT, 'infantry.webp'))

if __name__ == '__main__':
    main()
