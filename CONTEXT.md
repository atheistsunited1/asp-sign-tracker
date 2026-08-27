# ASP Sign Tracker

A crowdsourced map for the Atheist Street Pirates (ASP), a program of
[Atheists United](https://www.atheistsunited.org/streetpirates). Members pin the
locations of religious signage placed on public property and log what happens to
each sign. The map is publicly viewable; it doubles as a recruiting funnel for
new members.

## Language

Glossary terms are capitalized in docs and issues. Where the code uses a
different identifier, it is shown in `monospace`.

**Pin**:
A sign location on the map, identified to users by its Pin ID (`P-…`,
generated from `pins.short_num`, always present, unique). The database UUID
(`pins.id`) is never shown to users and is not searchable in the UI; it
appears only in the database.
_Avoid_: friendly ID, UUID (in UI copy)

**Activity** (`reports` table, `report_type` column):
A member's logged action or observation on a pin: **type · occurred_on · member
· photos** — no free text. `occurred_on` is the domain date (when it was
sighted / plundered / krakened; imported activities carry their historical
date); `created_at` is only when the row was written. Each pin's current state
is the state of its most recent non-audit activity by `occurred_on`.
_Avoid_: report (for the record itself — see **Report** below), submission,
report details, activity details

**Report** (umbrella):
Anything members have reported — pins and their activities together. It names
the Reports page, the "My Reports" filter, "Report Sign" / "Report As New Sign"
actions and Bulk Photo Reports. It is not a synonym for Activity: a single
logged record is always an Activity ("activity type", "activity history",
"deleted activities").

**Treasure in waiting** (dashboard):
The backlog of signs still up: pins whose state is Sighting, excluding
Billboards (the quarterly report's "treasure in waiting"). Its period change is
new signs minus plunders minus krakenings.
_Avoid_: backlog (in UI copy), reported signs

**Description** (`pins.description`):
The pin's single free-text field: how to find the sign on site (pole, corner,
landmarks) plus anything unusual. Quick updates may append a dated line
(`MM/DD/YY: note`); nothing edits it in place except mapmasters/admins.
_Avoid_: location description, notes (as a field name)

**Sighting** (`sighting`):
The default state: a sign observed in place and logged by a member.
_Avoid_: Reported (as a state name; the legend row is labeled "Sightings")

**Plundered** (`plundered`):
A sign whose removal was reported — by the ASP member who removed it, by a
non-member, by a local authority, or anonymously by whoever took it down. What
makes a sign plundered is that someone reported removing it. Members themselves
remove only signs that are illegally placed on public property; anything else is
handled as Questionable Legality.

**Krakened** (`krakened`):
A sign reported as no longer present for an unknown reason — no one has claimed
the removal (unknown actor, weather, acts of god). Special case: a billboard
whose advertisement is replaced is krakened, even though the cause is obvious,
because the advertiser does not report the removal.

**Questionable Legality** (`questionable`):
A sign that may violate a local code or ordinance but sits on private property
or another location where members do not remove signs. Members report it to the
relevant authority, citing the specific code, rather than plundering it.

**Major Campaign** (`is_major_campaign`):
A flag on a pin marking a sign as part of a campaign notable for continual,
high-frequency, high-volume placement, year round, across wide geographic
regions. There is no sign-count threshold; it is a judgment about the
distributor's pattern. Non-major pins are simply everything else, not
necessarily one-offs. Major-campaign pins render in their own colors.

**Billboard**:
A legally placed advertisement, tracked since the major-campaign distributor
extended their campaign to billboards. Billboards are never plundered and never
Questionable Legality; when the advertisement is replaced, the pin is krakened.

**Sign type** (`sign_type`):
What the physical item is: sign, billboard, sticker, banner, graffiti, pamphlet,
cross, other — plus `literature` (produced only by the KML importer; not offered
in the report-form select).

**Pamphlet** (`stationary`):
The sign type formerly labeled "Stationary"; the code value has not been
renamed.
_Avoid_: Stationary

**Guest**:
A logged-out visitor. Guests can view the public map and nothing else; the public
map exists to convert guests into members.

**Member**:
An authenticated user whose account an admin has approved. Only members can
contribute pins and activity. A member may edit their own contributions only
while they are pending. "Member since" is the approval date.

**Pirate name** (`profiles.username`):
A member's display name, chosen at signup; the "by ASP (XX)" initials in
imported activity map to a member's `initials`, not to this.
_Avoid_: username (in UI copy)

**Pending**:
A pin or activity that has not yet been reviewed by a mapmaster. Pending
contributions appear on the map immediately.

**Denied**:
A pin or activity a mapmaster has rejected. Denied contributions disappear from
the map.

**Mapmaster**:
A member role that moderates map content: approving, denying, and editing pins
and activities.

**Admin**:
A member role that manages user accounts and roles. Admins also hold all
mapmaster powers.
