# ASP Sign Tracker

A mobile-first, map-based app for documenting illegally posted signs and the activity around them
(sightings, removals), built for the Atheist Street Pirates ([Atheists United](https://www.atheistsunited.org/streetpirates)).
Members report signs with photos and GPS; moderators de-dupe, approve and publish to a shared map.
It replaces text threads and Google My Maps with a standardized, auditable pipeline.

The domain vocabulary (pin, activity, plundered, krakened, Major Campaign, …) is defined once in
[`CONTEXT.md`](CONTEXT.md); architecture decisions live in [`docs/adr/`](docs/adr/).

## Features

- **Report** — tap-to-report with GPS/EXIF coordinates, photo staging + client-side compression,
  nearby-pin detection (≤ 20 m) to avoid duplicates, bulk photo reports for admins.
- **Moderate** — review queue (pending / approved / deleted tabs), edit + approve, deny =
  soft-delete with a restore window, full pin history.
- **Map** — Leaflet with canvas pin icons, legend with live counts and filters, search
  (pin ID / city / ZIP / coordinates), bookmarks, locate/follow.
- **Import / Export** — KML import of legacy Google My Maps layers (in-app guide on the page);
  KML/CSV export shaped so exports re-import losslessly.
- **Dashboard** — quarterly-report KPIs for mapmasters/admins.
- **Notify** — Discord posts on new submissions via an Edge Function.

## How it works

```
Member → report form (or bulk photos)
  photos:   rotate → compress → upload → photos rows
  rows:     new pending pin — or merge into an existing pending pin + its oldest pending report
  then:     fire-and-forget Discord notification

Moderator → /reports
  approve:  pin + activity become visible on the map (lifecycle guarded: no duplicate finals)
  deny:     soft-delete with audit trail; /reports/deleted restores or purges within 30 days
  cleanup:  scheduled purge_deleted edge function hard-deletes expired soft-deletes
```

Where logic runs (client vs Postgres vs edge functions) is ADR-0003; the submission pipeline lives
in `src/shared/domain/` (`activitySubmissionService`, `photoUploadService`, `activityLifecycleService`).

## Tech stack

- **Frontend:** Vue 3 (`<script setup>`), Vite, Vue Router, Leaflet 1.9, ECharts (dashboard)
- **Backend:** Supabase — Postgres with Row-Level Security, Storage, Edge Functions (Deno)
- **Auth:** Supabase Auth — email + password, email reset
- **Notifications:** Discord webhooks

## Repo layout

The shape, placement table and import contract are ADR-0004, enforced by `eslint.config.js` and
`scripts/check-sizes.mjs` (both run in `npm run build`). Directories only — files change too often
to list here:

```
src/
  app/            shell: main.js, App.vue, router, nav/account components, session provides
  pages/<page>/   one folder per routed page (map incl. report-form, reports, deleted-pins,
                  bulk-photos, kml-import, dashboard, export, manage-users)
  shared/         used by ≥2 pages: ui/ (domain-free), lib/ (pure helpers), domain/ (services +
                  domain logic), data/ (supabase client, repos, storage), auth/ (session, roles)
supabase/
  functions/      mirror-photo, notify_discord, purge_deleted (declared in config.toml)
  db-patches/     the versioned schema ledger — see supabase/README.md
  db-snapshot/    the version-0 baseline schema export
scripts/          verify-rls.mjs, smoke-routes.mjs, check-sizes.mjs, style-snapshot.mjs, debug/
docs/adr/         architecture decision records
```

## Quick start

Prereqs: Node ≥ 22.12 (`package.json` `engines`), npm, a Supabase project (hosted, or local via the
Supabase CLI).

```bash
git clone https://github.com/atheistsunited1/asp-sign-tracker.git
cd asp-sign-tracker
npm install
cp .env.example .env        # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                 # http://localhost:5173
```

The anon key is public by design — Postgres RLS is the sole security boundary (ADR-0001,
[`SECURITY.md`](SECURITY.md)). Apply the schema per [`supabase/README.md`](supabase/README.md).
Checks and workflow: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Deploying

**Frontend** — any static host. Netlify config is in `netlify.toml` (SPA redirect, Node version,
the public-by-design `VITE_*` env vars). Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
optionally `VITE_APP_BASE_URL` (share-link base; defaults to the page origin).

**Edge Functions** — copy `supabase/.secrets.prod.example` to `supabase/.secrets.prod` (gitignored),
fill in the Discord/purge secrets, then from `supabase/`:

```bash
supabase secrets set --env-file .secrets.prod
supabase functions deploy notify_discord mirror-photo purge_deleted
```

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected into hosted functions automatically —
never put them in the file, never expose the service-role key to the frontend. Schedule
`purge_deleted` daily (Dashboard → Edge Functions → Schedules; `POST`, body `{"days":30}`,
header `x-cron-secret: <PURGE_CRON_SECRET>`).

## Database & storage

- The schema lives in `supabase/db-snapshot/` + the `supabase/db-patches/` ledger — truth model and
  change procedure in `supabase/README.md`.
- Every table ships with RLS; `scripts/verify-rls.mjs` probes the access matrix from outside.
- Storage: one public bucket `sign-photos`; every writer stores objects as
  `{pin_id}/{report_id}/{photo_id}.{ext}` (`src/shared/data/photoKeys.js`), and `photos.image_url`
  holds the public URL (cleanup derives keys from it).

## Routing & roles

| Route | Access |
|---|---|
| `/` (map) | public |
| `/reports` | authenticated |
| `/import-kml`, `/reports/deleted`, `/dashboard`, `/export` | mapmaster/admin |
| `/bulk-photo-reports`, `/manage-users` | admin |

The router guard checks the session then the role gate (`src/shared/auth/roles.js`) — user
experience only (ADR-0001). Sessions end after 30 minutes of inactivity — ADR-0002, including the
hosted-project settings that make it hold.

## Basemaps

Streets = OpenStreetMap standard tiles (keep traffic modest per OSM policy). Satellite = USGS
"Imagery Only" (public domain, US-only, native zoom ends at 16 — deliberately upsampled). Google/Esri
tile endpoints are deliberately not used (licensing) — decision record in issue #67.

## Contributing, security, license

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, checks, branch/PR flow, database-change rules.
- [`SECURITY.md`](SECURITY.md) — how to report vulnerabilities (privately), and the security model.
- **License:** MIT — see [`LICENSE`](LICENSE). Copyright (c) 2026 Atheists United.

### Contributing anonymously

You are welcome to contribute without linking your real identity: 

- Create a separate GitHub account with no personal details.
- Update account Settings → Emails: enable **Keep my email addresses private** and **Block command line pushes that expose my email**.
- Fork this repo and open a pull request from that account.

- Commit with that account's noreply address (`ID+username@users.noreply.github.com` — shown on the same settings page), e.g.:
  ```bash
  git config user.name "your-alias"
  git config user.email "ID+your-alias@users.noreply.github.com"
  ```
- Your fork, commits and pull request then carry only that persona. Avoid starring, watching or
  commenting from an account you don't want associated.
