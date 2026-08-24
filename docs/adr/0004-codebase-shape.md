# ADR-0004: Codebase shape — app / pages / shared

- Status: accepted (2026-08-22)
- Related: ADR-0003 (where logic runs), issue #97 (plan and steps), the structural-PR workflow in `CONTRIBUTING.md`

## Context

The app grew page by page (map, report form, reports, KML import, users, bulk photos, deleted pins, export,
dashboard); `src/components/` was the organising folder, `src/utils/` became a catch-all, and several pages passed
1,000–5,500 lines. Research for growing Vue apps converges on *feature/page folders plus a shared folder* (the official
`create-vue` scaffold is flat and meant for small apps; Feature-Sliced Design is for large ones). The owner's concern
is drift: refactoring without a designed destination.

## Decision

### Directory structure
```
src/
  app/        the shell, things that exist once: main.js, App.vue, router/
  pages/      one folder per routed page: <Name>Page.vue, components/, useX.js composables, <name>Service.js, tests
              map/ (incl. report-form/ — opened from the map), reports/, deleted-pins/, bulk-photos/, kml-import/,
              dashboard/, export/, manage-users/
  shared/     used by more than one page
    ui/       domain-free UI: toast, confirm, lightbox, autosuggest, leaflet helpers
    lib/      pure helpers, no Vue, no domain: dates, place, coords, withTimeout, logger, errors, photo utils, validators
    domain/   glossary-level logic and pin/activity-aware components, composables, services used by ≥2 pages
    data/     Vue-free data access: supabase client, repos/ (one per table), photo storage/keys, telemetry
    auth/     session store (the only app-wide state), auth service, auth modals
```
Naming: page folders kebab-case; routed page `<Name>Page.vue` at the folder root; child components in `components/`;
composables `useX.js`; a page's data access `<name>Service.js`; pure modules plain nouns with `.test.js` siblings;
fixtures in `__fixtures__/`; all imports use the `@/` alias (`@/shared/lib/date`, `@/pages/reports/reportsService`).

### Placement
| Produced | Home |
|---|---|
| routed page | `pages/<name>/<Name>Page.vue` |
| component / composable used by one page | that page folder (`components/` for `.vue`) |
| domain-free component / composable used by ≥2 pages | `shared/ui/` |
| pin/activity-aware component / composable / service used by ≥2 pages | `shared/domain/` |
| pure helper | `shared/lib/` |
| a page's queries / RPC wrappers | `pages/<name>/<name>Service.js` |
| table wrapper | `shared/data/repos/` |
| session / role state | `shared/auth/sessionStore.js` |
| DB change | `supabase/db-patches/` |
| tests / fixtures | beside the module / `__fixtures__/` |

### Import contract
1. `app → pages → shared`. Nothing imports `app`. **Pages never import other pages** — anything two pages need moves to
   `shared`. The router imports `@/pages/<x>/<X>Page.vue`.
2. Inside `shared`: `ui`, `lib` are domain-free (`ui` may import `lib`; `lib` imports nothing else); `domain` may
   import `ui`, `lib`, `data`, `auth`; `data` is Vue-free and imports only libraries and `lib`; `auth` may import
   `ui`, `lib`, `data` (its modals use the toast; roles live in `shared/auth/roles.js`).
3. Only `shared/data/*`, `shared/domain/*Service.js`, `shared/auth/authService.js`, `shared/auth/sessionStore.js` (the
   session listener) and `pages/*/*Service.js` touch the Supabase client / repos. Components and composables get data
   through services; RPC calls live in services.
4. Pages are thin: template + composable wiring; no data access, no business rules (size limit: §6).
5. One implementation per concept (dates/place/coords → `shared/lib`; activity lifecycle → `shared/domain`; photo
   keys/URLs → `shared/data/photoKeys` (storage I/O in `photoStorage`); roles → `shared/auth/roles`, including the
   router guard).
6. Size guards: `.vue` ≤ 600 lines (pages ≤ 400), composable ≤ 300, service ≤ 300 — split by responsibility, not by
   line count.
7. Tests beside modules; pure modules must have tests; composables with logic are tested with mocked services; no
   component-test framework until a component carries logic that cannot live in a composable.
8. State: per-page state lives in that page's composables; `useSessionStore()` is the only app-wide state (no Pinia).
9. Tests (`*.test.*`) may import any module — e.g. the export writer's round-trip test through the KML parser.

## Consequences

- The contract is enforced: `eslint.config.js` encodes §1–§3 as `no-restricted-imports` patterns per layer (imports
  use the `@/` alias, so no resolver is needed) and `scripts/check-sizes.mjs` encodes §6 with a list of documented
  exceptions; `npm run lint` runs both and is the first step of `npm run build` (#97 step 4). The README "Repo
  layout" must match the tree.
- Every structural PR posts a touch-point manifest before code moves and stays behaviour-neutral —
  duplicates removed, size guards met, docs current (workflow in `CONTRIBUTING.md`).
