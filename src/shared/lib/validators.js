// Centralized, re-usable field validation

// username: 3–24 chars, letters numbers _ and . only (mirrors the DB check
// profiles_username_chars_ck), must start with a letter/number
const USERNAME_RX = /^[A-Za-z0-9][A-Za-z0-9_.]{2,23}$/;

// initials: 1–6 visible, no whitespace; we’ll normalize to upcase trimmed
const INITIALS_RX = /^[^\s]{1,6}$/;

// zip: 5 digits or 5-4
const ZIP_RX = /^(?:\d{5})(?:-\d{4})?$/;

// very light email check (we still rely on Supabase for real email rules)
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(u) {
  const v = (u || '').trim();
  return USERNAME_RX.test(v) ? { ok: true, value: v } :
    { ok: false, msg: 'Username must be 3–24 characters (letters, numbers, _ or .).' };
}

export function validateEmail(e) {
  const v = (e || '').trim();
  return EMAIL_RX.test(v) ? { ok: true, value: v } :
    { ok: false, msg: 'Enter a valid email address.' };
}

export function validateInitials(i) {
  if (!i) return { ok: true, value: null }; // optional
  const v = (i || '').trim().toUpperCase();
  return INITIALS_RX.test(v) ? { ok: true, value: v } :
    { ok: false, msg: 'Initials must be 1–6 characters (no spaces).' };
}

export function validateZip(z) {
  if (!z) return { ok: true, value: null }; // optional
  const v = (z || '').trim();
  return ZIP_RX.test(v) ? { ok: true, value: v } :
    { ok: false, msg: 'ZIP must be 12345 or 12345-6789.' };
}

// Helper to validate a full payload (username+email+initials+zip)
export function validateUserPayload({ username, email, initials, zip }) {
  const errors = [];

  const u = validateUsername(username);
  if (!u.ok) errors.push(u.msg);

  const e = validateEmail(email);
  if (!e.ok) errors.push(e.msg);

  const i = validateInitials(initials);
  if (!i.ok) errors.push(i.msg);

  const z = validateZip(zip);
  if (!z.ok) errors.push(z.msg);

  return {
    ok: errors.length === 0,
    errors,
    // normalized values
    value: {
      username: u.ok ? u.value : username,
      email:    e.ok ? e.value : email,
      initials: i.ok ? i.value : null,
      zip:      z.ok ? z.value : null,
    }
  };
}
