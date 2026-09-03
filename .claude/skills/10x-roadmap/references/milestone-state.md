# Milestone state machine

Read this file only when Step 0 of SKILL.md determined the invocation touches the milestone lifecycle: first launch, resume/status check, closure, or opening the next milestone. Do NOT load it when the invocation is a pure regeneration of an already-open milestone's decomposition — Steps 1–10 of SKILL.md cover that alone.

## States

State is **derived, never stored separately**. The only persistence is `context/foundation/roadmap.md` (frontmatter + item statuses). Detection is a pure read — no sidecar state file, ever (repo convention: the legacy `.implement-state.json` sidecar was killed for exactly this failure mode).

| State            | Detection rule                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `NO_MILESTONE`   | `context/foundation/roadmap.md` absent, OR present without a `milestone_id` frontmatter key (legacy roadmap) |
| `ACTIVE`         | `milestone_status: open` AND at least one `F-NN`/`S-NN` item is not `done`                         |
| `READY_TO_CLOSE` | `milestone_status: open` AND every `F-NN`/`S-NN` item is `done`                                    |
| `CLOSED`         | `milestone_status: done` (closure recorded, next milestone not yet opened)                         |

**Legacy roadmap** (file exists, no `milestone_id`): treat as `NO_MILESTONE`, but before regenerating offer **adoption** — wrap the existing roadmap as `M-01` by adding the milestone frontmatter keys and a `## Milestone` section in place, preserving all item statuses. Adoption is the Recommended option; regeneration archives the legacy file first per SKILL.md Step 9.

## Transitions

### `NO_MILESTONE` → `ACTIVE` — open the first milestone

1. Announce: no milestone is open — this is the first launch.
2. Ask for source materials with the interactive-question tool (SKILL.md Step 1's source-materials question; PRD is the Recommended primary source).
3. Run SKILL.md Steps 1–10 in full (readiness → baseline → interview → decompose → emit → self-review → write). The emitted roadmap carries `milestone_seq: 1`, `milestone_status: open`, a populated `## Milestone` charter, and an empty `## Milestone History`.

### `ACTIVE` → `ACTIVE` — the regular loop (status / next move)

On invocation while a milestone is active with open items:

1. Read `roadmap.md` fully. Recompute which items are `ready` (all Prerequisites `done`).
2. Report a compact milestone status block: milestone name, item counts by status, done-count out of total. Count-based only — never percent-of-time, never dates.
3. Recommend the single next move using SKILL.md Step 10's selection rule (north star first, then its enabling foundation, then highest fan-out).
4. Regenerate the decomposition only if the user asks for it or the source material's version changed (e.g. `prd_version` bumped). Regeneration runs Steps 1–10 with Step 9 collision handling, preserves the milestone frontmatter and `## Milestone History` verbatim, and carries `done`/`in-progress`/`planning` statuses forward by `Change ID` (forward-only — never regress).

### `READY_TO_CLOSE` → `CLOSED` — close the milestone

1. Announce that every item in the milestone is `done`. Confirm with the interactive-question tool:
   - "Close milestone (Recommended)" — record closure and start the next loop.
   - "Keep it open — I'll add scope" — user extends the milestone; new slices must trace to the same source materials (or new `MS-NN` anchors added to the charter).
   - "Cancel" — exit without changes.
2. On close: set `milestone_status: done` and `updated: <today>` in frontmatter; flip the `## Milestone` charter's Status line to `done`; append the closure entry to `## Milestone History`. The file stays in place at `context/foundation/roadmap.md` — closing never moves or copies it anywhere.
3. Proceed immediately to `CLOSED` → `ACTIVE` in the same invocation — the loop restarts — unless the user cancels there.

### `CLOSED` → `ACTIVE` — open the next milestone

1. Ask for the next milestone's source materials with the interactive-question tool:
   - "Updated PRD (Recommended when `prd.md` changed since the closed milestone's `prd_version`)" — re-read and target the delta.
   - "Same PRD — next tranche" — FRs/user stories the closed milestone(s) did not cover (check `## Milestone History` for prior coverage).
   - "Other documents — I'll give paths" — specs, briefs, research docs.
   - "I'll describe the milestone myself" — free-form description, no document.
2. If the user describes the milestone in their own words: record the description verbatim in the new roadmap's `## Milestone` charter and distill it into numbered `MS-NN` scope anchors. Slices then trace to `MS-NN` IDs instead of `FR-NNN`/`US-NN` (SKILL.md's "never invent slices" rule swaps its trace target to the charter; the rule itself still holds — no slice without an anchor).
3. Run SKILL.md Steps 1–10 for the new milestone with `milestone_seq` incremented, a fresh `## Milestone` charter, and `## Milestone History` carried forward verbatim (it already ends with the just-closed entry — do not append it again). The write replaces `context/foundation/roadmap.md` in place — Step 9's archive-collision question does not apply to the milestone loop; continuity lives in the carried-forward `## Milestone History`, not in file copies. The Step 3 PRD-readiness check runs only when the source is PRD-shaped; description-sourced milestones skip it (the charter's `MS-NN` anchors are the readiness gate: fewer than 2 anchors → ask the user to firm up the description first).

## Invariants

- **One milestone open at a time.** Opening a new milestone while `milestone_status: open` requires closing it first — or explicitly abandoning it (user's call, recorded in `## Milestone History` as `abandoned <date>` with a one-line reason).
- **Milestones are outcome-scoped, never time-boxed.** No sprint semantics, no target dates. The only dates are factual open/close records in history entries.
- **State lives in `roadmap.md` alone.** Frontmatter + item statuses are the whole machine. Anything else is drift.
- **Downstream skills are untouched.** `/10x-plan`, `/10x-implement`, `/10x-archive` keep flipping item `Status` by `Change ID` exactly as before, milestone-blind. Milestone closure is *detected* by this skill on its next invocation — never pushed by `/10x-archive`.
- **History is append-only** and carried forward verbatim into each successor roadmap, so the current file always tells the full milestone story.
