@AGENTS.md

## Working this repo

- **Issues** are tracked in GitHub Issues (this repository) via the `gh` CLI. Label vocabulary:
  `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- **Domain docs**: one glossary — `CONTEXT.md` — plus decision records in `docs/adr/`. Use the
  glossary's terms in UI text, code and issues; propose a `CONTEXT.md` PR when a term is missing.
- **Codebase shape**: `src/` is `app/ · pages/<routed-page>/ · shared/{ui,lib,domain,data,auth}` —
  placement table and import contract in `docs/adr/0004-codebase-shape.md`, client/DB split in
  `docs/adr/0003-where-logic-runs.md`; both enforced by `npm run lint`. Structural PRs post a
  touch-point manifest (every symbol/file → destination) on the PR **before** moving code, stay
  behaviour-neutral, use `git mv`, and keep the README layout current.
