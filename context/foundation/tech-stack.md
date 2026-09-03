---
starter_id: 10x-astro-starter
package_manager: npm
project_name: storygen
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

A solo author shipping Storygen in roughly one week of after-hours work, whose
PRD makes email-and-password registration (FR-001, FR-002) and per-user
generation history (FR-009 to FR-011) must-have on learning grounds, needs a
starter where auth, a relational database and a public deploy already exist
rather than being assembled. 10x-astro-starter is the recommended default for
`(web, js)` and clears all four agent-friendly gates: TypeScript with Zod at the
boundaries, Astro's conventional routing and file layout, a large training-data
corpus, and current version-pinned docs. Supabase covers registration, sessions,
row-scoped reads (the isolation requirement in Non-Functional Requirements) and
the counters behind the per-account and application-wide daily ceilings
(FR-012, FR-013). The LLM provider is the one external integration the starter
does not carry and must be added, with its credentials held server-side to
satisfy the Success Criteria guardrail — **now decided, see below**. Scaffolding confidence is first-class,
not verified, so expect an occasional manual step. Deployment stays on the
starter's Cloudflare Pages default; CI runs on GitHub Actions with
auto-deploy-on-merge, which suits a single-developer repo where every merge
should be live.

## LLM provider — decided 2026-09-03

**Cloudflare Workers AI, model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.**

Chosen over the hosted commercial APIs on three grounds specific to this project.
First, it needs **no API key at all** — the model is reached through a Workers
binding, so the Success Criteria guardrail ("credentials are never observable
through the product's own surfaces") holds structurally rather than by
discipline; there is no secret that can leak into `wrangler.jsonc`, a log, or
the repo. Second, it runs on the platform the app is already deployed to, so it
adds no account, no card, and no second vendor. Third, the free allowance —
10,000 Neurons per day — covers roughly 300 jokes or 66 stories, which is far
beyond what a single-user product consumes, and it converts directly into the
FR-013 ceiling (50 generations/day fits with room for the one-retry rule).

The weights are open, so the choice is portable: the same model runs on Groq,
Together, or local hardware. That only stays true if `S-01` keeps the provider
call behind a narrow interface, the way `F-01` did with errors — otherwise the
portability is theoretical.

**Unverified risk.** Polish creative quality is the open question: a joke with a
punchline inside sixty words is a hard ask for any 70B open-weights model. If the
format contract fails often, the retry rule fires more, doubling both Neuron
spend and latency against the 15 s NFR. Measure this with a prompt before
building the validator around it.

**Integration note.** `@astrojs/cloudflare` v13 removed `Astro.locals.runtime`,
the usual route to bindings. Reach the AI binding through
`import { env } from "cloudflare:workers"` — see the risk register in
@context/foundation/infrastructure.md.
