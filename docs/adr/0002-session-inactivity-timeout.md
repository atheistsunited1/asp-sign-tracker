# ADR-0002: Sessions end after 30 minutes of inactivity, enforced by Supabase Auth

Date: 2026-08-21
Status: accepted

## Context

The Feb 2026 UI review asked whether members should be logged out after a
period of inactivity (issue #65). The app is a Vue SPA using supabase-js with
`persistSession` and `autoRefreshToken`; by default a session lives as long as
its refresh token keeps being used, i.e. indefinitely. Members use the app on
personal phones in the field; a modal "you will be logged out" warning was
judged too invasive, and a client-side idle timer was judged fragile
(background tabs, device sleep, photo uploads in flight).

## Decision

1. **Server-side enforcement.** Supabase Auth's session *inactivity timeout* is
   set to **30 minutes** (`[auth.sessions] inactivity_timeout = "30m"` in
   `supabase/config.toml`; Dashboard → Authentication → Sessions on the hosted
   project, Pro plan). No client timer, no warning modal.
2. **Access-token expiry = 600 s**, deliberately far below the inactivity
   window. Supabase measures inactivity from the **last token refresh** and
   checks it only when the client next refreshes; supabase-js refreshes just
   before the access token expires. With a 1-hour token an actively used tab
   would refresh only every ~55 min, exceed the 30-min window, and be signed
   out — the opposite of the intent. At 10 min, an open tab refreshes every
   ~8–9 min and stays alive; a tab closed or hidden for more than 30 min fails
   its next refresh.
3. **"Activity" means the app is open in a visible tab.** supabase-js pauses
   auto-refresh on hidden tabs and the app already re-checks the session on
   `visibilitychange`. Typing or clicking is not tracked — it needn't be: an
   open tab keeps itself alive at one auth call per ~9 minutes. Idle-while-open
   detection is explicitly out of scope.
4. **The UI states what happened.** When the server ends a session (refresh
   rejected) supabase-js emits `SIGNED_OUT`; the app drops to guest, closes
   member-only trays, and shows "Signed out after 30 minutes of inactivity.
   Log in to continue." A user-initiated Log out is distinguished and keeps its
   own message.

## Consequences

- Members who keep a tab open are never interrupted; members who return after
  >30 min away log in again. The hosted setting is silent on the Free plan —
  the behavior only exists where the plan supports it.
- The 600 s token means one refresh call per ~9 min per open tab; negligible
  load. Do not lower it further (Supabase advises ≥ 5 min).
- Any future "warn before logout" UX would have to be client-side and is
  deliberately not built.
- Verification: sign in; leave the tab open 35 min → still signed in; close
  the tab for 35 min and reopen → toast and guest state.
