# Production Readiness

What runs in production, where it's administered, and the decisions behind it — so a team
member can orient in minutes. This is a map, not a runbook: each fact links to its source of
truth (ADRs, configs, issues) instead of restating it. No secrets appear here or anywhere in
this repo.

## At a glance

| Component | What runs there | Administered in |
|---|---|---|
| **GitHub** (`atheistsunited1/asp-sign-tracker`) | Source, issues, CI, releases | GitHub Settings (owner account) |
| **Netlify** | The site: [asp-sign-tracker.netlify.app](https://asp-sign-tracker.netlify.app), builds from `main` | Netlify dashboard (AU account) |
| **Supabase** (Pro) | Postgres + RLS, auth, storage, edge functions, cron | Supabase dashboard (AU account) |
| **Resend** | Auth email delivery (SMTP) for `atheistsunited.org` | Resend dashboard (AU account) |
| **Discord** (AU server) | Sighting notifications per regional channel | In progress — [#6](https://github.com/atheistsunited1/asp-sign-tracker/issues/6) |

## Release flow

- Work lands on feature branches → PR to `develop` → release PR `develop → main` → Netlify
  deploys `main`. Build/publish/headers all come from `netlify.toml`.
- Rulesets require PRs on both branches (no direct pushes, no force-push/deletion); `main`
  additionally requires the `check-source` CI check, so releases can only merge from `develop`
  (`.github/workflows/enforce-release-branch.yml`).
- Only the owner account can merge (no collaborators — see Access below). CI (`build-and-test`)
  runs lint, tests, and build; the lint gate includes the import contract and size guards
  ([ADR-0004](adr/0004-codebase-shape.md)).

## Security model

- **Postgres RLS is the sole security boundary** — the anon API key ships in the client bundle
  by design; every permission lives in policies ([ADR-0001](adr/0001-rls-sole-security-boundary.md)).
  `scripts/verify-rls.mjs` probes the live API and must stay green.
- Accounts require **admin approval**: unapproved users cannot hold a session (signed out with a
  pending notice), and RLS denies them all member writes regardless.
- Guest (logged-out) reads of approved activity go through dedicated `SECURITY DEFINER` RPCs;
  the underlying tables stay members-only.
- Strict **CSP + security headers** served by Netlify for all routes (see `netlify.toml`).
- Repo protections: secret scanning + push protection, Dependabot alerts/updates, private
  vulnerability reporting, read-only workflow permissions
  ([#1](https://github.com/atheistsunited1/asp-sign-tracker/issues/1)).

## Data & schema

- Schema truth = the baseline snapshot in `supabase/db-snapshot/` **plus** the ledgered patches
  in `supabase/db-patches/` — contract and naming in [supabase/README.md](../supabase/README.md).
- The `database_patch_version` ledger row in the database says exactly what's applied; patches
  gate on it and advance it atomically.

## Auth & email

- Email + password signup with **email confirmations ON**; the pending profile row is created
  server-side by a trigger at signup.
- Login accepts **email or username** (username resolves server-side via the
  `login_with_username` edge function — uniform errors, no email disclosure).
- Sessions: 1 h inactivity timeout, access tokens at the platform default
  ([ADR-0002](adr/0002-session-inactivity-timeout.md)).
- Auth email is delivered by **Resend** (custom SMTP, domain-verified, sender
  `noreply@atheistsunited.org`); templates cover confirmation, password reset, and an
  account-already-exists notice for signup collisions.

## Scheduled & serverless

| Edge function | Purpose |
|---|---|
| `notify_discord` | Posts sighting notifications to the regional Discord channel ([#6](https://github.com/atheistsunited1/asp-sign-tracker/issues/6)) |
| `login_with_username` | Username login (server-side email lookup) |
| `mirror-photo` | Copies external photo URLs into the `sign-photos` storage bucket |
| `purge_deleted` | Hard-deletes soft-deleted rows older than 30 days; invoked by a daily cron (09:00 UTC, pg_cron + pg_net), authenticated by a shared secret |

Storage: `sign-photos` is a public-read bucket (object URLs work for everyone); bucket
*listing* is moderator-only.

## Access & secrets

- Production services are owned by **Atheists United accounts**; repository actions happen under
  the org identity. Outside contributors use **fork + PR** (anonymous contributions per the
  README); there are no collaborators by decision.
- Secrets (edge-function tokens, cron secret, SMTP key) live only in the Supabase secrets store
  and gitignored local files — never in the repo, issues, or client code. The Supabase URL and
  anon key are public by design (see Security model).

## Deferred by decision

- Discord bot rollout — in progress ([#6](https://github.com/atheistsunited1/asp-sign-tracker/issues/6)).
- Full member/admin RLS matrix on a local seeded stack ([#11](https://github.com/atheistsunited1/asp-sign-tracker/issues/11)).
- Custom domain + HSTS preload.

## Quick verification

```sh
node scripts/verify-rls.mjs        # anon RLS matrix against production — must pass
npm run lint && npx vitest run && npm run build   # the release gate, locally
curl -sI https://asp-sign-tracker.netlify.app | grep -i content-security-policy   # headers live
```
