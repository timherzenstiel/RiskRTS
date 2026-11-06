# Sample bank

The game plays recorded sounds where it has them and synthesises the rest (`packages/client/src/audio/sfx.ts`). Every category is optional: drop in what you have, and anything missing keeps its synthesised sound.

## Build

1. Put raw recordings in `assets/sfx-src/<category>/` (any of wav, flac, mp3, ogg, aiff, m4a). Several files per category give variety; 3–6 is plenty.
2. Run `node tools/sfx/import.mjs` (needs ffmpeg).
3. It writes `packages/client/public/sfx/*.mp3` and `manifest.json`. Commit those; `assets/sfx-src/` can stay out of git.

The tool trims silence, makes one-shots mono, caps their length, normalises loudness per category and bakes a crossfade into loops. Keep the whole bank under ~8 MB.

## Licence

Use **CC0** (public domain) recordings only, so the files can sit in a public repo and ship with the game. On Freesound, filter by *Creative Commons 0*. Sound packs that are "royalty-free" but forbid redistributing the raw files (e.g. the GDC bundles) can't go into a public repo.

## Categories

| Category | What it is | Length | Search on Freesound (CC0) |
|---|---|---|---|
| `rifle` | One bolt-action rifle shot, close (Lee-Enfield, Mauser, Lebel) | ≤ 1.2 s | [rifle shot](https://freesound.org/search/?q=rifle+shot&f=license:%22Creative+Commons+0%22) |
| `rifle-far` | Rifle shot at a few hundred metres, with echo | ≤ 2 s | [distant gunshot](https://freesound.org/search/?q=distant+gunshot&f=license:%22Creative+Commons+0%22) |
| `mg` | A 6–14-round burst of a water-cooled MG (Vickers, Maxim): ~8 rounds/s, *not* a modern fast MG | ≤ 3 s | [machine gun burst](https://freesound.org/search/?q=machine+gun+burst&f=license:%22Creative+Commons+0%22) |
| `mg-far` | MG burst far away | ≤ 3.5 s | [distant machine gun](https://freesound.org/search/?q=distant+machine+gun&f=license:%22Creative+Commons+0%22) |
| `gun` | Field gun firing (75 mm / 18-pounder), close | ≤ 3 s | [cannon fire](https://freesound.org/search/?q=cannon+fire&f=license:%22Creative+Commons+0%22) |
| `gun-far` | Artillery far away: a dull thud with a rolling tail | ≤ 4 s | [distant artillery](https://freesound.org/search/?q=distant+artillery&f=license:%22Creative+Commons+0%22) |
| `heavy` | Heavy gun / battleship turret, deep and long | ≤ 4.5 s | [howitzer](https://freesound.org/search/?q=howitzer&f=license:%22Creative+Commons+0%22) |
| `whistle` | Incoming shell whistle, ending right before the impact (the game cuts it there) | ≤ 3 s | [incoming shell whistle](https://freesound.org/search/?q=incoming+shell&f=license:%22Creative+Commons+0%22) |
| `impact` | Shell exploding nearby, with debris | ≤ 3 s | [explosion dirt](https://freesound.org/search/?q=explosion+dirt&f=license:%22Creative+Commons+0%22) |
| `impact-far` | Explosion far off | ≤ 4 s | [distant explosion](https://freesound.org/search/?q=distant+explosion&f=license:%22Creative+Commons+0%22) |
| `flak` | Anti-aircraft shell bursting in the air | ≤ 2 s | [flak](https://freesound.org/search/?q=flak&f=license:%22Creative+Commons+0%22) |
| `tank-gun` | Short tank cannon (6-pounder / 57 mm) | ≤ 2.5 s | [tank cannon](https://freesound.org/search/?q=tank+cannon&f=license:%22Creative+Commons+0%22) |
| `bullet` | Bullet crack / whizz-by / ricochet | ≤ 1 s | [bullet whizz](https://freesound.org/search/?q=bullet+whizz&f=license:%22Creative+Commons+0%22) |
| `whistle-officer` | Trench whistle (Acme Thunderer, pea whistle) blown once | ≤ 1.6 s | [referee whistle](https://freesound.org/search/?q=referee+whistle&f=license:%22Creative+Commons+0%22) |
| `cheer` | Crowd of men shouting / charging ("hurrah") | ≤ 5 s | [crowd shout charge](https://freesound.org/search/?q=crowd+shout&f=license:%22Creative+Commons+0%22) |
| `tank-loop` | Heavy tracked vehicle, slow, engine and tracks, loopable | ≤ 20 s | [tracked vehicle](https://freesound.org/search/?q=tracked+vehicle&f=license:%22Creative+Commons+0%22) |
| `plane-loop` | Propeller aircraft flying, loopable (rotary engine if you find one) | ≤ 20 s | [propeller plane](https://freesound.org/search/?q=propeller+plane&f=license:%22Creative+Commons+0%22) |
| `battle-loop` | Massed small-arms fire far off, loopable (played under the single shots in big battles) | ≤ 20 s | [battle ambience](https://freesound.org/search/?q=battle+ambience&f=license:%22Creative+Commons+0%22) |
| `wind-loop` | Wind over open fields, loopable | ≤ 20 s | [wind field](https://freesound.org/search/?q=wind+field&f=license:%22Creative+Commons+0%22) |

Tips: prefer dry recordings (the game adds its own outdoor reverb and distance filtering); avoid clips with music, voices you can understand, or modern weapons (no automatic rifles, no jet engines).
