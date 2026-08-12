---
project: "Storygen"
context_type: greenfield
created: 2026-08-11
updated: 2026-08-11
product_type: web-app
target_scale:
  users: small          # mechanically mapped from the Phase 1 decision "single named user (the author)"
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 1
  hard_deadline: null   # never stated; recorded as absent, NOT as a decision that no deadline exists
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "primary persona scope"
      decision: "single named user (the author); login exists as a learning goal, not a product need"
    - topic: "trigger moment"
      decision: "conversation/meeting — joke on a topic, immediately; plus exploratory play with no deadline"
    - topic: "pain category"
      decision: "missing capability — nothing enforces a format contract (length, punchline, structure)"
    - topic: "insight vs status quo"
      decision: "tools of this class exist; value is (a) walking the full technical path as learning, (b) the enforced format contract"
    - topic: "project name"
      decision: "Storygen"
    - topic: "auth mode"
      decision: "email + password login; session persists; explicit sign-out"
    - topic: "registration openness"
      decision: "open registration, bounded by a hard per-user daily generation limit (residual cost risk logged in Open Questions)"
    - topic: "role separation"
      decision: "flat user model, one user type; no admin role in MVP"
    - topic: "gated route behavior"
      decision: "unauthenticated access redirects to sign-in, then returns to the requested route"
    - topic: "save + history vs scope criterion #1"
      decision: "kept in MVP as an explicit override — persistence is on the learning happy path, not the product happy path"
    - topic: "daily generation limit"
      decision: "kept in MVP — only cost barrier available given open registration"
    - topic: "secondary success criterion"
      decision: "product reachable by anyone given its address, not only from the machine it was built on"
    - topic: "guardrail"
      decision: "generation-provider credentials never observable from the client"
    - topic: "FR priorities"
      decision: "all FRs are must-have by explicit choice (twelve at the time, thirteen after FR-013 was added); no scope buffer"
    - topic: "Socratic round scope"
      decision: "reduced to three load-bearing FRs (FR-003, FR-004, FR-012); all three resolved on re-entry 2026-08-11, the other ten never challenged"
    - topic: "FR-003 topic ceiling"
      decision: "lowered from 200 to 80 characters so the field forces a topic, not an instruction"
    - topic: "FR-004 story format grounding"
      decision: "both formats kept on a technical justification — the longer form exercises the format contract harder; persona grounding gap accepted knowingly"
    - topic: "cost bound"
      decision: "FR-013 added — application-wide daily ceiling across all accounts; registration stays open"
    - topic: "password storage"
      decision: "captured as an NFR — a stored password is never recoverable; mechanism left to downstream"
  frs_drafted: 13
  quality_check_status: accepted
---

# Shape Notes

_Session started 2026-08-11. Context type locked to `greenfield` (no project markers found in cwd; user passed `greenfield` explicitly)._
_Seed input: `idea-notes.md` (read in full at session start)._

**Session provenance note.** Phases 1–4 were captured through an interactive discovery round. The Socratic round (Phase 4.5) was reduced to three load-bearing FRs at the author's request; it was initially left unanswered, then **re-entered on 2026-08-11**, where all three challenges were resolved and one new requirement (FR-013) was added. The same re-entry resolved the password-storage gap. Phases 5–6 were assembled from content the author had already written in `idea-notes.md` rather than through a fresh interactive round; nothing in them is invented, but the gray-area questions those phases normally ask were not put to the author, so `## Business Logic`, `## Non-Functional Requirements`, and `## Non-Goals` carry no recorded counter-positions.

Scrutiny is uneven across the document, and a reader should know where. **Challenged and resolved:** FR-003, FR-004, FR-012 (see their blockquotes), plus the Phase 1 insight and the Phase 2 access model. **Never challenged:** the remaining ten FRs (FR-001, FR-002, FR-005 through FR-011, FR-013) and everything in Phases 5–6. Every schema-required section is present and populated from the author's own material — the unevenness is in how hard each decision was tested, not in whether it was captured.

Any phase can be re-entered by re-invoking `/10x-shape` and choosing "Resume".

## Vision & Problem Statement

<!-- Phase 1 — captured 2026-08-11 -->

The author needs a short joke on a specific topic within tens of seconds — typically mid-conversation — or a text generated purely for play, with no deadline. Today both paths cost more than they should: a web search returns material adjacent to the topic but never on it, and prompting a language model directly means fighting length, format, and tone by hand, then correcting the result. The pain is a **missing capability**: nothing enforces a format contract on the output.

Tools of this class already exist, and that is recorded deliberately rather than argued away. The value of building this one is twofold: walking the full technical path end-to-end (authentication → generation → persistence → deployment) as a learning objective, and the enforced format contract itself — the application guarantees length and structure (a punchline for a joke; beginning/middle/end for a story) and regenerates output that fails the contract, which an open chat interface does not do.

> Socrates (Phase 1): "A joke generator on top of a language model can be built in a weekend, and many exist — what makes this worth building?" Resolution: the author declined the market-differentiation framing and named learning the full path as the primary motivation, with the format contract as the secondary, real differentiator. Recorded as stated; success criteria therefore shift from product outcomes (retention, return visits) to technical outcomes (the path works end-to-end).

## User & Persona

<!-- Phase 1 — captured 2026-08-11 -->

**Primary persona — the author.** A developer building this project to learn the full web path, working after hours. One real user. Authentication exists because passing through an auth implementation is part of the learning objective, not because the product requires multiple accounts.

The moment they reach for the product:

- **Conversation or meeting** — they need a joke on a topic that just came up, immediately. Perceived latency is a first-class concern here, not cosmetic polish.
- **Boredom / play** — exploratory use with no deadline. Here the accumulated history of generated texts matters more than speed.

Cost of the status quo for this persona: a web search that misses the topic, or manual prompting plus manual correction of the result.

## Success Criteria

<!-- Phase 3 — captured 2026-08-11 -->

**MVP flow (the sequence that proves the product works):**

1. User registers an account (email + password)
2. User enters a topic
3. User picks a format (joke)
4. User picks a length
5. User triggers generation — **value appears here**
6. User copies the result

Five user actions before value, one external integration. Author's estimate: ~1 week of after-hours work. Below the 3-week threshold — no scope-cost surface triggered, no timeline acknowledgment block required.

### Primary

- A newly registered user goes from an empty topic field to a copied joke in a single session, without consulting documentation.
- Both formats produce output: a joke and a story can each be generated from a user-supplied topic.
- Every successful generation appears in that user's history and is still there after signing out and back in.

### Secondary

- The product is reachable by anyone the author gives its address to, not only from the machine it was built on.

### Guardrails

- Credentials for the generation provider are never exposed through the product's own surfaces — nothing a person using the application can view or inspect reveals them. Violation means a third party can spend against the author's account, which is a failure even if every Primary criterion holds.

### Scope-criterion override (recorded deliberately)

`idea-notes.md` criterion #1 admits a feature to the MVP only if the happy path is impassable without it. Saving results, generation history, and the daily limit all fail that test — a joke can be generated and copied without any of them.

All three are kept in the MVP anyway. Rationale: the Phase 1 learning objective is the full path (authentication → generation → **persistence** → deployment), so the persistence layer sits on the *learning* happy path even though it does not sit on the *product* happy path. The daily limit is kept because open registration (Phase 2) leaves it as the only cost barrier in the design.

This is an explicit override of the author's own criterion, not an oversight. Criterion #1 as written in `idea-notes.md` is therefore inaccurate for this project and should be reworded to admit learning-path features.

## User Stories

<!-- Phase 4 — captured 2026-08-11 -->

### US-01: User generates a joke on a topic they supply

- **Given** a signed-in user who has not reached their daily generation limit
- **When** they enter a topic, choose the joke format and a length, and trigger generation
- **Then** they see a joke about that topic on the same screen, can copy it in one action, and find it in their history afterwards

#### Acceptance Criteria

- A topic outside the accepted length range is refused before any generation is attempted, with a message naming the reason
- The produced joke satisfies the joke format contract (within the word ceiling, ending on a punchline); output failing the contract is produced again once before an error is shown
- The result is persisted to the signed-in user's account without an explicit save action
- Copying the result requires a single action and needs no text selection
- A user who has reached their daily limit sees an explanatory message instead of a result, and no generation is attempted

_Only the primary path is written as a user story. Stories for history browsing (FR-010), deletion (FR-011), and the story format (FR-004) were not captured — their acceptance criteria are not yet non-obvious enough to have been discussed._

## Functional Requirements

<!-- Phase 4 — captured 2026-08-11. Socratic round (Phase 4.5) was partial; see annotations. -->

All thirteen FRs are `must-have` by the author's explicit choice — no FR was demoted when the option was offered, and FR-013 was added at `must-have` on re-entry. Consequence recorded: the MVP carries no scope buffer, so if the one-week estimate proves short there is nothing pre-marked to cut.

### Authentication

- FR-001: User can register an account with an email address and a password. Priority: must-have
- FR-002: User can sign in, stay signed in across visits, and sign out. Priority: must-have

### Generation

- FR-003: User can submit a topic between 3 and 80 characters. Priority: must-have
  > Socrates: Counter-argument considered: "at a 200-character ceiling a user can type instructions ('write it in the style of X, five paragraphs') and bypass the format contract, which Phase 1 named as the product's value." Resolution: the ceiling was lowered from 200 to 80 characters. A short field forces a topic rather than an instruction and defends the format contract without adding any new validation logic. Resolved 2026-08-11 on re-entry into Phase 4.5.
- FR-004: User can choose the output format — joke or story. Priority: must-have
  > Socrates: Counter-argument considered: "Phase 1 named two trigger moments — a joke mid-conversation, and play out of boredom — and neither requires a story, so the second format enters the MVP without grounding in the persona." Resolution: both formats kept, on a technical rather than a persona justification, recorded as such — the longer form is harder to hold in structure, so it exercises the format contract (the Phase 1 insight) more severely than a joke does. The persona still does not ground the story format; that asymmetry is accepted knowingly. Resolved 2026-08-11 on re-entry into Phase 4.5.
- FR-005: User can choose the output length from three presets. Priority: must-have
- FR-006: User can trigger generation and read the produced text on the same screen. Priority: must-have
- FR-007: User is told their topic was rejected before any generation is attempted. Priority: must-have
- FR-008: User can copy the produced text to the clipboard. Priority: must-have

### History

- FR-009: User's successful generations are saved to their account with no explicit save action. Priority: must-have
- FR-010: User can browse their own generations newest-first and open any of them in full. Priority: must-have
- FR-011: User can delete a generation from their history. Priority: must-have

### Limits

- FR-012: User is prevented from generating beyond a fixed daily count of their own, and told why. Priority: must-have
  > Socrates: Counter-argument considered: "with open registration (Phase 2), N accounts × the per-user daily limit leaves total spend unbounded, so this FR does not achieve what it was added for." Resolution: FR-012 is kept as the per-account fairness bound, and FR-013 was added as the actual cost bound. Registration stays open — the Phase 2 decision was not reversed. Resolved 2026-08-11 on re-entry into Phase 4.5.
- FR-013: User is refused generation once an application-wide daily ceiling across all accounts is reached, and told why. Priority: must-have

_Ten of the thirteen FRs (FR-001, FR-002, FR-005 through FR-011, FR-013) carry no Socratic annotation: the round was reduced to the three load-bearing FRs at the author's request, and those ten were never challenged._

## Non-Functional Requirements

<!-- Phase 5 — assembled from idea-notes.md's definition-of-done, reframed to outer-boundary form -->

- A user perceives a completed short or medium-length generation within 15 s, and a long generation within 30 s. Beyond that they receive a message; the interface never becomes unresponsive.
- Continuous visible progress is shown for the whole duration of any generation, so the user is never left unsure whether the request is alive.
- No generation is readable by any account other than the one that produced it. An attempt to read another account's generation is refused.
- Reaching either the per-account or the application-wide daily generation ceiling produces an explanatory message, never an unhandled error.
- A stored password is never recoverable. Even with full access to everything the application has stored, no user's password can be reconstructed. The mechanism that achieves this is a downstream choice.
- Every failure mode — a timed-out generation, an unavailable provider, a refused topic — is reported in Polish, in plain language, with no internal error text surfaced to the user.
- The product's interface and its generated output are in Polish only.

## Business Logic

<!-- Phase 5 — assembled from idea-notes.md, not from a fresh interactive round -->

**Every generation is bound by a contract of topic, format, length, and tone — the product never passes arbitrary user text straight through to output.**

The rule consumes three user-facing inputs: the topic the user types, the format they pick (joke or story), and the length they pick. Before any generation is attempted, the topic is checked against the accepted range and against disallowed content; a topic that fails is refused with a reason instead of silently producing something.

The rule's output is text that must satisfy the chosen format's structural requirements. A joke stays within roughly sixty words and ends on a punchline. A story stays within roughly four hundred words and carries a beginning, a development, and an ending. Output that fails its format contract is produced again once; if the second attempt also fails, the user gets a readable error rather than a result that breaks the contract.

The user encounters the rule twice in the flow: once as refusal (an unacceptable topic never reaches generation) and once as guarantee (what comes back is shaped, not raw). This is the distinction Phase 1 identified between this product and an open chat interface — the anti-pattern of pure add/view/delete CRUD does not apply, because the application makes a decision about the shape of its own output.

## Access Control

<!-- Phase 2 — captured 2026-08-11. Restored 2026-08-11 after being dropped in a full-file rewrite; content recovered from the Phase 2 capture and checkpoint.gray_areas_resolved. -->

**Login with email + password.** A user registers an account, signs in, and the session persists between visits; sign-out is explicit. Every screen except sign-up and sign-in requires an authenticated session.

**Registration is open**, gated by a hard per-account daily generation limit rather than by an invite list, with an application-wide daily ceiling behind it (FR-013).

**Flat user model — a single user type.** No roles, no admin. An authenticated user sees only their own generations; there is no view onto anyone else's data and no capability to manage another account.

**Unauthenticated access to a gated route redirects to the sign-in screen**, and after a successful sign-in the user lands on the route they originally requested.

> Socrates (Phase 2): "The persona is a single user, so what is the smallest access model that still makes the MVP useful?" Resolution: full email + password login was kept deliberately — the persona is one user, but passing through registration, credential handling, session, and sign-out is the stated learning objective from Phase 1. The access model is therefore larger than the product needs, by choice.

## Non-Goals

<!-- Phase 6 — taken verbatim from idea-notes.md's exclusion list; the interactive multi-select round was not run -->

- **Sign-in through a third-party identity provider, magic links, two-factor, and email-based password reset** — every one adds a second external integration, which the author's own scope criterion forbids. Consequence: a forgotten password strands the account.
- **Sharing and public links** — no public URLs for generated texts, no feed, no trending list, no likes or comments. Keeps the product single-tenant.
- **Export to PDF or DOCX, email delivery, social-media integrations** — all are outbound integrations; the clipboard covers the stated need.
- **Editing and partial regeneration** — no content editor, no "rewrite this paragraph", no versioning of a result. The format contract governs the whole output or nothing.
- **Advanced personalisation** — no custom prompt templates, no model selection, no exposed generation parameters, no genre choice beyond the default neutral tone.
- **More than one language** — a single interface and generation language. This is a non-functional non-goal as much as a functional one.
- **Payments and plans** — no subscriptions, no paid tiers. The daily limit is identical for everyone.
- **Human content moderation, an administration panel, and abuse reporting** — flows from the flat user model decided in Phase 2.
- **Images, voice, audio** — no illustrations for stories, no text-to-speech.
- **Offline mode, a mobile application, a browser extension** — web only.
- **Product analytics and A/B testing** beyond basic error logging.

## Forward: tech-stack

<!-- Not part of the PRD schema. Carried for the downstream tech-stack-selection step. -->

- The persistence store is undecided, and it is load-bearing rather than incidental: FR-009 through FR-011 require generations to survive a sign-out, the Primary success criterion tests exactly that, and the Phase 3 scope-criterion override justified keeping history in the MVP *because* the persistence layer is part of the learning objective. Whatever the downstream choice, it has to support per-account isolation (an NFR) and newest-first retrieval of a user's own records (FR-010).
- Field-level shape of a stored generation is deliberately absent from this document — per the schema, entities and fields are pinned during stack selection and implementation planning, not in the PRD. `idea-notes.md` records the author's own working list (topic, format, length, content, date) if the downstream step wants a starting point.
- Generation provider and model are undecided. The choice drives cost, perceived latency (which the NFRs pin at 15 s / 30 s), and whether the daily limit numbers are sensible.
- Content-safety approach is undecided: an explicit blocked-category list owned by the application, versus relying on the provider's own moderation. This is a stack-shaped consequence of a product rule already captured in Business Logic.
- The mechanism that makes a stored password unrecoverable is undecided. The *property* is settled and lives in the NFRs; picking how it is achieved is a downstream choice.

## Quality cross-check

<!-- Phase 7 — evaluated 2026-08-11, gate closed by the author the same day. Re-verified 2026-08-11 after an error was found: see the correction note below. -->

```
═══════════════════════════════════════════════════════════
  QUALITY CROSS-CHECK
═══════════════════════════════════════════════════════════

  Access Control:           present — email + password, flat user model, open registration
  Business Logic:           present — one declarative sentence, format contract
  Project artifacts:        present
  Timeline-cost ack:        present — mvp_weeks: 1, below the 3-week threshold
  Non-Goals:                present — 11 entries with rationale
  Preserved behavior:       n/a (greenfield)

═══════════════════════════════════════════════════════════
```

All six gate elements pass, and the author asked for the gate to be closed. `quality_check_status: accepted`.

**Correction (2026-08-11).** The first run of this gate reported `Access Control: present` while the `## Access Control` section was in fact absent from this document — it had been dropped during a full-file rewrite after Phase 4, and the gate table was written from the Phase 2 capture rather than from the file on disk. The section has been restored from the Phase 2 capture and `checkpoint.gray_areas_resolved`; no decision content was lost. The gate verdict above is now verified against the file itself, section by section. Lesson for future runs: the Phase 7 check must read back the document, not the session's memory of it.

Two frontmatter values are worth reading with care, because neither came from a direct answer:

- **`target_scale.users: small`** is a mechanical mapping from a decision the author *did* make explicitly in Phase 1 — "single named user (the author)". It is derived, not fabricated. If the intent ever widens beyond one user, this prior is wrong and Phase 1 needs re-entry, because the flat user model, the absence of moderation, and the daily ceilings all rest on it.
- **`hard_deadline: null`** records the *absence* of a stated deadline, not a decision that no deadline exists. The question was put and not answered. A reader should not treat this field as settled.

What is NOT a gap, and is recorded in the session provenance note instead: that ten of thirteen FRs carry no Socratic annotation, and that Phases 5–6 were assembled from the author's prior writing rather than facilitated live. Both are true statements about how this document was produced, not missing content — every PRD section the schema requires is present and populated from the author's own material. They belong to provenance because a reader needs them to judge how much scrutiny each section received, not because the PRD will have holes.

## Open Questions

<!-- Running block. /10x-prd mirrors these verbatim into the PRD's Open Questions section. -->

1. **Are the daily ceiling numbers right, and should the per-account limit differ by format?** A story costs more to generate than a joke, and neither the per-account count (FR-012) nor the application-wide ceiling (FR-013) has a number attached yet. Carried from `idea-notes.md` and extended by the FR-013 decision. Owner: author.
2. **Is length three presets or a word-count slider?** `idea-notes.md` assumed three presets as easier to validate; FR-005 encodes that assumption. Owner: author.
3. **How is a disallowed topic defined** — an application-owned blocked-category list, or the generation provider's own moderation? Carried from `idea-notes.md`. Owner: author.
4. **Is there a hard deadline?** Never asked; `timeline_budget.hard_deadline` is recorded as `null` by default rather than by decision. Owner: author.

_Resolved on 2026-08-11 during re-entry into Phase 4.5, and therefore removed from this list: the FR-003 topic-ceiling bypass (ceiling lowered to 80 characters); the FR-004 ungrounded story format (both kept on a technical justification); the FR-012 unbounded-cost hole (FR-013 added as an application-wide ceiling, which also closes the Phase 2 open-registration cost risk); and password storage (now an NFR — a stored password is never recoverable)._
