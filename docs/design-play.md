# RiskRTS – Design: Easy to play, hard to master (UI, handling, gameplay)

Status: 6 Nov 2026 · Base: `main` after the command overhaul (PRs #24–#31) and PR #33 (computer armies) · Status: **Approved with decisions (6 Nov 2026, §10)**

## Problem

The command overhaul gave the game the right parts: corps, armies with commanders, border cards, supply capacity and the manpower flow. Playtesting (6 Nov) shows that players can't find those parts:

1. **Things you can do are hidden.**
   - Requests only come from armies, and nothing tells you to form one ("I did not see them").
   - Fortifying only works from a border card, which opens when you click exactly on a border line or a chip in Fronts mode.
   - Moving troops without right-click goes through three different, unrelated buttons.
2. **Words without context.** *Form corps*, *depot*, *Peacetime / Extended / Total*, *mandate* and *standing approvals* are explained only in tooltips or in the Rules overlay. On screen they are labels without consequences.
3. **New events are silent.** A new request or a finished trainee only changes a number in a badge. The alerts queue exists (`Situation.tsx`), but it holds only dangers, not decisions.
4. **No difficulty curve.** From minute one the player faces every system at once: Production, Supply, Munitions, Manpower, weariness, corps, armies, fortifying, scouting, the navy and diplomacy. Every system also has to be run by hand until the player discovers armies.
5. **Few goals between start and victory.** The secret mission is far away, and battles don't add up to a story. "Am I winning this war?" has no answer on screen.

## Goal

**Easy:** a new player wins their first war without opening the Rules, and every action is at most two clicks from what it acts on.

**Fun:** each war has a story with clear moments: plans, turning points, a commander who shines or fails, and headlines.

**Challenging:** the challenge comes from **attention and trade-offs, not from finding buttons**. There are always more fronts, requests and crises than you can handle personally. You decide what to run yourself, what to hand to commanders, and what to neglect, and each choice has a price.

## Pillars

1. **Hand off what you choose, run the rest yourself.** Every front can be run at one of three levels: *You*, *Commander* or *Auto*. Handing off is easy and always visible. The challenge is that commanders are imperfect and cost something.
2. **Decisions come to you.** Anything that needs an answer appears where you are looking: on the map, at the border it concerns, with the answer buttons right there.
3. **The verb sits on the object.** Select something, and everything you can do with it is shown in one place, with its key.
4. **Show the consequence before the click.** Every lever shows what it will cause ("+340 men/week · unrest in ~9 weeks").
5. **Bring systems in one at a time.** The first war unlocks systems one by one (§6). Experienced players skip this.

---

## 1. Command bar: one place for all verbs

A **command bar** sits as a strip at the top of the right sidebar, above the selection card (decided, §10). It is the main way to give orders. The card below it holds the details. The battle bar at the bottom of the map stays where it is.

```
┌ RADAR ───────────────────────────┐
├ VII + XI Corps · 2 corps · 31 btl┤
│ [M] Move   [A] Attack  [D] Dig in │
│ [F] Fortify… [S] Scout… [R] Refill│
│ [J] Join/Detach   [G] Form army   │
├ SELECTION CARD ──────────────────┤
│ …                                 │
```
Two or three rows of icon buttons with labels. On narrow screens, labels fall back to icons with the key.

The buttons depend on the selection:

| Selection | Verbs |
|---|---|
| Own region | Recruit… · Build… · **Fortify a border…** (picks the border on the map) · Move troops · Form corps (only if the depot holds troops) |
| Own border (line, chip, or a border picked from a region) | Send corps · **Fortify** · Scout · Attack across · Hand to commander |
| Corps (one or more) | Move · Attack · Dig in · Detach / Merge · Refill · **Form army** / Join army |
| Army | Mandate (Hold / Defend / Attack) · Target · Budget · Requests (n) · Disband |
| Enemy region | Attack from… · Scout · Spy · Air strike · Feint |
| Battle | shortcuts to the battle bar's levers: barrage, over the top, reinforce, retreat |

Rules:
- **Move / Attack** enter target mode with the route preview (§5.5 of the command design) and work the same on touch and desktop. Right-click stays as the fast path.
- Every button shows its key. Disabled buttons say why on hover ("needs 2 battalions", "4 Production short").
- The region drawer's tabs (Overview, Recruit, Build) stay for details. They are no longer the only way to do these things.

**Clicking borders:** the region Overview gets a **Borders** list (one row per border with balance colour, works icons and a Fortify button). The hit area of border lines on the map is three times wider when zoomed out. Clicking a border chip in *any* map mode opens the border card, not only in Fronts mode.

## 2. Decisions come to you: the Inbox

The Staff panel becomes the **Inbox**. It holds every decision that is waiting, not just commanders' requests:

| Source | Example | Answer |
|---|---|---|
| Commander | "Trench II on Lorraine – Saar · 4" | Approve · Deny · *Always approve works for this army* |
| Training | "6 battalions ready in Berlin" | Join VII Corps · New corps · Leave in depot |
| Economy | "Shells for 1 week left" | Shift lever to Munitions · Ignore |
| Diplomacy | "Austria offers a pact" | as today |
| Calendar | "Choose a doctrine" | as today |

How it reaches you:
- **On the map:** a small envelope pin at the border or region the decision concerns, in all map modes. Clicking it opens the answer card right there.
- **Toast plus a soft sound** (a typewriter clack for routine, a field-telephone ring for urgent). Each toast has the answer buttons, and **Y / N** answer the newest one.
- **Auto-pause** (solo) on whatever the player picks: an urgent request, our region attacked, a region lost, a battle won. The default is urgent requests and regions attacked.
- **In multiplayer: pause by vote** (decided, §10). Any player can call a pause (button or the event that would auto-pause them). The others see "Germany asks for a pause · 10 s" with Agree / Refuse. A majority of human players pauses the game for up to 60 seconds. Each player gets 3 pause calls per hour of play. The host can switch votes off.
- Requests that wait too long expire with a visible consequence ("Trench not dug – XI Corps' morale −5"), so ignoring them is a choice with a price.

The *Always approve…* checkbox on a request card is the standing approval, offered where it makes sense, so players learn it without the army card.

## 3. Three levels of command

### 3.1 Front levels

Each **front** (a connected stretch of hostile borders, already computed by `frontsOfPower`) shows its level as a banner on the map and in the Situation panel:

| Level | Who acts | Cost | Good at | Bad at |
|---|---|---|---|---|
| **You** | the player, corps by corps | your attention | anything you're watching | nothing happens while you look away |
| **Commander** | an army HQ: shifts corps, digs in, asks for men and attacks | a general (limited, §3.2) and his front budget | steady, sensible play by his traits | timing big offensives, and he's sometimes wrong |
| **Auto** | today's region Auto: refills posts, rotates the depot | free | quiet borders | it never attacks, and it reacts late to massing |

**Making it obvious:**
- When a front has hostile borders and no commander, the Situation panel and the front banner show **"Appoint a commander"**. One click forms an army from the corps on that front. Players no longer need to know about selecting corps first.
- The first time the player has 3 or more manual corps on one front, the hint offers this.

### 3.2 Generals are a limited resource

This is where the challenge comes from: you can't simply hand everything off.

**Every army has a general, and there is no army without a free one** (decided, §10). An *army* is the HQ that commands several corps along one front. A *corps* (up to 20 battalions) is the formation below it and needs no general. Today's "Form army" only becomes possible when a general is free. Otherwise the button says "No general free · next in 14 weeks" and offers to relieve one.

- A power starts with **3 generals** (Russia 4, Britain 2, …, from the nation data). One more arrives each war year, and another for every 3 battles won by your armies. Losing a region with an HQ costs that general.
- Each general has **two traits** out of about 10, with a portrait and a name:

  | Trait | Effect |
  |---|---|
  | *Cautious* | asks for works more often, never asks to attack below 2:1 |
  | *Thruster* | asks to attack at 1.2:1, his attacks gain +10 % initial momentum |
  | *Engineer* | works cost him 25 % less |
  | *Logistician* | his corps count 15 % less against supply capacity |
  | *Butcher* | +morale shock on attack, double losses |
  | *Beloved* | his corps' morale recovers 50 % faster |
  | *Political* | his requests cost +1 weariness when denied |
  | *Scout* | patrols from his front see an extra report level |
  | *Slow* | shifts corps 30 % slower |
  | *Old guard* | no penalties, no bonuses, cheap |

- Generals gain **stars** from won battles. A 3-star general earns a trait, or loses a bad one.
- **Relieving** a general frees his slot but costs weariness and morale on his front for 2 weeks, so firing generals is a real decision.

### 3.3 Operations: plans you sign, commanders carry out

A big offensive is the most fun and the most micromanagement. To keep the fun and cut the micro, a commander on *Attack* mandate offers an **operation plan** in the Inbox:

```
OPERATION "MICHAEL" · 2nd Army (Gen. Brandt · Thruster, Engineer)
Objective: Lorraine → Champagne        Forces: 5 corps (78 btl) · 2 more requested
Barrage: 2 weeks heavy · 1,800 shells   Expected: success 60 % · losses ~18,000
[Approve]  [Approve with 2 more corps]  [Postpone]  [Deny]
```

- After approval, the army gathers, fires the barrage and attacks by itself, in the existing phases (form up, march, assemble, go in). You can still take over at any moment: clicking the battle hands that front to *You* until the battle ends.
- After the operation, a **result card** compares plan and outcome. The general gains or loses a star.

## 4. Readable numbers: from gauges to consequences

### 4.1 The national status strip

The top strip shows four **gauges with a trend and a forecast** instead of bare counters:

| Gauge | Shows | Warns when |
|---|---|---|
| Production | stock · +income | over 4 weeks unspent (idle) |
| Manpower | pool · weeks of replacements left | under 5 weeks |
| Munitions | weeks of barrage left at current fire | under 2 weeks |
| Home front | weariness against your nation's unrest threshold, as a bar with the threshold marked | within 10 points |

Hovering a gauge shows its breakdown (the `<Why>` component from the command design). Clicking opens the ledger.

### 4.2 Levers show their effect before you commit

**Conscription** (Nation sheet and Economy panel) becomes three cards instead of three bare words:

```
 PEACETIME              EXTENDED                 TOTAL
 +620 men/week          +930 men/week            +1,240 men/week
 weariness fades        +0.5/week                +1/week, never fades
                        unrest in ~22 weeks      unrest in ~9 weeks
```

The war economy lever, barrage levels, mandates and budgets work the same way: each option shows its numbers and forecast, computed with the existing sim functions on a cloned state. The same goes for **Form corps**, whose tooltip and card read *"Turn the 14 battalions waiting in the depot into a corps you command. Only corps can be selected, moved and put into an army."*

### 4.3 Words

| Today | New | Why |
|---|---|---|
| Depot | **Reserve** (in the region) | "depot" sounds like supply |
| Form corps | **Form corps from reserve** | says where the troops come from |
| Peacetime / Extended / Total | **Peacetime classes / Extended call-up / Total mobilisation** | full words, with the numbers below |
| Standing approvals | **Approves by himself** | says what it does |
| Mandate Hold / Active defence / Offensive | **Hold / Defend / Attack** | short |

German follows the same idea (*Reserve*, *Korps aus Reserve bilden*, *Friedensjahrgänge / Erweiterte Einberufung / Totale Mobilmachung*).

## 5. Goals and story inside a war

### 5.1 War aims

When a war starts, the player picks **one war aim** out of three, drawn from the secret mission and the map, for example:
- *Take Champagne before winter*
- *Hold every border for 12 weeks*
- *Knock Italy out of the war*

A war aim pays out when reached (a doctrine point, Production, or −10 weariness) and costs weariness when missed. Computer powers pick aims too, and once scouted, an enemy's aim is shown in Intel. This gives every war a short-term objective and a feeling of winning or losing.

### 5.2 War score per war (peace stays optional)

The Situation panel's war row gets a **war score** bar (regions taken, men lost against men killed, war aim progress). When one side's score is high enough, a **peace offer** with terms comes up automatically (cede a region, pay Production). Peace is **never forced** (decided, §10): either side can refuse and fight on, but refusing a good offer costs weariness. This turns long stalemates into decisions instead of grinding.

### 5.3 Headlines and moments

- A weekly **newspaper card** reports the big events: battles won and lost, regions taken, a general relieved, strikes. It's flavour, but it also recaps what happened while you looked elsewhere. It can be switched off. There are two voices (decided, §10):
  - **Your own national paper** (a fictional title per nation) covers your wars, slanted: victories are big, defeats become "orderly withdrawals".
  - **A neutral wire service** covers wars between other powers, in a dry report style, only with what you could know (fog rules).
- **Moments** get a short full-screen card with a sound: first battle of a war, a region taken after a long siege, a capital threatened, a general's third star.
- The after-action **Reports** link from these cards.

## 6. Learning the game: the first war

A new solo game offers **"First war (guided)"** next to the normal start:

| Stage | Unlocks | Objective |
|---|---|---|
| 1 · Mobilise | Recruit, Form corps, Move | Form 2 corps and move one to the threatened border |
| 2 · Dig in | Border card, Fortify | Dig a trench on the border marked red |
| 3 · First battle | Battle bar, barrage | Hold Lorraine against the first attack |
| 4 · Hand off | Appoint a commander, Inbox | Appoint a commander for the eastern front, answer his first request |
| 5 · Supply | Supply mode, capacity | Get the corps in Saar back under capacity |
| 6 · Offensive | Operations | Approve the first operation and take one region |

- Systems not yet unlocked are hidden: no rail buttons, empty gauges. The AI holds back until stage 3, then plays normally.
- A short **objective list** (top left, collapsible) replaces today's `Hint` steps 0–4. Each objective has a **Show me** button that highlights the button to press.
- The normal game keeps contextual hints, at most one at a time: the first time you see the Inbox, the first time a border goes red, and so on. They can be dismissed for good, as today.

## 7. Difficulty: the challenge is a setting

The solo setup gets one **Difficulty** choice that bundles a few values:

| | Recruit | Officer | Marshal |
|---|---|---|---|
| Generals | +2 | normal | −1 |
| Auto-pause defaults | everything | urgent requests and attacks | off |
| Enemy AI | holds back, doesn't mass on 2 fronts at once | normal | aggression +30 %, uses feints |
| Unanswered requests | never expire | expire after 3 weeks | expire after 1 week |
| Forecasts (§4.2) | exact | exact | ranges only |

## 8. Small fixes from the playtest

- The **Staff** badge in the left rail becomes the **Inbox** with a number and pulses when something is urgent.
- **Form army** appears in the corps card even when only one corps is selected, as *"Appoint a commander for this front"*.
- The **border card** opens from a right-click on an own border when no corps is selected (today that right-click does nothing useful).
- The **Nation sheet** merges into the Economy panel, as the command design planned (§5.3 there).
- Every panel gets a one-line explanation under its title ("Corps you command, by army. Select one to give orders.").

## 9. Phases

| Phase | Content | Size |
|---|---|---|
| 1 · Find it | command bar (§1), Borders list, wider border hit areas, border card from any mode, small fixes (§8), words (§4.3) | M |
| 2 · Inbox | Inbox with all decision sources, map pins, toasts and sound, Y/N, auto-pause, request expiry (§2) | M |
| 3 · Consequences | status gauges with forecasts, lever cards for conscription, war economy, barrage, mandates (§4) | S–M |
| 4 · Generals | front levels and banners, "Appoint a commander", general slots, traits, stars, relieving (§3.1–3.2), AI uses traits | L |
| 5 · Operations | operation plans and result cards (§3.3), AI plans operations through the same code | M |
| 6 · Story | war aims, war score and peace offers, headlines, moments (§5) | M |
| 7 · Learning | guided first war, objective list, contextual hints, difficulty presets (§6–7) | M |

Phases 1–3 fix today's confusion without changing the rules. Phases 4–6 add the depth. Phase 7 comes last because it teaches the finished game.

## 10. Decisions (6 Nov 2026)

1. **Command bar:** a strip at the top of the right sidebar, above the selection card. The battle bar stays at the bottom of the map.
2. **Generals:** every army has a general, and an army can only be formed when a general is free (hard limit). Corps need no general.
3. **Peace:** always optional. Refusing a good offer costs weariness.
4. **Headlines:** both. A national paper per nation for your own wars, a neutral wire service for other powers' wars.
5. **Multiplayer pause:** by vote. Any player can call it, a majority of humans pauses for up to 60 s, 3 calls per player per hour, the host can switch it off.
