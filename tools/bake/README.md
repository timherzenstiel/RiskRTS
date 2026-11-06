# Unit art bake

Blender scripts that build the game's unit art (design §4). Both run in Blender 4.2+ (`blender -b -P <script>`) or with
the `bpy` Python module (`python3 <script>`), on any machine; the output is committed so the game needs no build step.

| Script | Output |
|---|---|
| `models.py` | `packages/client/public/art/units.glb`: low-poly soldier (standing, kneeling), five national headgear, MG, field gun, rhomboid tank, biplane + propeller, pillbox, bunker. Vertex colours; COLOR_0 alpha is the house-colour mask. |
| `ships.py` | Ship models built into `units.glb` by `models.py`: dreadnought hull and its separate twin turret (they train on the target in game), destroyer, troop transport liner, Furious-style carrier, X-lighter, harbour plot. Waterline at y = 0. |
| `cameos.py` | `packages/client/public/art/cameo/<unit>_<faction>.webp`: sidebar portraits of each unit in each nation's colours, rendered at the game's camera pitch and sun (Cycles). Set `CAMEO_SAMPLES` for quality. |

Run `models.py` first; `cameos.py` reads its glb. Model frame: +z forward, y up, a soldier is ~0.21 units tall
(the same frame as the box models in `render/models.ts`). The renderer (`render/meshPools.ts`) tints masked paint
with `tint * clamp(luma * 4.2, .55, 1.35)`; `cameos.py` uses the same rule so the portraits match the map.

Still to come from this pipeline: per-pose meshes or vertex-animation textures (march, fire, die), sprite impostors for
the far bands, and building/defence models beyond the pillbox and bunker.
