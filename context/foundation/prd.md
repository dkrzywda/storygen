---
project: "Storygen"
version: 1
status: draft
created: 2026-08-11
context_type: greenfield
product_type: web-app
target_scale:
  users: small          # derived from the shaping decision "single named user (the author)" — not directly stated; see Open Questions
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 1
  hard_deadline: null   # records the ABSENCE of a stated deadline, not a decision that none exists; see Open Questions
  after_hours_only: true
---

# Storygen — Product Requirements Document

_Generated from `context/foundation/shape-notes.md` (shape heuristic 4/4). Greenfield template, 10 schema sections._

## Vision & Problem Statement

The author needs a short joke on a specific topic within tens of seconds — typically mid-conversation — or a text generated purely for play, with no deadline. Today both paths cost more than they should: a web search returns material adjacent to the topic but never on it, and prompting a language model directly means fighting length, format, and tone by hand, then correcting the result. The pain is a **missing capability**: nothing enforces a format contract on the output.

Tools of this class already exist, and that is recorded deliberately rather than argued away. The value of building this one is twofold: walking the full technical path end-to-end (authentication → generation → persistence → deployment) as a learning objective, and the enforced format contract itself — the application guarantees length and structure (a punchline for a joke; beginning/middle/end for a story) and regenerates output that fails the contract, which an open chat interface does not do.

> Socratic (shaping): "A joke generator on top of a language model can be built in a weekend, and many exist — what makes this worth building?" Resolution: the author declined the market-differentiation framing and named learning the full path as the primary motivation, with the format contract as the secondary, real differentiator. Recorded as stated; success criteria therefore shift from product outcomes (retention, return visits) to technical outcomes (the path works end-to-end).

## User & Persona

**Primary persona — the author.** A developer building this project to learn the full web path, working after hours. One real user. Authentication exists because passing through an auth implementation is part of the learning objective, not because the product requires multiple accounts.

The moment they reach for the product:

- **Conversation or meeting** — they need a joke on a topic that just came up, immediately. Perceived latency is a first-class concern here, not cosmetic polish.
- **Boredom / play** — exploratory use with no deadline. Here the accumulated history of generated texts matters more than speed.

Cost of the status quo for this persona: a web search that misses the topic, or manual prompting plus manual correction of the result.

No secondary persona. The MVP serves the primary persona only, and the flat access model in `## Access Control` rests on that.

## Success Criteria

The flow that proves the product works, as sketched during shaping:

1. User registers an account (email + password)
2. User enters a topic
3. User picks a format (joke)
4. User picks a length
5. User triggers generation — **value appears here**
6. User copies the result

Five user actions before value, one external integration. Author's estimate: ~1 week of after-hours work.

### Primary

- A newly registered user goes from an empty topic field to a copied joke in a single session, without consulting documentation.
- Both formats produce output: a joke and a story can each be generated from a user-supplied topic.
- Every successful generation appears in that user's history and is still there after signing out and back in.

### Secondary

- The product is reachable by anyone the author gives its address to, not only from the machine it was built on.

### Guardrails

- Credentials for the generation provider are never exposed through the product's own surfaces — nothing a person using the application can view or inspect reveals them. Violation means a third party can spend against the author's account, which is a failure even if every Primary criterion holds.

## User Stories

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

Only the primary path was written as a user story during shaping. Stories for history browsing (FR-010), deletion (FR-011), and the story format (FR-004) were not captured — their acceptance criteria were not judged non-obvious enough to warrant discussion at that stage.

## Functional Requirements

All thirteen FRs are `must-have` by the author's explicit choice — no FR was demoted when the option was offered, and FR-013 was added at `must-have` during a later shaping round. Consequence recorded: the MVP carries no scope buffer, so if the one-week estimate proves short there is nothing pre-marked to cut.

**Why the persistence and limit requirements are must-have despite sitting off the happy path.** The author's own scope criterion admits a feature only if the primary flow is impassable without it. FR-009 through FR-013 all fail that test — a joke can be generated and copied without saving, history, or any ceiling. They are must-have anyway, by explicit override: the learning objective stated in `## Vision & Problem Statement` is the *full* path including persistence, so those requirements sit on the learning path even though they do not sit on the product path. The ceilings are must-have because open registration (see `## Access Control`) leaves them as the only cost barrier in the design. This override is recorded rather than assumed.

### Authentication

- FR-001: User can register an account with an email address and a password. Priority: must-have
- FR-002: User can sign in, stay signed in across visits, and sign out. Priority: must-have

### Generation

- FR-003: User can submit a topic between 3 and 80 characters. Priority: must-have
  > Socratic: Counter-argument considered: "at a 200-character ceiling a user can type instructions ('write it in the style of X, five paragraphs') and bypass the format contract, which shaping named as the product's value." Resolution: the ceiling was lowered from 200 to 80 characters. A short field forces a topic rather than an instruction and defends the format contract without adding any new validation logic.
- FR-004: User can choose the output format — joke or story. Priority: must-have
  > Socratic: Counter-argument considered: "shaping named two trigger moments — a joke mid-conversation, and play out of boredom — and neither requires a story, so the second format enters the MVP without grounding in the persona." Resolution: both formats kept, on a technical rather than a persona justification, recorded as such — the longer form is harder to hold in structure, so it exercises the format contract more severely than a joke does. The persona still does not ground the story format; that asymmetry is accepted knowingly.
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
  > Socratic: Counter-argument considered: "with open registration, N accounts × the per-account daily limit leaves total spend unbounded, so this FR does not achieve what it was added for." Resolution: FR-012 is kept as the per-account fairness bound, and FR-013 was added as the actual cost bound. Registration stays open — that decision was not reversed.
- FR-013: User is refused generation once an application-wide daily ceiling across all accounts is reached, and told why. Priority: must-have

Ten of the thirteen FRs (FR-001, FR-002, FR-005 through FR-011, FR-013) carry no Socratic annotation: the challenge round was reduced to the three load-bearing FRs at the author's request, and those ten were never challenged. See `## Open Questions`.

## Non-Functional Requirements

- A user perceives a completed short or medium-length generation within 15 s, and a long generation within 30 s. Beyond that they receive a message; the interface never becomes unresponsive.
- Continuous visible progress is shown for the whole duration of any generation, so the user is never left unsure whether the request is alive.
- No generation is readable by any account other than the one that produced it. An attempt to read another account's generation is refused.
- Reaching either the per-account or the application-wide daily generation ceiling produces an explanatory message, never an unhandled error.
- A stored password is never recoverable. Even with full access to everything the application has stored, no user's password can be reconstructed.
- Every failure mode — a timed-out generation, an unavailable provider, a refused topic — is reported in Polish, in plain language, with no internal error text surfaced to the user.
- The product's interface and its generated output are in Polish only.

## Business Logic

**Every generation is bound by a contract of topic, format, length, and tone — the product never passes arbitrary user text straight through to output.**

The rule consumes three user-facing inputs: the topic the user types, the format they pick (joke or story), and the length they pick. Before any generation is attempted, the topic is checked against the accepted range and against disallowed content; a topic that fails is refused with a reason instead of silently producing something.

The rule's output is text that must satisfy the chosen format's structural requirements. A joke stays within roughly sixty words and ends on a punchline. A story stays within roughly four hundred words and carries a beginning, a development, and an ending. Output that fails its format contract is produced again once; if the second attempt also fails, the user gets a readable error rather than a result that breaks the contract.

The user encounters the rule twice in the flow: once as refusal (an unacceptable topic never reaches generation) and once as guarantee (what comes back is shaped, not raw). This is the distinction shaping identified between this product and an open chat interface — the empty-CRUD anti-pattern does not apply, because the application makes a decision about the shape of its own output.

## Access Control

**Login with email + password.** A user registers an account, signs in, and the session persists between visits; sign-out is explicit. Every screen except sign-up and sign-in requires an authenticated session.

**Registration is open**, gated by a hard per-account daily generation limit (FR-012) rather than by an invite list, with an application-wide daily ceiling behind it (FR-013).

**Flat user model — a single user type.** No roles, no admin. An authenticated user sees only their own generations; there is no view onto anyone else's data and no capability to manage another account.

**Unauthenticated access to a gated route redirects to the sign-in screen**, and after a successful sign-in the user lands on the route they originally requested.

> Socratic (shaping): "The persona is a single user, so what is the smallest access model that still makes the MVP useful?" Resolution: full email + password login was kept deliberately — the persona is one user, but passing through registration, credential handling, session, and sign-out is the stated learning objective. The access model is therefore larger than the product needs, by choice.

## Non-Goals

- **Sign-in through a third-party identity provider, magic links, two-factor, and email-based password reset** — every one adds a second external integration, which the author's own scope criterion forbids. Consequence: a forgotten password strands the account.
- **Sharing and public links** — no public addresses for generated texts, no feed, no trending list, no likes or comments. Keeps the product single-tenant.
- **Export to PDF or DOCX, email delivery, social-media integrations** — all are outbound integrations; the clipboard covers the stated need.
- **Editing and partial regeneration** — no content editor, no "rewrite this paragraph", no versioning of a result. The format contract governs the whole output or nothing.
- **Advanced personalisation** — no custom instruction templates, no user-facing choice of which generator produces the text, no exposed generation parameters, no genre choice beyond the default neutral tone.
- **More than one language** — a single interface and generation language. This is a non-functional non-goal as much as a functional one.
- **Payments and plans** — no subscriptions, no paid tiers. The daily limit is identical for everyone.
- **Human content moderation, an administration panel, and abuse reporting** — follows from the flat user model.
- **Images, voice, audio** — no illustrations for stories, no spoken output.
- **Offline mode, a mobile application, a browser extension** — web only.
- **Product analytics and A/B testing** beyond basic error logging.

## Open Questions

1. **Are the daily ceiling numbers right, and should the per-account limit differ by format?** A story costs more to generate than a joke, and neither the per-account count (FR-012) nor the application-wide ceiling (FR-013) has a number attached yet. Owner: author.
2. **Is length three presets or a word-count slider?** Shaping assumed three presets as easier to validate; FR-005 encodes that assumption. Owner: author.
3. **How is a disallowed topic defined?** The `## Business Logic` rule commits to refusing disallowed topics without defining the category boundary. Owner: author. Note: the *means* of enforcement is a downstream concern, but the boundary itself is a product decision.
4. **Is there a hard deadline?** The question was put during shaping and not answered. `timeline_budget.hard_deadline` is `null` by absence, not by decision — a reader should not treat the field as settled. Owner: author.
5. **Is `target_scale.users: small` correct?** It was derived from the shaping decision "single named user (the author)", not answered directly. If the intent ever widens beyond one user, this prior is wrong, and the flat user model, the absence of moderation, and the daily ceilings all rest on it. Owner: author.
6. **Ten of thirteen FRs were never challenged.** FR-001, FR-002, and FR-005 through FR-011 and FR-013 carry no recorded counter-argument, and `## Business Logic`, `## Non-Functional Requirements`, and `## Non-Goals` were assembled from the author's prior writing rather than through a facilitated challenge round. Nothing is invented — but scrutiny is uneven, and a reviewer cannot tell a tested decision from an untested one outside FR-003, FR-004, and FR-012. Owner: author, if a deeper review pass is wanted before implementation.
