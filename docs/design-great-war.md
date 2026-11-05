# RiskRTS – Design: The Great War Update

Status: 5 Nov 2026 · Base: `main` @ 718ea3c (after PR #7, war simulation) · Source: brainstorm "Core Concept / Real-Time / Detailed Design Expansion" · Status: **Implemented** (phases 1–6, see the PRs `great-war/1-…` to `great-war/6-…`)

## Decisions

- **Real time stays.** No turns, no "lock orders and resolve". The brainstorm's turn-based passage is dropped.
- **Battle levers, not micro.** Battles still fight themselves; players get a handful of decisive levers per front (barrage, over the top, stance, reserves, retreat).
- **Map stays at 54 world regions.** Rails, weather and mountain borders are added to it, not a new map.
- **Economy: supply + shells + men.** Supply (industry) buys things, shells feed the guns, a finite manpower pool limits recruiting. No fuel.
- **Tech calendar locks units.** Planes from spring 1915, tanks from Sep 1916 at the earliest (per nation, §4.4).
- **No gas.** Kept out for tone.
- **Secret missions stay individual.** Alliances can be broken.
- **Every power plays differently:** national units, strengths and weaknesses (§4.4). The AI plays to its nation's character.
- **Server later.** Everything stays P2P-compatible; dedicated server, persistent worlds, ranked and spectators are the last phase.

## Evaluation of the brainstorm

| Idea | Verdict | Why |
|---|---|---|
| Real-time parallel play, no dice, deterministic sim | **Done** | Already the core of the game. |
| Formations, strength %, morale, surrender, war weariness | **Done** | PR #7. |
| Trenches, wire, sandbags, bunkers per border; fronts per border | **Done** | PR #7. |
| Fog, cavalry/recon/spies, ageing reports | **Done** | PR #7. |
| Supply lines, encirclement | **Done**, extended by rails (§3). |
| Tiberian Sun look: iso camera, muddy grade, smoke | **Done**, extended in §8. |
| Artillery preparation as the key decision | **Adopt** – the best idea in the docs (§1). |
| Shell stockpiles, finite manpower | **Adopt** (§2). |
| Rail network as lifeblood, cutting rails | **Adopt** on the 54-region map (§3). |
| Tech calendar 1914–18, doctrines, stormtroopers, tanks | **Adopt** (§4). |
| National variants (British, French, German, Russian …) | **Adopt and extend** – not just looks, but units, strengths and weaknesses (§4.4). |
| Poison gas | **Drop** – your call, tone. |
| Weather & seasons | **Adopt, light** (§5). |
| Terrain (mountains favour defenders) | **Adopt, light** – mountain borders (§5.2). |
| Stances, hold at all costs, commit reserves, retreat | **Adopt** as battle levers (§1). |
| Fatigue | **Adapt** – folded into morale instead of a new bar (§1.6). |
| Misinformation, fake army concentrations, trench raids | **Adopt** (§6). |
| Live diplomacy, ceasefires, betrayal | **Adopt, light** (§7). |
| After-action report, staff briefing panel | **Adopt** (§8). |
| Blockades / U-boats, revolution | **Adapt** – light versions (§2.3, §3.4). |
| Game speed 1×–4×, tactical pause | **Partly done** (pause in SP/host); speed control added (§8). |
| Full C&C micro: drag-select, control groups, bombard rectangles | **Drop** – dozens of simultaneous battles across 54 regions; micro in one leaves the others unattended. |
| Division templates, attachments, army commanders with AI subordinates | **Drop** for now – heavy for 5 unit types. Stances and reserves give most of the value. |
| Detailed European + colonial map | **Drop** (your call: keep 54 regions). |
| Fuel as a resource | **Drop** – tanks and planes are few; fuel adds bookkeeping without decisions. |
| Satellite recon | **Drop** – out of period. |
| Night battles with searchlights | **Cosmetic only** – one convoy is a week, so day/night has no rules meaning (§8). |
| Persistent servers, ranked, spectators | **Last phase** (§9). |

## 1. Battle levers

A battle today: attackers wait `PACES.charge` seconds (180 s on Normal), artillery fires the whole time, then everyone charges. The levers turn those fixed rules into decisions. All levers are commands, so multiplayer and AI get them for free.

### 1.1 Barrage

Command `barrage { battle, level }` with `level` 0 off · 1 light · 2 heavy.

| Level | Gun fire rate | Shell use per battery | Effect |
|---|---|---|---|
| Off | – | 0 | Guns hold fire (saves shells, hides strength). |
| Light | 100 % | 1 per 10 s | As today. |
| Heavy | 180 % | 2 per 10 s | Builds **suppression** faster, cuts wire faster. |

- **Suppression** per front, 0–100 %: rises with shells landing in the enemy trench, falls when fire stops (half-life ~20 s). Suppressed defenders fire less (up to −60 %) and MG nests stop firing above 70 %. This is what makes "fire for 2–5 minutes, then go" a real choice.
- **Counter-battery:** when both sides fire, part of each side's shells target the enemy guns instead (more with recon aircraft over the battle).
- **Out of shells:** guns fire at 25 % ("rationed"), heavy barrage is greyed out.
- Gun emplacements and defending batteries draw from the defender's stock at half rate.

### 1.2 Over the top

Command `assault { battle }`: the attackers leave their start line now. If not given, they go automatically at the latest charge time of the pace (Normal 180 s), so idle players are not punished with a frozen front.

- The UI shows the front's suppression and remaining wire so the player can time it.
- Crossing no-man's-land is where infantry is most exposed (existing behaviour), now with wire and mud (§5) setting its length.

### 1.3 Stance (per region garrison and per attacking army)

| Stance | Behaviour |
|---|---|
| **Balanced** (default) | As today. |
| **Aggressive** | Counter-attacks between waves, +15 % damage, +25 % own losses. |
| **Defensive** | Stays in the trench, −30 % own losses, never counter-attacks. |
| **Hold at all costs** | No surrender above 0 morale, no withdrawal; morale damage +50 %. |

Command `stance { region, s }`. Armies on the march inherit the stance of the region they left.

### 1.4 Reserves

Already there: `shift` moves defenders between fronts of one region. New: `reinforce { from, battle }` sends troops from an adjacent own region **straight into that front** (arrives as a fresh wave, resets the trench-warfare lull as today). With rails (§3) they arrive three times as fast.

### 1.5 Retreat

Command `withdraw { battle }`:
- Attacker: survivors march back to the border they came from; morale −10, no wounded lost.
- Defender: survivors leave to an adjacent own, supplied region; the attacker takes the region without a fight on that front. Holdout defences stay as today.
- Units break and retreat on their own only via the existing surrender rule.

### 1.6 Fatigue (folded into morale)

No new bar. Instead: an army that arrives after marching more than 2 borders in a row, or that joins a battle within 60 s of leaving one, starts with −15 morale. Rest in a supplied region recovers it at the existing rate. Same feel, one number less.

## 2. Economy: supply, shells, men

### 2.1 Supply (as today)

Income per convoy unchanged. Factories now also produce shells, so factories become the key industrial target.

### 2.2 Shells

- One stockpile per power, shown in the top bar.
- Production per convoy: 2 base + 3 per factory + 1 per capital (national modifiers in §4.4). Command `produce { kind: 'shells', n }`: convert supply into shells, 1 supply → 4 shells.
- Use: §1.1. Shells for a battle must reach it: a front in a region that is **cut off** fires only from what was there (each region keeps a small local dump: 10 shells per battery present, refilled each convoy when supplied). Regions reached by land but **not by rail** get half refill (§3).
- AI: keeps a target stock of 30 + 10 per battery.

### 2.3 Men

- **Manpower pool** per power, in men. Start: about 3× the men of its starting armies, scaled by nation (§4.4).
- Recruiting costs supply **and** men from the pool (one battalion = 100 men). Barracks volunteers draw from it too. Pool empty → no recruiting; returning wounded still refill formations.
- Growth per convoy: 20 men per home-territory region still held (a new age class). Losing home territory shrinks the base permanently.
- **Mobilisation** (command `mobilise { level }`, 0–2): each level +50 % pool growth, +0.5 war weariness per convoy. Gives the "conscription laws" decision with one control.
- **Unrest (light revolution):** above 80 war weariness (national thresholds in §4.4) for 5 convoys in a row, the power's most distant home region stops paying (strikes, marked on the map); 15 points higher, it may rise and become neutral. Brings the collapse of Russia/Austria-style empires without a separate politics layer.

## 3. Rails on the 54-region map

### 3.1 Data

A fixed table of rail links between land-adjacent regions (`data/rails.ts`), following the 1914 network: dense in Europe; Trans-Siberian (Petrograd–Ural–Siberia–Irkutsk–Manchuria); Berlin–Baghdad (Germany–Austria-Hungary–Balkans–Anatolia; the Anatolia–Mesopotamia leg unfinished); North American transcontinentals; Cape and Cairo stubs in Africa; India. Drawn on the map with the existing railway paint in `groundPaint.ts`.

### 3.2 Effects

- **Movement:** marches along a rail link take one third of the time.
- **Supply quality:** a region linked to a supply source by an unbroken chain of own rails is **fully supplied**. Linked only by land: **thin supply** – half shell refill, half wounded return, recruiting allowed. No link: cut off (as today).
- Supply-line computation runs twice: rails first, then plain land.

### 3.3 Attacking and building rails

- **Air strike on a rail region** damages its links for 2 convoys (instead of strafing a battle).
- **Spy sabotage** (the optional item from the last design): a working spy can cut one rail link for 3 convoys, but doubles its own discovery chance.
- **Build railway** `build { kind: 'rail', region, to }` between two adjacent own regions: 5 supply, ready after 3 convoys. Captured rails work for the new owner.

### 3.4 Sea lanes and blockade (light)

Sea lanes stay as today but count as thin supply unless both ends have a factory or capital. A power with the **Blockade / U-boat war** doctrine (§4.3) or Britain's Royal Navy trait (§4.4) lowers enemy supply quality on sea lanes it borders by one step. No new ship units.

## 4. Calendar, technology, doctrine, nations

### 4.1 Calendar

One convoy is already one week of game time (`day += 7`). Start: August 1914. At 1× speed 1916 arrives after ~35 min, November 1918 after ~75 min – which matches the 45–120-minute match target. Games that end early never see the late war; long wars change character, as they should.

### 4.2 Unlocks by date

| Date | Unlocks |
|---|---|
| Aug 1914 | Infantry, MG companies, field batteries, cavalry patrols, spies, trench I, sandbags, wire, MG nests, gun emplacements |
| Spring 1915 | Air squadrons, recon flights, anti-air guns, trench II |
| 1916 | Trench III, bunkers, heavy barrage +20 % suppression, **tank platoons** – Britain first, others later (§4.4) |
| 1917 | Better tanks (+30 % HP), strategic bombing of factories, rail sabotage by air |
| 1918 | Combined arms (tanks + infantry in one wave +20 %), improved aircraft |

The opening is now infantry, MGs and guns only; planes arrive after ~10 minutes, tanks after ~40. Existing v3 saves keep the units they already have.

**Rushing:** a power can bring one unlock forward by 6 months for 20 supply (one rush per year). Replaces "research points" with one clear decision.

### 4.3 Doctrines

At the start of each war year (Jan 1915, 1916, 1917, 1918) each power picks one doctrine from three. A pop-up with a 60 s timer. Human players choose freely; the AI picks the one its nation favours (§4.4).

| Year | Options |
|---|---|
| 1915 | **Artillery dominance** (shells −25 % per barrage) · **Defence in depth** (trench building −30 % cost, second front line) · **Mass mobilisation** (pool growth +50 %) |
| 1916 | **Creeping barrage** (attackers take −30 % fire while suppression > 50 %) · **Elastic defence** (defenders fall back to a second line instead of breaking, once per battle) · **Blockade / U-boat war** (§3.4) |
| 1917 | **Infiltration** (infantry ignore 30 % of wire, +15 % speed; Germany's storm battalions go further, §4.4) · **Tank corps** (tanks −30 % cost) · **Air superiority** (planes +30 %, recon never shot down on first pass) |
| 1918 | **Combined arms** · **Total war** (+30 % income, +1 war weariness per convoy) · **Peace offensive** (war weariness −30 %, ceasefires cheaper) |

### 4.4 National character

Each power keeps the same five unit types (so the sim, AI and UI stay manageable), but one of them is a **national variant** with its own name, stats and model, and each power has two strengths and two weaknesses. All values are starting points for balancing.

| Power | National unit | Strengths | Weaknesses | AI favours |
|---|---|---|---|---|
| **British Empire** | **Mark IV tank platoon** – tanks from Sep 1916 (first of all), +20 % HP. | *Royal Navy:* own sea lanes always fully supplied; enemy sea lanes next to British regions drop one supply step. *Empire:* +1 supply per region held outside Europe. | *Volunteer army:* pool growth −50 % until Jan 1916 (conscription). Small starting army. | Blockade, Tank corps, Defence in depth |
| **French Republic** | **Canon de 75 battery** – field battery with +35 % rate of fire, −20 % damage against trench III and bunkers. Available from the start. | *Fortress belt:* bunkers and gun emplacements −25 % cost in home regions. *Ils ne passeront pas:* "Hold at all costs" costs only +25 % morale damage. | *Low birth rate:* pool growth −30 %. Losses raise war weariness +20 %. | Artillery dominance, Creeping barrage, Air superiority |
| **Russian Empire** | **Siberian rifle battalion** – infantry ignores winter penalties and fights +20 % in winter. | *Vast reserves:* manpower pool +60 %. *Russian winter:* winter penalties for all Russian troops halved. | *Shell crisis:* shell production −40 % until 1916. Morale cap −10; unrest starts at 70 war weariness. No own tanks until 1918. | Mass mobilisation, Defence in depth, Total war |
| **German Empire** | **Storm battalion** – from 1917 German infantry ignore 60 % of wire, +25 % speed, +15 % damage in the assault (stronger than the Infiltration doctrine others can take). | *Interior lines:* rail movement in Europe ×4 instead of ×3. *Krupp:* shell production +25 %, suppression +10 %. | *Blockaded:* German sea lanes are always thin supply. *Late tanks:* tanks only from Mar 1918, at +50 % cost (A7V). | Artillery dominance, Elastic defence, U-boat war, Infiltration |
| **Austria-Hungary** | **Škoda siege battery** – field battery with +80 % damage against defences (MG nests, bunkers, emplacements), −20 % rate of fire. | *Mountain war:* defenders on mountain borders +30 % (on top of §5.2). Fortifications −20 % cost in mountain regions. | *Many-nation army:* morale cap −10, unrest starts at 75 war weariness. Pool growth −20 %. No own tanks until 1918. | Defence in depth, Artillery dominance, Peace offensive |
| **Ottoman Empire** | **Fortress infantry** – infantry +25 % defence in a trench, −15 % attack. | *Gallipoli:* home regions start with trench II on every border. *Desert war:* heat penalties halved. | *Weak industry:* factories produce 2 shells instead of 3, factories cost +2. Poor rails: Anatolia–Mesopotamia unfinished, more sea lanes thin. No own tanks until 1918. | Defence in depth, Elastic defence, Mass mobilisation |

Tank dates by nation: Britain Sep 1916 · France Apr 1917 · Germany Mar 1918 · Russia, Austria-Hungary, Ottomans 1918. A captured factory region does not transfer a nation's units.

**AI personality** also shapes behaviour beyond doctrines: Britain fights around the coasts and raids sea lanes; France digs in and counter-attacks; Russia attacks with mass and accepts losses; Germany concentrates artillery for few, large offensives; Austria-Hungary defends mountains and leans on its ally against Russia; the Ottomans hold and wait for the attacker to bleed.

**Implementation:** `data/nations.ts` with per-faction stat multipliers per unit type, unit names and model keys, trait flags, tank date, pool and shell modifiers, unrest threshold and AI weights. The sim looks stats up through one function (`statsOf(faction, type)`), so battle code needs no special cases. Models get one variant each in `render/models.ts`.

## 5. Weather, seasons, terrain (light)

### 5.1 Weather

Per continent and month, computed from `day`:

| Condition | Where/when | Effect |
|---|---|---|
| **Mud** | Europe, Oct–Nov and Mar | Marches +30 % time, no-man's-land crossing +30 %, shell splash −20 %. |
| **Winter** | Eastern Europe, Asia north of 45°, Dec–Feb | Marches +40 %, cut-off wear ×2. |
| **Heat** | Africa, Middle East, India, Jun–Aug | Cut-off wear ×1.5. |
| **Fair** | otherwise | – |

Shown in the top bar and as rain/snow/dust in the renderer.

### 5.2 Mountain borders

A small table of mountain borders (`data/terrain.ts`, e.g. Italy–Austria-Hungary, Austria-Hungary–Balkans, Caucasus–Anatolia, Iberia–France, India–Mongolia/China). Attacks over them: defenders take −20 % damage, attackers cross no-man's-land 30 % slower, tanks −50 %.

## 6. Fog extensions

- **Decoy army** `decoy { from, to }`: 1 supply. Enemies observing either region see an estimated army marching ("ca. 500–1,500 men"). It dissolves on arrival or when a recon report covers it. The AI uses decoys when it masses for a real attack elsewhere.
- **Fake concentration** – no separate order: a decoy that stops in an own border region shows as an inflated estimate there until scouted.
- **Trench raid** `raid { battle }`: from a front that has settled into trench warfare. Costs one battalion's worth of risk (10–40 % losses), returns a full report on the enemy side of that front and −5 enemy morale.

## 7. Diplomacy (light)

Live offers between powers, accepted or rejected in a toast:

| Offer | Effect | Breaking it |
|---|---|---|
| **Ceasefire** (10 convoys) | No attacks between the two; fronts between them freeze into quiet. | +10 war weariness to the breaker, all AIs trust it less. |
| **Non-aggression pact** (until cancelled, 3-convoy notice) | No attacks. | Same as above. |
| **Alliance** | Shared vision, supply lines may run through the ally's regions. | Ends with 3-convoy notice or by attacking. |

Chat already exists in multiplayer lobbies; in-game it gets quick phrases. The AI accepts by its interest (threat on another front, war weariness). **Secret missions stay individual**, so allies may still be rivals – betrayal is part of the game.

## 8. Presentation and UI

- **Front card** (BattleCard): suppression bar, wire left, shells left in the local dump, barrage level buttons, *Over the top*, stance, *Reinforce*, *Withdraw*, *Raid*.
- **Staff briefing** before an attack: estimated enemy strength from fog, expected shell use for a 2-minute heavy barrage, rough loss forecast. Clearly labelled as an estimate.
- **After-action report** when a battle ends: men lost by type on both sides, shells spent, how far the attackers got (from agent positions), morale change. Stored for the last 20 battles; radio dispatch links to it.
- **Top bar:** date, weather, supply, shells, men in the pool, war weariness, speed 1×/2×/4× (host/single player; multiplayer follows the host).
- **Nation screen** in the lobby: each power's national unit, strengths and weaknesses, so the choice of power matters.
- **Battlefield:** persistent craters and churned mud per border (stored as a crater count per sector, not as fx), collapsed trench sections after heavy barrages, rain/snow, national unit models. Night is cosmetic: battles fought in mud months get dusk lighting for variety.
- **Map:** rails, mountain borders, unrest markers, ceasefire lines, decoy estimates looking like real ones.

## 9. Dedicated server (last phase)

- `packages/server`: Node + WebSocket `Channel`, runs `HostSession` unchanged (as `architecture.md` already outlines).
- **Persistent worlds:** state saved after every convoy; players leave and rejoin, their power runs on AI while away (stance and doctrine choices respected).
- **Ranked:** fixed settings, no pause, Elo per player.
- **Spectators:** full-vision snapshot stream with delay.

## 10. Data model changes (summary)

- `FactionState`: `shells`, `men` (pool), `mob`, `doctrines[]`, `rushes`, `unrest`.
- `RegionState`: `stance`, `dump` (local shells), `strike` (unrest), `supplyQ` (0 cut, 1 thin, 2 full).
- `Battle`: `barrage` per side, `supp` per side, `assaultAt`, `craters`, `report`.
- `Army`: `decoy?`, `rail?`.
- New data: `data/nations.ts`, `data/rails.ts`, `data/terrain.ts`.
- New state: `rails` damage map, `treaties[]`, `reports[]`.
- Commands: `barrage`, `assault`, `stance`, `reinforce`, `withdraw`, `produce`, `mobilise`, `rush`, `doctrine`, `decoy`, `raid`, `offer`, `answer`, `build rail`.
- Snapshot `v: 4`, migration from v3 (no shells/pool → start values from current armies; date-locked units already on the map are kept).

## 11. Phases

1. **Battle levers + shells** (§1, §2.2, front card, after-action report) – the core of the update; worth playing on its own.
2. **Nations + manpower** (§4.4, §2.3): national units, traits, AI personalities, pool, mobilisation, unrest.
3. **Rails, weather, mountain borders** (§3, §5).
4. **Calendar, unlocks, doctrines** (§4.1–4.3).
5. **Decoys, raids, diplomacy** (§6, §7).
6. **Dedicated server, persistence, ranked, spectators** (§9).

Each phase with tests, typecheck and its own PR. All numbers are starting values for balancing.

## Settled questions (5 Nov 2026)

1. Tanks and planes locked by the calendar: **yes.**
2. Secret missions with diplomacy: **individual.**
3. Gas: **out.**
4. AI and doctrines: **each power has its own units, strengths and weaknesses** (§4.4); the AI plays to them.

## Implementation notes (deviations and starting values)

Implemented as six stacked branches/PRs, one per phase. Where the build differs from the text above:

- **Over the top:** attackers go on their own after a pace-dependent time (Fast 40 s, Normal 75 s, Long 120 s) rather than `PACES.charge`, and at once when they bring no guns. Defenders keep the old charge time for counter-attacks (earlier when aggressive, never when defensive or holding).
- **Shells:** the local dump belongs to the battle (10 shells per gun that joins) instead of to the region. Thin supply makes every shot cost half again instead of halving a refill. Barrages against deep trenches lose 15% damage per trench level, so a barrage pins a line down rather than wiping it out.
- **Unrest:** a rising region goes over to the strongest neighbouring rival instead of becoming neutral (the map has no neutral owner).
- **Mobilisation:** general mobilisation also stops war weariness from fading; with only +0.5 per level the normal fade cancelled it out.
- **Doctrines:** "second line" of defence in depth = trenches count one level deeper in battle; combined arms gives +10% from the 1918 unlock and +25% with the doctrine; air superiority means reconnaissance flights are never shot down.
- **Rails:** the Bosporus counts as a train ferry on the Berlin–Baghdad line; rail strikes and factory bombing are their own air orders (from 1917).
- **Diplomacy:** attacking a treaty partner needs an explicit "Break treaty" order. Allies share vision and supply lines but not movement.
- **Dedicated server:** casual wars wait while nobody is connected; ranked wars keep running. Spectators lag 20 s by default.
- **Not yet drawn:** persistent craters (stored per border as `RegionState.cr`), collapsed trench sections and dusk lighting.
