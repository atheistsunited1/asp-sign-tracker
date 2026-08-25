# ADR-0002: Sessions end after 1 hour of inactivity, enforced by Supabase Auth

Date: 2026-08-21 (amended 2026-08-24: values set to 1 h / 3600 s)
Status: accepted

## Context

The Feb 2026 UI review asked whether members should be logged out after a
period of inactivity. The app is a Vue SPA using supabase-js with
`persistSession` and `autoRefreshToken`; by default a session lives as long as
its refresh token keeps being used, i.e. indefinitely. Members use the app on
personal phones in the field; a modal "you will be logged out" warning was
judged too invasive, and a client-side idle timer was judged fragile
(background tabs, device sleep, photo uploads in flight).

## Decision

1. **Server-side enforcement.** Supabase Auth's session *inactivity timeout* is
   set to **1 hour** (`[auth.sessions] inactivity_timeout = "1h"` in
   `supabase/config.toml`; Dashboard → Authentication → Sessions on the hosted
   project, Pro plan). No client timer, no warning modal.
2. **Access-token expiry stays at the platform default, 3600 s.** The hosted
   dashboard no longer exposes this field (2026-08 UI); changing it requires
   the Management API, and the 600 s value originally chosen was declined as
   not worth the operational step (2026-08-24). Supabase measures inactivity
   from the **last token refresh** and checks it only when the client next
   refreshes; supabase-js refreshes shortly *before* the access token expires,
   so an open tab refreshes at ~59 min — just inside the 1-hour window.
3. **The margin is thin and accepted.** With expiry equal to the inactivity
   window, an open-but-idle tab renews with only ~1 minute to spare; a device
   that sleeps across that boundary fails its next refresh and drops to guest.
   The cost is a re-login, which is the feature working. If this proves
   annoying in practice, the remedy is lowering the token expiry via the
   Management API (not raising the inactivity window).
4. **"Activity" means the app is open in a visible tab.** supabase-js pauses
   auto-refresh on hidden tabs and the app already re-checks the session on
   `visibilitychange`. Typing or clicking is not tracked — it needn't be.
   Idle-while-open detection is explicitly out of scope.
5. **The UI states what happened.** When the server ends a session (refresh
   rejected) supabase-js emits `SIGNED_OUT`; the app drops to guest, closes
   member-only trays, and shows "Signed out after 1 hour of inactivity.
   Log in to continue." A user-initiated Log out is distinguished and keeps its
   own message.

## Consequences

- Members who keep a visible tab open are normally never interrupted; members
  who return after >1 h away log in again. The hosted setting is silent on the
  Free plan — the behavior only exists where the plan supports it.
- One refresh call per ~59 min per open tab; negligible load.
- A revoked or de-approved user's existing access token can stay valid up to
  1 h (the refresh re-checks). Accepted; the login-approval gate and RLS
  bound what such a token can do.
- Any future "warn before logout" UX would have to be client-side and is
  deliberately not built.
- Verification: sign in; keep the tab visible ~65 min → still signed in
  (refresh at ~59 min); close the tab for >1 h and reopen → toast and guest
  state.
