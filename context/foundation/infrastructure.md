---
project: storygen
researched_at: 2026-08-24
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6.3 (output "server")
  runtime: workerd (@astrojs/cloudflare 13.5)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare and Vercel both score 5/5 on the agent-friendly criteria, so the decision was
settled by the interview: cost sensitivity, existing Cloudflare familiarity, and the fact
that single-region reach neutralises the edge advantage that would otherwise be Cloudflare's
headline. Cloudflare wins on two grounds the scoring matrix does not capture. First, cost —
the free tier is 100,000 requests **per day** with no cold start and no per-deploy meter,
where Netlify's free plan is exhausted by roughly 20 production deploys a month and Render's
free tier is unusable because its ~60 s cold start would stack on top of a 30 s generation.
Second, migration cost — this repo already carries `@astrojs/cloudflare` 13.5, `wrangler`
4.90, a Workers-shaped `wrangler.jsonc`, and a compatibility date that clears two known
Astro-on-Workers traps. Every other candidate requires an adapter swap and config rework,
which is real spend against a one-week budget.

**Deployment target correction.** `context/foundation/tech-stack.md` states deployment "stays
on the starter's Cloudflare Pages default". That is now wrong and must be treated as stale:
`@astrojs/cloudflare` **v13.0.0 dropped Cloudflare Pages support entirely**. The canonical
command for this stack is `wrangler deploy` (Workers + Static Assets), and
`wrangler pages deploy` is not available to it. The repo's `wrangler.jsonc` is already
correct — it uses the `main` + `assets` shape — so only the prose in `tech-stack.md` needs
fixing. Pages and Workers commands are not interchangeable; any deploy plan must say which.

## Platform Comparison

| Platform               | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total   |
| ---------------------- | --------- | ------------------ | ------------------- | ----------------- | ----------------- | ------- |
| **Cloudflare Workers** | Pass      | Pass               | Pass                | Pass              | Pass              | **5.0** |
| **Vercel**             | Pass      | Pass               | Pass                | Pass              | Pass              | **5.0** |
| **Railway**            | Pass      | Pass               | Pass                | Pass              | Partial           | 4.5     |
| **Netlify**            | Partial   | Pass               | Pass                | Pass              | Pass              | 4.5     |
| **Render**             | Partial   | Pass               | Pass                | Pass              | Pass              | 4.5     |
| **Fly.io**             | Partial   | Partial            | Pass                | Pass              | Partial           | 3.5     |

**Hard filters applied.** No candidate was dropped. The app needs no persistent connections
(`has_realtime: false`, `has_background_jobs: false`), so the serverless-only filter never
fired, and all six platforms can run Astro 6 SSR. The one runtime asymmetry is that only
Cloudflare runs it with the adapter already installed.

**Cloudflare Workers.** Five passes. `wrangler` covers deploy, rollback by version ID, log
tail, secret set/list, and deployment listing — every one of them with a `--json` or
`--format json` output mode and a non-interactive path via `CLOUDFLARE_API_TOKEN`. Docs
publish `llms.txt`, per-product `llms-full.txt`, and serve markdown from any docs URL via an
appended `/index.md` or an `Accept: text/markdown` header. Official MCP servers ship,
including `workers-observability`; they are production-positioned but versioned and moving,
so treat MCP as stable-but-evolving rather than a frozen GA guarantee.

**Vercel.** Also five passes, and the strongest of any candidate on agent-readable docs —
every documentation page has a `.md` twin, plus `llms.txt`, `llms-full.txt`, and per-page
`.graph.md` cross-link maps with an explicit "For AI agents" section. Function duration is
300 s by default on **every** plan including free, which makes the 15–30 s LLM await a
non-issue and comfortably beats Cloudflare's free-tier CPU headroom. It loses on cost shape
and migration: `@astrojs/vercel` must be pinned to **v10** for Astro 6 (v11 requires Astro 7
and refuses to install), and Vercel's own Astro framework page is stale — it still documents
the removed `/serverless` subpath and `output: 'hybrid'`, an active agent-misdirection risk.

**Railway.** Four passes plus a preview-grade MCP. The best mental model of the
non-Cloudflare options: Railpack detects Node with no Dockerfile, request timeouts run to 15
minutes, and `RAILWAY_TOKEN` gives a genuinely clean unattended CLI path. Penalised on cost —
the Hobby plan is a $5/mo floor that you pay even at zero usage, and the app-sleeping feature
that would otherwise reduce idle spend can return a 502 on the first request after wake,
which is hostile to a user-facing app.

**Netlify.** Docked to Partial on CLI-first because **rollback has no CLI verb** — it requires
the dashboard or a direct REST call, and criterion 1 names rollback explicitly. The 60 s
synchronous function limit does clear the 15–30 s await on the free tier. Two
project-specific hazards weigh heavier than the score: production deploys cost 15 of 300
monthly free credits, capping the free plan at roughly 20 deploys a month — which bites
hardest during exactly the week of iteration this project is — and Astro middleware defaults
to running as a Deno edge function, colliding head-on with this repo's middleware-driven
Supabase auth in `src/middleware.ts`.

**Render.** Docked to Partial on CLI-first for a structural reason: the CLI is GA and broad,
but it only _triggers_ a deploy of an existing git commit or prebuilt image — it cannot
upload local source, so the primary path stays git-push. Timeout fit is the best of any
candidate (HTTP responses may take up to 100 minutes) and the MCP server has been GA since
2025-08-21 with a sensible guardrail (it cannot delete services or databases). But the free
tier spins down after 15 minutes with a ~60 s spin-up, which would land on top of the
generation wait, so the honest floor is $7/mo Starter.

**Fly.io.** Lowest score. Partial on CLI-first (`fly launch` is interactive by default, and
there is no `fly releases rollback` — rollback means re-deploying a previous image by
digest), Partial on managed (Firecracker microVMs are managed, but **you own the Dockerfile
permanently**, including Node base-image CVEs, which is the operational burden criterion 2
exists to penalise), and Partial on MCP (`fly mcp server` is experimental). Its 60 s _idle_
timeout — not a total-duration cap — handles the LLM await fine, and autostop plus
`min_machines_running = 0` makes idle cost roughly $0.15–0.50/mo. But free allowances were
removed for new accounts and a credit card is mandatory.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Zero migration, $0/mo at this project's scale, and the platform the author already knows.
`wrangler` gives a complete unattended operational loop — deploy, rollback by version, tail
logs, manage secrets — with structured output on every verb. Critically, the limit that looks
disqualifying is not: Workers cap **CPU time, not wall-clock time**, and there is no hard
duration limit for HTTP-triggered Workers. Awaiting a 30 s LLM `fetch()` consumes no CPU, so
the generation shape this PRD is built around fits inside the free tier. The 50 subrequests
per request allowance comfortably covers one LLM call plus the handful of Supabase queries a
generation needs.

#### 2. Vercel

The safest choice if the free-tier CPU budget proves too tight. Its 300 s function duration
on the free plan removes the entire class of risk that dominates Cloudflare's register here,
and its documentation is the most agent-legible of any platform surveyed. The gap is
migration cost — swap the adapter, pin v10, re-verify the auth cookie and redirect flow on a
preview deploy — plus a Hobby plan restricted to non-commercial personal use, which is fine
for a learning project but becomes a forced $20/mo upgrade the moment anyone pays for the
code.

#### 3. Railway

The fewest surprises of any option: plain Node, no edge-runtime quirks, no CPU metering, no
Dockerfile, 15-minute request ceiling. If Cloudflare's invisible limits become a recurring
source of production-only bugs, Railway trades $5/mo for the elimination of that whole
category. The gap versus the recommendation is the standing cost floor and the fact that
`has_realtime: false` means its real strength — persistent processes — earns nothing here.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The 10 ms free-tier CPU budget is tighter than "awaiting fetch is free" suggests.** The
   await itself costs no CPU, but parsing a 400-word story response, Zod-validating it,
   running the format-contract word count, and SSR-rendering the page with React islands are
   all real CPU work. `## Business Logic` in the PRD mandates regenerating once when output
   fails its contract — which doubles the parse-and-validate cost inside a single invocation.
   Exceeding the budget raises a Cloudflare runtime error, not a Polish-language message,
   violating the NFR that every failure mode is reported in plain Polish with no internal
   error text surfaced.
2. **The subrequest budget is shared across the whole request and invisible until it trips.**
   One generation spends a token refresh, an insert, a per-account count read, an
   application-wide count read, and the LLM call. That is well under 50, but middleware runs
   on every request and nothing surfaces the running total.
3. **The Worker is still named `10x-astro-starter`** (`wrangler.jsonc` line 3). The first
   `wrangler deploy` publishes to `10x-astro-starter.<subdomain>.workers.dev`, making the
   starter's name the project's public URL. Workers cannot be renamed — correcting it later
   means creating a new Worker, re-setting every secret, and deleting the old one.
4. **`Astro.locals.runtime` was removed in adapter v13**, and it is the access pattern that
   most of the training corpus and nearly every Cloudflare-plus-Astro tutorial uses. An agent
   implementing the FR-012 and FR-013 counters will reach for it and get `undefined` at
   runtime rather than a type error. The trap sits exactly where the unwritten code goes; the
   current patterns are `astro:env` and `import { env } from "cloudflare:workers"`.
5. **Workers run near the user while Supabase runs in one region.** Single-region reach is
   acceptable per the interview, but it means every subrequest pays a fixed round-trip. One
   generation absorbs that inside the 15 s budget; a history page issuing several queries is
   less obviously safe.

### Pre-Mortem — How This Could Fail

Storygen shipped in a week and the joke format worked beautifully. Stories were the problem.
At 400 words the parse-plus-validate-plus-contract-check path crept past 10 ms of CPU, and
the regenerate-once branch guaranteed the worst case ran twice. Users saw a raw Cloudflare
error page — precisely the internal error text the non-functional requirements forbid — and
it was unreproducible locally, because `astro dev` runs workerd without enforcing CPU limits.
Two evenings went to chasing a bug that existed only in production. The application-wide
daily ceiling made it worse: Workers hold no state, so every request round-tripped to
Supabase twice simply to ask permission, and the ceiling check became the slowest thing in
the app. Meanwhile the URL was still `10x-astro-starter.workers.dev`, because renaming meant
re-doing every secret. Deploys stayed manual for six months, because CI still triggered on
`master` while the branch was `main`, so the auto-deploy-on-merge named in the stack document
never once ran. The platform was never the problem. Everything that hurt was a limit that
stayed invisible until production.

### Unknown Unknowns

- **`astro dev` runs on workerd but does not enforce CPU or subrequest limits.** Local success
  is not evidence of free-tier compliance, and there is no local signal for "this would have
  exceeded 10 ms." The first honest measurement comes from production observability.
- **`global_fetch_strictly_public` is absent from this repo's `wrangler.jsonc`** though
  Astro's reference configuration includes it. Without it, an outbound `fetch()` to the app's
  own hostname loops back into the Worker instead of reaching the internet — a bug that
  surfaces only after a custom domain is attached and never on `workers.dev`.
- **The pinned compatibility date (`2026-05-08`) predates the `nodejs_compat_v2`
  auto-activation date (`2026-08-04`),** so the project runs v1 Node-compat semantics today.
  Bumping the date to pick up a runtime fix silently changes Node compatibility behaviour —
  it looks like a one-line config edit and is not.
- **`vars` in `wrangler.jsonc` is committed to git, while `.dev.vars` is correctly
  gitignored.** The Success Criteria guardrail says generation-provider credentials are never
  exposed through the product's surfaces, but the exposure risk lives in the setup path, and
  one of these two files is a trap.
- **The free tier returns 429 rather than billing, and static-asset requests do not count
  toward the metered total.** Request volume cannot be inferred from traffic, and there is no
  graceful degradation — only a hard stop, which is most likely to be discovered
  mid-demonstration.

## Operational Story

- **Preview deploys**: `wrangler versions upload` publishes a non-production version and
  returns a preview URL; `wrangler versions deploy` promotes it. Preview URLs on the
  `workers.dev` subdomain are publicly reachable by default — there is no built-in auth gate,
  so anything sensitive needs Cloudflare Access in front of it. There is no automatic
  per-pull-request preview until a Workers Builds or GitHub Actions integration is wired, and
  none exists in this repo today.
- **Secrets**: production values via `echo -n "$VALUE" | wrangler secret put NAME` (piping
  avoids the interactive prompt); listed with `wrangler secret list --format json`, which
  returns names only, never values. Local development reads `.dev.vars`, already gitignored at
  `.gitignore:21`. Never put the LLM key in `wrangler.jsonc` `vars` — that file is committed.
  CI reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from GitHub repository secrets.
  Rotation is `wrangler secret put` again, which **takes effect immediately, not on the next
  deploy** — verified 2026-08-24: `secret put` PUTs to the Worker's secrets endpoint and
  creates _and deploys_ a new version, so no rebuild is needed and the version count rises with
  each secret set. Two further verified constraints: running `secret put` against a Worker that
  does not exist yet prompts to create one and **defaults to yes in non-interactive contexts**,
  producing a stub Worker (`export default { fetch() {} }`) that answers 1101 on every request —
  so always deploy real code first. And `secrets.required` in `wrangler.jsonc` hard-fails on a
  Worker that does not yet exist, so it can only be added after the first secrets are set.
- **Rollback**: `wrangler versions list --json` to find the target, then
  `wrangler rollback <VERSION_ID> --message "reason"` — omitting `--message` prompts, so an
  unattended agent must pass it. Time to revert is seconds; the Worker is immutable per
  version. Caveat: code rolls back, Supabase migrations do not. Any deploy carrying a schema
  change is not safely revertible by this command alone. Second caveat, specific to this
  Worker: `wrangler secret put` creates a new version, so **rolling back past the version that
  set the secrets un-sets them** — versions capture their bindings. The app silently reverts to
  the "not configured" banner with auth disabled, and it looks like a fully successful
  rollback. Run `wrangler secret list` after every rollback.
- **Approval**: an agent may deploy, upload a preview version, tail logs, list versions and
  deployments, and read secret _names_ unattended. Human-only, by hand in the dashboard:
  creating or deleting the Worker, renaming it, attaching or changing a custom domain,
  rotating the Supabase service key or the LLM provider key, any billing-tier change, and any
  destructive Supabase operation. The scoped API token for this project should cover Workers
  for this Worker only — no DNS, no billing, no access to unrelated projects.
- **Logs**: `wrangler tail --format json` streams live requests and exceptions;
  `observability.enabled` is already `true` in `wrangler.jsonc`, so invocation logs are
  queryable retrospectively rather than only live. `wrangler deployments list --json` gives
  deploy history. The `workers-observability` MCP server exposes the same data as structured
  tools if CLI output parsing becomes a recurring cost. **`wrangler tail` does not report CPU
  time** — verified 2026-08-24 by inspecting the installed wrangler 4.90 bundle, where no
  `cpuTime` field exists. The only CPU signal in tail output is the binary
  `outcome: "exceededCpu"`. CPU-time distribution comes from Workers Observability alone, so
  the 10 ms CPU risk below is **not detectable by the deploy verification loop** and needs a
  separate observability review once generation exists.

## Risk Register

| Risk                                                                                                                                                                                                         | Source           | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Story-format generation exceeds 10 ms free-tier CPU; user sees a raw Cloudflare error, breaching the Polish-plain-language NFR                                                                               | Devil's advocate | M          | H      | Wrap the parse/validate/render path in a try/catch returning a Polish message; measure actual CPU per invocation via observability on the first real story generations; move to the $5/mo paid plan (30 s CPU default) if the story path is anywhere near the ceiling                                                                                                                                                                                             |
| Public URL permanently becomes `10x-astro-starter.workers.dev` because Workers cannot be renamed                                                                                                             | Devil's advocate | H          | M      | Change `name` in `wrangler.jsonc` to `storygen` **before** the first `wrangler deploy`; also fix `name` in `package.json`                                                                                                                                                                                                                                                                                                                                         |
| Agent writes `Astro.locals.runtime` for the FR-012/FR-013 counters and gets `undefined` at runtime, not a type error                                                                                         | Devil's advocate | H          | M      | Record in `CLAUDE.md` that adapter v13 removed `Astro.locals.runtime`; use `astro:env` for declared vars and `import { env } from "cloudflare:workers"` otherwise                                                                                                                                                                                                                                                                                                 |
| Outbound `fetch()` to the app's own hostname loops back into the Worker once a custom domain is attached                                                                                                     | Unknown unknowns | M          | M      | Add `"global_fetch_strictly_public": true` to `compatibility_flags` in `wrangler.jsonc` now, before any custom domain exists                                                                                                                                                                                                                                                                                                                                      |
| Local success gives false confidence — `astro dev` runs workerd without enforcing CPU or subrequest limits                                                                                                   | Unknown unknowns | H          | M      | Treat the first deployed story generation as the real test; check the observability dashboard for CPU-time distribution before declaring the format contract done                                                                                                                                                                                                                                                                                                 |
| LLM provider key committed via `wrangler.jsonc` `vars` instead of `wrangler secret put`, breaching the Success Criteria guardrail                                                                            | Unknown unknowns | M          | H      | Keep every credential out of `wrangler.jsonc`; `.dev.vars` locally, `wrangler secret put` in production; add a pre-commit grep for provider key prefixes if one is available                                                                                                                                                                                                                                                                                      |
| Auto-deploy-on-merge never runs, so deploys stay manual indefinitely                                                                                                                                         | Pre-mortem       | H          | M      | `.github/workflows/ci.yml` triggers on `master` but the branch is `main` — fix the trigger, then add a deploy job gated on the lint and build steps                                                                                                                                                                                                                                                                                                               |
| Application-wide daily ceiling (FR-013) costs two Supabase round-trips on every request because Workers are stateless                                                                                        | Pre-mortem       | M          | M      | Combine the per-account and application-wide counter reads into one query or RPC; if latency becomes visible, cache the app-wide counter in Workers KV with a short TTL rather than adding a second platform                                                                                                                                                                                                                                                      |
| Free tier 429s rather than degrading, with no warning and no visibility from traffic volume                                                                                                                  | Unknown unknowns | L          | M      | Watch request counts in observability; the $5/mo paid plan removes the hard stop and raises CPU at the same time — one upgrade addresses two register entries                                                                                                                                                                                                                                                                                                     |
| Bumping the compatibility date to pick up a runtime fix silently changes Node-compat semantics (v1 to v2 at `2026-08-04`)                                                                                    | Unknown unknowns | M          | M      | Treat any `compatibility_date` change as a behavioural change, not config: bump it on its own commit and re-verify Supabase SSR auth end to end                                                                                                                                                                                                                                                                                                                   |
| Supabase round-trip latency from edge-distributed Workers degrades the history page (FR-010)                                                                                                                 | Devil's advocate | L          | M      | Choose a Supabase region near the expected users (Polish-only interface implies EU); paginate history rather than issuing per-item queries                                                                                                                                                                                                                                                                                                                        |
| `tech-stack.md` says Cloudflare Pages, which the adapter no longer supports — a future reader or agent runs `wrangler pages deploy` and fails                                                                | Research finding | H          | L      | Correct the deployment sentence in `context/foundation/tech-stack.md` to Workers; the deploy plan must name `wrangler deploy` explicitly                                                                                                                                                                                                                                                                                                                          |
| Adapter v13 auto-injects a `SESSION` KV namespace binding with **no `id`**, plus an `IMAGES` binding, neither of which the project asked for — the first real deploy may fail on the unprovisioned namespace | Research finding | M          | M      | Discovered 2026-08-24 by reading real build output, not docs: the build logs "Enabling sessions with Cloudflare KV" and the generated config carries `"kv_namespaces":[{"binding":"SESSION"}]`. `--dry-run` does not validate remote resources, so this is unresolved until the first real deploy. If it fails, either create the KV namespace or set `session: false` in `astro.config.mjs` — the app uses Supabase cookie auth and needs no Astro session store |

## Getting Started

Commands validated against this project's pinned versions — Astro 6.3, `@astrojs/cloudflare`
13.5, `wrangler` 4.90 — not against general platform documentation. Two notes on why these
differ from most published tutorials: `wrangler pages deploy` does **not** apply to this
stack (adapter v13 dropped Pages), and there is **no separate `wrangler dev` step**, because
`astro dev` already runs on workerd via the adapter's Vite integration since v13.

A third note, discovered by running these steps rather than reading about them: **the build
must precede the deploy, structurally.** `@cloudflare/vite-plugin` writes a generated
`wrangler.json` into `dist/server/` and a `.wrangler/deploy/config.json` redirect at the
project root, overriding `main` (to the bundled entry chunk) and `assets.directory` (to
`../client`). Running `wrangler deploy` without a build leaves wrangler reading the root
`wrangler.jsonc`, whose `assets.directory: "./dist"` is inert under v13 and whose `main` is an
unbundleable bare specifier. The `deploy` script below encodes that ordering so it cannot be
forgotten.

1. ~~Rename the Worker~~ — **done.** `name` is `storygen` in both `wrangler.jsonc` and
   `package.json` (commit `b5c3328`). Workers cannot be renamed after creation, so this had to
   land before the first deploy.

2. ~~Add the compatibility flag~~ — **done.** `compatibility_flags` is now
   `["nodejs_compat", "global_fetch_strictly_public"]`, and the flag was **verified accepted**
   by `wrangler deploy --dry-run` on 2026-08-24.

3. **Use the deploy scripts, not bare commands.** Added to `package.json`:

   ```jsonc
   "deploy": "astro build && wrangler deploy",
   "deploy:dry": "astro build && wrangler deploy --dry-run",
   ```

   Note there is **no `--yes` flag on `wrangler deploy`** in 4.90 — verified by running it, it
   returns `ERROR Unknown argument: yes` and aborts. `-y` exists only on `rollback` and
   `versions deploy`. No `astro sync` either: `astro build` already syncs, and the standalone
   `npx astro sync` is for regenerating types before _linting_.

4. **Authenticate.** `npx wrangler login` (OAuth) is the right choice for a human first
   deploy. Defer the API token until deploys are automated, then scope it to **Workers
   Scripts: Edit** plus **Workers Tail: Read**, Zone Resources _none_, with a TTL in weeks and
   never `Account API Tokens: Edit`. Caveat: the Workers Scripts resource selector appears to
   be account-granular rather than per-script, so "token limited to this Worker only" is
   probably not achievable — verify in the dashboard, and treat a single-project account, token
   TTL, and IP filtering as the real controls.

5. **Verify the artifacts before uploading anything.** `npm run deploy:dry` gives a full
   config parse, redirect resolution, compatibility-flag validation, and bundle assembly with
   no upload and no Worker creation. Then confirm `dist/server/wrangler.json` shows
   `"no_bundle": true` and `"assets": {..., "directory": "../client"}` — that `directory` is
   what proves the server bundle will not be published as a public static asset. Also confirm
   `dist/` holds **zero `.html` files**: nothing in `src/` exports `prerender`, so a leftover
   `.html` from an older static build would upload as an asset and permanently shadow its SSR
   route. Measured 2026-08-24: 21 modules, gzip 390.68 KiB — well under the 3 MB free-tier
   bundle limit.

6. **First deploy is a human action.** `npx wrangler deploy` _creates_ the Worker, and the
   name it creates is permanent, so this one command stays manual. Every deploy after it is
   `npm run deploy`. Record the `Current Version ID` from the output — the first deploy has no
   rollback target, so that ID is the anchor for the second one.

7. **Deploy before setting secrets, not after.** This ordering is forced: `wrangler secret put`
   against a Worker that does not exist prompts to create one and defaults to _yes_ when
   non-interactive, producing a stub Worker that answers 1101 on every request. Deploying real
   code first makes Worker creation deliberate. This project can afford the split because it is
   built to boot unconfigured — `createClient()` returns `null` and a Polish banner renders, so
   a secret-less deploy is a supported, browsable state that isolates platform failures from
   credential failures.

8. **Then set the secrets, interactively.** Run `npx wrangler secret put SUPABASE_URL` and
   again for `SUPABASE_KEY`. Use the prompt rather than a pipe: input is hidden, so the value
   never enters shell history, a file, or an agent transcript. (`echo -n` does not exist in
   PowerShell in any case.) `SUPABASE_KEY` must be the **anon/publishable** key — a
   `service_role` key bypasses RLS and silently breaks the PRD guarantee that no generation is
   readable by another account, with no error and no test that catches it. Mirror the same names
   into `.dev.vars` for local dev. Verify with `npx wrangler secret list --format json`, which
   returns names and types only, never values; the functional proof is the Polish banner
   disappearing from `/`.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup (the `master`-vs-`main` trigger bug is recorded as a risk, not fixed here)
- Production-scale architecture (multi-region, HA, DR)
