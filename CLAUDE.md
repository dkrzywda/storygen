# CLAUDE.md

Guidance for Claude Code working in this repository. Product intent: @context/foundation/prd.md — stack rationale: @context/foundation/tech-stack.md — rules earned from past runs: @context/foundation/lessons.md

## Tripwires

- **`npm run lint` fails on a clean checkout on Windows.** All 26 files in `src/` carry CRLF: there is no `.gitattributes`, `core.autocrlf=true`, and `.prettierrc.json` sets no `endOfLine`, so Prettier's `lf` default reports `Delete ␍` on every line (~1040 errors repo-wide). Verified 2026-08-24. Until this is fixed at the root, lint the files you touched, not the whole repo, and do not read a full-repo lint failure as caused by your change.
- **CI never runs on this repo as configured.** `.github/workflows/ci.yml` triggers on `master`; the branch here is `main`. Fix the trigger before relying on CI. The build step also needs `SUPABASE_URL` / `SUPABASE_KEY` repository secrets. Note this masks the tripwire above — CI runs on Linux, where the CRLF errors do not appear.
- **The LLM provider is decided but not wired.** Cloudflare Workers AI, model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, reached through a Workers **binding** — there is no API key, and there must never be one: that is what makes the credentials guardrail structural. Do not introduce a keyed provider without raising it. Adapter v13 removed `Astro.locals.runtime`, so reach the binding via `import { env } from "cloudflare:workers"`. Rationale, free-tier maths and the unverified Polish-quality risk: @context/foundation/tech-stack.md.
- `.nvmrc` pins Node 22.14.0; the machine that scaffolded this ran 22.18.0.
- The scaffolded dependency tree shipped with 1 critical and 13 high npm-audit findings (1 direct: `astro`). Full breakdown in @context/changes/bootstrap-verification/verification.md.

## Architecture

Everything is server-rendered (`output: "server"`). No file in `src/` exports `prerender`. Do not add the export — if a route appears to need it, stop and raise it rather than deciding alone.

**Supabase client is nullable by design.** `createClient()` in `src/lib/supabase.ts` returns `null` when `SUPABASE_URL`/`SUPABASE_KEY` are absent (both are declared `optional` in the `astro:env` schema). Every call site must handle `null` — that is what lets the app boot unconfigured. `src/lib/config-status.ts` collects the missing-config state and `Banner.astro` renders it.

**Auth is middleware-driven.** `src/middleware.ts` resolves the user on every request into `context.locals.user` (typed in `src/env.d.ts`) and redirects unauthenticated traffic away from anything matching `PROTECTED_ROUTES`. To protect a new route, extend that array — per-page auth checks are not the pattern here. `context.locals.user` is `null` both when there is no session and when Supabase is unconfigured, so a handler reading it needs no separate `createClient()` null check.

**Auth endpoints are form-post + redirect, not JSON.** `src/pages/api/auth/{signin,signup,signout}.ts` read `request.formData()` and answer with `context.redirect("/auth/...?error=" + encodeURIComponent(msg))`. The React forms (`src/components/auth/`) post natively and only add client-side validation and error display on top — keep them progressive-enhancement, not fetch-driven.

**One error contract, two response shapes — decided, not open.** Non-auth endpoints answer with JSON: `{ data }` on success, `{ error: { code, message, fields? } }` on failure, and the HTTP status is derived from the code, never written by hand in the handler. Auth endpoints keep form-post + redirect, but `?error=` carries a **code**, never prose — the page resolves it through the dictionary, so an unrecognised value yields the default message instead of echoing the URL back at the user. Every user-facing message comes from `API_ERRORS` in @src/lib/api-errors.ts; nothing from an SDK reaches a screen. Adding a code means adding it to `ApiErrorCode` in @src/types.ts and to `API_ERRORS` — the `Record` type makes a forgotten entry a compile error. Validate input with Zod through `validate()` in @src/lib/validation.ts and author the field messages in the schema, in Polish.

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

- `npm test` — Vitest unit pass, no Docker. `npm run test:watch` for the continuous mode. Tests live next to their subject as `src/**/*.test.ts`; the runner resolves `@/*` through `vitest.config.ts`, which mirrors the `tsconfig.json` paths — keep the two in step or test imports silently diverge from build imports.
- `npm run test:integration` — separate Vitest project (`vitest.integration.config.ts`) over `src/**/*.integration.test.ts`, **requires `npx supabase start`**. The unit config excludes these so `npm test` stays Docker-free; adding an integration test to the wrong pattern makes the fast suite need Docker.
- **A test that exercises RLS must use the publishable/anon key.** `service_role` bypasses RLS, so such a test passes even against a wide-open policy — a green light on the one guarantee the whole access model rests on. `src/lib/generations.integration.test.ts` refuses to run against a non-local host or a secret key; copy that guard into any new RLS test.
- `npx supabase gen types typescript --local > src/lib/database.types.ts` regenerates the DB types (then `npx prettier --write` on it — the CLI does not know Prettier). The file sits next to `src/lib/supabase.ts`, is ESLint-ignored as generated output, and types the shared client via `createServerClient<Database>`, so every query in the app is typed without per-call generics.

**Installing a package while `npm run dev` is running breaks the dev server.** The lockfile change makes Vite re-optimize dependencies and leaves a stale SSR cache; pages then render as HTTP 200 with an empty body, and the log shows `TypeError: jsxDEV is not a function` pointing at a React island you did not touch. Fix: stop the server, `rm -rf node_modules/.vite`, restart. Verified 2026-09-03 while adding `zod`.

Pre-commit runs `lint-staged` via husky: `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`. A `PostToolUse` hook (`.claude/hooks/format.mjs`) formats each edited file immediately, so the pre-commit pass should normally be a no-op.

## Project

Storygen — an Astro 6 SSR app deployed to Cloudflare Workers, with Supabase email/password auth. Scaffolded from `10x-astro-starter`; `package.json` still carries the starter's `name` and `version`.

Course tooling — the 10xDevs skill chain, which documents the toolkit rather than this codebase: @docs/10xdevs/lesson-m1l4.md

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill                          | Use it when                                                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code review (lesson focus)** |                                                                                                                                                                                                                                         |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome**   |                                                                                                                                                                                                                                         |
| `/10x-lesson`                  | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note.                                                                             |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
