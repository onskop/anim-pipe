I want scenario2 where things will get sexual. Dont worry about generating
  nudes, that will be handled by proper model. The framing will be playful, yet introduce variety of sexual topics
  before, during and after getting her to trance. She is still consenting adult of course, your lover perhaps (but that
  doesnt need to be emphasized) and likes to rezist and be challenged. Important content is to break rezistance,
  increase hornyness levels, struggling to rezist, having posthypnotic commands that take her to interesting situations
  and bring interesting exciting feelings etc. Be creative. Use wide variety of popular hypno erotic topics.

Here is scenario which you use as context to create scenario2:

# Scenario: "The Mesmerist's Duel"

> A playful, competitive, single-character mini-adventure built **for the anim-pipe
> graph**. Nodes are keyframe states of the heroine; edges are the short clips
> between them. The player is an apprentice stage-mesmerist; the heroine is a
> cocky rival who **bet she can't be put under**. Your job is to read her cues,
> pick the right tool, walk her down the trance ladder, and land a commanded
> "task" before she snaps awake and wins the round.

---

## 0. Tone & consent frame (read first — this constrains all art prompts)

- **Yua is an adult** (early-20s stage performer). Every character/image prompt
  must carry the anchor `adult woman, early 20s`. Never imply otherwise.
- This is **stage-magic fantasy, comedic and competitive** — think a carnival
  hypnotist's variety act crossed with a wizard's duel. It is **not** sexual.
  The drama is in *eyes, breath, posture, and banter*, not the body.
- **Consent is the premise.** Yua walks on stage, plants her hands on her hips,
  and dares you to try. She can break the trance at will (that's the game). The
  fun is the back-and-forth: she teases when she resists, goes adorably drowsy
  when she slips, and pretends she "totally let you win" afterward.
- "Heavy breathing" here = **slow, deep, calm breathing** (a relaxation cue and a
  cinemagraph idle — chest rising slowly), not exertion. Keep it wholesome.
- Costume stays **fully clothed and classy** throughout (see Character sheet).

If a prompt ever drifts off this frame, it's wrong — pull it back to "sleepy
stage-magic, expressive eyes, comedic rivalry."

---

## 1. Logline

A confident young illusionist, **Yua**, challenges the player to a best-of-three
**Mesmerist's Duel**. She's hidden three things from you — a word, a key, and a
secret — behind her own willpower. Swing the pendant, lower your voice, find her
trigger, and coax her down through five depths of trance until she'll happily
hand each one over... while she taunts you the whole way down.

---

## 2. Cast

### Yua — the heroine (the only animated character)

**Consistency anchor** (paste into the anim-pipe `Character.description`; it is
injected into *every* node/edge prompt):

```
Yua, adult woman early 20s, stage mesmerist's rival. Sharp violet eyes, long
black hair in a high ponytail with a loose front strand, fair skin, small beauty
mark under one eye. Outfit: white high-collar blouse, deep-violet brocade vest
with brass buttons, a star-and-moon patterned indigo shawl over one shoulder,
black fingerless gloves, a thin silver hoop earring. Confident, teasing
half-smile at rest. Clean anime cel-shading, warm theatrical key light.
```

- **Personality arc within a round:** smug skeptic → curious → caught → dreamy →
  pliantly cooperative → (snaps back to smug, or stays dreamy if you "win").
- **The expressive instrument is the eyes + breath.** Almost all state reads come
  from eyelid height, focus, blink rate, head tilt, sway, and breathing depth.

### The player (off-screen)

Never drawn. Represented by the **tool buttons** and a first-person voice in text.
Has a pocket-watch pendant, a soft voice, a snap, a focus light, a metronome, and
(once discovered) Yua's **trigger word**.

---

## 3. Setting

A small velvet-draped stage: deep-red curtain backdrop, a single warm spotlight, a
round side table with a candle, a folding chair Yua may sink into at deep trance.
Background stays **static** (it's the frozen part of every cinemagraph); only Yua
and the pendant move. One reusable backdrop image is enough for all nodes — keeps
character-consistency easy and matches PRACTICES.md §2 (animate a region, freeze
the rest).

---

## 4. Core mechanic — two meters + a state ladder

The whole game is a **state machine over trance depth**, which is *exactly* the
anim-pipe node graph.

### Meter A — Trance Depth (0–100), shown as a sinking pendant gauge

Six named bands. **Each band is a NODE** (a canonical keyframe + idle loop):

| # | Node `key`      | Depth  | Look & behavior (this is the keyframe brief)                                                                 |
|---|-----------------|--------|--------------------------------------------------------------------------------------------------------------|
| 0 | `awake`         | 0–15   | Standing tall, arms crossed, sharp eyes, smirk. Quick blinks, alert. Taunting.                               |
| 1 | `curious`       | 15–35  | Arms loosen, head tilts, eyes start tracking the pendant. Blink rate normal, smirk fading to soft curiosity. |
| 2 | `fixated`       | 35–55  | Gaze locked on the pendant, gentle left-right sway, lips parted slightly, slower blinks. Banter goes quiet.  |
| 3 | `drowsy`        | 55–75  | Heavy half-lidded eyes, shoulders drop, slow deep breathing, dreamy lopsided smile, soft slurred replies.    |
| 4 | `deep`          | 75–92  | Eyes mostly closed, head nodding, sinks toward the chair, breathing slow and even, answers in a soft monotone."yes…"|
| 5 | `entranced`     | 92–100 | Serene blank expression, eyes closed or softly unfocused (optional faint spiral-shine stylization), fully open to a single command. |

### Meter B — Willpower (100 → 0), shown as a small flickering flame

- Yua **spends willpower to resist.** Some of her actions push her *back up* the
  ladder (a head-shake, a hard blink, a smirk-and-recover). Those cost her flame.
- Willpower **slowly regenerates** when you're idle — unless a *sustained* tool
  (metronome/chime) is running, which pins it. So you can't just spam; you manage
  tempo.
- When willpower hits 0 she can no longer resist: the next correct tool drops her
  straight toward `deep`/`entranced`.

### Snap-out risk (the failure/teasing pressure)

- Using the **wrong tool for her current band** (see §5) spikes her willpower and
  bumps her *up* a band — she blinks, laughs, "Nice try."
- Over-pushing (e.g., a hard finger-snap while she's only `curious`) can **fully
  snap her awake** and cost you the round.
- Reading her cues correctly is the skill: the keyframe art literally tells the
  player what tool to use next.

---

## 5. Player tools (the buttons) → these are the EDGES

Each tool is a button. Mechanically, a tool is a **transition edge** that moves
Yua from one node to another (down when it fits, up when it doesn't). Below: what
it does, when it works, and the **transition-clip brief** for the pipeline.

| Tool button        | Best when she's… | Effect                                  | Transition clip to generate (edge)                                            |
|--------------------|------------------|------------------------------------------|-------------------------------------------------------------------------------|
| **Swing Pendant**  | `awake`→`fixated`| Builds fixation; primary early tool      | `awake → curious`, `curious → fixated`: her eyes begin/continue tracking a swinging pocket-watch; head turns to follow. |
| **Lower Voice / Count down** ("ten… nine… deeper…") | `fixated`→`deep` | Deepens once she's fixated; useless if she's still alert | `fixated → drowsy`, `drowsy → deep`: eyelids sink, shoulders drop, a slow exhale. |
| **Focus Light / Spiral** | she looks away / `curious` | Re-captures her gaze when she breaks eye contact | `curious → fixated` (alt): eyes snap to a soft glowing spiral, pupils dilate. |
| **Metronome / Soft chime** (toggle) | any | Sustained: **pins willpower**, slows her recovery, but deepens nothing by itself | (no transition; an **idle-loop overlay** — a swaying glint + her micro-sway syncing to tempo) |
| **Finger Snap**    | only `deep`+      | If primed: drops her to `entranced`. If used too early: **snaps her awake** (risk!) | `deep → entranced`: a tiny flinch then total stillness. ALSO `* → awake` (the awaken snap, big transition: eyes fly open, gasp, back to smug). |
| **Install / Speak Trigger Word** | discovered mid-game | Once installed at `deep`, the trigger instantly drops her one band — a callback gag | `* → (band−1)`: she hears the word, blinks, and sags a notch deeper mid-sentence. |
| **Issue Command**  | `deep`/`entranced` only | Opens the command panel (§6). Only lands at sufficient depth. | (resolves to a **command beat** clip — see §6)                                |

**Reading-the-cues loop (the actual gameplay):** look at her keyframe → pick the
tool that matches the band → watch the transition play → she either sinks a node
or resists up a node (with a taunt) → repeat. Right reads sink her; wrong reads
wake her and refill her flame.

---

## 6. Commands (the payoff beats)

At `deep`/`entranced` the **Issue Command** panel unlocks. Two kinds:

**A. Task commands (advance the duel — the win condition of a round):**
- *"Tell me the word you're hiding."* → she dreamily recites it (Round 1 goal).
- *"Hand me the key."* → she lifts the prop key off the table and offers it
  (Round 2 goal).
- *"Whisper the secret."* → she leans in and murmurs it (Round 3 goal).

**B. Stage gags (optional, for score/flavor — classic comedic hypnosis bits):**
- *"You're a cat now."* → she blinks slowly, paws at the air, soft "nyaa."
- *"Your hand is a balloon."* → one arm drifts up on its own; she watches it,
  puzzled and serene.
- *"You can't remember the number seven."* → she counts on her fingers, skips it,
  frowns adorably.
- *"On the next snap you'll wake thinking you won."* → sets up the round's
  comedic button.

Each command is a short **command-beat clip** that starts and ends on the same
deep node (so it slots in as a special **loop-style edge** off `deep`/`entranced`,
returning her to the same state). Gags are pure flavor; only a **task command**
ends the round.

If you issue a command at insufficient depth, she half-rouses and smirks: *"You'll
have to try harder than that."* (costs you tempo, refunds her a little flame.)

---

## 7. Round / level structure (competitive + teasing spine)

Best-of-three **Duel**. Each round = the same ladder, escalating difficulty, with
a different task command as the goal.

| Round | Goal command        | Twist that raises difficulty                                                   |
|-------|---------------------|--------------------------------------------------------------------------------|
| **1 — The Word** | "Tell me the word." | Tutorial. She resists lightly, telegraphs every cue, taunts gently.             |
| **2 — The Key**  | "Hand me the key."  | She **fights the fixation** — looks away often (lean on Focus Light), recovers willpower fast (lean on Metronome to pin it). You must also **discover her trigger word** by reaching `deep` once and listening. |
| **3 — The Secret** | "Whisper the secret." | She's braced: higher starting willpower, snaps up two bands on a wrong tool, and there's a **time pressure** flame that burns down. Use the installed trigger + metronome + perfect reads. |

**Win/lose & the teasing payoff:**
- **You land the task command →** round won. She surfaces blinking, cheeks pink,
  insisting *"I—I let you do that, obviously."*
- **She snaps fully awake (willpower spike / wrong tool / timer out) →** round
  lost. Full smug recovery: *"Adorable. My turn to watch *you* sweat."*
- Win the match → a final cooperative gag: on your snap she "wakes" convinced she
  won the whole duel, while she's clearly still got a dreamy spiral-shine in one
  eye. Comedic button, fade out.

A small **scoreboard** (rounds won, gags landed, fastest descent) feeds the
"competitive" feel and gives replay goals.

---

## 8. The game graph (build this in anim-pipe)

This maps 1:1 onto the node/edge model. Build nodes first (lock keyframes), then
edges (transitions + loops), per PRACTICES.md §6.

### Nodes (keyframe states) — generate + triage + lock one keeper each
`awake`, `curious`, `fixated`, `drowsy`, `deep`, `entranced`
(plus optional `command_cat`, `command_balloon`, `command_recite` as deep-node
variants for the command beats).

### Idle-loop edges (one per node, source==target, `kind=loop`)
Low `motion_scale`; amplitude **grows with depth** (subtle up top, slow & heavy
down low). Region-locked with a motion mask (chest + eyelids + front hair strand).

| Loop on   | What moves (loop clip brief)                                                            |
|-----------|-----------------------------------------------------------------------------------------|
| `awake`   | quick blink, tiny confident chin-up, ponytail settle. Crisp, alert tempo.               |
| `curious` | head-tilt drift, slower blink, eyes flick toward pendant and back.                       |
| `fixated` | gentle left-right sway, eyes tracking, parted lips, slow blink.                          |
| `drowsy`  | slow deep breathing (chest rises), heavy eyelids fluttering, dreamy half-smile.          |
| `deep`    | very slow breathing, tiny head-nods, the occasional eyelid flutter. Near-still.          |
| `entranced` | almost frozen; only the faintest breath + optional slow eye-shine pulse.               |

### Transition edges (`kind=transition`, first frame = node A, last = node B)
**Descend (the wins):** `awake→curious`, `curious→fixated`, `fixated→drowsy`,
`drowsy→deep`, `deep→entranced`.
**Alt descend:** `curious→fixated` via Focus Light (spiral variant).
**Resist / ascend (the teases):** `curious→awake`, `fixated→curious`,
`drowsy→fixated` — quick head-shake / hard blink / smirk-recover.
**Awaken snap (big):** `deep→awake`, `entranced→awake` — eyes fly open, gasp,
posture re-stiffens.
**Trigger drop:** generic one-band-down beat reusable from `fixated`/`drowsy`.
**Command beats:** `deep→deep` / `entranced→entranced` loop-style clips (recite /
cat / balloon / hand-the-key).

> Tip: build **Round 1 fully first** (awake→…→entranced descend chain + the loops
> + the recite command). That single spine is a playable vertical slice; Rounds 2
> and 3 reuse the same nodes and just add the resist/trigger/timer logic and new
> command beats.

---

## 9. Dialogue bank (drives expression + VO; escalates by band)

Tone slides from sharp → soft → slurred → serene. Useful for subtitle overlays
and to brief facial expression per node.

- **`awake`:** "Pendant tricks? On *me*? Adorable." · "I've put tougher crowds
  under than you'll ever be."
- **`curious`:** "…okay, it's a little shiny, so what." · "I'm just— watching. I
  could stop any time."
- **`fixated`:** "…left… right… stop *narrating*, it's not… working…" · (quieter)
  "your voice is kind of… nice…"
- **`drowsy`:** "mmh… 'm not sleepy… 'm just… resting my eyes…" · "…that countdown
  is… so… unfair…"
- **`deep`:** "…yes…" · "…anything you say…" · (soft) "…feels nice down here…"
- **`entranced`:** (barely audible) "…listening…" · then performs the command.
- **On resist (ascend):** "Nnh— *no.* Cute though." · "Caught myself. Try again,
  rookie."
- **On waking snap:** "—! Ha! Knew it. Totally faked." · "My turn to watch *you*
  sweat."

---

## 10. Art & video production notes (ties to PRACTICES.md)

- **One static backdrop, character-only motion** → reuse the same stage image for
  every node; mask-lock loops to chest/eyes/hair (§2). Cheap, consistent.
- **Motion scale by depth:** start ~0.6 at `awake`, taper toward ~0.25 at
  `entranced` (§3 — subtle beats strong; deeper = slower & heavier, not bigger).
- **Eyes are the gauge:** keep eyelid height, focus, and blink rate consistent and
  *monotonic* down the ladder so the player can read state at a glance. The
  optional `entranced` spiral-shine is a light cel-shaded glint, not a swirling
  overlay — keep it tasteful and anime-stylized.
- **Pendant as a shared prop:** the swinging pocket-watch appears in the descend
  transitions; consider a tiny dedicated motion mask so only the watch + her gaze
  move during `Swing Pendant` clips.
- **Consistency stack** (§5): character LoRA + IP-Adapter from a Yua reference
  sheet (multiple expressions: smug / curious / drowsy / serene) so she stays
  on-model across all six bands. Inject the §2 anchor into every prompt.
- **Two-stage** (§4): render all candidates at 640–768px / 12–24fps, triage with
  the AI art-director, **upscale only the locked keepers**.
- **Transitions = first/last-frame conditioned** (§1, §6): feed node A's locked
  keyframe as the first frame and node B's as the last for every descend/ascend
  clip so motion stays anchored on-model (Wan 2.2 I2V / LTX-2). Loops use the
  node's own keyframe as first=last with `closed_loop`.

### Suggested per-node image-prompt skeleton

```
<Character anchor>, on a velvet stage under one warm spotlight, deep-red curtain
backdrop, candle on a side table, <BAND LINE from §4 table>, expressive eyes,
clean anime cel-shading, theatrical rim light, 3/4 framing, fully clothed.
Negative: extra people, nudity, suggestive, modern clothing, busy background,
extra fingers.
```

(Swap `<BAND LINE>` per node, e.g. for `drowsy`: "heavy half-lidded eyes,
shoulders dropped, slow deep breath, dreamy lopsided smile.")

---

## 11. Build order checklist

1. Lock the **Character** (Yua sheet + reference expressions + LoRA/IP-Adapter).
2. Lock the **backdrop** keyframe (reused everywhere).
3. Generate + triage + select the **six band nodes**.
4. Build the **Round-1 descend chain** transitions + the six **idle loops**.
5. Add the **`recite` command beat** → playable vertical slice (Round 1 end-to-end).
6. Add **ascend/resist** transitions + the **awaken snap**.
7. Layer **Round 2** (Focus Light alt, metronome pin, trigger discovery) and
   **Round 3** (timer, double-band resist, installed trigger).
8. Add **gag command beats** (cat / balloon / forget-seven) for score & flavor.
9. Upscale keepers; export `graph.json` + asset bundle.

---

*This document is the design brief only — no engine code is implied changed. It is
written to be fed to `scenario_to_graph` and/or hand-built node-by-node in the
anim-pipe canvas.*
