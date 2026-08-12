---
bootstrapped_at: 2026-08-12T12:34:09Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: storygen
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Read from `context/foundation/tech-stack.md` (the invocation argument `@tech-stack.md`
resolved to a repo-root path that does not exist; the default chain location was used).

```yaml
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
```

### Why this stack (verbatim from the hand-off body)

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

## Pre-scaffold verification

| Signal      | Value                                                       | Severity | Notes                                                                                     |
| ----------- | ----------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| npm package | not run                                                     | n/a      | `cmd_template` starts with `git clone`; no `create-*` CLI to resolve                       |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17   | fresh    | from `card.docs_url`; `gh` CLI unavailable, read via the GitHub REST API instead (2.9 mo) |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 31536 (49 outside `node_modules/`)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold`
**.gitignore handling**: moved silently (absent in cwd)
**.bootstrap-scaffold cleanup**: deleted
**Upstream `.git/`**: deleted before move-up; cwd's own `.git/` untouched

Top-level entries moved into cwd: `.env.example`, `.github/`, `.gitignore`,
`.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `README.md`,
`astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`,
`package-lock.json`, `package.json`, `public/`, `src/`, `supabase/`,
`tsconfig.json`, `wrangler.jsonc`.

`context/` carried no scaffold counterpart; the existing tree is untouched.
`CLAUDE.md` in cwd won; the starter's copy sits beside it as `CLAUDE.md.scaffold`.

Local toolchain at scaffold time: Node v22.18.0, npm 10.9.3 (card expects node 22).
`npm install` reported 773 packages added with two deprecation warnings
(`@babel/plugin-proposal-private-methods`, `node-domexception`).

## Post-scaffold audit

**Tool**: `npm audit --json` (exit code 1 — informational, not a halt)
**Summary**: 1 CRITICAL, 13 HIGH, 7 MODERATE, 2 LOW (23 total across 895 dependencies: 449 prod, 316 dev, 131 optional)
**Direct vs transitive**: 0/1/2/0 direct of total 1/13/7/2 — three direct findings (`astro` HIGH, `supabase` MODERATE, `wrangler` MODERATE); the remaining 20 are transitive.

#### CRITICAL findings

- **tar** `<=7.5.20` (transitive, via `supabase`) — PAX size override applied to intermediary GNU long-name/long-link headers causes a tar parser interpretation differential (file smuggling); also a process crash via PAX numeric path type confusion. Fix available.

#### HIGH findings

- **astro** `<=7.0.9` (**direct**) — reflected XSS via unescaped slot name; Host header SSRF in the prerendered error page fetch. Fix available.
- **brace-expansion** `<=1.1.17 || 3.0.0 - 5.0.8` (transitive) — DoS via exponential-time expansion of consecutive non-expanding `{}` groups. Fix available.
- **devalue** `5.6.3 - 5.8.0` (transitive) — DoS via sparse array deserialization. Fix available.
- **fast-uri** `3.0.0 - 3.1.4` (transitive) — host confusion via literal backslash authority delimiter/introducer. Fix available.
- **js-yaml** `4.0.0 - 4.3.0` (transitive) — quadratic-complexity DoS in merge key handling via repeated aliases. Fix available.
- **miniflare** `3.20250204.0 - 5.20260801.0-alpha` (transitive, via `sharp`/`undici`) — inherited. Fix available.
- **nanoid** `<=3.3.16` (transitive) — non-secure generators loop indefinitely with negative size / zero size. Fix available.
- **postcss** `<=8.5.22` (transitive) — path traversal in previous-source-map auto-loading (`sourceMappingURL`) leading to arbitrary `.map` file disclosure. Fix available.
- **sharp** `<0.35.0` (transitive) — inherited libvips CVEs (CVE-2026-33327/33328/35590/35591). Fix available.
- **svgo** `4.0.0 - 4.0.1` (transitive) — `removeScripts` plugin leaves some executable scripts intact. Fix available.
- **undici** `7.0.0 - 7.28.0` (transitive) — TLS certificate validation bypass via dropped `requestTls` in SOCKS5 ProxyAgent; HTTP header injection via Set-Cookie percent-decoding. Fix available.
- **vite** `7.0.0 - 7.3.3` (transitive) — `server.fs.deny` bypass on Windows alternate paths; launch-editor NTLMv2 hash disclosure via UNC path handling on Windows. Fix available.
- **ws** `8.0.0 - 8.20.1` (transitive) — uninitialized memory disclosure; memory-exhaustion DoS from tiny fragments. Fix available.

#### MODERATE findings

- **supabase** `1.1.6 - 2.98.2` (**direct**) — inherits the `tar` CRITICAL above. Fix available.
- **wrangler** `3.108.0 - 4.101.0` (**direct**) — inherits `esbuild` and `miniflare`. Fix available.
- **@astrojs/language-server** `2.14.0 - 2.16.10` (transitive, via `volar-service-yaml`).
- **@cloudflare/vite-plugin** `0.0.7 - 1.41.0` (transitive, via `miniflare`/`wrangler`).
- **volar-service-yaml** `<=0.0.70` (transitive, via `yaml-language-server`).
- **yaml** `2.0.0 - 2.8.2` (transitive) — stack overflow via deeply nested YAML collections.
- **yaml-language-server** (transitive, via `yaml`).

#### LOW / INFO findings

- **@babel/core** `<=7.29.0` (transitive) — arbitrary file read via `sourceMappingURL` comment.
- **esbuild** `0.27.3 - 0.28.0` (transitive) — arbitrary file read when running the dev server on Windows.

Every finding reports a fix as available; bootstrapper does not run `npm audit fix`.
Note that the one direct HIGH is `astro` itself, which means the fix touches the
framework version the starter pins — worth checking against the starter's own
upgrade notes rather than applying blind.

## Hints recorded but not acted on

| Hint                    | Value                  |
| ----------------------- | ---------------------- |
| bootstrapper_confidence | first-class            |
| quality_override        | false                  |
| path_taken              | standard               |
| self_check_answers      | null                   |
| team_size               | solo                   |
| deployment_target       | cloudflare-pages       |
| ci_provider             | github-actions         |
| ci_default_flow         | auto-deploy-on-merge   |
| has_auth                | true                   |
| has_payments            | false                  |
| has_realtime            | false                  |
| has_ai                  | true                   |
| has_background_jobs     | false                  |

No CI/CD files were generated, and no feature-flag-driven modification was made to
the scaffold. The starter ships its own `.github/workflows/`, which arrived as part
of the clone rather than as bootstrapper output.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
