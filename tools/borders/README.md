# Real region borders

`build.py` turns Natural Earth admin-0 outlines (the `world-atlas` npm package, `countries-50m.json`, public domain)
into the region table the game builds its world from: `packages/shared/src/data/regionTiles.ts`.

1. Rasterise every country onto the game's 0.5° tile grid (4×4 supersampling, majority vote; big inland lakes
   from the old outline set are cut out).
2. Assign countries to the 54 regions (`GROUPS`), with 1914 cut rules (`rule`): Alsace-Lorraine, Posen, Silesia and
   East Prussia to Germany, Galicia, Bukovina and Transylvania to Austria-Hungary, Kars and Van to the Caucasus,
   Xinjiang to Turkestan, Tibet to Mongolia, Korea to Manchuria, Burma to India, and so on. Cut lines inside big
   countries use noise-warped coordinates so they meander instead of running along meridians.
3. Split the USA, Canada, Australia and Asian Russia between their regions by a noise-weighted flood fill.
4. **Repair the contact graph.** Corps are stored per border (`RegionState.fr[neighbour]`), so the regions must keep
   exactly the land contacts listed in `adjacency.json` (the map before real borders). Contact tiles of a forbidden
   pair move to a third region; where no region can take them (an isthmus such as Panama, Gibraltar or the Øresund)
   the tile becomes sea. Missing contacts grow a corridor.

`packages/shared/test/borders.test.ts` checks the result against `adjacency.json`.

Run after changing the rules (needs Python 3 with numpy and pillow, and `npm install` for world-atlas):

    python3 tools/borders/build.py
