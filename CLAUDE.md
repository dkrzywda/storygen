# CLAUDE.md

Guidance for Claude Code working in this repository. Product intent: @context/foundation/prd.md — stack rationale: @context/foundation/tech-stack.md — rules earned from past runs: @context/foundation/lessons.md

## Tripwires

- **`npm run lint` fails on a clean checkout on Windows.** All 26 files in `src/` carry CRLF: there is no `.gitattributes`, `core.autocrlf=true`, and `.prettierrc.json` sets no `endOfLine`, so Prettier's `lf` default reports `Delete ␍` on every line (~1040 errors repo-wide). Verified 2026-08-24. Until this is fixed at the root, lint the files you touched, not the whole repo, and do not read a full-repo lint failure as caused by your change.
- **CI never runs on this repo as configured.** `.github/workflows/ci.yml` triggers on `master`; the branch here is `main`. Fix the trigger before relying on CI. The build step also needs `SUPABASE_URL` / `SUPABASE_KEY` repository secrets. Note this masks the tripwire above — CI runs on Linux, where the CRLF errors do not appear.
- **Zod is not installed** even though @context/foundation/tech-stack.md and the starter's own rules call for Zod validation at API boundaries. Install it before writing code that assumes it.
- **The response shape for non-auth API endpoints is undecided.** Existing auth endpoints redirect with `?error=`; three independent agent runs adding `/api/generate` each invented a JSON shape instead. Decide deliberately and record the decision here — see "Milczenie reguły to nie zgoda" in @context/foundation/lessons.md.
- The LLM provider the PRD depends on is not part of the starter and is not installed yet.
- `.nvmrc` pins Node 22.14.0; the machine that scaffolded this ran 22.18.0.
- The scaffolded dependency tree shipped with 1 critical and 13 high npm-audit findings (1 direct: `astro`). Full breakdown in @context/changes/bootstrap-verification/verification.md.

## Architecture

Everything is server-rendered (`output: "server"`). No file in `src/` exports `prerender`. Do not add the export — if a route appears to need it, stop and raise it rather than deciding alone.

**Supabase client is nullable by design.** `createClient()` in `src/lib/supabase.ts` returns `null` when `SUPABASE_URL`/`SUPABASE_KEY` are absent (both are declared `optional` in the `astro:env` schema). Every call site must handle `null` — that is what lets the app boot unconfigured. `src/lib/config-status.ts` collects the missing-config state and `Banner.astro` renders it.

**Auth is middleware-driven.** `src/middleware.ts` resolves the user on every request into `context.locals.user` (typed in `src/env.d.ts`) and redirects unauthenticated traffic away from anything matching `PROTECTED_ROUTES`. To protect a new route, extend that array — per-page auth checks are not the pattern here. `context.locals.user` is `null` both when there is no session and when Supabase is unconfigured, so a handler reading it needs no separate `createClient()` null check.

**Auth endpoints are form-post + redirect, not JSON.** `src/pages/api/auth/{signin,signup,signout}.ts` read `request.formData()` and answer with `context.redirect("/auth/...?error=" + encodeURIComponent(msg))`. The React forms (`src/components/auth/`) post natively and only add client-side validation and error display on top — keep them progressive-enhancement, not fetch-driven.

## Conventions

- `@/*` → `./src/*` (tsconfig paths).
- Astro components for static content and layout; React islands only where interactivity is required. No `"use client"`.
- Merge classes with `cn()` from `@/lib/utils` — never concatenate class strings.
- shadcn/ui components live in `src/components/ui/` ("new-york" variant); add with `npx shadcn@latest add [name]`.
- Services and extracted business logic go in `src/lib/`, or `src/lib/services/` once the logic warrants its own folder.
- Shared entity/DTO types go in `src/types.ts` at first use, not at second. Extracted React hooks go in `src/components/hooks/`. Neither path exists yet; create on first need rather than inventing a different location.
- ESLint runs `strictTypeChecked` + `stylisticTypeChecked` against the real TS project, so lint is slow and type-aware; `no-console` is a warning, unused vars are errors unless prefixed `_`.
- Supabase migrations belong in `supabase/migrations/` named `YYYYMMDDHHmmss_short_description.sql`, with RLS enabled and granular per-operation, per-role policies. The directory does not exist yet — the first migration creates it.
- Never write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, stop and say so instead of writing.

## Commands

Full script list and Supabase setup live in @README.md. The non-obvious ones:

- `npx astro sync` — regenerates `.astro/types.d.ts`. Stale types surface as `@typescript-eslint/no-unsafe-*` errors in `src/middleware.ts`; run it after changing `astro.config.mjs` or its `env.schema`, and before blaming your own code.
- `npm run dev` runs on the Cloudflare workerd runtime, not plain Node.
- `npx supabase start` needs Docker and ~7 GB RAM.

**No test runner is configured.** There is no `test` script and no test framework installed, so there is no "run a single test" command yet. Picking one is an open decision, not an existing convention.

Pre-commit runs `lint-staged` via husky: `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`. A `PostToolUse` hook (`.claude/hooks/format.mjs`) formats each edited file immediately, so the pre-commit pass should normally be a no-op.

## Project

Storygen — an Astro 6 SSR app deployed to Cloudflare Workers, with Supabase email/password auth. Scaffolded from `10x-astro-starter`; `package.json` still carries the starter's `name` and `version`.

Course tooling — the 10xDevs skill chain, which documents the toolkit rather than this codebase: @docs/10xdevs/lesson-m1l4.md

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit — Module 1, Lesson 5

Pick a deployment platform and ship to production with the **infra chain**:

```
(/10x-init  →  /10x-shape  →  /10x-prd  →  /10x-tech-stack-selector  →  /10x-bootstrapper  →  /10x-agents-md  →  /10x-rule-review  →  /10x-lesson)  →  /10x-infra-research  →  Plan Mode deploy
```

The full Module 1 chain ships from Lessons 1–4 (re-included so you can fix any earlier contract mid-flight). `/10x-infra-research` is the lesson's main topic; the deploy step itself uses the host's built-in **Plan Mode** rather than a dedicated skill — the artifact (`context/deployment/deploy-plan.md`) is what carries forward.

### Task Router — Where to start

| Skill | Use it when |
| --- | --- |
| **Infrastructure (lesson focus)** | |
| `/10x-infra-research [path-to-tech-stack-or-prd]` | You have a `context/foundation/tech-stack.md` (and ideally a `prd.md`) and need to pick an MVP deployment platform. The skill loads the stack as a hard constraint, runs a 5-question developer interview (persistent connections, cost sensitivity, existing familiarity, global reach, co-location preference), spawns parallel subagent research across six candidate platforms, scores them Pass/Partial/Fail across the five agent-friendly criteria from `references/agent-friendly-criteria.md`, shortlists the top three, and runs a three-lens anti-bias cross-check on the leader (devil's advocate, pre-mortem, unknown unknowns) before writing `context/foundation/infrastructure.md`. Use AFTER `/10x-tech-stack-selector`, BEFORE `/10x-implement`. |
| **Deploy (host built-in, not a skill)** | |
| Plan Mode deploy | You have `infrastructure.md` + `tech-stack.md` and want a read-only plan reviewed before any mutation hits the platform. Activate the host's plan mode (Claude Code: `Shift+Tab` cycles default → auto-accept → plan; IDE: dedicated button) with the prompt "Wykonajmy pierwsze wdrożenie w oparciu o `@infrastructure.md`, zgodnie ze stackiem z `@tech-stack.md`". Read the plan, demand corrections, approve, then let the agent execute. The approved plan persists at `context/deployment/deploy-plan.md` so the next lesson's milestone planning can reference what's already deployed and which secrets are already wired. |
| **Re-run upstream if needed** | |
| `/10x-init` / `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-rule-review` / `/10x-lesson` / `/10x-stack-assess` / `/10x-health-check` | Bundled so you can patch any earlier contract mid-flight. If the anti-bias cross-check forces a platform swap that pushes a stack-shaped decision (e.g. "this DB doesn't fit any platform we'd accept"), re-run `/10x-tech-stack-selector` to keep `tech-stack.md` and `infrastructure.md` aligned. |

### How the chain hands off

- `/10x-infra-research` reads `context/foundation/tech-stack.md` (language, framework, runtime, database) as **hard constraints** — platforms that can't run the stack are dropped before scoring. It also reads `context/foundation/prd.md` (scale, latency, uptime expectations) as **soft weights** when scoring. Both inputs are optional but strongly recommended; without them the skill proceeds but warns.
- The skill writes `context/foundation/infrastructure.md` as the third foundation contract: frontmatter (`project`, `researched_at`, `recommended_platform`, `runner_up`, `context_type`, `tech_stack`) plus a body covering recommendation, full platform comparison with scoring matrix, anti-bias findings, operational story (preview / secrets / rollback / approval / logs), and a risk register tying every entry back to the lens that surfaced it. On collision the skill prompts: overwrite, save as `infrastructure-v2.md`, or abort.
- Plan Mode reads `infrastructure.md` and `tech-stack.md` together. The agent emits a step-by-step plan covering automated steps it owns, manual setup gates (account creation, secret configuration), exact deploy commands (Pages vs Workers commands are NOT interchangeable on Cloudflare — the plan must specify), and verification steps. The plan is rejected/edited until it's right; only then does Plan Mode exit and execution begin. The approved plan lands at `context/deployment/deploy-plan.md` and is consumed downstream by milestone-planning skills as ground truth for "what's already deployed".

### What the lesson's skills capture (and what they do NOT)

- **`/10x-infra-research` captures**: platform shortlist scored against five agent-friendly criteria (CLI quality, managed/serverless degree, agent-readable docs, stable/scriptable deploy API, MCP or first-class agent integration), three anti-bias outputs on the leader (numbered weaknesses, 150–200-word failure narrative, 3–5 unknown-unknowns), an operational story with one concrete answer per axis (not categories), and a risk register where every row names its source lens (`Devil's advocate` / `Pre-mortem` / `Unknown unknowns` / `Research finding`). Status of every non-GA feature is captured inline (`beta` / `preview` / `region-limited` / `deprecated`) with the date the status was checked.
- **`/10x-infra-research` does NOT** build Docker images or write Dockerfiles, configure CI/CD pipelines, or plan beyond MVP scope (multi-region HA is explicitly out of scope). It does NOT decide for you — the user accepts, swaps to runner-up, or aborts after the cross-check, and that decision is recorded in the output.
- **Plan Mode** captures: an explicit human gate between "agent has a plan" and "agent mutates production". The artifact (`deploy-plan.md`) is the audit trail for "what was supposed to happen" when the live run goes sideways. Plan Mode does NOT replace `/10x-infra-research` (the platform decision must already be made — Plan Mode plans the deploy, it doesn't pick where to deploy).

### The five agent-friendly criteria (and why they're load-bearing)

The criteria that make `/10x-infra-research`'s scoring matrix are not generic "good platform" axes — they're the specific traits that determine whether an agent can operate this platform from a session without you holding its hand:

1. **CLI-first** — every routine operation has a documented command; the agent doesn't need to click in a panel.
2. **Managed / serverless** — fewer moving pieces means fewer ways the agent (or you) breaks something the platform was supposed to handle.
3. **Agent-readable docs** — markdown / `llms.txt` / GitHub-hosted docs the agent can fetch and parse, not JS-rendered marketing pages.
4. **Stable, scriptable deploy API** — predictable exit codes, structured output, no interactive prompts mid-deploy.
5. **MCP server or first-class agent integration** — bonus, not required. CLI alone is fine for MVP; MCP earns its keep when the agent makes dozens of structured queries against live state.

Hard filters apply before scoring (persistent-connection requirement drops Netlify/Vercel serverless-only; tech-stack runtime mismatch drops the platform entirely). Interview answers reweight criteria after — cost sensitivity penalizes expensive base tiers, familiarity breaks ties, global-reach preference favours edge-native platforms, co-location preference favours integrated databases.

### Anti-bias as a decision discipline (not theatre)

Every research conversation with an LLM has a built-in tilt toward whatever the user already signalled. `/10x-infra-research` runs three structured lenses against the leader BEFORE the file is written, not after:

- **Devil's advocate** — *find the weaknesses, hidden costs, and failure modes specific to deploying `<this stack>` on `<this platform>`*. Output is a numbered list of 3–5 specifics, not categories.
- **Pre-mortem** — *six months later, this decision turned out to be a complete disaster; walk through the assumptions and underestimated risks that led there*. Output is a 150–200-word narrative; narratives surface concrete failure shapes that abstract risk lists hide.
- **Unknown unknowns** — *what's true about this combination that the marketing page and docs don't make obvious?* Output is 3–5 non-obvious risks.

After the cross-check the user has three real options: **proceed with the leader and absorb the risks into the register**, **swap to runner-up** (and re-run the cross-check on the new leader), or **swap to third place**. The third option is rare; if it never happens across many runs, the cross-check has degraded into a ritual and should be rewritten.

Two additional techniques (no skill required, raw prompts) belong in the same toolbox: forcing the model to compare three alternatives in a markdown table (structure beats "the same answer in different words"), and role-rotation (the same decision through a frontend dev's, security person's, and cost owner's eyes — surface the cost each role pays and propose alternatives if any of them flinch).

### CLI vs MCP for live-infra operability

After deploy, the agent needs a way to talk to the running platform. Two paths, complementary not competing:

- **CLI** (`wrangler`, `flyctl`, `vercel`, `gh`) — explicit and auditable, output stays in the terminal, safer defaults for irreversible actions (e.g. `netlify deploy` is draft by default; `--prod` must be passed). Best for MVP: minimal setup, low context cost (no tool schemas pre-loaded), and the agent has to know the command (which is where a per-tool skill helps).
- **MCP** — a dedicated server exposing structured tools with schemas (`pages_deployments_list`, etc.). Each connected MCP server adds tool definitions to the context window, so cost compounds across servers. Earns its keep when the agent makes many discovery-style queries against live state (logs, deployment diffs) and structured JSON beats parsing CLI output.

Sensible default: start with CLI, add MCP when you notice a recurring pattern of `--help` traversal the agent has to do to answer a class of questions. Anthropic's own [building-agents-that-reach-production](https://claude.com/blog/building-agents-that-reach-production-systems-with-mcp) framing is "API, CLI, and MCP are three complementary paths" — pick by task, not by hype.

### Production-access boundary (minimal permissions, human-on-irreversibles)

Both CLI and MCP can give the agent direct access to production. The lesson sets a default posture:

- **Tokens are scoped, not master keys.** On Cloudflare: an API token limited to Pages or Workers for one project, no DNS, no Workers Secrets for unrelated projects, no billing. AWS / GCP equivalent: scoped IAM role with `console-only-user` or read-only on production, full access on staging.
- **Tokens live in env vars, not in `.mcp.json` committed to the repo.** The agent picks them up via the MCP server or CLI's env-discovery, not via plaintext in conversation.
- **Destructive actions are human-only.** Drop a database, rotate a primary secret, delete a project — those are panel-by-hand operations, even if the agent suggests them. Manual click costs 30 seconds; cleanup after an automated mistake costs hours.

This is the MVP posture. As the project matures, the natural evolution is staging gets full agent access, production becomes read-only — covered in later modules.

### Foundation paths used by this lesson

- `context/foundation/tech-stack.md` — input (Lesson 2 hand-off, hard constraints)
- `context/foundation/prd.md` — input (Lesson 1 hand-off, soft weights)
- `context/foundation/infrastructure.md` — output (the third foundation contract)
- `context/deployment/deploy-plan.md` — output of Plan Mode deploy (audit trail of "what was supposed to happen")
- `context/foundation/lessons.md` — recurring rules & pitfalls (use `/10x-lesson` from Lesson 4 if you spot a class of agent failure during research or deploy)
- `docs/reference/contract-surfaces.md` — load-bearing names registry

### Universal language

The shipped skill carries no 10xDevs / cohort / certification references. The candidate platform list (Cloudflare, Vercel, Netlify, Fly.io, Railway, Render) is the starting research lens, not a recommendation set — the scoring + interview + cross-check pipeline is what's load-bearing, and a platform absent from the default list can be added by extending the research step. The five agent-friendly criteria are the artifact's true core; `/10x-infra-research` re-reads them from `references/agent-friendly-criteria.md` so they evolve as platforms do.

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
