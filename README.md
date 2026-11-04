# RiskRTS – Fronts of 1914

A real-time, Risiko-style World War I strategy game built with Three.js (voxel / pixel-art look), single HTML file.

- 54 regions on a rasterised world map, 6 powers, secret missions
- No turns: a supply convoy arrives for every power at the same time every 20 s
- Recruit troops, build trenches / factories / barracks, march on neighbouring regions
- Battles are auto-resolved agent simulations you can zoom into

## Run
Open `index.html` in a browser (needs internet for the three.js CDN and Google Fonts), or serve the folder:

    python3 -m http.server 8000

## Controls
Click = select · right-click = march · drag/wheel = pan/zoom · 1-4 = recruit · Space = pause

`tests/` contains the headless Playwright smoke tests used during development.
