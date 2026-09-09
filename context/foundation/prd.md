---
project: "Storygen"
version: 3
status: draft
created: 2026-08-11
context_type: greenfield
product_type: web-app
target_scale:
  users: small # derived from the shaping decision "single named user (the author)" — not directly stated; see Open Questions
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 1
  hard_deadline: null # records the ABSENCE of a stated deadline, not a decision that none exists; see Open Questions
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

No secondary persona. The MVP serves the primary persona only. Until 2026-09-08 the flat access model in `## Access Control` rested on that; the administrator role added then does **not** introduce a second persona — it is the same author holding a second account, and `## Access Control` records why that role is larger than this persona justifies.

Amended 2026-09-09: with FR-016 through FR-018 the two accounts are no longer merely unequal in what they can see, but unequal in what they can do **to each other** — one can suspend or destroy the other. Under the stated persona both accounts belong to the same person, so nobody is harmed by that asymmetry; but the mitigation is a property of the persona, not of the product, and it stops holding the moment a second real person registers. Registration is open (see `## Access Control`), so nothing in the design enforces the persona this reasoning depends on.

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
- Added 2026-09-09 with FR-016 to FR-018: no administrative action destroys saved generations without first telling the administrator, on the product's own surface, what is about to be destroyed. An irreversible action offered on an accurate but silent screen is a failure of this criterion even when every Primary criterion holds.

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

All eighteen FRs are `must-have` by the author's explicit choice — thirteen at the original writing, plus FR-014 and FR-015 added 2026-09-08 and FR-016 through FR-018 added 2026-09-09, all at the same priority. The three added on 2026-09-09 inherit `must-have` from this document's blanket choice rather than from an argument of their own; no other priority has ever been used here, and inventing a second tier for them would be a new decision, not a record of one. Among the original thirteen, no FR was demoted when the option was offered, and FR-013 was added at `must-have` during a later shaping round. Consequence recorded: the MVP carries no scope buffer, so if the one-week estimate proves short there is nothing pre-marked to cut.

**Why the persistence and limit requirements are must-have despite sitting off the happy path.** The author's own scope criterion admits a feature only if the primary flow is impassable without it. FR-009 through FR-013 all fail that test — a joke can be generated and copied without saving, history, or any ceiling. They are must-have anyway, by explicit override: the learning objective stated in `## Vision & Problem Statement` is the _full_ path including persistence, so those requirements sit on the learning path even though they do not sit on the product path. The ceilings are must-have because open registration (see `## Access Control`) leaves them as the only cost barrier in the design. This override is recorded rather than assumed.

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

### Roles

Added 2026-09-08 at the author's explicit request, **reversing** the flat user model this document argued for in `## Access Control` and the administration-panel entry in `## Non-Goals`. The reversal is recorded here rather than applied silently, because three earlier sections rested on the flat model.

- FR-014: An account designated as administrator can view the list of accounts with, for each one, its registration date, its total generation count, and its usage against the daily per-account limit. Priority: must-have
  > Scope boundary, decided when the requirement was added: the overview carries **counts only, never generated text**. This is what keeps the isolation NFR ("no generation is readable by any account other than the one that produced it") intact and unamended — the row-level policy on the generations table is not widened, and the administrator has no path to another account's content. Widening this later is a change to the one mechanism the whole access model rests on, and must be argued on its own.
- FR-015: A non-administrator who requests the account overview is refused, and the refusal does not disclose whether the overview exists. Priority: must-have

### Account management

Added 2026-09-09 at the author's explicit request, **reversing** three items this document parked in `## Non-Goals` as recently as 2026-09-08 — blocking accounts, deleting another account's data, and the capability to manage another account at all. As with FR-014, the reversal is recorded here rather than applied silently, because `## Access Control`, `## User & Persona` and `## Non-Goals` all rested on the narrower reading.

This is the point where the administrator stops being a reader and becomes an actor. Everything before FR-016 could only ever show a number; from here on an administrative action changes another person's account, and two of the three cannot be undone by the person affected.

- FR-016: An administrator can block an account and later unblock it. A blocked account cannot use the product and is told that its access has been suspended, rather than being shown a generic failure. The account overview shows which accounts are blocked. Priority: must-have
  > Scope boundary: what "cannot use the product" means at the boundary — refused at sign-in, or signed in but refused generation — is **not** decided here. It changes what the blocked person sees and is a product decision, not an implementation detail; see `## Open Questions`, item 7.
- FR-017: An administrator can delete an account. Before the deletion is carried out they are told what will be destroyed with it — that account's saved generations — because the action cannot be undone. Priority: must-have
  > Consequence recorded, not discovered later: this is the first requirement in the product that destroys texts whose owner never asked to lose them, and the isolation guarantee in `## Non-Functional Requirements` does not protect against it — isolation forbids *reading* another account's generations, and deleting an account never reads them. A second consequence is quieter: the deleted account's share of the application-wide daily ceiling (FR-013) is released with it, so after a deletion the ceiling no longer records what the application actually spent that day.
- FR-018: An administrator can grant the administrator role to another account and revoke it. Priority: must-have
  > Scope boundary: whether an administrator may act on their own account, and whether the last remaining administrator role can be revoked, is **not** decided here — see `## Open Questions`, item 9. Getting it wrong locks administration out of the product with no path back through the product's own surfaces.

Ten of the original thirteen FRs (FR-001, FR-002, FR-005 through FR-011, FR-013) carry no Socratic annotation: the challenge round was reduced to the three load-bearing FRs at the author's request, and those ten were never challenged. FR-014 and FR-015, added later, carry the scope boundary above instead of a challenge round, and FR-016 through FR-018 carry scope boundaries and recorded consequences for the same reason — a challenge round was not held for any of the five. See `## Open Questions`.

## Non-Functional Requirements

- A user perceives a completed short or medium-length generation within 15 s, and a long generation within 30 s. Beyond that they receive a message; the interface never becomes unresponsive.
- Continuous visible progress is shown for the whole duration of any generation, so the user is never left unsure whether the request is alive.
- No generation is readable by any account other than the one that produced it. An attempt to read another account's generation is refused. **Unamended 2026-09-09**, deliberately: FR-016 through FR-018 let an administrator suspend an account and destroy it together with its generations, but never let one read another account's text. Destroying is not reading, so this requirement is untouched by the account-management change — and it remains the one guarantee no requirement in this document is permitted to widen.
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

**Two roles — regular user and administrator.** Amended 2026-09-08; this section previously read "Flat user model — a single user type. No roles, no admin." Amended again 2026-09-09; the sentence describing the administrator previously ended "and nothing else: no generated text, and no capability to manage, block, or delete another account" — the second half of that clause is exactly what FR-016 through FR-018 reverse. A regular user sees only their own generations and has no view onto anyone else's data. An administrator additionally sees the account overview defined in FR-014 — registration dates, generation counts, usage against the per-account limit — and can block, unblock and delete an account and grant or revoke the administrator role (FR-016 to FR-018). What an administrator still cannot do is **read another account's generated text**: that boundary is unchanged, it is the one thing FR-014 was explicitly fenced against widening, and it is what keeps the isolation requirement intact.

The role is a property of the account, not of the person reading the screen, and it is **not** derived from an email address at request time — an address is user-supplied data and treating it as an authorisation claim would make the check forgeable. Which account holds which role is a data decision, recorded outside this document; the two accounts existing when this was added are `dkrzywda@amniscode.pl` (administrator) and `damiano.krzywda@gmail.com` (regular user).

> Consequence recorded: the persona in `## User & Persona` is one user, and `target_scale.users: small` was derived from the shaping decision "single named user (the author)". Two named accounts with different capabilities makes that derivation stale — see `## Open Questions`, item 5, which anticipated exactly this. The administrator role is therefore larger than the persona justifies, the same way full email-and-password login already was: by choice, for the learning path, and recorded as such rather than argued as product need.

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
- **Human content moderation and abuse reporting** — narrowed twice. First 2026-09-08: this entry previously also parked "an administration panel", which FR-014 brought into scope as a read-only account overview. Narrowed again 2026-09-09: the list of what stayed out previously read "no reading another account's generated text, no editing or deleting another account's data, no blocking or unblocking accounts, no adjusting anyone's limit, no moderation queue, no abuse reports", and the entry closed "The administrator reads counts and nothing more" — blocking, unblocking and deleting an account are now FR-016 and FR-017, so both statements had become false. What stays out after this narrowing: **no reading another account's generated text**, no editing another account's generations, no adjusting anyone's daily limit, no moderation queue, no abuse reports. The distinction between the two deletions is deliberate — an administrator may delete an *account*, which destroys its generations with it (FR-017); an administrator may not reach into an account and change or remove individual generations.
- **Images, voice, audio** — no illustrations for stories, no spoken output.
- **Offline mode, a mobile application, a browser extension** — web only.
- **Product analytics and A/B testing** beyond basic error logging.

## Open Questions

1. **Are the daily ceiling numbers right, and should the per-account limit differ by format?** A story costs more to generate than a joke, and neither the per-account count (FR-012) nor the application-wide ceiling (FR-013) has a number attached yet. Owner: author.
2. **Is length three presets or a word-count slider?** Shaping assumed three presets as easier to validate; FR-005 encodes that assumption. Owner: author.
3. **How is a disallowed topic defined?** The `## Business Logic` rule commits to refusing disallowed topics without defining the category boundary. Owner: author. Note: the _means_ of enforcement is a downstream concern, but the boundary itself is a product decision.
4. **Is there a hard deadline?** The question was put during shaping and not answered. `timeline_budget.hard_deadline` is `null` by absence, not by decision — a reader should not treat the field as settled. Owner: author.
5. **Is `target_scale.users: small` correct?** It was derived from the shaping decision "single named user (the author)", not answered directly. If the intent ever widens beyond one user, this prior is wrong, and the flat user model, the absence of moderation, and the daily ceilings all rest on it. Owner: author. **Amended 2026-09-09**: this question is now more pressing, not less. It was written when the widest asymmetry between accounts was what each could see; FR-016 to FR-018 make one account able to suspend and destroy another, and `## User & Persona` records that the only thing protecting the second account is the assumption that one person owns both.
6. **Ten of thirteen FRs were never challenged.** FR-001, FR-002, and FR-005 through FR-011 and FR-013 carry no recorded counter-argument, and `## Business Logic`, `## Non-Functional Requirements`, and `## Non-Goals` were assembled from the author's prior writing rather than through a facilitated challenge round. Nothing is invented — but scrutiny is uneven, and a reviewer cannot tell a tested decision from an untested one outside FR-003, FR-004, and FR-012. Owner: author, if a deeper review pass is wanted before implementation.

7. **What does "blocked" mean at the product's boundary?** FR-016 commits to blocking an account without deciding what the blocked person meets: a refusal at sign-in, or a session that opens normally and then refuses generation. The two produce different messages and expose different amounts of the product to someone who has lost access. Owner: author. Block: yes — FR-016 cannot be planned coherently until this is answered.
8. **Is deletion the only removal, or is there a recoverable state before it?** FR-017 commits to deletion and to warning first, but not to whether an account can be put beyond use *recoverably* — which sits close enough to FR-016's blocking that the two may collapse into one capability, or may not. The recorded consequence stands either way: deleting an account destroys its saved generations and releases its share of the FR-013 ceiling, so the ceiling stops recording what the application actually spent that day. Owner: author. Block: yes.
9. **May an administrator act on their own account, and can the last administrator role be revoked?** FR-018 grants and revokes the role but leaves both self-action and the floor undecided. Getting the floor wrong removes administration from the product with no path back through the product's own surfaces; getting self-action wrong lets one account demote or delete the account that holds the role. Owner: author. Block: yes.
