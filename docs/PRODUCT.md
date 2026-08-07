# Chess Repertoire Trainer — Product Document

**Status:** Draft v0.1
**Owner:** Darian
**Last updated:** 2026-08-06

---

## 1. Problem

I want to learn and retain a chess opening repertoire. Existing tools each fail on
a different axis:

- **Lichess Studies** — great for authoring trees, weak drilling. No spaced
  repetition, no memory of what I keep getting wrong.
- **Chessable** — excellent drilling, but the content is someone else's
  repertoire. Authoring my own is clunky, and the annotations that matter most
  (*why* this move) are buried in prose I didn't write.
- **Both** — drill generically. Neither weights practice toward the positions I
  actually reach in my own games, or the moves I personally keep missing.

The failure mode I'm optimizing against is not "I don't know enough theory." It's
**"I know 20 moves of a line nobody plays against me, and I'm lost on move 5 when
they deviate."**

## 2. Goal

A personal tool that does exactly two things well:

1. **Store** my repertoire as an annotated move tree that I author myself.
2. **Quiz** me on it daily with spaced repetition, so it stays in memory.

Everything else is out of scope until those two are used daily for a month.

## 3. Non-goals (v1)

Explicitly NOT building:

- ❌ A chess engine or move-legality logic (use `chess.js`)
- ❌ Engine analysis / evaluation bars
- ❌ Opponent prep, game database, or master-games search
- ❌ Accounts, sync, multi-user, sharing
- ❌ A custom spaced-repetition algorithm (use stock SM-2)
- ❌ Playing full games against a bot
- ❌ Mobile native apps (responsive web is enough)

**Scope discipline rule:** no new feature ships until 30 consecutive days of
drilling on what already exists. Additions must come from friction hit *while
drilling*, not from ideas had *while coding*.

## 4. Users

One: me. ~Club-level player building a repertoire from scratch. This being a
single-user tool is a design advantage — no auth, no permissions, no migrations
against other people's data, and I can make opinionated choices.

## 5. Core concepts / data model

### Slot
The situation a repertoire answers. Slots are **user-created data, not schema** —
nothing about which openings I play is compiled into the app. New slots and
repertoires can be added, renamed, split, merged or deleted at any time, forever.

Seeded with a default four, which are a *structural partition* of the game rather
than a statement about my current openings — every game ever played falls into
exactly one:

- `White` (my first move)
- `Black vs 1.e4`
- `Black vs 1.d4`
- `Black vs sidelines` (1.c4 / 1.Nf3 / 1.b3 …)

These are editable like anything else. The partition happens to be complete, so
in practice growth means **adding repertoires inside slots**, not adding slots —
but the app must never assume that.

A slot holds **one or more repertoires**. Exactly one is marked `primary` — the
default weapon, and the one deviation capture (F5) assumes when a game is
ambiguous.

**Design decision — no hardcoded openings anywhere.** No opening names, ECO
codes, move lists or tree shapes in source. The app is a generic annotated-tree
trainer; the entire chess content is user data in IndexedDB, exportable as JSON.
Switching from the London to the Catalan in two years is a data edit, not a code
change.

### Repertoire
A named annotated move tree filling one slot. Multiple alternatives per slot are
a supported, first-class case (e.g. `vs 1.e4 — Najdorf` and `vs 1.e4 — Dragon`),
for variety, for different time controls, or while deciding which system I
actually like.

Each repertoire has a state:

- `primary` — the default for its slot; full card intake
- `active` — an alternative in regular rotation; full card intake
- `trial` — I'm evaluating it. Capped new-card intake, excluded from streak
  math. Promote to `active` or drop it, deliberately.
- `parked` — retained and exportable, generates no cards

**Design decision — keys are `(repertoireId, fen)`, not `fen`.**
This is forced by alternatives-per-slot. Two repertoires in the same slot will
share positions with *contradictory* correct moves: after
`1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3`, the Najdorf says `5...a6` and the
Dragon says `5...g6`. A globally FEN-keyed store would either clobber one or
generate an unanswerable card. Scoping the key to the repertoire keeps
transpositions collapsing *within* a tree (the useful behaviour) while isolating
alternatives *across* trees (the correct behaviour).

**Design decision — a global daily cap, not a per-repertoire one.** The queue is
one shared pool across all card-generating repertoires, capped at a target
session length (default ~15 min ≈ 40–60 cards), drawn most-overdue-first. Adding
a repertoire does *not* silently multiply my daily workload — it dilutes
attention across a fixed budget. The app surfaces the review-debt trend so that
cost is visible immediately rather than discovered three weeks later as a
200-card backlog.

**Rules encoded in the UI (warn, don't block):**
- At most one repertoire in `trial` at a time.
- Warn when adding an alternative to a slot whose `primary` is not yet mature
  (defined as: ≥80% of its cards at an interval ≥ 14 days). Alternatives are a
  reward for fluency, not a substitute for it.

### Position node
The tree is keyed by **position (FEN), not move sequence**, so transpositions
collapse naturally into one node.

```
Node {
  fen: string              // normalized, side-to-move + castling + ep
  moves: Move[]            // candidate continuations from here
}

Move {
  san: string              // "Nf3"
  isMine: boolean          // my repertoire move vs. an opponent option
  note: string             // the "why" — always optional, often empty
  leadsTo: fen
}
```

### Drill card
A card = **one position where it is my turn**, plus the correct move(s).
Opponent-to-move positions are never drilled; they're just path.

```
Card {
  fen: string
  repertoireId: string
  // SM-2 state
  easeFactor: number       // start 2.5
  intervalDays: number
  repetitions: number
  dueAt: timestamp
  lapses: number
}
```

**Design decision — notes are optional everywhere.**
*(Revised. Originally the note was a required field on my own moves, on the
theory that a move without a reason evaporates under pressure. That reasoning
still holds for recall, but it was the wrong thing to enforce: entering a
repertoire means adding hundreds of moves, and a mandatory field on every one of
them is a tax on the bulk-entry path rather than a nudge toward better notes. A
blocked save doesn't produce a thoughtful annotation, it produces a junk one.)*

Notes stay first-class in the UI — prompted with a placeholder, editable at any
time, and surfaced during drilling — but never block adding a move. The intended
workflow is to enter lines fast, then annotate the moves that actually turn out
to be confusing.

**Consequence: adding a move takes no confirmation step.** With nothing required,
a form between playing a move and storing it would be friction with nothing
behind it. Playing a legal move on the board adds it and walks into it;
annotation and deletion both happen afterwards from the continuations list.

## 6. Features (v1)

### F1 — Import
- Paste PGN (with variations) → parsed into a tree.
- Paste a Lichess study URL/ID → fetch its PGN via the public Lichess API.
- Import merges into an existing repertoire rather than replacing it.

*Rationale: I should not have to hand-enter a repertoire I've already sketched
in Lichess.*

### F2 — Tree editor
- **A repertoire opens as a list of its lines**, not as a board. Pick one to
  view or edit it; the board editor is where you land, not where you start.
- Board + move list side by side.
- Click through the tree; play a move on the board to add a new line.
- Edit an existing move in place: **replace** it with a different one, or
  **promote** it to be the main line at that branch.
- Whether a move is **mine** or the **opponent's** is derived from the side to
  move, never asked. Making it a toggle would only create a way to get it wrong.
- Optional note field per move, editable at any time.
- Delete a move, pruning by reachability from the root rather than deleting the
  subtree outright — with transpositions, a position under a deleted move may
  still be reachable another way and must survive.
- Show, per node, how many of my games reached it (see F5) once data exists.

**Design decision — lines are the way in, positions are the way to edit.**
The tree is stored FEN-keyed and browsed one node at a time. That's the right
shape for entering moves and the wrong one for reading: opening a repertoire
straight onto a board answers "add a move" well and "what have I actually got in
here?" not at all — the only way to find an existing line was to remember it and
navigate back down to it, which is exactly the memory the app is supposed to be
holding on my behalf.

So a repertoire opens as its **root-to-leaf lines**, in movetext, filterable,
each flagged with whether it's the main line and whether it has a terminal plan.
This is the same unit the drill presents (F3), so the list reads as "the puzzles
this repertoire can generate" rather than as a second, competing model. Picking
a line opens the editor at its **last** move — the end is where a line is
usually wrong, and it's where the plan box lives.

Lines-with-no-plan get their own filter, because "a line that ends on a bare move
without a plan is unfinished" is otherwise a rule with no way to act on it.

**Design decision — replace is its own operation, not delete-then-add.**
Changing my mind about a move is the single most common edit, and expressing it
as a deletion followed by re-entry loses the move's place in the list — the
replacement lands at the end, silently demoting the line. `replaceMove` keeps the
slot. What it does *not* do is re-graft the old continuation under the new move:
the rest of a line is an answer to the move that came before it, so carrying it
over would manufacture theory I never chose. The count of positions that will be
discarded is shown before confirming, and counts only those reachable no other
way — a position that transposes in elsewhere survives.

**Design decision — edge order is the main line, so it's editable.**
Extending a position forward takes the first continuation at each branch, which
already made edge order load-bearing for drills. Promotion (`↑`) makes that
visible and controllable instead of an accident of entry order.

**Enumeration is capped.** Transpositions make the tree a DAG, where the number
of distinct root-to-leaf paths can grow exponentially. The list stops at 400 and
says so, rather than hanging on a tree that's perfectly reasonable to own.

### F3 — Drill mode
The core loop. **The unit of practice is a whole line, not a single position.**

**A puzzle =** one line, walked from its starting position to its end.

- The app picks a due line and sets the board to its start. **My colour is
  whatever that line is — White or Black, unannounced and effectively random**
  from puzzle to puzzle.
- **No theme, no opening name, no repertoire label is ever shown.** Just the
  board. Working out *what I'm in* from the position is part of the exercise —
  it is the exact skill a real game demands.
- If it's the opponent's move, the app plays it. Then I move. Then it replies.
  Back and forth, automatically, no clicking "next".
- **Correct** → the move plays, brief green, the opponent's reply comes back
  immediately. Flow is unbroken.
- **Wrong** → red, show the correct move and its note. Then **continue the line
  from the correct move** — never restart. Restarting punishes with repetition of
  what I already knew.
- The line ends when the tree ends. Show the **terminal plan note** — "castle
  short, play …c5, pressure the d-file" — which is the actual payload of the
  whole exercise.
- Session ends when the due queue is empty. Target: **10–15 min**.

**Design decision — present as lines, schedule as positions.**
Naively, one line = one card. That's coarse: a 12-move line gets a single grade,
so a move I know cold is re-drilled at the same rate as the one move I keep
missing, and SM-2 loses all its resolution.

Instead: SM-2 state lives on **positions** (the F3 card model), but positions are
never presented alone. The scheduler picks the most-overdue position, then walks
the *whole line containing it* from the start. Every position along the way is
graded in passing. Known moves cost two seconds and get their intervals pushed
out; the weak position in the middle gets a real grade. I get sequence practice;
the algorithm gets per-move resolution.

**Design decision — the first divergent move selects the repertoire.**
This is what makes "never show the theme" work even with alternatives per slot.
Walking from the start, if several repertoires in a slot are live, *any* of their
moves is accepted — and the move I choose commits the puzzle to that repertoire,
which the app then follows for the rest of the line. Playing 1…c6 selects the
Caro-Kann; 1…e6 would select the French, if one existed. This exactly mirrors a
real game, where I am the one who picks the weapon, silently, by moving.

*(Supersedes the earlier decision to label cards with their repertoire. That was
solving position ambiguity with a UI hint; starting lines from the root and
letting the move itself disambiguate solves it properly, and preserves the harder
and more realistic exercise.)*

**Design decision — interleave, never block.** Consecutive puzzles come from
different repertoires. Drilling all Caro-Kann then all KID feels smoother and
produces worse recall; interleaving produces recall that survives a real board.
Random colour per puzzle falls out of this for free.

**Design decision — binary grading**, not SM-2's 0–5 self-rating. Self-rating is
slow and I'd cheat. Map: correct → quality 4, wrong → quality 2 (resets the
interval).

### F4 — Daily habit surface
- Home screen shows: cards due today, current streak, next review date.
- That's it. No dashboards, no graphs. The number that matters is "did I do it
  today."

### F5 — Deviation capture (the differentiator)
This is the feature that makes it worth building rather than using Chessable.

- Paste a PGN of a game I played (or a Lichess game URL).
- The app walks the game against my repertoire and reports **the first move where
  the game left book** — whether it was my mistake or my opponent's novelty.
- One click to add that position + my intended response into the tree.
- **Routing with alternatives per slot:** a game maps to a slot unambiguously
  (from colour and the opponent's first move), but a slot may hold several
  repertoires. Match the game against all of them and attribute it to the one it
  followed longest; fall back to the slot's `primary` when the game left book
  before the trees diverge. Always show which repertoire it picked, with a
  one-click override — misattributed lines silently corrupt the tree.

*Rationale: the repertoire should grow from my own games, not from a course's
notion of completeness. This closes the loop between playing and studying.*

### F6 — Persistence & portability
- Single-user, local-first. State lives in IndexedDB / localStorage.
- **Export to JSON** and **import from JSON** — my repertoire must never be
  trapped in this app.
- Export to PGN with variations, so it round-trips to Lichess.

### F7 — Coverage gaps (frequency-weighted tree building)

Answers the question "what should I study next?" with data instead of guesswork.

- For any node where it's the **opponent's** move, fetch move frequencies from
  the **Lichess Opening Explorer API** (free, public, no key), filtered to my
  rating band and time controls.
- Show each opponent move with its real-world frequency: `6.Bg5 — 31%`,
  `6.Be2 — 24%`, `6.f4 — 3%`.
- Flag **unanswered gaps**: any opponent move above a threshold (default 5%) that
  has no reply in my tree. Surface these as a ranked to-do list across all
  repertoires — "your 8 biggest holes, most common first."
- Show cumulative coverage per repertoire: *"your tree answers 84% of what you'll
  actually face."* That number, not node count, is the measure of a repertoire's
  completeness.

**Design decision — coverage %, not depth, is the headline metric.** The default
failure mode when studying variations is going 20 moves deep in one fashionable
line while a 12%-frequency sideline goes completely unanswered. Ranking gaps by
frequency inverts that instinct: breadth to ~90% coverage first, depth only
after. It also makes the stopping point objective — a 3% sideline is *correctly*
ignored, and seeing it marked as such is what makes ignoring it feel safe rather
than negligent.

**Requires:** my rating band and primary time control, set once in preferences.
The explorer is worthless unfiltered — masters-database frequencies describe an
opening landscape I will never encounter.

### Depth policy

**Storage depth and drill depth are two different settings. They are never
conflated.**

#### Storage depth — unlimited, always

The tree stores whatever I enter, as deep as I want, forever. No cap, no warning,
no truncation, no limit in the data model. A 25-move theoretical main line is a
perfectly valid thing to own. Everything stored is browsable in the editor,
included in PGN/JSON export, and matched against by deviation capture (F5).

This is non-negotiable: the app is a repertoire *store* first. Any limit on what
it holds would make it worse than the Lichess study it replaces.

#### Drill depth — a moving window, per repertoire

What differs is which stored positions generate **SRS cards** — because that
spends my daily time, and time is the only genuinely scarce resource here.

Each repertoire has an **active depth**: positions at or above it generate cards
and appear in the daily queue. Positions beyond it are *dormant* — fully stored,
fully visible, but not scheduled.

Dormant positions are **not hidden during drills**. When a puzzle reaches the
active-depth boundary, the app keeps auto-playing the rest of the stored line for
me to watch, then shows the terminal note. So I see my deep theory regularly in
context; I'm just not yet being *graded* on recalling it unaided.

**Raising active depth is one control.** Move it from 8 to 12 and those positions
wake up and enter the queue over the following days. Nothing is re-entered, lost,
or rebuilt — the tree never changed, only the window over it.

**Default: 8, per repertoire, adjustable at any time.** Suggested rule of thumb
(a nudge, never enforced): raise it when ≥80% of currently active cards sit at
intervals ≥ 14 days. Depth is a reward for fluency at the current depth.

#### Where a line should end

Not at a move count — **at a plan.** The terminal note on every line should
describe an idea: *"castle short, play …c5, pressure the d-file."* A line that
ends on a bare move without a plan is unfinished regardless of its length.

**Rationale for a conservative starting window.** At 1000 rapid, opponents leave
book early and often, with moves that barely register in the explorer. Being
*graded daily* on move 15 of a main line spends reps on positions I rarely reach,
while the positions I do reach are ones no course covers. Hence: store the deep
theory (it costs nothing and I'll grow into it), drill the shallow end (it costs
my only scarce resource). It also makes **F5 (deviation capture) the primary
tree-growth mechanism and F7 (explorer gaps) secondary** — the reverse of how a
stronger player would use them.

## 7. Success criteria

The project succeeds if, three months in:

1. I've drilled ≥ 20 days per month.
2. My repertoire tree contains ≥ 30 positions per repertoire that I added *from
   my own games* via F5.
3. I can play my first 8 moves in the main lines without conscious effort.

It fails if I've spent more hours in the editor than in drill mode. Track this —
log total time in each mode and surface the ratio. **If editor time > drill time,
stop building and go drill.**

## 8. Technical approach

**Stack:** Vite + React + TypeScript, static build, no backend.

| Concern | Choice | Why |
|---|---|---|
| Rules/legality/PGN | `chess.js` | Solved problem. Never write this. |
| Board UI | `react-chessboard` | Drop-in, good mobile touch handling. |
| Storage | IndexedDB via `idb-keyval` | Enough for one user, no server. |
| Scheduling | SM-2, ~40 lines, hand-written | Well documented, no dependency. |
| Deploy | Static host (Vercel/Netlify/GH Pages) as a PWA | Installable on phone. |

**Key decision — web, not desktop.** The daily 15-minute habit lives or dies on
whether I can drill from my phone in a queue or on a commute. A responsive PWA
gets that for free. Local-first means no login and no network dependency.

**Data flow:** everything is one JSON blob in IndexedDB, loaded into a React
context at boot, written back on mutation. No sync, no conflict resolution, no
server. If it outgrows that, it outgrew v1.

## 9. Build phases

**Phase 0 — Skeleton (½ day)**
Vite + React + TS, chess.js + react-chessboard rendering a board I can move
pieces on. Nothing else.

**Phase 1 — Tree + editor (1–2 days)**
Data model, FEN-keyed tree, click-to-navigate, add/delete moves, notes.
Persistence + JSON export/import. **At this point I can enter a real repertoire.**

**Phase 2 — Drill (1 day)**
SM-2, card generation from the tree, the drill loop, home screen with due count.
**At this point the app is useful — start the 30-day clock.**

**Phase 3 — Import (½ day)**
PGN paste and Lichess study fetch.

**Phase 4 — Deviation capture (1 day)**
Game PGN → first out-of-book move → one-click add.

Phases 3 and 4 only after Phase 2 has been used for real. Phase 4 is the payoff
feature and it's deliberately last, because it needs a populated tree and real
games to be worth anything.

## 10. Open questions

- [x] ~~Which repertoire am I actually committing to?~~ **Decided** — see
      Appendix A.
- [ ] Should drill mode weight cards by how often positions occur in my real
      games (data from F5), or is plain SM-2 enough? *Defer — plain SM-2 first,
      revisit after 30 days.*
- [ ] Multiple valid moves in one position (a "you may play either") — support,
      or force one choice? *Lean: force one choice in v1. Ambiguity is the enemy
      of drilling.*
- [x] ~~Do I need the note field on opponent moves too?~~ **Yes, and notes are
      optional on both sides** — see the revised decision in §5.
- [x] ~~What rating band + time control do I filter the explorer to?~~
      **1000 rapid on chess.com** → filter the Lichess explorer to the
      **1200–1600** bands, rapid + blitz (Lichess ratings run materially higher
      than chess.com's at this level; matching the number rather than the skill
      would filter to the wrong population).

---

## Appendix A — Seed content (data, not spec)

> Everything in this appendix is **starting data entered on day one**, not
> product requirements. No part of it is encoded in the app. It will change as I
> improve, and that change must cost nothing but a few edits in the UI.

Rating: **1000 rapid, chess.com.**

Card counts below are **active cards at the starting drill window (depth 8)** —
not a limit on what the trees contain. Stored depth is unlimited and expected to
exceed this considerably; these numbers describe daily workload only.

| Slot | Repertoire | State | Active cards @ depth 8 | Load |
|---|---|---|---|---|
| White | London System | `primary` | 80–110 | Low |
| White | 1.e4 / Ruy Lopez | `parked` | 250–320 | Very high |
| Black vs 1.e4 | Caro-Kann | `primary` | 110–140 | Moderate |
| Black vs 1.d4 | King's Indian Defence | `primary` | 140–180 | High |
| Black vs sidelines | *(unfilled)* | — | 40–60 | Low |

Total active: **~370–490 cards**, settling to roughly 12–18 reviews/day once
mature — a ~12–15 minute daily session, which is the budget the whole design is
built around. Raising active depth later increases this; the global daily cap
absorbs the spike by spreading it over more days rather than lengthening
sessions.

**Only one slot has alternatives, and it's the cheap kind.** London and 1.e4
diverge at move 1 — no shared positions, no contradictory cards, and the choice
is made before the game starts. The FEN-collision problem that forced
`(repertoireId, fen)` keying does not actually bite here; the keying stays
anyway, because it costs nothing and the constraint may return.

**The asymmetry that matters:** "I play the Ruy Lopez" is not a White repertoire.
The Ruy needs `1.e4 e5 2.Nf3 Nc6 3.Bb5`, and the opponent controls 1...e5.
Committing to 1.e4 also owes answers to the Sicilian, French, Caro-Kann,
Scandinavian, Pirc, Modern, Alekhine, Philidor and Petroff — roughly 80% of the
work, none of it the Ruy. The London is a system with near-complete coverage from
day one. Hence London `primary`, 1.e4 `trial`: a working White repertoire in two
weeks instead of three months of leaking games to the Sicilian.

**Build order.** Coverage before depth, cheapest-per-game-covered first:

1. **London** — fastest slot to 90% coverage; one White repertoire that works.
2. **Caro-Kann** — every 1.e4 game as Black.
3. **KID** — largest Black load; start once the first two are in maintenance.
4. **Black vs sidelines** — small, and cheap insurance.
5. **1.e4 / Ruy Lopez** — last, in `trial`, built anti-Sicilian-first (frequency
   order, not Ruy-first). Promote over the London only when F7 coverage clears
   ~85%.

**Studying variations = closing F7 gaps in frequency order**, not working through
a course's table of contents. The KID alone has Classical, Sämisch, Four Pawns,
Fianchetto, Averbakh and Makogonov; at club level the distribution is heavily
skewed and several of those are genuinely rare. Let the explorer say which.
