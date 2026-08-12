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
satisfy the Success Criteria guardrail. Scaffolding confidence is first-class,
not verified, so expect an occasional manual step. Deployment stays on the
starter's Cloudflare Pages default; CI runs on GitHub Actions with
auto-deploy-on-merge, which suits a single-developer repo where every merge
should be live.
