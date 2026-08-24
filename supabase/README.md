# Supabase database methodology

This is the single source of truth for database-change procedure.

Only the designated database reviewer may approve SQL. Only the DBA or an
explicitly authorized developer may execute a merged patch. Everyone else
documents the requested outcome and submits it for database review without
running SQL.

## Truth model

The intended database state is:

```text
sole canonical schema snapshot
+ db-patches/ in ascending version order
```

- `db-snapshot/` contains exactly one generated canonical snapshot — the
  deliberate version-`0` baseline. It is **not** kept current: the live schema
  is always snapshot + every applied patch; the singleton row in
  `public.database_patch_version` says which patch is applied.
- `db-patches/*.sql` is the immutable post-baseline ledger.

The current canonical baseline is version `0`:

```text
baseline_id: 20260824_production_baseline_01
schema file: db-snapshot/2026-08-24-16-30-00-database.sql
version:     0
last patch: baseline_20260824_production_baseline_01
```

## Versioned patch contract

Patch filenames carry the creation date, a short description, and the target
database version:

```text
<YYYYMMDD>-patch-<short-description>-<#>.sql     e.g. 20260901-patch-add-flag-column-1.sql
```

`<#>` is the target database version. The ledger row — not the directory
listing — is the authority on ordering: apply patches in ascending `<#>`.

Every patch must be idempotent, self-document its purpose, and run in one
transaction. It must:

1. Declare its patch ID, baseline ID, expected current version `N-1`, and
   target version `N`.
2. Lock and read the singleton row in `public.database_patch_version`.
3. Verify the baseline ID matches.
4. Accept only version `N-1`, or version `N` with the same patch ID for a safe
   rerun. Any other version aborts before schema changes.
5. Perform only idempotent changes.
6. Run its forward verification.
7. Update `database_patch_version` to `N` and its patch ID as the final database
   change before `commit`.

`public.database_patch_version` and its version-`0` row are part of the
canonical baseline. Because the ledger cannot precede the first patch, the
version-`1` patch of a cycle is the sanctioned bootstrap: it creates the ledger
table and version-`0` row when they are missing. Every later patch must abort if the table
or row is missing; no patch may reset or repair an existing ledger.

The version table is database-control metadata. Client access is revoked, RLS
is enabled, and no client policies are defined.

## Change workflow

1. Create one versioned, timestamped, idempotent patch directly in `db-patches/`.
2. Develop against the canonical snapshot plus every root-level patch.
3. Before merge, merge the latest target branch into the working branch. Do
   not rebase or rewrite history.
4. If another patch merged first, assign the next version, update the UTC
   timestamp, reconcile the SQL, and rerun validation.
5. Obtain database-review approval and merge.
6. The authorized deployer applies the newly merged patch and records its
   verification result.
7. Never edit a merged patch. Corrections use the next version.

Blocked or deferred patch proposals stay out of `db-patches/` (an issue, PR
branch or draft elsewhere). Before promotion, reconcile with the current
ledger, assign the next version and a current UTC timestamp, then add to
`db-patches/` through a reviewed PR.

## Canonical reconciliation

Do not create routine snapshots after patches. Obtain a new canonical export
only for a planned major database version or reconciliation:

1. Export the linked Supabase schema to a temporary location outside the
   repository.
2. Review it against the current snapshot plus every patch.
3. Replace the sole file in `db-snapshot/` without hand-editing the export.
4. If sanitized reference data is required for the new cycle, cut it then
   (including the singleton version-`0` ledger row); none exists today.
5. Set the same new baseline ID and version `0` in the live database through a
   separately reviewed reconciliation operation.
6. Remove the superseded patch cycle from the current tree and start again at
   patch version `1`. Git history retains prior cycles.

PowerShell export command:

```powershell
$timestamp = Get-Date -Format "yyyy-MM-dd-HH-mm-ss"
$exportPath = Join-Path $env:TEMP "$timestamp-database.sql"
npx supabase@latest db dump --linked --file $exportPath
```
