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
