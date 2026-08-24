# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub's *Report a vulnerability* button on this
repository's Security tab (private vulnerability reporting). Do not open a public issue for a
security problem. We aim to acknowledge reports within a week.

Please include what you found, where (URL/table/RPC/function), and reproduction steps. Proof-of-concept
access using your own account is fine; do not access, modify or delete other people's data.

## Supported version

The deployed app builds from the `main` branch; only `main` receives security fixes.

## Security model (what a report is measured against)

- **Postgres Row-Level Security is the sole security boundary**
  (`docs/adr/0001-rls-sole-security-boundary.md`). The Supabase project URL and anon key are public
  by design; nothing in the client is a secret or an enforcement point.
- Anything the anon key can read/write that RLS should forbid **is a vulnerability** — that is the
  most valuable kind of report. `scripts/verify-rls.mjs` is our own regression probe for this.
- SECURITY DEFINER RPCs check authorization in their body; edge functions hold the only privileged
  credentials (never in this repo).
