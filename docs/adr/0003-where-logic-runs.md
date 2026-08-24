# ADR-0003: Where logic runs — the frontend / backend contract

- Status: accepted (2026-08-22)
- Related: ADR-0001 (RLS is the sole security boundary), ADR-0004 (codebase shape)

## Context

The app is a Vue 3 single-page client talking to Supabase directly (anon key + the signed-in user's JWT). Over time
logic landed in three places — the browser, Postgres (RLS, functions), and Deno edge functions — without a written rule
for which goes where. Refactoring at scale needs that rule, otherwise "move it to the backend" and "keep it in the
client" both sound reasonable for the same code.

## Decision

**The client (Vue) owns** UX state, UX-level validation, composition of reads, optimistic UI. It uses only the anon key
and the user's JWT. Nothing is *secured* in the client; client checks exist for UX (ADR-0001).

**Postgres owns**
- row access — RLS policies (ADR-0001); `scripts/verify-rls.mjs` is the regression test;
- the schema and every schema change — the ledgered patches in `supabase/db-patches/` (never from the client, never by
  hand outside the ledger);
- cross-row / aggregated / privileged reads — `SECURITY DEFINER` functions called via RPC, which are **their own
  authorization boundary**: the body checks the caller (`auth.uid()`, `is_moderator()`, …), `search_path` is fixed,
  `execute` is revoked from `anon`/`public`, and each is named by use case (`dashboard_stats`, `export_pins`,
  `admin_list_profiles`). Views are `security_invoker`.

**Edge functions own only** what neither the browser nor Postgres can do: secrets (`notify_discord`),
hosts without CORS (`mirror-photo`), scheduled jobs (`purge_deleted`). They never apply arbitrary client-supplied
filters with the service role. Every function is declared in `supabase/config.toml`.

**In client code** this shows up as: `shared/data/repos/*` = one thin wrapper per table; services (per page or per
shared domain) = use-case functions and RPC wrappers; components and composables never touch the Supabase client.

## Consequences

- A new capability is placed by asking, in order: does it need a secret or a non-CORS host → edge function; does it
  read across rows / need privilege → SECURITY DEFINER RPC (with its own check); otherwise → client through repos
  under RLS.
- Adding an RPC or policy is a DB patch with a version bump; the client change follows in the same PR or a later one.
- Removing an edge function or RPC must keep ADR-0001 true: no path to the data that bypasses RLS or a body check.
