# RiskRTS – Design: Deployment, Map Readability and Phased Offensives

Status: 5 Nov 2026 · Base: `main` @ 67170d3 (Great War update merged) · Status: **Implemented** (branch `deployment-offensives`, see the implementation notes at the end)

## Problem

1. **You can't read the map.** A region's whole garrison is drawn as one small cluster at its centre (`DynamicDraw.garrison`), next to tiny factory/barracks props at fixed offsets. From normal zoom you can't tell troops from buildings, how many there are, or where they stand.
2. **Troops have no place inside a region.** `RegionState.units` is one pool. Defenders appear "everywhere" when a battle starts; you can't keep a reserve in the middle or mass on one border.
3. **Attacks are instant.** `march` → the army walks for 2.5–4 s → `arrive()` opens a battle at once. There is no build-up the enemy can see coming and no choice between a limited attack and a full invasion.

## Decisions

- **One main group plus one group per front.** Each region has a **main army** in the middle and at most **one corps per border**. Troops arriving at a place join the group already there. No group cap or merge prompts needed; the map stays readable by construction.
- **Named groups.** Main groups are armies, front groups corps, named per nation ("4th Army", "VII. Armeekorps", "XX Corps d'armée") – not bare numbers.
- **Movement time follows distance.** Every move – inside a region, through own land or into an attack – takes path length ÷ marching speed. Big regions are slow to cross, small ones quick; rails ×3.
- **Orders per group, never per battalion.** Keeps the "levers, not micro" rule of the Great War design.
- **Auto-deploy by default.** Every region distributes its garrison by threat unless the player takes it over. 54 regions must stay playable without micro.
- **Offensives run in phases:** Form → Move up → Assemble → then **Hold**, **Take the first line** or **Invade**. Each phase takes real time and is visible to an enemy who watches.
- **One battle, two stages.** A front fights the enemy's **first line** (border works) first; only an invasion continues into the **depth** (main army, interior defences).
- **Footholds give position only** – no income, no mission credit.
- **Naming:** the existing manpower "Mobilisation" lever (`mobilise { level }`) is renamed **Conscription** in the UI. "Mobilise" now means calling up troops for an offensive (command `form`).

---

## 1. Map readability

### 1.1 Troop markers

Every group gets a **marker** at its post – a WWI staff-map flag token:

```
 ┌──────────────────────┐
 │ ⚑ ✕  VII. AK · 12    │   faction colour, symbol of the biggest unit share, name, battalions
 └───◢──────────────────┘   ring/pip = state
```

| State | Ring / pip |
|---|---|
| Forming | progress ring filling up |
| Moving | arrow towards the destination, dotted path line with arrival time |
| Assembled / ready | solid ring |
| Holding (dug in) | spade pip, thicker base |
| Attacking first line | crossed rifles |
| Invading | arrowhead |
| Cut off / low morale | red edge, flashing below 25 % morale |

- Unit symbols follow map convention: ✕ infantry, ⦿ MG, • artillery, ◇ tank, ✈ air (from `icons.tsx`).
- **Zoom tiers:** far – markers only, merged per region ("3 groups · 24 btl"); mid – markers plus small models at their post; near – models only, marker on hover/selection.
- Markers are DOM labels like today's army counts (`render/labels.ts`), placed at the post's position, not the region centre.
- Fog: enemy markers show the estimate ("~10–20 btl") and stale reports in grey with the report date (existing `vis`/`est`). Enemy group names only after a report.

### 1.2 Front lines

- Each border with an own corps at its front post gets a **front line** drawn along the border: faction colour, thickness by strength, hatched teeth facing the enemy (trench-map style).
- Borders with no corps show a thin dashed line – an undefended border is visible at a glance.
- Active battles keep the existing battle anchor at the sector point. Footholds show as a bulge in the line.

### 1.3 Buildings

- Buildings move to **fixed plots** around the region's anchor, apart from the main army: factory (east), barracks (west), airfield (south), capital flag on the town.
- Models ×1.6 at map zoom, with a silhouette outline in faction colour so they read against terrain.
- **Region label badges:** ★ capital, factory, barracks, airfield, rail; bombed factory = struck-through badge.

### 1.4 Overlays

Two toggles in the top bar (and keys `T` / `B`):

- **Troops** – dims terrain and buildings, shows all markers, front lines and movement paths larger.
- **Industry** – dims troops, shows buildings, rails and supply quality (full/thin/cut).

---

## 2. Deployment inside a region

### 2.1 Posts and groups

| Post | Where | Group | Role |
|---|---|---|---|
| **Centre** | region anchor | **Main army** (always exists while the region has troops) | Reserve. Recruits and returning wounded join it. Reaches every border. |
| **Front post** (one per border) | sector point of that border | **Corps** of that front (0 or 1) | Mans the trench of that border. First to fight when attacked over it. |

- Moving troops to a post where a group stands merges them into it (morale and stance averaged as today in `arrive()`).
- Troops **on the move** are a temporary column (shown with the name of the group they left) until they arrive.
- A corps that is emptied disappears; the next one formed at that border gets a new number.

### 2.2 Names

- `data/nations.ts` gets per-nation patterns: army ordinal + word, corps Roman numeral + word. E.g. Germany "4. Armee" / "VII. Armeekorps", Britain "First Army" / "XI Corps", France "2e Armée" / "XX Corps d'armée", Russia "1-ya Armiya" / "III Kavkazskiy Korpus" style, Austria-Hungary "k.u.k. 3. Armee", Ottomans "5. Ordu" / "XV. Kolordu".
- Numbers are handed out per power in order of creation, deterministic (same on every client).

### 2.3 Orders

| Order | Effect |
|---|---|
| **Move to front X** | Sends a share (or chosen types) of the main army to the corps at border X. |
| **Back to reserve** | Sends a share of a corps back to the main army. |
| **Spread along borders** | Splits the main army over all enemy-facing borders by threat, keeps ~30 % in reserve. |
| **Move to region Y** | Sends a share of a group through own (or allied) regions to region Y, to its centre or a chosen front. |
| **Stance** | As today (balanced/aggressive/defensive/hold), now per group. |

### 2.4 Movement time

- **Time = path length ÷ marching speed.** The path runs post to post through sector points: centre → front post → across the border → next region's front post → its centre, and so on. Large regions (Siberia, Canada, Sahara) take long to cross, small ones (Belgium, Balkans) little.
- Marching speed ≈ **0.2 world units/s** on Normal (today 2.4). That gives roughly: centre → border 15–25 s in a mid-sized European region, one neighbour-to-neighbour leg 30–50 s, much longer in Asia or Africa.
- Rail links ×3 on that leg (Germany ×4 in Europe), mud/winter as today (`weatherMarch`), pace factor from `PACES` (Fast ×0.6, Long ×1.5).
- Same rule for own territory and attacks – distance decides, not ownership.
- The column's marker shows the remaining time; the path line shows the route it takes.

### 2.5 Auto-deploy

- Each region has a **deploy mode**: *Auto* (default) or *Manual*.
- Auto keeps ~30 % with the main army and spreads the rest over enemy-facing borders by the threat estimate the AI already computes (`_th`), weighted by works on that border. Re-balances every convoy, only with idle troops.
- Giving any group in a region an order switches the region to Manual; one tap switches back.

### 2.6 What placement does in battle

- **Attacked over border X:** the corps at front X fights from the start, in the trench. Fixed defences fight as today.
- The **main army** joins as a fresh wave after its travel time (centre → X). Resets the trench lull as reinforcements do today.
- **Other corps** stay put unless moved (`shift` becomes "move to front X").
- A border without a corps is held only by its fixed defences until the main army arrives. That is now the reason to man a border.

### 2.7 Deployment panel

In the region drawer, a new **Deploy** tab: a schematic of the region – main army in the middle, one spoke per border with neighbour name, owner colour, rail/sea/mountain marks and its corps. Tap a group, pick a share, tap a destination. The same works on the map: select marker → tap a border or region.

---

## 3. Phased offensives

### 3.1 The phases

```
 FORM ──► MOVE UP ──► ASSEMBLE ──► HOLD
(centre)  (distance)  (front post) ├─► TAKE FIRST LINE ──► (dig in, front stays)
                                   └─► INVADE ─► first line ─► consolidate ─► depth ─► region falls
```

| Phase | What happens | Time (Normal pace) | Visible to the enemy |
|---|---|---|---|
| **1. Form** (Mobilise) | Pick formations from the main army (and optionally recruit). They are called up and readied. | 20 s + 2 s per formation, max 60 s. Barracks or capital −50 %. | No – spies see it. |
| **2. Move up** | The troops march to the front post facing the target, through own regions if needed. | Distance-based (§2.4). | Observers see the corps grow ("troops massing – ~10–20 btl"). |
| **3. Assemble** | Troops deploy into jump-off trenches, guns register targets. | 30 s. While assembling the corps defends normally. | Yes – patrols/recon give exact numbers. |
| **4a. Hold** | The corps stays as the garrison of that border and digs in. | – | Yes. |
| **4b. Take the first line** | Battle against the enemy's first line on that border only. | Barrage + over the top as today (auto-go at 75 s), then the fight. | Battle starts. |
| **4c. Invade** | Take the first line, consolidate, then fight the depth. | First line as 4b, 30 s consolidation, then the depth battle. | Battle starts. |

Order-to-capture on Normal: about **5–7 minutes** for a neighbour attack from the centre of a mid-sized region, ~3 min from an assembled corps.

- **Skipping assembly** is allowed: attacking straight off the march costs the existing fatigue penalty (−15 morale) and the barrage starts unregistered (−30 % suppression for the first 30 s). Speed vs. preparation.
- **Quick order:** the old "attack X" button stays. It queues all phases for the chosen troops (form → move → assemble → invade) in one tap; every phase still takes its time. The AI uses the same path.
- An attacking corps is the corps of that front: troops sent there later join the battle as reinforcements (as today).

### 3.2 Battle stages

`Battle` gets a `stage` and a `goal`:

| Stage | Defenders | Ends when |
|---|---|---|
| **0 – First line** | The corps at that border, fixed defences of that sector, field works (trench, wire, sandbags) – as battles work today. Main army joins after travel time. | Attackers hold the trench → *first line taken*. Or attackers are beaten / withdraw. |
| **1 – Consolidation** | – | 30 s. The captured trench loses a level, wire and sandbags are gone, MG nests of that sector are destroyed or become holdouts. Defender may counter-attack with the main army. |
| **2 – Depth** | Main army, interior defences (`s = -1`), flak, anything moved in. Open ground: no wire, trench level 0. | Defenders beaten → region falls. Corps still at other borders become holdouts (existing `contested` logic) or withdraw to an adjacent own region. |

- **Goal "first line":** the battle stops after stage 0 and settles into trench warfare with the attacker in the old enemy line – a **foothold**. The region stays the defender's; the foothold only gives the better position. A later *Invade* order on the same front continues from stage 1.
- **Goal "invade":** stage 0 → 1 → 2 without a new order.
- A defender may *withdraw* from stage 0: survivors go to the main army, the fight continues in the depth. Elastic defence keeps its bonus.

### 3.3 Hold the front

- A holding corps digs in over time: after 2 convoys it counts as one trench level deeper on that border (max. the built depth +1).
- Corps facing an enemy foothold or front keep the front quiet (trench warfare, raids possible as today).

---

## 4. Fog and AI

- **Fog per post:** observers see an estimate per front post facing them, not just the region total. Scouted reports show all groups with names. A massing corps is a warning – and decoys now show up as a fake corps at a front post.
- **AI**
  - Garrisons on auto-deploy.
  - Offensives through the same phases: picks a target, forms troops from the main army of the border region, moves up, assembles, attacks.
  - National character decides the goal: Germany builds few big corps and invades; France takes first lines and holds; Russia invades with mass and skips assembly more often; Britain attacks along coasts; Austria-Hungary and the Ottomans mostly hold and counter-attack footholds.
  - Reacts to warnings: a massing corps across a border raises `_th` there → more troops to that front, works on that border.

---

## 5. Data model

- **New:** `Group { id, owner, region, post, name, units, men, mor, stance, state, order?, readyAt? }`
  - `post`: `-1` centre (main army), `≥0` neighbour id (corps of that front). Unique per `(region, post)`.
  - `state`: `forming | assembling | ready | holding | engaged`.
  - `order`: `{ k: 'hold' | 'line' | 'invade', to: number }`.
- **Columns on the move** reuse `Army` for ground troops with a route: `Army.path: { region, post }[]`, `Army.group` (name of the group it left), `Army.dest` post. `arrive()` merges into the group at the destination.
- `GameState.groups: Group[]`, plus per-power name counters. `RegionState.units` / `men` stay as **derived totals** of the region's groups (one helper), so economy, fog, supply and AI code reading totals keep working.
- `RegionState.deploy: 0 auto | 1 manual`.
- `Battle.stage: 0 | 1 | 2`, `Battle.goal: 'line' | 'invade'`, `Battle.foothold?: boolean`.
- **Commands:** `form { region, units }`, `move { region, post, to, toPost, frac | units }`, `order { region, post, k, to }`, `deploy { region, mode }`. `march` stays as the quick order. `shift` and `reinforce` become `move`. `stance` takes a group.
- **Snapshot `v: 5`**, migration from v4: each region's units become its main army (then auto-deployed); armies on the march become columns with the same progress.
- **Client:** markers in `labels.ts`, front lines in `dynamic.ts` (line batch), building plots in `dynamic.ts`, models drawn per group at its post (`garrison()` takes a position), Deploy tab in `DrawerTabs.tsx`, overlays in `TopBar.tsx` and the renderer.

## 6. Phases

1. **Readability** (§1): markers, front lines, building plots and badges, overlays. Client only, no sim change – ships first and already fixes "I can't see what's where".
2. **Groups, posts and distance-based movement** (§2, §5): groups and names in the sim, deploy tab, auto-deploy, placement in battle, migration to v5.
3. **Phased offensives** (§3): form, move up, assemble, battle stages, footholds, quick order.
4. **Fog per post and AI** (§4), balancing of all times.

Each phase with tests, typecheck and its own PR. All times are starting values for balancing.

## Settled questions (5 Nov 2026)

1. Marching time: **follows distance**, for own territory and attacks alike (§2.4).
2. Footholds: **position only**, no income or mission credit.
3. Group names: **named per nation**, armies and corps (§2.2).
4. Groups per region: **one main army in the middle, one corps per front** (§2.1) – no cap or merge prompts.

## Implementation notes (deviations and starting values)

Implemented on branch `deployment-offensives`, in one PR rather than four (the phases depend on each other's data model). Where the build differs from the text above:

- **Data model:** no separate `Group` list. Corps live on the region (`RegionState.fr[border] = { u, n, ord, ready, since, st }`); the main army is the region's `units` minus every corps. `units`/`men` keep meaning "the region's total", so economy, supply, fog and the AI needed no change. Men are spread evenly over a region's groups, and morale stays per region. Core module: `shared/src/sim/posts.ts`.
- **Columns** are `Army` objects with `post` (destination post), `src`, `wait` (forming), `ord`, `path`/`fin` (route through own land) and `inner` (moving between posts of one region).
- **No `form` command.** Forming up is a phase of attacks only: the quick order (`march` into a foreign region) calls troops up from the main army (20 s + 2 s per formation, max 60 s, halved with barracks or in the capital). Plain redeployments (`move`) set off at once.
- **Marching speed:** 0.3 world units/s on Normal (the design said 0.2). Measured on the map: centre → border median ≈ 20 s, neighbour leg ≈ 45 s, longest regions over a minute. Crossing from a border into the enemy's line takes at least 6 s.
- **Main army in battle:** only regions on *Auto* send half their main army to a threatened border when a battle opens. On *Manual* the player decides; the main army then meets the attackers in the depth.
- **Interior defences** (`s = -1`) fight in the depth stage; anti-air guns still stand with the first front.
- **A fallen region:** corps on its other borders and what is left of the main army march to a neighbouring own region (or surrender if there is none), instead of becoming holdouts.
- **Defender withdrawing from the first line** falls back to the main army in the middle; the fight goes on in the depth.
- **Recruits** in a region fighting a phased battle join the main army, not the battle.
- **Fog:** columns forming up are hidden unless a spy works in the region. Corps across the viewer's own borders show as an estimate; their attack order shows in the last 30 s of assembly (plus a "massing" warning in the feed). Reports show all corps with names.
- **AI:** offensives go through the same phases. New per-nation weights `line` (share of first-line-only attacks: France and the Ottomans 0.5, Austria-Hungary 0.4, Russia 0) and `rush` (attacking before assembly: Russia 0.4). It carries footholds into the depth after 40 s when it looks stronger than the depth.
- **Map:** corps markers are staff-map tokens (unit symbol, battalions or estimate, short name up close) with state styles for holding, dug in, assembling (countdown) and attacking. Forming columns show their countdown. Front lines are drawn as bars with teeth towards the enemy; unmanned foreign borders are dashed for the selected region and on the troops layer. Buildings stand on spread-out plots at 1.5× size (1.9× on the industry layer); region labels carry capital/factory/barracks/airfield badges. Layers: *Map / Troops / Industry* below the clock, keys `T` and `B`.
- **Conscription:** the manpower lever (`mobilise`) is labelled Conscription in the UI (Peacetime / Extended / Total); the command name is unchanged.
- **Tests:** battle-mechanics tests now open fronts through `test/helpers.ts` (`strike`, `openFront`), which place the defenders on the attacked border and an assembled corps on the attacker's side. New tests in `test/deploy.test.ts`.
- **Snapshot `v: 5`, protocol 5.** v4 saves are migrated by placing every garrison at once.
- **Not yet:** markers are not clickable (select the region instead); no drag-and-drop on the Deploy tab; the "merged per region" far-zoom marker and the foothold bulge in the front line are not drawn.

Starting values: forming 20 s + 2 s/formation (max 60 s), assembly 30 s, consolidation 30 s, dug in after 2 convoys (+1 trench level), unregistered guns −30 % suppression for 30 s, auto-deploy keeps 30 % in the main army. All scale with the pace (Fast ×0.6, Long ×1.5).
