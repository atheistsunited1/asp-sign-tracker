# ADR-0001: Postgres RLS is the sole security boundary

Date: 2026-07-30
Status: accepted

## Context

The app is a Vue SPA talking directly to Supabase with the (public by design)
anon key. Every line of `src/` — components, services, repos, role helpers,
router guards — executes on an untrusted machine and can be bypassed by anyone
with devtools and the Supabase URL. The 2026-07-30 schema snapshot showed
`pins`, `reports`, `photos`, and `profiles` with RLS disabled and `GRANT ALL`
to `anon`: any visitor could read all profiles, self-escalate to admin, and
rewrite all map data. An earlier refactor had moved database calls into
`src/data/repos` and `src/data/services`, which improved maintainability but —
running client-side — could not and did not change what an attacker could do.

The genuine alternative was inserting a server tier (API or more edge
functions) between the SPA and the database and putting authorization there.
(Paths above are as of 2026-07-30; the client code now lives under `src/shared/`,
with role helpers in `src/shared/auth/roles.js` — the decision is unchanged.)

## Decision

Authorization is enforced exclusively in Postgres: RLS policies, table/function
grants, and `SECURITY DEFINER` guards, versioned as patches in
`supabase/db-patches/`. No server tier is added. Client-side role checks
(`shared/auth/roles.js`, router guards, UI gating) are user experience only; they may
hide buttons but must never be the reason an operation is safe. Privileged
back-office work stays in edge functions running with the service role.

## Consequences

- Every new table ships with RLS enabled and explicit per-role policies in the
  same patch that creates it; every new RPC states who may execute it.
- The access matrix (guest → member → mapmaster → admin, pending/denied
  contribution lifecycle) lives in the database and is testable from outside
  via `scripts/verify-rls.mjs`.
- The SPA keeps its layering for maintainability, but a compromised or bypassed
  client can do nothing the policies do not allow.

## Rejected

A custom API tier in front of Supabase: forfeits RLS as the boundary or
duplicates it in middleware, re-implements auth token handling, and adds a
second deployable — with no new capability for this app's needs.
