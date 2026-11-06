# Unit art bake

Blender scripts that build the game's unit art (design §4). Both run in Blender 4.2+ (`blender -b -P <script>`) or with
the `bpy` Python module (`python3 <script>`), on any machine; the output is committed so the game needs no build step.

| Script | Output |
|---|---|
| `models.py` | `packages/client/public/art/units.glb` + `units.webp`: every unit, ship and building model. Vertex colours (COLOR_0, the fallback) and a UV map into the painted atlas; the mask (COLOR_0 alpha / atlas alpha) has three levels: 1 team colour, .5 nation dress, 0 own paint. Scenery (trees, houses) keeps vertex colours only. |
| `texture.py` | The painted atlas `units.webp` (4096², `ATLAS=` to change): UV-unwraps the models into one atlas, rasterises paint, material class, position and sharp edges per texel in numpy, bakes ambient occlusion in Cycles, then paints wool folds, canvas, leather, wood grain, chipped paint, rust streaks, concrete, dust, mud and vehicle camouflage. `python3 tools/bake/texture.py` alone bakes a few models into /tmp for a quick look. |
| `preview.py` | Close-up comparison render of a glb (+ atlas) at the game's camera: `python3 tools/bake/preview.py <glb> <out.png> <faction> [atlas]`. |
| `sprites.py` | Far-zoom infantry impostors (`art/sprites/`), rendered from the textured models. |
| `ships.py` | Ship models built into `units.glb` by `models.py`: dreadnought hull and its separate twin turret (they train on the target in game), destroyer, troop transport liner, Furious-style carrier, X-lighter, harbour plot. Waterline at y = 0. |
| `cameos.py` | `packages/client/public/art/cameo/<unit>_<faction>.webp`: sidebar portraits of each unit in each nation's colours, rendered at the game's camera pitch and sun (Cycles). Set `CAMEO_SAMPLES` for quality. |

Run `models.py` first (about 5 minutes on two cores); `sprites.py` and `cameos.py` read its glb and atlas. Nation dress colours
are listed twice, in `cameos.py` and `render/palette.ts` (`DRESS_*`); keep them in sync. Model frame: +z forward, y up, a soldier is ~0.21 units tall
(the same frame as the box models in `render/models.ts`). The renderer (`render/meshPools.ts`) tints masked paint
with `tint * clamp(luma * 4.2, .55, 1.35)`; `cameos.py` uses the same rule so the portraits match the map.

Still to come from this pipeline: per-pose meshes or vertex-animation textures (march, fire, die), sprite impostors for
the far bands, and building/defence models beyond the pillbox and bunker.
