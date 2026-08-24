# Contributing

Thanks for helping track down illegally-posted signs! This file is the short version; the deeper
references are `README.md` (setup, architecture), `CONTEXT.md` (glossary — a *pin* is a sign, an
*activity* is a dated event on it) and `docs/adr/` (the decisions the code follows).

## Dev setup

Follow the README's **Quick start**. You will need your own Supabase project for full
functionality — schema per `supabase/README.md`.

## Checks

```bash
npm run lint      # ESLint incl. the ADR-0004 import-boundary rules + size guards   (CI gate)
npm run build     # lint + vite build (this is exactly what deploys run)            (CI gate)
npm test          # vitest                                                          (CI gate)
node scripts/smoke-routes.mjs   # headless route smoke — local/deploy check, not in CI (needs Chrome + a build)
```

## Making changes

- Branch from `develop`; PRs target `develop`. Releases are a PR `develop → main`.
- Where code goes is defined by `docs/adr/0004-codebase-shape.md` (`app/ · pages/<page>/ ·
  shared/{ui,lib,domain,data,auth}`); the lint enforces the import contract, and
  `scripts/check-sizes.mjs` enforces file-size guards (exceptions need a documented reason).
- Structural refactors: post a touch-point manifest (every symbol/file → destination) on the PR
  **before** moving code; stay behaviour-neutral, move with `git mv`, keep the README layout current.
- Pure modules get tests beside them (`*.test.js`). Behaviour changes should say so in the PR
  ("Deliberate visible changes"), everything else is expected to be neutral.
- Database changes are ledgered patches in `supabase/db-patches/` — never ad-hoc SQL, never from the
  client. RLS on every table; new RPCs check authorization in the body.
- Issue labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.

## Security

Do not open public issues for vulnerabilities — see `SECURITY.md`.
