# Royalty reconciliation and intake — executable tests

These run the project's **own migration files** against a real PostgreSQL (PGlite, WASM), and the
**real `api/artist-submission.js` handler**, so the figures below are produced by the code that
ships rather than by a model of it.

```
npm install
node scenarios.mjs     # 36 royalty cases
node backfill.mjs      #  8 historical dry-run cases
node intake.mjs        # 35 closed-intake cases
```

## What is real and what is stubbed

**Real:** every migration in `supabase/migrations/`, applied in order, unedited except for the
`create extension pgcrypto` line — `gen_random_uuid()` is core Postgres 13+, so dropping it changes
nothing under test. The three Supabase roles and `auth.uid()` are created in a short prelude.
`artist-submission.js` is imported as written.

**Stubbed:** Supabase Storage (an in-memory bucket that refuses to overwrite, as `x-upsert: false`
makes the real one do), `requireAdmin` (driven by a global so each case chooses the caller), and
email (recorded, not sent). Stripe is never called: `scenarios.mjs` and `backfill.mjs` hand the
database the same shapes `api/_reversals.js` builds from a re-read Stripe object.

**Not covered here:** the live Supabase signed-upload token expiry, and the live Stripe webhook
signature path. Both need one confirmation against the real project — see
`docs/ev-for-artists-handoff.md` § Known gaps.

## Why these exist

Executing the SQL rather than reading it caught a bug on the first run: `overlaps` is a Postgres
operator keyword and cannot name a CTE. The migration would have failed on apply.
