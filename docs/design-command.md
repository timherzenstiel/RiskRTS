# RiskRTS – Design: Command Overhaul (forces, supply, manpower, situation map, menus)

Status: 6 Nov 2026 · Base: `main` @ ae8521a (navy + globe merged; the small `clarity` branch is folded in) · Status: **Approved · phases 1–4 merged (PRs #24, #26, #28, #30) · phase 5 in its own PR** · Mockups: design canvas "RiskRTS – Command overhaul"

## Problem

Seen from the code as it is today:

1. **You can't read the situation.** The map shows corps tokens and battle smoke, but not *who is at war with whom*, *which border is in danger*, or *how my side of a border compares to theirs*. The only list of fronts is the idle sidebar (8 battles, no grouping). Enemy strength is buried in the foreign region drawer as text lines.
2. **Troops are slices, not units.** A region holds one `units` pool; a corps (`RegionState.fr[border]`) is a subset of it; the main army is "whatever is left". Men are spread evenly over all groups and morale is per region. So a corps has no strength, morale or history of its own, and you move troops by a share (25/50/75 %/all but 1) instead of by picking a formation.
3. **Every action is region-first.** Recruit, Fortify, Build, Deploy, March and Harbour are six tabs of the region drawer. To defend a border you open a region, then Deploy, then pick a share, then a border. To see a border's works you go to Fortify. Attacking is a *different* drawer (the foreign region's), with its own share picker.
4. **Too many overlapping numbers, opaque rules.** "Supply" is both the money and the logistics (`supply`, `supplyQ`, `cut`). Shells are bought by clicking "+4 shells". Wounded men are a hidden second pool. Morale, strength, war weariness, conscription and unrest all act, but nothing on screen says *why* a number is what it is.

## Goal

A player should, at a glance, answer five questions – and act on the answer with one or two clicks:

| Question | Answered by |
|---|---|
| Where are the wars, and between whom? | **Fronts** map mode + **Situation** panel (§1, §5.2) |
| What do I have on each border, and what is across it? | **Border balance chips** on the map + **border card** (§1.3, §5.3) |
| Where are my forces and what state are they in? | **Forces** map mode + **Order of battle** panel (§1, §5.2) |
| Can I keep them supplied and replaced? | **Supply** map mode + **Economy** panel (§3, §4) |
| What needs my attention now? | **Alerts** queue (§5.4) and the commanders' **Staff inbox** (§2.5) |

## Decisions

- **Corps become real objects.** Each corps and army has its own battalions, men, morale, stance and order, and moves as a whole. Region totals are derived from the corps in it. (The deployment design wanted this; the build took a shortcut – this pays it off.)
- **Select a formation, then give the order.** Click a corps token (or a roster row), right-click a target. Splitting is an explicit *Detach* with chosen battalions, not a percentage.
- **One word per thing.** The money becomes **Production**; **Supply** means only logistics. A convoy becomes a **week** (it already is 7 days).
- **Supply has a capacity.** A region can feed only so many battalions; rails, depots and ports raise it. This makes logistics a visible constraint on massing troops instead of a hidden flag.
- **One manpower flow.** Pool → training → corps; casualties partly come back as wounded *into the pool*. Under-strength corps are refilled from the pool automatically.
- **Munitions run themselves.** Factories split their output between Production and Munitions by one national lever; no "+4 shells" clicking.
- **Menus by subject, not by region.** The right sidebar shows **what is selected** (corps, border, region, battle, fleet). Nation-wide business lives in **panels** on the left (Situation, Staff, Forces, Economy, Navy, Intel, Diplomacy, Calendar). Map modes replace the Map/Troops/Industry layers.
- **Commanders run the fronts; you run the war.** Every army has a commander (an AI general with traits) who deploys, digs in and fights his stretch of front within a **mandate** you set, and sends you **requests** – more men, guns, shells, works, a railway, permission to attack or to fall back. You approve, partly approve or deny; an approval carries itself out (§2.5).
- **Every number explains itself.** Hovering any figure shows its breakdown; every alert says why and links to the fix.
- **Desktop first.** Touch keeps working with the existing bottom tray but gets its own pass later.
- Unchanged: battles, battle levers, phased offensives, fog rules, navy, rails data, nations, doctrines, calendar, diplomacy.

---

## 1. Map modes – seeing the situation

The map-layer picker under the radar becomes a **mode picker** with five modes (keys `F1`–`F5`). Every mode keeps terrain and borders; each fades what it doesn't need and draws its own overlay. The globe (theatre zoom) shows the same overlays.

| Mode | Key | Shows | Fades |
|---|---|---|---|
| **Political** | F1 | Owner wash, capitals, region names, treaties (ceasefire lines dashed white, alliances as shared hatching) | – |
| **Fronts** (default once the first battle starts) | F2 | Wars and battles (§1.1), hostile borders with **balance chips** (§1.3), attack arrows, massing warnings | buildings, quiet own interior |
| **Forces** | F3 | Every corps and army token at full size, movement routes with ETA, fleets, strength/morale pips | buildings, works |
| **Supply** | F4 | Supply state and load per region (§3), depots, rails (cut rails red), cut-off pockets outlined | troops except totals |
| **Intel** | F5 | What you know: full / report of *date* (ageing sepia) / estimate / unknown; spies, patrol routes, recon coverage | – |

The old layers map onto this: *Map* → Political, *Troops* → Forces, *Industry* → Supply (buildings show in Supply and Political).

### 1.1 Wars on the map (Fronts mode)

- **Hostile borders** – every border between two powers at war – are drawn as a thick **two-colour line** (one colour per side, split along the border). You see at once that Germany fights France in the west and Russia in the east.
- **Active battles** are a marker at their sector point: crossed sabres in the attacker's colour on a ring in the defender's colour, a small progress bar (stage: first line / consolidating / depth / foothold) and the arrow of the attack.
- **Quiet fronts** (trench warfare, `age − lastJoin > 60 s`) draw dimmer, with a spade pip.
- **Massing** (a corps assembling with an attack order, already in fog as `massing`) pulses amber on the border it faces.
- At theatre zoom, battles of the same pair of powers in one area merge into one marker "DE ⚔ FR · 4".

### 1.2 Forces on the map (Forces mode)

- Corps tokens (existing staff-map tokens in `labels.ts`) now stand for **real corps** (§2): symbol, name up close, battalions, a strength bar and a morale pip.
- Several corps at one post stack into one token "VII + XI AK · 24 btl"; hovering fans them out.
- **Armies** (a corps group with an HQ, §2.1) show a larger token at their HQ and a thin bracket around the borders their corps hold.
- Columns on the move show the route as today, plus the ETA at the arrowhead.

### 1.3 Border balance chips

On every **own border that faces a power at war with you** (and every coast facing an enemy fleet or port), a chip sits at the sector point:

```
 ┌─────────────┐
 │ 14 ▮▮▮▮▯ ~9 │   own battalions | bar of the ratio | their battalions (estimate, date, or ?)
 └─────────────┘   frame: green ≥ 1.5×, khaki 0.8–1.5×, amber 0.5–0.8×, red < 0.5× or massing
```

- **Own side** = battalions of the corps at that post, weighted by power (`unitPower`), plus works and defences of that sector, plus half of an army reserve that can reach the border in under 30 s.
- **Their side** = what you know of the corps on *their* post facing you plus their works on that border:
  - scouted/spy: exact, with the report date if stale ("9 · 12 Mar");
  - observed: the existing estimate range ("~6–12");
  - unknown: "?" and a grey frame.
- **Columns** you can see heading for that border count with a "+" ("~9 +6").
- Clicking a chip opens the **border card** (§5.3). The chips also appear in Political mode when you hover a region.

This needs one shared helper `borderBalance(view, region, sector)` in `shared/src/sim/` used by the chips, the border card, the Situation panel and the AI's threat estimate (`_th`), so the player sees the same numbers the AI reasons with.

---

## 2. Forces: corps as objects

### 2.1 What a formation is

| Level | What it is | Holds |
|---|---|---|
| **Battalion** (unit) | as today: inf 100 men, MG coy 60, battery 80, tank platoon 25, squadron 12 | – |
| **Corps** | the formation you command: 1–20 battalions at one place | battalions, men per type, morale, stance, order, experience |
| **Army** | 2–6 corps on a stretch of front, led by a commander (§2.5) | its corps, a front (list of borders), an HQ region, the commander and his mandate |
| **Depot** | the troops of a region not in any corps (recruits, returning stragglers) – one per region, at the centre | battalions only; joins a corps or becomes one |

- **Squadrons** stay a regional pool at airfields (they fly missions, not marches); they are not part of corps.
- **Corps size cap 20 battalions.** Larger concentrations are several corps at one post. Keeps each battle side readable and stops one-stack play.
- **Experience** (new, light): 0–3 stars, +1 per won battle the corps fought in, −1 when it is refilled by more than half; each star +5 % damage. Gives corps an identity worth keeping alive.
- Names come from `data/names.ts` as today ("VII. Armeekorps", "4. Armee").

### 2.2 Where corps stand

- A corps stands at a **post**: a region's centre (reserve) or one of its border/coast sectors – as today, but any number of corps per post.
- On **Auto** (default per region, as today's deploy mode), the region forms and moves *depot* troops itself: it keeps a reserve corps at the centre and one corps per threatened border, sized by the balance (§1.3). Corps the player has ordered are **manual** (a small hand icon) and auto never touches them.
- An **Army** is run by its commander (§2.5): he deploys *its* corps along its front, covers the most dangerous borders first and keeps one corps back. This is the 54-region answer: give each front one army, and it manages itself – and asks you for what it needs.

### 2.3 Orders

All orders are on the **corps card** (§5.3) and on the map:

| Action | Mouse (desktop) | Effect |
|---|---|---|
| Select | click token / roster row; shift-click adds; drag a box on the map selects tokens | – |
| **Move** | right-click an own post / border / region | Marches the selected corps there by the shortest own route (rail where possible); preview line with ETA before you release. |
| **Attack** | right-click an enemy region or a hostile border | Phased offensive as today (form → move up → assemble → goal). The card asks *First line* or *Invade* (default from the last choice). |
| **Ship / Landing** | right-click a far own coast / an enemy coast | Navy orders as today, but for the selected corps. |
| **Detach** | card → *Detach*: choose battalions per type | New corps at the same post. |
| **Merge** | drag one token onto another, or card → *Merge with…* | One corps; morale and experience weighted by men. |
| **Hold / Dig in** | card | As today's hold order. |
| **Stance** | card (4-way switch) | Now per corps; in a battle each corps keeps its own stance. |
| **Refill** | card toggle, default on | The corps takes replacements from the pool (§4). |
| **Assign to army** | card → army list, or drag into the army in the roster | – |

The share picker (`SharePicker`, 25/50/75/all but 1) goes away for ground troops. Squadrons keep a count picker.

### 2.4 Battles with corps

- The battle code keeps working on per-faction agent lists; spawning reads **corps** instead of the region pool. Each agent remembers its corps (`Agent.c`), so losses, morale and experience go back to the right corps.
- A defending border is held by the corps at that post; the region's reserve and neighbouring corps join as waves after their travel time (as today).
- Morale is per corps (today per region `RegionState.mor` and per battle `Battle.mor`). The battle keeps `mor` per faction for its own rules, starting from the men-weighted morale of the corps fighting and writing changes back to each.

### 2.5 Front commanders and requests

The army HQ of §2.1 gets a **commander**. Together with the mandate and the request inbox, this is how a player runs a 54-region war without micro: commanders do the work on the map, the player decides where men, production and munitions go.

**Commanders**

- Each army has one, named from a per-nation pool of invented names in `data/names.ts` (no real persons), with **two traits** out of:

  | Trait | Effect on how he runs the front |
  |---|---|
  | *Offensive spirit* | attacks at a lower balance (1.2× instead of 1.5×), asks for guns and shells more |
  | *Methodical* | always assembles fully, heavy barrage before going over, fewer but better-prepared attacks |
  | *Defensive genius* | digs in faster (+1 trench level after 1 week instead of 2), asks for works and wire |
  | *Logistician* | asks for railways and depots; corps under his command draw 15 % less supply |
  | *Cautious* | asks to fall back sooner, rarely over-extends |
  | *Inspiring* | +5 morale cap for his corps |
  | *Careless* | over-capacity tolerated, takes more losses |

- **Experience** 0–3 like corps (won battles on his front); a commander whose army loses a region may be **relieved**: replacing him costs −5 morale on that front for 2 weeks; the new one starts at 0.
- Nations bias the trait pool (France: Defensive genius, Methodical; Russia: Offensive spirit, Careless; Germany: Methodical, Logistician; Britain: Cautious, Offensive spirit …).

**Mandate** (set per army in the army card; the commander never steps outside it)

| Mandate | The commander may |
|---|---|
| **Hold** | deploy and shift his corps along his front, dig in, counter-attack footholds on his own borders. No attacks across the border. |
| **Active defence** (default) | as Hold, plus *proposes* local *Take the first line* attacks where the balance is ≥ his threshold (each needs your permission). |
| **Offensive → target** | plan a phased offensive on the target region(s) you name: picks corps, moves up and assembles, asks for what he lacks, then asks permission to go; after you approve he runs it to the end. |

**Front budget** – optional share of weekly Production (0–30 %, default 0) the commander may spend himself on works and recruits for his front without asking. A player who wants no paperwork sets 20 % and approves only the big things.

**Requests**

Commanders file requests from the same numbers the player sees (balance, capacity, morale, shells). Each request says what, why, what it costs and how urgent it is, and offers up to three answers:

| Request | Why he asks (trigger) | Approve does |
|---|---|---|
| **Reinforcements** – "4 infantry battalions + 1 battery for the Poland border" | balance < 1.0 or massing across his border | Options: *Recruit* (production + men, trained into his army's depot, auto-joined), *Transfer* a named corps from another army or the reserve (shows its ETA), or *Deny*. |
| **Replacements priority** | his corps under 70 % strength | Puts his army first in the weekly replacement order (§4.1) for 4 weeks. |
| **Munitions** – "60 shells for the Lorraine offensive" | planned or running heavy barrage, front dump low | Reserves shells from the stockpile for his front. |
| **Fortify** – "Trench II + wire on the Italy border, 7 ⚙" | border chip amber/red, quiet front | Places the works (fortify commands). |
| **Railway / depot** – "Rail Germany–Posen, 5 ⚙" | his region over capacity or on *Road* supply | Builds it. |
| **Reconnaissance** – "Recon flight over Poland, 3 ⚙" | the chip facing him shows "?" or a stale report | Sends the patrol / flight. |
| **Air support** | battle on his front, squadrons in range idle | Assigns squadrons to his battles. |
| **Permission to attack** – "Take the first line at Lorraine: 14 vs ~9, est. losses 1.2k" | any attack across the border, under either mandate (always asked) | Starts the offensive. |
| **Permission to fall back** – "Withdraw XVII AK from Poland border to the centre" | balance < 0.5 and no help coming | Orders the withdrawal / shortening of the line. |

- **Urgency**: *routine* (expires after 4 weeks), *urgent* (2 weeks, amber), *critical* (red – an attack expected within the minute). Expired requests vanish; denied ones are not asked again for 3 weeks unless things get worse.
- At most **3 open requests per army**, merged when similar ("+2 more battalions" updates the existing one).
- **Partial approval**: reinforcement and munitions requests have a slider ("give 2 of 4").
- **Standing approvals** per army and kind: *Always approve fortify up to 8 ⚙*, *always approve recon*, *always approve replacements priority*. Shown as switches in the army card.
- **Denied requests** have consequences only through the situation: a commander denied men on a weak border may ask to fall back next.

**Where the player sees them**

- **Staff inbox** – a new left-rail panel *Staff* with a count badge: requests sorted by urgency, grouped by army, each with the commander, the reason in one line, the cost, and the answer buttons. Hover shows the border/region on the map.
- **Alerts** (§5.4) show *critical* requests.
- **Army card** (selection card for an army HQ token): commander portrait slot, traits, experience, mandate switch, front budget slider, standing approvals, his open requests, his corps.
- The top strip shows "Staff 4" next to the ticker when requests wait.

**Who decides what – summary**

| The player | The commander |
|---|---|
| Creates armies, assigns corps and fronts | Places his corps along his front, shifts reserves |
| Sets mandate, offensive targets, front budget | Plans and runs the attacks his mandate allows |
| Approves men, transfers, shells, works, rails, big attacks, withdrawals | Requests them, with reasons |
| Can still take any corps over by hand (it leaves auto until handed back) | Leaves manual corps alone, but counts them in his balance |

**Implementation**: commanders run **inside the sim** as part of the faction step (deterministic, so multiplayer and replays agree) and reuse the AI's planning code (`ai.ts`) split into a per-army planner. The computer powers simply auto-approve by their national weights, so the AI becomes "commanders + an AI war minister" – one code path for both. Requests live in `GameState.requests`; the fog view only sends a power its own.

---

## 3. Supply: logistics only, with capacity

### 3.1 Names

| Today | New |
|---|---|
| `supply` (money) | **Production** (⚙), "+12 / week" |
| convoy (20 s) | **week** (20 s at 1×) |
| supply quality full / thin / cut | **Supply**: *Rail* / *Road* / *Cut off* |
| `produce shells` | Munitions lever (§4.3) |

### 3.2 Depots and routes

Unchanged at heart (`updateSupplyLines`): a region is supplied when an own (or allied) route reaches a **depot** – capital, factory region, a port with a sea route held, or home territory. Rail all the way = *Rail*, otherwise *Road*, none = *Cut off*.

New: the reason is kept. Each region stores where its supply comes from and, when cut, the region where the route broke (`RegionState.via`, `brk`). The Supply map draws the route on hover; the alert says "Cut off since the fall of Warsaw".

### 3.3 Capacity (new)

Each region can feed a number of **supply points** per week; each battalion draws some:

| Draw | inf | MG | battery | tank | squadron |
|---|---|---|---|---|---|
| supply points | 1 | 1 | 2 | 2 | 1 |

| Capacity | Points |
|---|---|
| *Rail* | 24 |
| *Road* | 10 |
| *Cut off* | 0 |
| Depot in the region (capital, factory, port) | +12 each |
| Each own rail link into the region, from the 2nd | +4 |
| Weather: mud −20 %, winter −30 % (Siberians: −15 %), heat −15 % |

- **Load** = draw of every battalion in the region, battles included. Shown as a bar "18 / 34" on the region card and as a fill colour in Supply mode.
- **Over capacity** (load > 100 %): no replacements, shells cost half again (as thin supply today), morale −2 per week.
- **Far over** (> 150 %): plus 3 % strength lost per week (sickness, hunger). Cut off keeps today's wear (8 %, ×weather).
- This replaces the effects of "thin supply" today: *Road* now matters through capacity, not a flat penalty.
- **Why:** massing 40 battalions on a road-supplied front is now visibly unsustainable; building a railway (`rail` command) or capturing a depot is how you support an offensive. That gives rails and factories a clear purpose besides income.
- The AI's offensive planner caps the troops it masses at the target-adjacent region's capacity × 1.2.

---

## 4. Manpower, replacements, munitions

### 4.1 One flow

```
 age class ──►┐                              ┌──► killed
 (home regions)│                             │
               ▼                             │
         MANPOWER POOL ──► training (1 week) ──► CORPS ──► losses ──┤
               ▲     └──► replacements ──────────►▲                  │
               └──────────── wounded return (35 %, after 2 weeks) ◄──┘
```

- **Pool** as today (`FactionState.men`), growth from home regions × conscription.
- **Recruiting** takes men and production at once, and the battalion appears **one week later** in the region's depot (a "in training" row on the region card and a cameo wipe that runs for the week). Barracks: training ends at the next week instead. This makes the pipeline visible and gives the enemy a moment to see it coming.
  - Exception: a region under attack can raise **emergency levies** at once at double production cost.
- **Replacements:** every week, under-strength corps with *Refill* on, in supplied regions under capacity, take men from the pool – front-line corps first, then reserves – up to 15 % of their full strength per week. Replaces the hidden `wounded` refill in `reinforce()`.
- **Wounded** return to the **pool**, not straight to formations: 35 % of casualties, two weeks after the battle (`FactionState.wounded` becomes a small queue). One pool, one place to look.
- Barracks volunteers (one battalion per week) stay, but go through the same training step.

### 4.2 Manpower ledger

The Economy panel (§5.2) shows the pool as a ledger for the last and the next week:

```
 Pool 4,800 men                      last week   next week (est.)
   + age class (9 home regions)        +180         +180
   + wounded back                      +140         +260
   − in training                       −300           –
   − replacements                      −220         −310
   ─────────────────────────────────────────────
   = change                            −200         +130
 In the field 38,400 · in training 300 · killed so far 6,100
```

Conscription (*Peacetime / Extended / Total*) sits under the ledger with its effect spelt out ("+50 % age class, +0.5 war weariness / week").

### 4.3 Munitions

- Factory output is split by a national **war economy** lever: *Civil* (shells 25 % of factory output), *Balanced* (50 %, default), *Munitions first* (75 %). Production income falls by what goes to shells. The capital and the base output stay as today.
- No `produce` clicking; the command stays for old replays but the UI drops it.
- The top strip shows shells with **barrage-weeks left**: stock ÷ what your batteries burn on a light barrage. "◉ 220 · ~3 wk".

### 4.4 What goes away

| Removed | Replaced by |
|---|---|
| `wounded` direct refill | replacements from the pool + wounded back to pool |
| *thin supply* flat penalties | capacity |
| "+4 shells" button | war economy lever |
| percentage share picker (ground) | selecting corps, *Detach* |
| region morale `RegionState.mor` | corps morale (region shows the men-weighted average) |

---

## 5. Menus and layout

### 5.1 Desktop layout

```
┌ TOP STRIP ─ orders · dispatch ticker ─────── ⚙ 46 +12 · ☗ 4,800 +130 · ◉ 220 ~3wk · weariness ◔ · 12 Mar 1916 · Mud · ‖ 1× 2× 4× · ☰ ┐
├────┬──────────────────────────────────────────────────────────────────────────────┬───────────────────┤
│ ⚔  │                                                                              │  RADAR            │
│Situ│                                                                              │  mode: Pol Fro For│
│ ☰  │   (open panel, 360 px, over the map's left edge)                             │        Sup Int    │
│For │                                                                              ├───────────────────┤
│ ⚙  │                          MAP                                                 │  SELECTION CARD   │
│Eco │                                                                              │  corps / border / │
│ ⚓  │                                                                              │  region / battle /│
│Nav │                                                                              │  fleet            │
│ 👁  │                                                                              │                   │
│Int │ ┌ ALERTS ──────────────┐                                                     │                   │
│ 🤝  │ │ ! VII AK out of supply│                                                     │                   │
│Dip │ │ ! Massing at Lorraine │                                                     │                   │
│ 📅  │ └──────────────────────┘                                                     │                   │
└────┴──────────────────────────────────────────────────────────────────────────────┴───────────────────┘
```

- **Left rail**: eight panel buttons (Situation, **Staff** with a request badge, Forces, Economy, Navy, Intel, Diplomacy, Calendar) (`Alt+1…8`). One panel open at a time; `Esc` closes.
- **Right sidebar** keeps the War Office plate, radar and gauge from the graphics design, but its body is now the **selection card**. Nothing selected: the card shows the **Situation summary** (wars, top three alerts).
- **Top strip**: Production, Manpower, Munitions, war weariness, date, weather, speed, menu. Each counter opens its ledger on click and its breakdown on hover. Diplomacy moves into the left rail.
- **Bottom command bar** for a selected battle stays as designed in the graphics overhaul (barrage lever, over the top, …).

### 5.2 Panels (left)

| Panel | Contents |
|---|---|
| **Situation** | *Wars:* one row per enemy power: relation (war / ceasefire / pact / alliance), active battles, regions taken/lost this war, men lost on both sides, trend arrow. Expand → its battles, each with *Go*. *Borders in danger:* the five worst balance chips. *Others' wars:* battles between third powers you can see. |
| **Staff** | Commanders' requests (§2.5): by urgency and army, with reason, cost and Approve / Partly / Deny; standing approvals per army. |
| **Forces** (order of battle) | Tree: Armies → corps; unassigned corps; depots with troops; in training. Columns: name, where, battalions, strength %, morale, supply ●, order/state, ETA. Sort and filter (idle, under strength, out of supply, in battle). Click selects + flies; drag a corps into an army. Bulk: *Refill all*, *Set stance*. |
| **Economy** | Production ledger (income breakdown: land, continents, factories, empire, war weariness −x %), Manpower ledger (§4.2) + conscription, Munitions + war economy lever, Supply summary (regions over capacity, cut off), build queue (everything in training or under construction with time left). |
| **Navy** | Today's FleetList and Harbour tab merged: ports with docked ships, fleets at sea, sea control per zone. |
| **Intel** | Reports by age, spies (3 slots), patrols/flights in the air, "scout this border" shortcuts for the worst *?* chips. |
| **Diplomacy** | Today's dialog, docked. |
| **Calendar** | Today's dialog: unlocks, rush, doctrines. |

### 5.3 Selection cards (right)

The card changes with what you click. Each is one screen, no tabs except the region card.

- **Corps card** – header: name, nation crest, post ("on the Lorraine border"), manual/auto. Strength bar (men / full), morale, experience stars, supply ● with load. Battalion row (icons × counts). Order buttons: *Move*, *Attack*, *Hold/Dig in*, *Detach*, *Merge*, *Back to reserve*; stance switch; *Refill* toggle; army. With several corps selected: summed header and the shared buttons.
- **Border card** (click a balance chip or a border line) – two columns, **ours | theirs**: corps (with names when known), battalions and men, works (trench I–III, sandbags, wire), defences, mountain/rail/sea marks, report date or "estimate". Below: *Send corps here* (list of nearest own corps with ETA), *Fortify* (the cameo grid of today's Fortify tab, for this border only), *Scout* (patrol / flight / spy with cost), *Attack over this border*.
- **Region card** – header with owner, capital, weather, supply state and **load bar**. Tabs: **Overview** (corps here with their posts, borders as a compact list of chips, buildings), **Recruit** (cameos; new battalions go into training → depot; a target corps picker "join: VII AK / new corps / depot"), **Build** (factory, barracks, airfield, port, railways). Foreign regions: Overview with what is known + *Attack from…* + *Scout*.
- **Army card** – commander (name, traits, experience, *Relieve*), mandate (Hold / Active defence / Offensive → pick target on the map), front budget slider, standing approvals, open requests, its corps and front borders.
- **Battle card** – unchanged content (FrontControls), plus both sides' corps by name.
- **Fleet card** – as today's fleet rows.

What moves where:

| Today | New |
|---|---|
| Recruit tab | Region card → Recruit |
| Build tab (incl. shells) | Region card → Build; shells → Economy panel |
| Fortify tab (pick a border first) | Border card → Fortify |
| Deploy tab | Corps on the map + Forces panel; region Overview shows posts |
| March tab / foreign "Attack from" rows | Right-click with corps selected; border card *Attack*; region card *Attack from…* |
| Harbour tab | Region card → Build (port, ships) + Navy panel |
| Idle sidebar fronts list | Situation panel / summary |
| Nation screen (conscription) | Economy panel |

### 5.4 Alerts

A short queue bottom-left (max 5 visible, newest first, dismissable, grouped when repeated). Each alert has a cause and a one-click fix or jump:

| Alert | Fix button |
|---|---|
| Border in danger (chip red or massing) | *Open border* |
| Corps out of supply / region over capacity | *Show supply* (Supply mode, route drawn) |
| Corps under 50 % and *Refill* off, or pool empty | *Open corps* / *Economy* |
| Idle production (> 3 weeks of income unspent) | *Recruit* |
| Battle started / first line lost / region fallen | *Go* |
| Training finished | *Assign* |
| Critical commander request | *Approve* / *Open Staff* |
| Doctrine choice, treaty offer | as today |

The dispatch ticker stays for flavour; alerts are the actionable subset.

### 5.5 Explaining the rules

- **Breakdown tooltips** on every number (income, shell output, pool growth, capacity, balance, morale): a small table of the terms and their source. One component `<Why>` fed by functions that return terms instead of a total (`incomeTerms`, `capacityTerms`, `balanceTerms`, …); the existing totals become sums of those.
- **Preview before commit:** right-click-and-hold on a target shows the route, ETA, supply load at the destination after arrival ("Lorraine 31/34 → 45/34 over capacity") and the balance chip after arrival.
- The **Rules** overlay gets one page per system (Forces, Supply, Manpower, Munitions, Fronts) with the numbers from the data tables, generated from the same constants.

---

## 6. AI

- Uses corps: its offensive planner picks corps by readiness and supply, never masses beyond capacity × 1.2, keeps one reserve corps per threatened region.
- Uses armies with commanders for every front with more than 3 hostile borders; its "war minister" answers the requests by national weights and its budget (§2.5).
- Threat estimate (`_th`) switches to `borderBalance` on its own fogged view, so it reacts to the same chips a player sees.
- Sets the war economy lever by shell stock (below 30 + 10/battery → Munitions first) and conscription by pool (below 5 weeks of replacements → Extended).

## 7. Data model

- **New:** `GameState.corps: CorpsObj[]`
  ```ts
  interface CorpsObj {
    id: number; owner: number; n: number; kind: 0 | 1;      // 0 corps, 1 army HQ (holds no troops itself)
    region: number; post: number;                            // -1 centre, ≥0 border, ≥1000 coast; -2 on the move / at sea
    u: Units; men: Units; mor: number; xp: number;
    st: Stance; ord?: Order; ready?: number; since?: number; now?: boolean;
    manual?: boolean; refill: boolean; army?: number;        // id of its army HQ
    col?: number; fleet?: number; battle?: number;           // moving (Army id), aboard, fighting
  }
  ```
  Army HQ: `kind 1`, `front: number[]` (sector keys), `cmd: { name, traits: [t, t], xp }`, `mandate: 0 | 1 | 2`, `target?: number[]`, `budget: number`, `standing: ReqKind[]`, `spent` (front budget this week).
- **New:** `GameState.requests: { id, owner, army, kind: ReqKind, urg: 0 | 1 | 2, at, exp, why: Term[] (numbers; the client builds the text), ask: payload, opts }[]`, plus per army a "denied until" map.
- `RegionState.units`/`men` stay as **derived totals** (corps + depot) refreshed by one helper, so economy, fog and most AI code keep reading them. The depot is `RegionState.dep: { u, men }` plus `train: [unit, n, readyDay][]`.
- `RegionState.fr` and `mor` go away (migrated); `Corps` in fog views becomes a filtered `CorpsObj` (with `est`).
- `Army` columns carry `corps: number[]` instead of units/men; `arrive` puts the corps at its post.
- `Agent.c` (corps id).
- `RegionState.via`, `brk` (supply route), `cap`, `load`.
- `FactionState.econ` (0..2 war economy), `wounded` → `woundedQ: [men, day][]`.
- **Commands:** `select`-free: `moveCorps { ids, to, post }`, `attackCorps { ids, to, goal, now? }`, `detach { id, u }`, `merge { a, b }`, `corpsSet { id, st?, refill?, army? }`, `army { region, corps[] }`, `armyFront { id, front }`, `mandate { army, k, target? }`, `budget { army, share }`, `standing { army, kind, on }`, `answer { req, opt, n? }` (the treaty `answer` is renamed `treatyAnswer`), `relieve { army }`, `econ { level }`, `recruit` gains `join?: corpsId`. `march`/`move`/`shift`/`reinforce` stay as wrappers (AI, tests) that pick corps.
- **Snapshot `v: 7`, protocol 7.** Migration v6 → v7: each `fr[border]` becomes a corps with its units and the region's men share and morale; the main army becomes a reserve corps (or the depot if under 2 battalions); columns become corps on the move.

## 8. Phases

1. **See the situation** (client + one shared helper, no sim change): map modes, two-colour hostile borders, battle markers, balance chips with `borderBalance`, Situation panel, Alerts, `<Why>` breakdowns of existing numbers. Fixes "I can't see what's going on" on its own.
2. **Corps as objects** (sim): `CorpsObj`, depot, battle spawning per corps, per-corps morale and experience, select-then-order on the map, Detach/Merge, Forces panel, armies with auto front, migration v7.
3. **Commanders and requests** (§2.5): per-army planner split out of `ai.ts`, traits, mandates, front budget, requests and answers, standing approvals, Staff panel and army card; the AI powers switch to commanders + war minister.
4. **New menus**: left panels, selection cards (corps, border, region, battle, fleet), retire the six drawer tabs, previews, Rules pages.
5. **Supply capacity, manpower flow, munitions**: renames, capacity and load, supply route reasons, training week, replacements, wounded to pool, war economy lever, Economy panel ledgers, AI updates, balancing.

Each phase with tests, typecheck, a screenshot pass through `dev/harness.ts` and its own PR. All numbers are starting values for balancing.

## Settled questions (6 Nov 2026)

1. **Supply capacity** (§3.3): **adopted.**
2. **Training week** (§4.1): **yes**, recruits arrive one week later; emergency levies at double cost.
3. **Corps per border**: **several corps per post, at most 20 battalions each.**
4. **Commanders** (§2.5): **always ask** *Permission to attack* – a commander never starts an attack across the border on his own, whatever his mandate. *Active defence* local attacks and *Offensive* plans both go through the request.
5. **Rename**: **yes** – supply → Production, convoy → week, everywhere (UI, rules, tooltips).

## Implementation notes – phase 1 (branch `command/1-situation`)

- **Map modes** replace the Map / Troops / Industry layers: *Political (P) · Fronts (F) · Forces (T) · Supply (B) · Intel (I)*, under the radar and on the keys (F1–F5 would clash with the browser). Forces and Supply drive the old troops / industry layers. The map switches to Fronts by itself on the first battle you fight, until you pick a mode yourself.
- **Fronts mode** paints a band in the owner's colour along every border between two powers at war (wider and hotter where a battle burns) and dims the rest of the land, so each war line shows both colours side by side (`terrain.ts` `paintRegion`). Since every power without a treaty is at war, most borders between powers glow; the battle bands and the chips carry the detail. Not drawn on the globe yet.
- **Balance chips** (`labels.ts`, shared `sim/balance.ts` `borderBalance` / `hostileBorders`): ours = the corps on the border + half the main army if it can get there within 30 s; theirs = the corps on their side (exact, an estimate in men, or an old report) + half their main army, + columns marching in. Ratio = our troop power × works (+25 % per trench level, +8 % per sandbag row, +10 % per wire belt) + defences, over their troop power. The AI does not use it yet (phase 3).
- **Left rail** with Situation, Nation, Reports, Diplomacy, Calendar; **Situation panel** (wars per power with battles and losses on record, borders to watch, other wars); **border card** above the region file (ours | theirs, Send troops / Fortify / Scout / Attack); **alerts** bottom-left (under attack, massing or weak border, cut off, manpower low, supply unspent; dismiss for a minute).
- **Why**: the supply, shells and men counters show their breakdown in the tooltip (`sim/terms.ts`, tested to add up to the totals).
- On phones the rail is hidden; the Situation panel opens from the sidebar's idle page.

## Implementation notes – phase 2 (branch `command/2-corps`, on top of phase 1)

- **Corps are formations** (`RegionState.cs: Corps[]`, `sim/posts.ts`): id, number, post (-1 centre, a border, a coast), battalions, **own men and morale**, experience 0–3 stars, `man` (under the player's orders). At most **20 battalions** each (`CORPS_CAP`); any number per post. The region's `units`/`men` stay the totals; what is in no corps is the **depot** (`depotOf`). `fixPosts` keeps corps within the totals every step.
- Corps live in **a list per region** rather than the global `GameState.corps` of §7: identity travels with columns (`Army.ct`), fleets (`Fleet.ct`) and battles (`Battle.ct`, `Agent.c`). Survivors go back to the post they came from, per corps; conquerors stand at the centre. A won battle adds a star (+5 % damage each).
- **Auto** only arranges the depot and its own corps; corps marked ✋ (moved, attacked, detached, merged or formed by the player) are left alone. Idle Auto corps at the centre fold back into the depot.
- **Commands**: `moveCorps`, `attackCorps` (moves up to the border, assembles, attacks), `detach`, `merge`, `form` (new corps from the depot), `corpsSet` (stance, hand back to Auto), `order` with an optional corps id. `march` / `move` / `ship` still work on shares of a post.
- Returning wounded refill corps and depot in proportion to their gaps; encirclement wears corps down like the depot.
- **Saves v7 / protocol 7**: each old border corps becomes corps of its own (split at 20) with the region's men share and morale.
- **Client**: Forces panel (rail, key **O**: regions → corps with strength, morale, stars, ✋; corps on the move; depot with *Form corps*), corps card (stats, stance, order, Detach, Merge, Hand to Auto, attack goal), corps markers on the map (one per post, "×2", click selects, Shift adds), right-click orders for the selected corps, the Deploy tab lists every corps per post.
- Not yet: **armies** (2–6 corps under a commander with a front) – they come with the commanders in phase 3; box-select and drag-to-merge on the map; refill toggle (phase 5).

## Implementation notes – phase 3 (branch `command/3-commanders`, on top of phase 2)

- **Armies** (`GameState.hq: Hq[]`, `sim/commanders.ts`): formed from selected corps (*Form army* on the corps card); the front starts with the regions they stand in and grows with the regions the army's corps take. `Corps.army` (also on the corps tag, so it survives marches and battles). Region Auto never touches army corps; corps the player orders by hand (`man`) stay in the army but the commander leaves them alone.
- **Commanders** have an invented name per nation and two traits (`data/commanders.ts`): Offensive spirit, Methodical, Defensive genius, Cautious, Inspiring, Careless. Logistician waits for supply capacity (phase 5). Experience grows with battles won on the front.
- Every 3 s a commander looks at the hostile borders of his front with `borderBalance` on his power's fog view. He wants about 1.1× what is across (÷ the works bonus, ×1.5 when they mass, more on an Offensive target, a screen of 3 where nothing is known). **By himself** he moves spare corps along the front: from posts that are no longer hostile, from borders that are safe by 2.5× (Cautious 3.5×) and from the reserve to the borders short of men. He keeps 1 corps in reserve (Methodical 2, Careless 0).
- **Requests** (`GameState.requests`, at most 3 per army, the same key updates in place, lapse when the reason is gone, a denial rests 3 weeks): *Reinforcements* (recruit now onto that border, or transfer the nearest corps under the player's own orders), *Field works* (trench, then wire), *Reconnaissance* (patrol), *Permission to attack* (Active defence: first line where the ratio ≥ 1.5×, Offensive spirit 1.2×, Methodical 1.8×; Offensive: invade the target; at least 3 battalions), *Permission to fall back*, and **Send corps back** – asked when a treaty makes a border peaceful or when the front can spare corps beyond the reserve. Nothing leaves the front and no attack starts without the player's answer.
- **Standing approvals** per kind (not attacks) and a **front budget** (0–30 % of weekly income for men, works, patrols) let a commander carry requests out himself.
- Commands: `army`, `armyAssign`, `armySet` (mandate, target, budget, front, standing), `reply`, `relieve`, `disband`. Events `request` (critical ones reach the feed and the alerts) and `release`. Fog and snapshots carry only a power's own armies and requests. Protocol 8.
- **Client**: Staff panel (rail, key **G**, badge with open requests, red when one is critical) with the requests per army and what each commander did lately; army card (commander, traits, mandate, target, budget, standing approvals, front, corps, Relieve, Disband); Form army / Assign to / Take out on the corps card; armies in the Forces panel.
- **Scouting**: a commander asks for a *reconnaissance flight* when an own airfield reaches the region (2 borders), else a *cavalry patrol*; on the target of an Offensive he asks for a *spy*. He watches borders that are not safe when the report is missing or older than 21 days, and he proposes an attack only on a report at most 7 days old (else he asks for one first). New trait *Intelligence officer*: wants a fresh look at every hostile border each week, his patrols and flights are caught half as often.
- **Radio**: every new request is called in by its commander in his own voice (one per army; urgent ones with morse and higher priority, routine ones with a cooldown), and he reports corps he sends back (`commanderCall` in `audio/dispatches.ts`). The feed and the alerts carry only critical requests.
- Merged with `main` (sound and radio, unit art, recruit cards) through the whole stack.
- Not yet: computer powers still play with the old AI (no armies, no war minister); munitions, rail and air-support requests come with phase 5.

## Implementation notes – phase 4 (branch `command/4-menus`, on top of phase 3)

- **Region card**: three tabs instead of six. *Overview* (deploy mode, depot and corps per post, the share and goal for right-click marches, *Pick a target on the map* for touch, air strikes, reconnaissance, decoy marches from here), *Recruit*, *Build* (buildings, railways, defences in the interior, and the harbour for coastal regions). The Fortify, Deploy, March and Harbour tabs are gone.
- **Border card** (from a chip, a list, or a click inside the selected own region close to one of its borders or coasts): ours | theirs, then *Send corps…* (the nearest corps that can reach it over land, with march time – `marchEta` in `sim/posts.ts`), *Fortify…* (the works grid for this border), *Scout…* (patrol, flight from an airfield in reach, spy), *Attack*.
- **Left rail**: Situation, Staff, Forces, **Economy** (supply, shell and manpower ledgers from `incomeTerms` / `shellTerms` / `poolTerms`, buying shells, conscription, supply lines in trouble), **Navy** (fleets and ports), **Intel** (agents, scouts out, the borders we know least about with a patrol button, latest reports), Nation, Reports, Diplomacy, **Rules**, Calendar. The rail scrolls and tightens on short screens.
- **Preview**: with corps selected, hovering a region shows what a right-click would do – where they go and how long it takes, or the attack with ours : theirs and when they go in.
- **Rules** overlay: Fronts, Corps, Commanders, Scouting, Supply & men – every number read from the simulation's constants.
- Fixed on the way: the column list of the Deploy section crashed for columns heading to a coast.
- Not yet: right-click-and-hold route lines on the map, battle and fleet cards (the existing bottom battle bar and fleet card stay), the top-strip "Staff" counter.


## Implementation notes – phase 5 (branch `command/5-supply`, on `main` after phases 1–4)

- **Names**: the money is **Production** and a convoy is a **week** everywhere on screen (top strip, cards, tooltips, help, rules, error texts). Naval convoys (troop transports at sea) keep their name. The data field is still `FactionState.supply`.
- **Supply capacity** (`sim/supply.ts`): Rail 24 / Road 10 / cut off 0, +12 per depot (capital, factory, harbour), +4 per own rail link from the second, mud −20 %, winter −30 % (Siberians −15 %), heat −15 %. Load = 1 per battalion, 2 per battery or tank, including those fighting in the region's battles and attacking out of it. Over capacity: morale −2 a week instead of +6, no replacements, shells ×1.5 for a side drawing through it; over 150 %: 3 % of the men lost a week. This replaces *thin supply*. Capacity and load are computed on demand (not stored), so fog views and mirrors get them for free.
- **Why cut off**: `cutBreak` names the hostile region next to the cut-off pocket that most likely broke the route (one that was someone's home before the war, then one with a battle).
- **Supply route on hover** (Supply mode): `supplyRoute` finds the cheapest chain of own or allied regions back to a source (a road leg costs three rail legs, sea lanes between own ports count). The own region under the cursor (else the selected one) shows it as a broad line – rail white, road amber, sea blue dashed – with a diamond at the source; a cut-off region shows a red dashed line to where the route broke, with a cross. Computed on demand, at most once a second.
- **Training**: recruits cost Production and men at once and arrive after a week (`RegionState.train`); with barracks at the next week. Barracks volunteers train too. A region lost meanwhile loses its recruits. **Emergency levies** (`recruit.now`): at once and at double cost, only in a region under attack. A commander's recruits go to the border that asked once trained and count as on their way meanwhile.
- **Replacements**: every week, corps with *Refill* on (`Corps.nr` off; the toggle is on the corps card) in supplied regions under capacity and out of battle take men from the pool, at most 15 % of their full strength – front-line corps first, then reserves, then depots. **Wounded**: 35 % of casualties go into `FactionState.wq` and rejoin the pool two weeks later. The old direct wounded refill is gone. Ledger: `FactionState.led` (last week: age class, wounded back, raised into training, replacements) and `ledger()` in `sim/terms.ts` (next week estimated).
- **War economy** (`econ` command, `FactionState.econ`): Civil / Balanced / Munitions first sends 25 / 50 / 75 % of factory output to shells; Balanced equals the old numbers. The *Buy shells* buttons are gone (the `produce` command stays for old replays). The top strip shows shells with weeks of light barrage left.
- **Client**: region card gets a supply bar (route, load / capacity, the breakdown on hover) and *In training* rows; the Recruit tab gets the levy switch. Economy panel: Production and shell ledgers, the war economy lever, the manpower ledger last week / next week, conscription, regions cut off (with the reason) and over or near capacity. Supply map mode shades own land green / yellow / orange / red by load against capacity (cut off red), greys out everyone else's land, and labels own regions with load / capacity. Alerts for regions over capacity, and the cut-off alert names where the route broke. Rules page *Supply & men* rewritten.
- **AI**: sets the war economy lever by its shell stock (below 30 + 10 per gun → Munitions first, above twice that → Civil), raises conscription when the pool lasts less than five weeks of replacements, counts recruits in training, raises emergency levies when attacked, recruits nothing into a region over 120 % of capacity and never moves reserves into one beyond it.
- **Saves and protocol**: protocol 9. New fields are optional; an old save's wounded become one entry of the queue. Snapshots carry the recipient's recruits in training, wounded queue, ledger and lever (`Snapshot.me`) and the corps' refill flag.
- **Balance check** (3 seeds, all-computer, 12.5 minutes): 0–5 of 54 regions over capacity at any time, at most 2 far over; regions changing hands 12–17 (main: 13–18); pools drain at about the same rate as before.
- Not yet: computer powers still play without armies and commanders (a war minister answering their requests).
