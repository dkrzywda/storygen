---
name: 10x-roadmap
description: >
  Milestone-driven roadmap manager: open an outcome-scoped milestone from
  source materials (primary: the PRD), decompose it into vertical end-to-end
  slices in context/foundation/roadmap.md, track the milestone as connected
  slices complete, close it when every slice is done, and loop into the next
  milestone. Use AFTER /10x-prd (and after the tech-stack selection /
  bootstrap step, when applicable). Trigger phrases: "write the roadmap",
  "generate roadmap", "create the roadmap from PRD", "stwórz roadmapę",
  "open a milestone", "close the milestone", "milestone status", "what
  should I build first", "what's next on the roadmap". Do NOT use for
  per-change planning — that's /10x-plan's job.
argument-hint: "[path-to-prd]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Agent
  - AskUserQuestion
  - TaskCreate
  - TaskUpdate
---

# Roadmap: Milestone-driven roadmap for context/foundation/roadmap.md

This skill is the bridge between **product** (PRD or other source materials) and **per-change planning** (`/10x-plan`), and it acts as the project's **milestone-level project manager**. Work is grouped into **milestones**: an outcome-scoped batch of connected slices, exactly one open at a time, tracked in `roadmap.md` itself. Each invocation first dispatches on milestone state (Step 0): if no milestone is open, the skill asks for source materials and opens one; if a milestone is active, it reports status and recommends the next move; if every slice is done, it closes the milestone and loops into opening the next one — from updated source materials or from the user's own description.

Within an open milestone, the skill's decomposition job is unchanged: read the source materials, auto-probe the codebase baseline, **infer a decisive sequencing proposal** (main goal, north-star slice, investment areas, top blocker), surface only the genuine uncertainty the artifacts can't resolve, and emit a `context/foundation/roadmap.md` that lists vertical, user-visible slices in dependency order — ready to feed into `/10x-plan <change-id>`.

## Milestone layer — state machine lives in a reference file

The milestone lifecycle (states, detection rules, transitions, invariants) is specified in **`references/milestone-state.md`**, deliberately kept out of this file. **Read it only when the invocation operates at milestone level** — first launch, resume/status check, milestone closure, or opening the next milestone. A pure re-decomposition of an already-open milestone does not need it.

The two facts needed before deciding whether to load it:

- State is **derived from `roadmap.md` alone** (frontmatter `milestone_id` / `milestone_status` + item statuses). There is no sidecar state file.
- Milestone IDs are `M-<seq>` with a kebab-case `milestone_id`; milestones are **outcome-scoped, never time-boxed** — a milestone closes when its slices are `done`, not when a date passes. This is not a sprint.

**Posture: opinionated recommender, lean interview.** The skill acts as a senior tech-lead who has read the PRD, probed the codebase, and arrived with a recommendation — but who still asks the human the 2-3 load-bearing calls before committing. The interview rules (3-question cap, strong Recommends, no strawmen, the custom-MVP exception) are specified once, in Step 5.

It is a **decomposition + sequencing** skill, not a low-level planner. It NEVER picks frameworks, file paths, schemas, libraries, or implementation details — those belong to `/10x-plan`. It NEVER assigns time estimates, t-shirt sizes, points, or human-calendar dates — agentic execution is non-linear and time-budgeted estimates would lie. What it DOES is: name the slices, sequence them by dependency and by stated goal, surface what's blocking, and route open questions where they can be resolved.

The skill is **AI-native** in four concrete ways: (1) it expresses ordering as a dependency graph, not a calendar; (2) it marks slices that can be executed in parallel by separate agent runs; (3) it pushes "blocking unknowns" up where a human can resolve them, instead of letting them silently slip into implementation; (4) it inventories the existing codebase with subagents instead of asking the user what's already in place.

## When to use, when to skip

**Use when**: the user wants to open a milestone and decompose it (typical first source: a non-trivial `context/foundation/prd.md` with FRs and user stories populated), check milestone/roadmap status, or close a finished milestone and open the next. Typical triggers: just finished `/10x-prd`, just finished bootstrap, returning to a project and asking "what's next", or all roadmap slices have been archived.

**Skip when**: the PRD is hollow (large `## Open Questions`, `# TODO: domain rule`) — point at `/10x-prd` (or upstream `/10x-shape`) first; a roadmap from a hollow PRD will inherit the hollowness. Also skip when the user wants to plan a *single* change in detail — that's `/10x-plan`. The roadmap is plural; the plan is singular.

## Relationship to other skills

- `/10x-shape` and `/10x-prd` — produce the upstream PRD this skill consumes. If `shape-notes.md` carries a `## Forward: technical-roadmap` block (where shape parks roadmap-bound content), this skill lifts it.
- `10x-tech-stack-selector` — runs between `/10x-prd` and this skill in the bootstrap chain. If `context/foundation/tech-stack.md` exists, this skill reads it as input to derive `## Foundations` (auth scaffold, deploy skeleton, observability — anything the tech-stack-selection step implied) and to short-circuit baseline probes for layers already declared.
- `/10x-plan` — downstream consumer. The user picks a roadmap item and invokes `/10x-plan <change-id>`; that skill creates the change folder, produces a detailed plan, and flips the matched roadmap item's `Status` to `planning`. The roadmap does NOT pre-create change folders; one slice can spawn multiple changes when `/10x-plan` discovers that the item is still too broad (only the first advances the shared item's status).
- `/10x-implement` (and its autonomous sibling `/10x-goal-implement`) — further downstream. When implementation *starts* on a change whose `Change ID` matches a roadmap item, it flips that item's `Status` to `in-progress` — the open-work counterpart to `/10x-archive`'s `done` flip. This skill itself still emits only `proposed` / `ready` / `blocked` on generation; the intermediate lifecycle states (`planning`, `in-progress`) are now written downstream as the change moves through plan → implement. Every downstream flip matches by `Change ID`, is best-effort (a no-match is a silent skip), and is forward-only (never regresses a more-advanced status).
- `/10x-archive` — closes the loop at the end. When a change whose `Change ID` matches a roadmap item is archived, `/10x-archive` flips that item's `Status` to `done` (in `## At a glance` and in the item's body block) and appends an entry to `## Done`. This skill never pre-populates `## Done`; `/10x-archive` is its sole writer.
- `/10x-frame`, `/10x-research` — orthogonal. They operate on a single change, not the roadmap.

## Initial Response — Step 0: milestone state dispatch

When this skill is invoked, dispatch BEFORE doing any decomposition work:

1. **Probe milestone state** (cheap, no reference file needed yet):

   ```bash
   test -f context/foundation/roadmap.md && head -20 context/foundation/roadmap.md
   ```

   - File absent, or present without a `milestone_id` frontmatter key → **no milestone open** (first launch, or legacy roadmap).
   - `milestone_status: open` → milestone active or ready to close (depends on item statuses — read the full file to tell).
   - `milestone_status: done` → previous milestone closed, next not yet opened.

2. **Unless a milestone is open with undone items and the user explicitly asked for a fresh decomposition** — i.e. on first launch, legacy adoption, status/next-move check, closure, or opening the next milestone — **read `references/milestone-state.md` now** and follow the matching transition. The transitions delegate back into Steps 1–10 below where decomposition is needed.

3. **If a milestone is open and the user asked to regenerate the decomposition** (or passed a source path argument, e.g. `/10x-roadmap @path/to/prd.md`), skip the reference file: capture the path (strip a leading `@`), default to `context/foundation/prd.md` otherwise, and proceed straight to Step 1. Regeneration preserves milestone frontmatter and `## Milestone History` verbatim and carries item statuses forward by `Change ID` (forward-only).

## Interactive prompts — host-agnostic

Whenever the procedure says *"ask the user"*, use whatever structured interactive-question tool the host agent exposes (Claude Code → `AskUserQuestion`; on other hosts, any tool that asks the user a question with labelled options). If none is available, fall back to a plain conversational message listing the labelled options — do not block the procedure. State which tool you selected (or that you fell back to plain chat) the first time you ask, so the user can correct you.

Question blocks appear in Steps 1, 3, 4, 5, and 9 and in the milestone transitions of `references/milestone-state.md` — short structured choices. Step 5 asks each anchor as its own structured question; its synthesis recap is plain markdown (no extra question).

## Parallel baseline research — host-agnostic

Whenever the procedure says to use subagents or run parallel probes, use whatever background-research / task-spawn tool the host exposes (Claude Code → `Agent` with an Explore/general-purpose subagent type; on other hosts, any tool that spawns an isolated agent and returns a summary), fanning the probes out in one batched call. If none exists, run the same probes sequentially in the main context. Either path must return the same baseline summary shape with file evidence.

## Process

### Step 1: Elicit and read source materials

**When opening a milestone** (first launch or next-milestone transition from `references/milestone-state.md`), ask what the milestone should be built from — do not assume, but Recommend the PRD:

Interactive question:
- question: "What are the source materials for this milestone?"
  header: "Sources"
  options:
  - label: "PRD at context/foundation/prd.md (Recommended)"
    description: "The standard path: milestone scoped from the PRD's FRs and user stories. Run /10x-prd first if it doesn't exist yet."
  - label: "Other document(s) — I'll give paths"
    description: "Specs, briefs, research docs. Slices will trace to their content, recorded as scope anchors in the milestone charter."
  - label: "I'll describe the milestone myself"
    description: "Free-form description, no document. I'll distill it into MS-NN scope anchors that slices trace to."
  - label: "Cancel"
    description: "Exit without changes."
  multiSelect: false

For subsequent milestones, `references/milestone-state.md` refines these options (updated PRD vs next tranche of the same PRD). When the invocation carried an explicit path argument, skip the question and use that path.

Resolve and verify the input path(s):

```bash
test -f "<resolved-path>"
```

If a file exists, **read it FULLY** (no `limit`/`offset`). If the user chose self-description, capture their description verbatim instead — it becomes the `## Milestone` charter with numbered `MS-NN` scope anchors, and Steps 3's PRD-readiness check is replaced by an anchor check (< 2 distillable `MS-NN` anchors → ask the user to firm up the description, then STOP if they can't).

If a named file does not exist, ask with the selected interactive-question tool:

Interactive question:
- question: "No source found at `<resolved-path>`. How would you like to proceed?"
  header: "Input?"
  options:
  - label: "Run /10x-prd first (Recommended)"
    description: "Stop here. Run /10x-prd to produce prd.md, then re-invoke /10x-roadmap."
  - label: "Provide a different path"
    description: "I'll wait for you to give me the path."
  - label: "Cancel"
    description: "Exit without changes."
  multiSelect: false

On "Run /10x-prd first": print the redirect message and STOP.

### Step 2: Read supplementary inputs (best effort)

Read these if they exist; otherwise note their absence and continue:

- `context/foundation/shape-notes.md` — look for a `## Forward: technical-roadmap` section. If present, lift its bullets verbatim as candidate roadmap inputs (the user already parked them there during shaping).
- `context/foundation/tech-stack.md` — informs the `## Foundations` section AND short-circuits baseline probes (a layer already declared here is reported as "per tech-stack.md" without re-probing).
- `context/foundation/roadmap.md` — if it already exists, hold it for Step 9 (collision handling). Do NOT mutate it yet.
- `context/foundation/lessons.md` — if present, scan for any rules that touch ordering or readiness (e.g., "always ship the riskiest slice first"). Treat as priors, not gospel.

### Step 3: PRD readiness check

Before generating, score the PRD on a 0–4 readiness heuristic. Each signal contributes 1 point:

1. **Vision & Problem Statement is non-trivial** — section exists, contains ≥ 2 sentences, does NOT contain `# TODO`.
2. **At least one populated user story** — `### US-NN:` heading exists with a Given/When/Then block beneath it (not `# TODO`).
3. **At least one `must-have` FR** — line matching `^- FR-\d{3}: .* (P|p)riority: must-have$` exists.
4. **Business Logic populated** — `## Business Logic` section's first non-blank line is a declarative sentence (not `# TODO: domain rule`).

Document the heuristic explicitly in the conversation:

```
PRD readiness check (heuristic, 4 signals, 1 point each):
  [✓|✗] Vision & Problem Statement non-trivial
  [✓|✗] ≥ 1 populated user story
  [✓|✗] ≥ 1 must-have FR
  [✓|✗] Business Logic populated

  Score: <N>/4
  Open Questions in PRD: <count>
```

**Score ≥ 3**: PRD is roadmap-ready; proceed to Step 4.

**Score < 3**: warn explicitly. Name what's missing and why it matters for the roadmap (NOT a generic "your PRD is thin"):

```
This PRD scored <N>/4 on the roadmap-readiness heuristic. Missing signals:

  - <signal name>: <one-line consequence for the roadmap>
  - ...

A roadmap generated from a hollow PRD will have many slices marked Status:
blocked with their first Unknown being a PRD gap. That's a valid intermediate
state — the roadmap surfaces what's blocking — but if you have time to firm
up the PRD first, the resulting roadmap will be substantially more actionable.
```

Then ask with the selected interactive-question tool:

Interactive question:
- question: "How would you like to proceed?"
  header: "Thin PRD"
  options:
  - label: "Firm up PRD first (Recommended)"
    description: "Stop here. Resolve PRD's Open Questions / TODOs, then re-invoke /10x-roadmap."
  - label: "Proceed anyway"
    description: "Generate from what's there. Hollow areas surface as blocked slices with PRD gap as their Unknown."
  - label: "Cancel"
    description: "Exit without changes."
  multiSelect: false

On "Firm up PRD first": print the redirect and STOP. On "Proceed anyway": continue with the score recorded so Step 6 can flag thin areas.

### Step 4: Auto-research baseline

The "what's already in place" assessment shouldn't fall on the user — the codebase is the source of truth. Use the selected background research / task-spawn tool, if available, to inventory each layer in parallel. If no such tool exists, run the same probes sequentially in the main context. Each probe returns a one-paragraph verdict: **present** (with file evidence), **absent**, or **partial** (scaffold exists but not wired). Then surface the inventory for user confirmation before it feeds Foundations.

**Layers to probe** (skip a layer if `tech-stack.md` already names that layer's choice — report "per tech-stack.md: <choice>" instead of probing):

| Layer          | What the probe looks for                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Frontend       | UI framework, build tooling, routing, component libraries — `package.json` deps, framework config files           |
| Backend / API  | Server framework, API routes, request handlers — entrypoints, route files, controllers                            |
| Data           | DB driver, ORM/query builder, schema/migration tooling, seeded data — schema files, migration directories         |
| Auth           | Auth provider integration, session/token handling, auth middleware — auth config, middleware files                |
| Deploy / infra | Hosting target, container config, CI/CD workflows, infra-as-code — `Dockerfile`, `.github/workflows`, deploy YAML |
| Observability  | Logging library, error tracking, metrics, dashboards — sentry/datadog/otel imports, log middleware                |

**Run all probes in one batched delegation when the host supports it.** Each prompt is short and self-contained; delegated agents return only a paragraph each, so the main context stays small. Example for Auth:

> Inventory the auth/identity layer of this codebase. Report in under 100 words: (1) is there an auth provider integration? Name it. (2) Are there session/token issuing or verification code paths? Cite a file:line. (3) Is there route-level auth middleware? Cite. If a layer is absent, say "absent" — don't speculate. Don't suggest changes. Don't write or edit files.

Adapt the same template per layer. Always require: present/absent/partial verdict, ≤ 100 words, file evidence when present, no speculation, no edits.

After all probes return, present a one-screen baseline summary to the user:

```
Codebase baseline (auto-researched):

  Frontend:      <present | absent | partial> — <one line, with file pointer>
  Backend/API:   <…>
  Data:          <…>
  Auth:          <…>
  Deploy/infra:  <…>
  Observability: <…>
```

Then confirm:

Interactive question:
- question: "Does this baseline match your understanding? Anything to correct or add before it informs Foundations?"
  header: "Baseline"
  options:
  - label: "Looks right — proceed"
    description: "Use this baseline as input for Foundations and the roadmap's ## Baseline section."
  - label: "Correct one or more layers — I'll explain"
    description: "Free-form correction. I'll re-record the layer(s) before proceeding."
  - label: "Add something not listed"
    description: "Free-form. Things the probes missed (planned-but-not-wired, scaffold from another repo, etc.)."
  multiSelect: true

Save the confirmed baseline. It feeds Step 6a (Foundations) directly: **present** layers → Foundations skips them; **absent** or **partial** → Foundations slot opens. It also feeds the roadmap's `## Baseline` section verbatim.

### Step 5: Lean interview — 2-3 anchor questions, each with a strong Recommend

The PRD captures the **product**. The baseline (Step 4) captures **what already exists**. This step produces the roadmap's framing — `main_goal`, `north_star`, investment areas, `top_blocker` — through a capped interview: at most **three anchor questions**, each carrying one strong **Recommend** grounded in a quoted artifact line plus 1-2 alternatives with a one-line "why this is also reasonable" rationale. The user picks the Recommend, picks an alternative, or overrides freely; investment areas are *derived* from the answers, not asked. This is the sweet spot between the two failure modes the skill has lived through: **silent auto-framing** (deciding load-bearing calls without a human gate) and **unbounded discovery** (asking what the artifacts already answer). If `shape-notes.md` carried a `## Forward: technical-roadmap` block, feed it into the Recommends — don't re-elicit content the user already parked there. If an anchor is still undecided when the cap is hit, **make the call** using the Recommend, record it in frontmatter with a one-line rationale, and proceed — the user can override at any point.

**5a. Infer recommendations and the alternatives that are actually reasonable.**

For each anchor below, derive *both* the Recommend AND the alternatives — grounded in specific quotes from PRD frontmatter / `## Vision` / `## Success Criteria` / `## NFRs` / `## Open Questions` / baseline / `tech-stack.md`. An alternative is "reasonable" only if a real signal in the artifacts supports it OR it is a common, defensible default for the product shape. **Do not list strawmen.** If only one value is plausible (no real alternative supportable from the artifacts), say so — that anchor will be presented with a single Recommend and an "override in your own words" fallback option.

- **`main_goal`** — pick from `market-feedback` | `quality` | `low-complexity` | `speed` | `learn` | `other`. Signals: `timeline_budget` (tight → speed or low-complexity), `target_scale` (small → low-complexity; mass-market → quality), Success Criteria phrasing ("learn from real users" → market-feedback; "validate the riskiest assumption" → market-feedback; "no incidents at launch" → quality), Vision tone (exploratory hobby → learn; hard deadline → speed). Alternatives are *adjacent* values that the same evidence could reasonably support — e.g., `market-feedback` and `speed` often coexist when the PRD says "ship to learn fast".

- **`north_star`** — the smallest end-to-end user-visible flow that, if shipped first, proves the core hypothesis of the PRD's Vision. Usually traces to a high-priority US-NN AND the primary Success Criterion. Reasonable alternatives are *other* candidate slices that also trace to the primary Success Criterion or to a high-priority US-NN, with fewer Prerequisites or with different sequencing consequences. When more than three candidates exist, present the top three.

- **`top_blocker`** — pick from `skills` | `capacity` | `time` | `decisions` | `external` | `motivation` | `none`. Signals: ≥ 3 unresolved PRD `## Open Questions` → `decisions`; ambitious scope vs `timeline_budget` mismatch → `time` or `capacity`; vendor dependency named in PRD that's not yet contracted → `external`; tech-stack lists a layer the team has never shipped → `skills`; none fire → `none`. Reasonable alternatives are *adjacent* blocker types that fire on similar signals — e.g., `time` and `capacity` often both fire on scope-vs-deadline tension.

- **Investment areas** (NOT asked — derived in 5d) — for each of `frontend`, `backend`, `data`, `infra`: decide `invest deeply` vs `go simple`. Signals: PRD NFRs that gate launch in a layer (privacy / latency / correctness → invest there), baseline gaps that map to PRD must-haves (auth absent + multi-user must-have → invest in auth), Open Questions concentrated in one layer (decisions unresolved there → invest), and the chosen `main_goal` (`quality` boosts privacy/observability layers; `learn` boosts the unfamiliar layer; `speed` / `low-complexity` keeps everything simple by default). Do NOT promote a layer to "invest" without naming the PRD/baseline/main_goal signal.

**5b. Skip an anchor only when the artifact is unambiguous.** If PRD frontmatter or Success Criteria *literally states* the value (e.g., `timeline_budget: "1 week to ship"` plus "we need to launch before X" → `main_goal: speed`), skip that question and announce the skip with the chosen value and the quote that locks it. Never skip when any plausible alternative exists — the user's confirmation on a real choice is worth more than the seconds saved. In practice you will usually ask 2-3 questions; you may ask fewer, but NEVER more than 3.

**5c. Run the interview — one structured question per anchor, in order.**

For each non-skipped anchor — `main_goal`, then `north_star`, then `top_blocker` — use the selected interactive-question tool. Each question is its own call (sequential, not batched). Format:

Interactive question:
- question: "<plain-language anchor question, in the user's language>"
  header: "<short header — e.g., Cel | Gwiazda | Główne ryzyko / Goal | North star | Blocker>"
  options:
  - label: "<Recommend value> (Recommended)"
    description: "<One-line why, with the artifact quote/pointer that grounds the Recommend.>"
  - label: "<Alternative A value>"
    description: "Reasonable when <one-line condition the artifacts partially support>; you'd pick this when <sequencing/scope consequence>."
  - label: "<Alternative B value>"
    description: "Reasonable when <one-line condition>; you'd pick this when <consequence>."
  - label: "Something else — I'll explain"
    description: "Free-form. Name the value and the reason; I'll record both and sequence accordingly."
  multiSelect: false

Rules for the options block:
- **The Recommend is always option 1**, with the "(Recommended)" suffix on the label.
- **Each alternative carries its own "why reasonable" clause** tied to artifact signal — not "alternative: quality" but "alternative: quality — reasonable when launch correctness matters more than first-user signal". An alternative without one is a strawman; remove it.
- **At most 2 alternatives** plus the free-form fallback (2-4 options total). Longer lists fatigue the user without adding signal.
- **North star options name slice candidates, not abstract values** — each label is `<US-NN candidate> — <one-line outcome>`.
- **If only one value is plausible** (5a found no reasonable alternative), present just the Recommend and "Something else — I'll explain", and disclose in the question text: "the artifacts only support one reading here; flag if your read differs".

**5d. Derive investment areas (no question).**

After the 2-3 anchor answers land, derive investment areas from: (1) the chosen `main_goal`, (2) PRD NFRs gating launch in a layer, (3) baseline gaps mapped to must-have FRs, (4) Open-Question concentration. Announce the derived investment in the synthesis recap (5e). The user can override in one line; they are not asked to pick.

**5e. Synthesis recap — confirm without asking.**

Emit a single plain-markdown message that locks in the framing. No new questions. Mirror the user's language end-to-end (Polish PRD → Polish recap). Shape:

```markdown
Locking in the roadmap framing:

- **Cel sekwencjonowania: `<main_goal>`.** <One-line rationale tying to the user's anchor answer and an artifact pointer.>
- **Gwiazda przewodnia: `<S-NN candidate> — <Outcome>`.** <One-line tying this slice to the primary Success Criterion or riskiest assumption.>
- **Główne ryzyko / blocker: `<top_blocker>`.** <One-line with the specific signal — count of Open Questions, named vendor, deadline mismatch, etc.>
- **Inwestycje: w `<layer>` głęboko; reszta lekko.** <One-line — derived from main_goal + NFR + baseline gap; not asked.>

Powiedz "go" żeby ruszyć dalej, albo nadpisz dowolną linię ("inwestycja powinna być w data, nie infra"). Nie będę pytał ponownie o to, co już ustaliliśmy.
```

When the user says "go" or stays silent past the next step boundary, proceed with the locked framing. Per-line overrides are accepted and re-recorded without re-asking the other anchors.

**5f. Custom-MVP-shape exception.**

A "custom MVP shape" is a product that doesn't map onto a familiar pattern: not a SaaS dashboard, not a CRUD app, not a content platform, not an obvious AI-wrapper, not a marketing site. Signals: PRD `## Vision` describes a novel interaction or domain; `## User Stories` don't cluster around a familiar entity (create/read/update/delete a `<thing>`); `tech-stack.md` declares non-obvious tooling (game engines, hardware bridges, specialized runtimes, novel agent shapes); user wording emphasizes a new mechanic, not a known pattern.

When the PRD looks custom-shaped:

1. **Open the interview by disclosing it** in the message preceding the first anchor question: *"This PRD doesn't fit a familiar MVP pattern (no SaaS dashboard / CRUD / content / AI-wrapper shape). My Recommends for the next 2-3 questions are weaker than usual — push back hard if my read is off."*
2. **Soften the Recommend on `north_star` and any derived investment area.** Phrase the Recommend description as *"My best read is X, but the artifact signal is thin"* rather than *"PRD §Vision says X"*.
3. **Allow up to two follow-up exchanges** on top of the three anchor questions. Custom MVPs reward dialogue; the user's design intuition is doing more work than artifacts can. Follow-ups are free-form text, not new structured questions.

This is the one path where the skill leans into dialogue rather than away from it — and the only path that allows follow-ups. Total ceiling under this exception: 3 anchors + 2 follow-ups = 5 exchanges; outside it, 3 anchor questions, no follow-ups, one synthesis recap.

**5g. Phrasing and language guardrails (apply to every anchor question and the recap).**

- **Mirror the user's language end-to-end.** Polish PRD → Polish questions, options, and recap. Translate section names (`Open Questions` → `Otwarte pytania`, `Functional Requirements` → `Wymagania funkcjonalne`, `Non-Goals` → `Poza zakresem`, `Success Criteria` → `Kryteria sukcesu`). No English fragments like "north star", "blocker", "must-have" inside a Polish question or option label — paraphrase ("gwiazda przewodnia", "główne ryzyko", "konieczne").
- **Translate skill-internal jargon to plain product language.** *"Privacy posture"* → *"polityka prywatności dostawcy AI"*. *"North star"* → *"pierwsza historyjka, która udowadnia, że produkt działa"*. *"Blocking unknowns"* → *"pytania bez odpowiedzi, które blokują dalsze planowanie"*. A user should never need to open this skill's docs to parse a question.
- **Quotes in option descriptions earn their place.** A citation like *"tech-stack wskazuje Astro + Supabase + OpenRouter"* is a name-dump unless the next clause says why it matters for *this* anchor. Either inline the implication or drop the quote.
- **Recommend must be defensible, not aggressive.** A Recommend's one-liner is grounded in an artifact line, not in confident tone. If you can't point to the quote, downgrade — present the anchor with two alternatives of equal weight (and a free-form fallback), and let the user choose.

### Step 6: Decompose and sequence

This step is where the skill earns its keep. Build the roadmap content **in memory** (not on disk yet).

**6a. Identify Foundations.** A foundation is a cross-cutting prerequisite that has no user-visible outcome on its own but unblocks named vertical slices, reduces a named blocking unknown, or creates verification infrastructure required by a named slice. It is an enabler contract, not permission to roadmap horizontally. Sources:

- `tech-stack.md` decisions that imply scaffolding work (auth provider → auth scaffold; chosen deploy target → deploy skeleton; chosen monitoring → observability baseline).
- PRD `## Non-Functional Requirements` that need infrastructure (e.g., NFR "p95 < 800ms" implies basic perf instrumentation).
- PRD `## Access Control` if it's anything beyond "single user, no auth".
- **Step 4 baseline** — anything reported as **absent** or **partial** is a Foundations candidate. Anything reported as **present** is skipped (and noted in `## Baseline`).
- **Step 5 "Where to invest"** — "invest deeply" picks promote a foundation to its own explicit slice (e.g., "data layer — invest deeply" + absent baseline → F-NN explicit data-design foundation, not just an implicit migration step).

Don't invent foundations the PRD doesn't imply (no "set up Storybook" unless something forces it). Do not create a generic "data layer", "API layer", "UI layer", or "auth system" foundation unless you can name the downstream `S-NN` item it unlocks, the blocking unknown it reduces, or the verification path it enables.

**Foundation scope cap.** A Foundation must be the smallest cross-cutting enabler that lets a named vertical slice proceed. It may establish a minimal contract, scaffold, policy, or verification path; it must NOT complete an entire architectural layer ahead of user-facing work. If a foundation's Outcome sounds like "the data layer/API/UI/auth is complete", split it or fold the minimum needed work into the first `S-NN` slice that consumes it. The test: after the Foundation lands, at least one downstream `S-NN` should still integrate and exercise that layer through a real user capability.

**Progressive disclosure rule.** Prefer introducing technical elements at the moment the first user-facing slice needs them. A foundation is justified only when postponing it would make the first vertical slice unplannable, unsafe, or unverifiable. "We'll need this layer eventually" is not enough.

Foundation IDs are `F-NN` (zero-padded two-digit, starting at `F-01`).

**6b. Decompose the user-facing surface into slices.** Walk the PRD's `## User Stories` and `## Functional Requirements`. Group them into vertical, end-to-end slices where each slice:

- Delivers a **single user-visible capability** stated as "user can …".
- Touches every layer needed to make that capability real (data + logic + interface), top to bottom.
- Is small enough that one `/10x-plan` invocation produces a tractable plan, but big enough that the slice is meaningful on its own (a slice is generally one US-NN, occasionally two when they're tightly coupled — e.g., "create" and "list" of the same entity).

Do NOT slice horizontally ("the database slice", "the API slice", "the UI slice"). Horizontal slices are the anti-pattern this skill exists to prevent. The default decomposition is vertical-first: each user-facing slice should produce a usable capability that an agent can implement and verify end-to-end. Horizontal work is allowed only as a named Foundation with an explicit downstream reason.

Slice IDs are `S-NN` (zero-padded two-digit, starting at `S-01`).

Each `F-NN` and `S-NN` also gets a stable **Change ID** in kebab-case. The Change ID is the bridge into `/10x-plan` and, later, a backlog item in Jira/Linear. Prefer concise, outcome-oriented names such as `first-gated-generation`, `minimal-auth-for-generation`, or `srs-review-session`.

**Slice granularity and balance.** Roadmap slices should be roughly comparable in planning effort and conceptual weight, even though they do not carry estimates. Avoid one slice that absorbs most of the PRD while later slices are tiny polish items. If one candidate slice references many must-have FRs or multiple unrelated user stories, split it along user-visible outcomes, workflow phases, personas, or risk boundaries until each `S-NN` is something one `/10x-plan <change-id>` can reason about coherently.

Use these split triggers:

- A slice covers more than one primary user action (e.g., "import, edit, share, and report").
- A slice combines setup, core workflow, and administration in one item.
- A slice satisfies most of the must-have FRs while other slices have only one minor FR each.
- A slice's Risk line contains more than one independent risk.
- A slice needs unrelated unknowns owned by different people or layers.

Do NOT split by layer to fix size. Split by narrower vertical outcomes. For example, replace "complete recipe system" with "user can save the first recipe", "user can search saved recipes", and "user can share a recipe" — not "recipe schema", "recipe API", and "recipe UI".

**6c. Build the dependency graph.** For each slice and foundation, identify Prerequisites:

- **Other foundation IDs** the slice needs in place (e.g., S-03 needs F-01 auth).
- **Other slice IDs** whose data or capabilities this slice consumes (e.g., S-04 "rate a recipe" depends on S-03 "see recipes").
- **External state** (e.g., "a seeded ingredient table"). Concrete, not vague.

For every foundation, also identify **Unlocks**:

- one or more downstream `S-NN` vertical slices the foundation directly enables, OR
- one or more blocking Unknowns it reduces, OR
- one or more named verification paths required by a downstream slice.

If a foundation has no clear Unlocks, remove it or fold the work into the first vertical slice that needs it.

Then for each item, derive **Parallel with** — the slices whose Prerequisites are a subset or sibling of this slice's Prerequisites and which don't depend on it. AI agents can fan out across these. If two slices share zero dependencies and neither blocks the other, they're parallel. When the #1 blocker (Step 5) is **capacity**, be especially generous in computing parallel-with — it's the user's most actionable lever.

**6d. Topological sort, biased by main goal.** Foundations first (in dep order among themselves), then slices in dep order. Place the **north star** slice as early as its Prerequisites allow — don't defer it for symmetric ordering. Then bias ties by main goal (Step 5):

- **Market feedback** → ties broken in favor of the slice that surfaces the riskiest assumption (often integration or domain logic). Surfacing risk early matters more than maximizing demo value of slice 1.
- **Quality / craft** → Foundations sequenced more eagerly; observability and access-control foundations are NOT deferred behind user-facing slices.
- **Low complexity / quick win** → ties broken in favor of the smallest viable slice; aggressive Parking.
- **Speed to launch** → strict must-have path first; non-essentials get Parked, not sequenced late.
- **Learn the tech / explore** → ties broken in favor of slices that exercise unfamiliar tech earliest; learning value counts as user value here.

If `## Open Roadmap Questions` includes a sequencing-relevant decision (e.g., "do we ship for mobile first?"), do NOT pick a sequence that prejudges the answer — leave the affected slices as `Status: blocked` until the question resolves.

**6e. Identify blocking unknowns.** For each slice, list:

- **Blockers** (external, pending) — vendor approval, design asset, stakeholder decision. If none, write `—`. The Step 5 "External" #1-blocker answer feeds these.
- **Unknowns** (questions to research) — things the roadmap can't answer that `/10x-plan` shouldn't try to either. Each unknown carries: question, owner, blocking-status (yes/no — is planning blocked until this resolves?). The Step 5 "Decisions" #1-blocker answer feeds these.

A slice with `Status: blocked` exists when at least one Unknown has `Block: yes`. The roadmap's job is to surface these so the user can resolve them before `/10x-plan` is wasted on a slice that can't be planned.

**6f. Generate `## Open Roadmap Questions`.** Two sources:

- PRD's `## Open Questions` — copy verbatim, renumber if needed. These are still open.
- New questions surfaced during Step 5 that span multiple slices ("should we actually ship for mobile?").

Per-slice unknowns stay in the slice; cross-cutting ones live here.

**6g. Generate `## Parked`.** Lift PRD's `## Non-Goals`. Also append anything Step 5 surfaced as deferred — particularly when the main goal is **speed to launch** or the #1 blocker is **time/capacity**, this section grows. Each entry: one-line item, one-line rationale.

**6h. Derive `## Streams` (navigation aid).** Streams are a *derived view* over the dependency graph — they do NOT replace the topological order in `## Foundations` + `## Slices` and introduce no new IDs. Their job: give a reader the proposed reading order across parallel tracks in one screen. Derivation: one stream per foundation that anchors a distinct Prerequisites chain (`F-NN` → the slices listing it in Prerequisites, in dep order); a slice with no foundation prerequisite is its own one-item stream (never a "Misc" bucket); a slice depending on multiple streams' heads joins the most-derived one, with the join named in that stream's note ("joins Stream A at S-01") — never duplicated across streams. Emit one markdown-table row per stream — `Stream | Theme | Chain | Note` — Chain joining existing Roadmap IDs with `→`, Theme descriptive not promotional ("Review loop", not "The killer feature"), Note one clause tying the stream to `main_goal` or naming a join. Cap: 2-5 streams — more means the graph is over-segmented (fold single-slice streams into an adjacent foundation's stream); fewer than 2 means the topological order already reads cleanly, so omit the section. Streams are NOT canonical: on any conflict, the topological order wins and the stream definition is wrong.

### Step 7: Emit roadmap content

Use this exact template (section names are the contract; downstream tooling and `/10x-plan` may grep for them):

````markdown
---
project: <from PRD frontmatter>
version: 1
status: draft                    # draft | active | locked
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
prd_version: <int from PRD frontmatter, or `—` for non-PRD sources>
main_goal: <market-feedback | quality | low-complexity | speed | learn | other>
top_blocker: <skills | capacity | time | decisions | external | motivation | none>
milestone_id: <kebab-case, outcome-oriented — e.g. first-usable-deck>
milestone_seq: <int, 1 for the first milestone>
milestone_status: open           # open | done
---

# Roadmap: <Project>

> Derived from <source materials> + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-<seq>: <Milestone name>** — Status: open

- **Intent:** <1-2 sentences: the outcome this milestone proves or delivers — outcome-scoped, no dates>.
- **Source materials:** <`context/foundation/prd.md` (v<N>) | listed doc paths | "user description (anchors below)">
- **Done when:** every F-NN and S-NN below is `done`<, plus any explicit acceptance line the user gave>.
- **Scope anchors:** <PRD IDs this milestone draws from (FR-NNN, US-NN ranges) — or, for description-sourced milestones, numbered `MS-NN` items distilled verbatim from the user's description:>
  - MS-01: <one scope statement>
  - MS-02: <…>
  (Omit the MS list entirely when the source is a PRD or other document.)

## Vision recap

<2-3 sentences lifted from PRD's Vision & Problem Statement. NOT a re-statement —
just enough that a reader can orient without opening prd.md.

If the recap leans on a product-strategy term — most commonly "wedge", but also
"beachhead", "primary metric", "validation milestone", "north star" — define it
inline on first use, in one short sentence in plain language. Example:
"The product wedge — the one trait that, if removed, makes the product
indistinguishable from a generic AI tool — is that cards must be both
AI-grounded in the learner's own pasted text and human-gated before they
land in the deck." A reader who has not taken a product-strategy course must
be able to read the section cold.>

## North star

**<Slice ID>: <Outcome>** — <one sentence on why this is the validation milestone, tied to main_goal>.

> A reader-facing one-liner explaining what "north star" means here: the smallest
> end-to-end slice whose successful delivery would prove the core product hypothesis
> — placed as early as Prerequisites allow because everything else only matters
> if this works. Include this gloss the FIRST time "north star" appears in the
> document body; do not repeat it later.

## At a glance

| ID    | Change ID              | Outcome (user can …)              | Prerequisites    | PRD refs       | Status   |
| ----- | ---------------------- | --------------------------------- | ---------------- | -------------- | -------- |
| F-01  | <kebab-case-change-id> | (foundation) <foundation outcome> | —                | NFR-XX         | proposed |
| F-02  | <kebab-case-change-id> | (foundation) <foundation outcome> | F-01             | NFR-YY         | proposed |
| S-01  | <kebab-case-change-id> | <user-can outcome>                | F-01             | US-01, FR-001  | ready    |
| S-02  | <kebab-case-change-id> | <user-can outcome>                | S-01             | US-02, FR-003  | proposed |
| S-03  | <kebab-case-change-id> | <user-can outcome>                | S-01, F-02       | US-03, FR-005  | blocked  |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme              | Chain                          | Note                                                      |
| ------ | ------------------ | ------------------------------ | --------------------------------------------------------- |
| A      | <Theme>            | `F-01` → `S-01` → `S-02`       | <One-line rationale tying the stream to main_goal.>       |
| B      | <Theme>            | `F-02` → `S-03`                | <Joins Stream A at `S-NN` if applicable, else standalone.> |
| C      | <Theme>            | `S-NN`                         | <Standalone slice with no foundation prerequisite.>       |

(2–5 streams; every `F-NN` and `S-NN` appears in exactly one stream. Omit this section entirely if the dep graph is too small for streams to add value — see Step 6h.)

## Baseline

What's already in place in the codebase as of `<YYYY-MM-DD>` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** <present | absent | partial> — <one line, file pointer if present>
- **Backend / API:** <…>
- **Data:** <…>
- **Auth:** <…>
- **Deploy / infra:** <…>
- **Observability:** <…>

## Foundations

### F-01: <Foundation title>

- **Outcome:** (foundation) <one sentence on what's now in place — not user-visible>.
- **Change ID:** <kebab-case-change-id>
- **PRD refs:** <NFR-NN, Access Control section, etc. — be specific>
- **Unlocks:** <downstream S-NN IDs, blocking unknown IDs/questions, or named verification paths>
- **Prerequisites:** <slice/foundation IDs and external state — or `—`>
- **Parallel with:** <IDs that can run alongside, or `—`>
- **Blockers:** <external pending, or `—`>
- **Unknowns:** <questions, or `—`>
- **Risk:** <one line: why sequenced here, what could go wrong>
- **Status:** proposed | ready | blocked

(Repeat for each F-NN.)

## Slices

### S-01: <Slice title>

- **Outcome:** <user can …>
- **Change ID:** <kebab-case-change-id>
- **PRD refs:** <FR-NNN, US-NN, NFR-N — every must-have FR this slice satisfies, every US-NN it advances>
- **Prerequisites:** <slice/foundation IDs and external state>
- **Parallel with:** <IDs, or `—`>
- **Blockers:** <external pending, or `—`>
- **Unknowns:**
  - <question> — Owner: <user|team|TBD>. Block: <yes|no>.
  - (or `—` if none)
- **Risk:** <one line>
- **Status:** proposed | ready | blocked

(Repeat for each S-NN, in dependency order.)

## Backlog Handoff

| Roadmap ID | Change ID              | Suggested issue title         | Ready for `/10x-plan` | Notes |
| ---------- | ---------------------- | ----------------------------- | --------------------- | ----- |
| F-01       | <kebab-case-change-id> | <issue title for Jira/Linear> | no                    | <why or `—`> |
| S-01       | <kebab-case-change-id> | <issue title for Jira/Linear> | yes                   | Run `/10x-plan <change-id>` |

This table is the clean handoff to Jira/Linear or any MCP-backed backlog. Include one row for every `F-NN` and `S-NN`. It should be compact enough to copy into issues, but it must not duplicate the detailed roadmap body.

## Open Roadmap Questions

1. **<Question>** — Owner: <who>. Block: <which slice IDs this gates, or `roadmap-wide`>.
2. ...

(Each entry mirrors PRD's `## Open Questions` shape. Per-slice unknowns stay in the slice.)

## Parked

- **<Item>** — Why parked: <PRD §Non-Goals reference, or rationale from interview>.
- ...

## Milestone History

(Append-only. Carried forward verbatim into each successor milestone's roadmap; empty on the very first milestone. Closure entries are written by this skill's `READY_TO_CLOSE → CLOSED` transition. Format:)

- **M-<seq>: <Milestone name>** (`<milestone_id>`) — closed <YYYY-MM-DD>. <One-line outcome.>

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived. Do NOT pre-populate. Format:)

- **<Slice ID>: <Outcome>** — Archived <YYYY-MM-DD> → `context/archive/<YYYY-MM-DD-change-id>/`. Lesson: <pointer to lessons.md if any, or `—`>.
````

**Field semantics, in detail:**

- **Outcome** is verb-led. Slices: *"user can sign in and see an empty fridge"*. Foundations: *"(foundation) auth scaffold landed; tokens issued via configured provider"*. Never a noun phrase ("authentication system"); always a state-of-the-world declarative.
- **Change ID** is kebab-case, stable, and suitable for `context/changes/<change-id>/`. Do not use `F-01` / `S-01` as the change id; those are roadmap-local order IDs.
- **Unlocks** appears only on Foundations. It names the downstream reason this Foundation exists: specific `S-NN` slices, blocking unknowns, or verification paths. A Foundation without Unlocks is horizontal drift.
- **PRD refs** uses the literal IDs from PRD (`FR-001`, `US-01`, `NFR-02`). Don't paraphrase. Every must-have FR in PRD must appear in at least one slice's PRD refs after Step 8 self-review.
- **Prerequisites** mixes slice IDs (`S-01`, `F-02`) and external state, comma-separated. External state is plain English ("seeded ingredient table", "design tokens published"). One field, not split.
- **Parallel with** is informational. Computed from the dep graph: any slice X where my Prerequisites and X's Prerequisites have no path between them. Empty = `—`.
- **Blockers** is *external pending* only (vendor, design, stakeholder decision). Things the team can't unilaterally resolve. If the team CAN resolve it, it's an Unknown, not a Blocker.
- **Unknowns** is questions to research. Each carries Owner and Block flag. Block=yes promotes the slice's Status to `blocked`.
- **Risk** is one line: why sequenced here, what could go wrong, why this is the safer order than alternatives. Not a postmortem. Not catastrophizing. Just the load-bearing reason a future reader needs to understand the sequence.
- **Status** lifecycle: `proposed` (default on first generation) | `ready` (Prerequisites all met, no blocking unknowns — `/10x-plan` can run) | `planning` | `in-progress` | `done` | `blocked` (one or more unknowns with `Block: yes`). This skill emits only `proposed`, `ready`, and `blocked` on generation; the rest are written downstream (see "Relationship to other skills"), best-effort and forward-only.
- **Frontmatter `main_goal` / `top_blocker`** record Step 5 answers so a future re-read (or a reviewer) can see the sequencing bias at a glance without opening the conversation history.

**Hard rule — never invent slices.** Every slice must trace to a source-anchor ID (guardrail 1). If the interview surfaced something the sources don't declare ("oh and we also need offline mode"), it does NOT become a slice — it becomes an Open Roadmap Question (real gap) or a Parked entry (explicitly deferred). The roadmap sequences what the sources declare; it does not grow them.

**No time units. No estimates. No complexity scores.** (Guardrail 5.) Order is encoded in Prerequisites; pacing in Blockers and Unknowns. Wanting to write "this should take a few hours" means you've drifted into `/10x-plan`'s territory — stop.

### Step 8: Self-review

Before any disk write, verify the in-memory roadmap:

1. **Frontmatter** — all 11 keys present (`project`, `version`, `status`, `created`, `updated`, `prd_version`, `main_goal`, `top_blocker`, `milestone_id`, `milestone_seq`, `milestone_status`).
2. **Required sections** — these `##` headings exist, in this order: `Milestone`, `Vision recap`, `North star`, `At a glance`, `Streams` (optional — present iff Step 6h decided streams add value), `Baseline`, `Foundations`, `Slices`, `Backlog Handoff`, `Open Roadmap Questions`, `Parked`, `Milestone History`, `Done`. With `Streams` present the count is 13; without it, 12.
3. **Per-entry schema** — every S-NN has the 9 mandatory fields (`Outcome`, `Change ID`, `PRD refs`, `Prerequisites`, `Parallel with`, `Blockers`, `Unknowns`, `Risk`, `Status`). Every F-NN has those fields plus `Unlocks`.
4. **PRD coverage** — every PRD `must-have` FR (grep `^- FR-\d{3}: .* must-have$`) appears in at least one slice's `PRD refs`. Same for every `### US-NN:`. If a must-have isn't covered, the self-review FAILS.
5. **Dependency graph integrity** — no cycles. Every ID listed in `Prerequisites` exists somewhere in the doc. The order in `## Foundations` and `## Slices` is a topological sort: no slice depends on something that comes after it.
6. **At-a-glance table parity** — table rows match section bodies. Each row's `Change ID`, `Prerequisites`, `PRD refs`, `Status` match the body fields verbatim.
7. **Status consistency** — every `blocked` slice has at least one Unknown with `Block: yes`. Every `ready` slice has all Prerequisites already in `done` state (today this means: no Prerequisites, OR Prerequisites are all foundations the baseline reports as `present`).
8. **No invented slices** — every slice's `PRD refs` contains at least one real source-anchor ID: a PRD ID (`FR-\d{3}` or `US-\d{2}`) for PRD-sourced milestones, or an `MS-\d{2}` charter anchor for description-sourced ones. Mixed sources may mix ID kinds, but every anchor must exist in the source document or the `## Milestone` charter.
9. **Baseline ↔ Foundations consistency** — no Foundation re-scaffolds a layer the `## Baseline` section reports as `present`. If the baseline says auth is present and there's still an `F-NN` for auth scaffold, that's a self-review failure (either the baseline is wrong or the foundation is redundant).
10. **Foundation enabler contract** — every Foundation has `Unlocks` populated with at least one downstream `S-NN`, a named blocking unknown, or a named verification path. A generic foundation such as "database layer" without a downstream reason is a self-review failure.
11. **Change ID integrity** — every F-NN and S-NN has a unique kebab-case `Change ID`; every F-NN and S-NN appears exactly once in `## Backlog Handoff`; every handoff row references an existing roadmap ID and repeats the same Change ID. No spaces, dates, status labels, or roadmap IDs as change IDs.
12. **Slice granularity balance** — no `S-NN` may absorb the majority of a non-trivial PRD while sibling slices are narrow leftovers. If one slice references most must-have FRs, more than two unrelated US-NN entries, multiple primary user actions, or unrelated risks/unknowns, the self-review FAILS unless the PRD truly has only one user-visible workflow. Fix by splitting into narrower vertical outcomes, not by creating layer slices.
13. **Foundation scope cap** — no Foundation may complete an entire layer in advance. The Outcome and Risk must show a minimal enabler contract, and `Unlocks` must name vertical slices that will still integrate that layer through user-facing behavior. If the Foundation reads like "build the data/API/UI/auth layer", the self-review FAILS. Split it, narrow it, or fold the minimum needed work into the first consuming `S-NN`.
14. **Progressive disclosure of technical elements** — each cross-cutting technical element appears either in the first vertical slice that needs it or in a Foundation that is required before that slice can be planned, verified, or made safe. If a technical element is introduced only because it will be useful later, the self-review FAILS and that work moves into the first slice that actually uses it.
15. **Streams coverage** (only if a `## Streams` section was emitted) — every `F-NN` and every `S-NN` listed in `## At a glance` appears in exactly one stream's `Chain` cell. Duplicates and omissions both fail. The Chain cells only reference existing Roadmap IDs (no invented IDs). Stream count is 2–5. If the doc has < 2 candidate streams, the section should have been omitted (Step 6h cap).
16. **Milestone integrity** — `milestone_status` is `open` on generation; `milestone_seq` is 1 greater than the highest closed `M-<seq>` in `## Milestone History` (1 when history is empty); the `## Milestone` charter's `M-<seq>` matches `milestone_seq`; every `MS-NN` anchor referenced by any slice exists in the charter; `## Milestone History` was carried forward verbatim (never edited, never truncated) on regeneration and next-milestone opening.
17. **Strategic terms are defined inline** — scan the emitted body for guardrail 13's jargon list; every listed term that appears must carry its one-sentence definition on **first** occurrence (identifier-style IDs like `FR-001`/`S-02` and proper names of tools/services are exempt). An undefined first use FAILS; a term that can't be defined in one sentence is replaced with plain language and re-emitted.

If any check fails, **abort the write** and report the specific failure:

```
Roadmap self-review FAILED:

  - <specific failure, e.g., "FR-007 (must-have) is not covered by any slice"
     or "Slice S-04 lists S-06 in Prerequisites, but S-06 comes later in the doc"
     or "F-02 (auth scaffold) is redundant — Baseline reports auth as present">
  - ...

The roadmap was NOT written. Fix the failure and regenerate, or — if a check is
wrong — file a skill bug. Self-review aborts protect downstream tooling from
drift.
```

Then STOP.

### Step 9: Collision check

```bash
test -f context/foundation/roadmap.md
```

If the file does not exist, write to `context/foundation/roadmap.md` and proceed to Step 10.

If the file exists, the foundation-doc convention is **edit-in-place** for incremental refinement, **archive-then-replace** for full regeneration. This skill produces a *full* roadmap from PRD; surgical refinement is out of scope. So default to archive-then-replace, but ask with the selected interactive-question tool:

Interactive question:
- question: "context/foundation/roadmap.md already exists. How would you like to proceed?"
  header: "Collision"
  options:
  - label: "Archive and replace (Recommended)"
    description: "Move existing to context/foundation/archive/<today>-roadmap.md, then write the new roadmap. History preserved per foundation README convention."
  - label: "Overwrite without archiving"
    description: "Replace in place. Existing content is lost (unless you've committed it). Use only if the existing roadmap is empty or scratch."
  - label: "Cancel"
    description: "Exit without writes. No collision resolution."
  multiSelect: false

On "Archive and replace": create `context/foundation/archive/` if missing, move the existing file to `context/foundation/archive/<today>-roadmap-<milestone_id>.md` (today's date in `YYYY-MM-DD`; drop the `-<milestone_id>` suffix for legacy files without one), then write the new content. If a file already exists at that archive path (regenerated twice in one day), append `-2`, `-3`, etc.

On "Overwrite without archiving": write the new content, overwriting in place.

On "Cancel": STOP.

### Step 10: Hand off

After the write lands, summarize:

```
═══════════════════════════════════════════════════════════
  ROADMAP GENERATED
═══════════════════════════════════════════════════════════

  Project:           <project>
  Milestone:         M-<seq>: <name>  (<milestone_id>)  —  open
  Path:              context/foundation/roadmap.md
  Main goal:         <main_goal>            (sequencing bias)
  #1 blocker:        <top_blocker>          (what to plan around)
  Baseline present:  <comma-separated layers reported present>
  Foundations:       <count>
  Slices:            <count>
  Status breakdown:  ready: N  |  proposed: M  |  blocked: K
  PRD coverage:      <covered must-have FRs> / <total must-have FRs>
  Open Roadmap Q:    <count>
  Parked items:      <count>

  North star:  <Slice ID> — <Outcome>

═══════════════════════════════════════════════════════════
```

Then **recommend a single next move** — don't hand back a "ready" list and ask the user to choose. Pick the one roadmap item to plan first and justify it in one line. The user can override, but the default surface is a recommendation, not a menu.

**Selection rule for the recommended next move** (apply in order, first match wins):

1. If the north star is `ready`, recommend it. The north star is the validation milestone; deferring it loses signal.
2. Else if a Foundation the north star directly depends on is `ready`, recommend that Foundation, and explicitly say "this unlocks the north star <S-NN>".
3. Else if no slice is `ready`, recommend resolving the highest-leverage Open Question or Blocker (the one that unblocks the most downstream items). No planning move is available until then.
4. Else recommend the `ready` slice that unblocks the most downstream items (highest fan-out in the dep graph). Tie-break by main goal (Step 6d).

Format:

```
► **Your next move:** `/10x-plan <change-id>` on **<Roadmap ID>: <Outcome>**.

  Why this one first: <one sentence — load-bearing reason: it IS the north
  star / it unblocks the north star / it has the highest fan-out / it's the
  smallest end-to-end validation we can ship now>.

  After that, in order: <next ready ID>: <Outcome> → <next>: <Outcome>.
  (Full list in `## Backlog Handoff`.)

  Blocked — stay parked until their Unknowns resolve:
    - <Slice ID>: <Unknown> (Owner: <who>)
    - ...
  (Resolving any of these promotes its slice to `ready` and changes my
  recommendation; come back and I'll re-recommend.)
```

If no slice is `ready` and no Foundation is `ready` either (case 3), replace the recommendation with:

```
► **No planning move is available yet.** Every slice is blocked.
  Highest-leverage unknown to resolve next:

    <Question> — Owner: <who>. Unblocks: <S-NN, S-MM, ...>.

  Resolving this promotes <count> slices and is the single change that
  most opens the roadmap. Resolve it, then re-invoke `/10x-roadmap` to
  re-recommend.
```

STOP. Do not chain into another skill automatically — the user picks when to plan. But do NOT degrade the recommendation into a multiple-choice list; if the user wants a different slice, they say so.

## Critical guardrails

1. **Source materials are the source.** Every slice traces to a source-anchor ID — PRD IDs (`FR-NNN`/`US-NN`) for PRD-sourced milestones, `MS-NN` charter anchors for description-sourced ones. Step 5's framing surfaces goal/north-star/investment/blocker context inferred from the sources; the baseline surfaces what already exists; neither grows the sources. Roadmap items without a source trace are a self-review failure.

2. **Vertical slices first.** A slice delivers user-visible capability end-to-end. Horizontal slices ("the API layer", "the schema") are the anti-pattern this skill exists to prevent. Foundations are the *only* exception — they are explicitly cross-cutting enablers, live in their own section, carry `Unlocks`, and are marked `(foundation)` so no reader confuses them with user-facing work.

3. **Balanced granularity without estimates.** Slices do not get size labels, but their scope still has to be comparable. A roadmap where `S-01` contains nearly the whole PRD and `S-02`/`S-03` are minor leftovers is a bad roadmap. Split oversized items by narrower user-visible outcomes, workflow phases, personas, or risk boundaries — never by technical layer.

4. **Foundations are minimal unlocks, not layer-completion projects.** A foundation may create the smallest prerequisite needed before vertical work can proceed. It may not prebuild the whole database/API/UI/auth layer. If a technical element can be introduced inside the first user-facing slice that needs it, put it there; this keeps integration vertical and progressively reveals only the needed elements.

5. **No estimates, no time units.** No "Day 1", no "2 weeks", no "small/medium/large", no points. AI-agent execution is non-linear and time-budgeted estimates lie. Order is encoded in Prerequisites; pacing surfaces via Blockers and Unknowns. The roadmap describes shape, not schedule.

6. **No low-level technical details.** No frameworks named (those live in `tech-stack.md`), no file paths, no schema definitions, no code, no library choices. If you find yourself writing those, you've crossed into `/10x-plan`'s territory — stop and let `/10x-plan` do its job downstream.

7. **Surface unknowns, don't paper over them.** Per-slice Unknowns with `Block: yes` promote `Status: blocked`. Cross-cutting unknowns land in `## Open Roadmap Questions`. If the PRD has TODOs, the roadmap inherits them as blocked-slice unknowns. The roadmap's value is partly in showing the user what's NOT yet plannable.

8. **Baseline is auto-researched, not asked.** Don't ask the user "what's already in place?" — spawn parallel Explore subagents (Step 4) and let the codebase answer. Then ask the user only to confirm or correct. This is the contract that makes Foundations honest: a foundation only exists when the baseline says the layer is absent or partial.

9. **Self-review aborts on drift.** Missing required sections, broken dep graph, uncovered must-have FRs, invented slices, oversized slices, Foundation layer-completion, Baseline-vs-Foundations contradictions — all abort the write with a specific error. No silent patch-up.

10. **Foundation-doc convention.** `roadmap.md` is a foundation doc per `context/foundation/README.md`. Default collision handling is archive-then-replace (history goes to `foundation/archive/<today>-roadmap.md`); surgical refinement is out of scope for this skill (edit by hand if you need it).

11. **Universal language only.** No 10xDevs / cohort / certification references in any user-facing output or any artifact written to disk. The skill is a generic roadmap generator.

12. **Never chain automatically.** Step 10 is an announcement, not an invocation. The user picks when (and which) slice to feed to `/10x-plan`. Auto-chaining would skip the human's review of the generated roadmap.

13. **Define strategic terms inline on first use.** Product-strategy vocabulary — `wedge`, `beachhead`, `north star`, `validation milestone`, `primary metric`, `must-have path`, `product-market fit`, `thin end of the wedge`, `riskiest assumption`, `core hypothesis` — is skill- and PRD-internal shorthand, not common knowledge; the roadmap must read cold to a teammate (or future-you) who has not taken a product-strategy course. On the FIRST occurrence of any such term in the document body, attach a one-sentence definition inline (parenthetical, em-dash gloss, or short follow-on sentence); do not repeat it later. If a concept can't be defined in one sentence, replace it with plain language ("the smallest end-to-end flow that proves the product works" beats "the wedge" you can't compress into one clause). Applies to user-facing prose in the emitted document — not to interview questions (5g covers those) or this file's own field semantics. Self-review check #17 enforces it.

14. **Lean interview with strong Recommends — not silent auto-framing, not unbounded discovery.** Step 5's rules are normative: at most 3 anchor questions (`main_goal`, `north_star`, `top_blocker`), investment areas derived not asked, every question one Recommend grounded in a quoted artifact line plus 1-2 real alternatives (strawmen forbidden), skips only when the artifacts literally state the value, follow-ups only under the custom-MVP exception (5f). Step 10's recommended-next-move is the same principle applied to the hand-off: one recommendation with a one-line reason, not a "ready to plan" list the user has to triage.

15. **Milestones loop, but never time-box.** Exactly one milestone open at a time; it closes only when every F-NN/S-NN is `done` (or the user explicitly abandons it), then the loop reopens with fresh source materials or a user description. Milestone state is derived from `roadmap.md` alone — no sidecar files. The lifecycle spec lives in `references/milestone-state.md`, loaded ONLY for milestone-level operations (Step 0 dispatch). Downstream skills stay milestone-blind; this skill detects milestone completion on its next invocation.

## Notes

- This skill is a **document generator plus milestone tracker**. Output is `context/foundation/roadmap.md`, period. Per-change planning lives downstream in `/10x-plan`.
- The baseline probe (Step 4) replaces what used to be a "what's already in place?" question. Subagents are cheaper than the user's attention, and the codebase is more reliable than memory.
- When the skill regenerates an existing roadmap, the archived previous version is the cleanest diff target for seeing how the project's understanding changed — that's the affordance the foundation-doc convention is designed for.
