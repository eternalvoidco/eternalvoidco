# Royalty reconciliation and intake — executable tests

These run the project's **own migration files** against a real PostgreSQL (PGlite, WASM), and the
**real `api/artist-submission.js` handler**, so the figures below are produced by the code that
ships rather than by a model of it.

```
npm install
node scenarios.mjs     # 36 royalty cases
node backfill.mjs      #  8 historical dry-run cases
node intake.mjs        # 35 closed-intake cases
node staging.mjs       # 34 staging-verification cases
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

## staging.mjs

The four things that must be positively established before a royalty is paid:

- **§1** the VAT basis. An unresolved basis blocks; `exclusive` pays €19.20 on a €160 tee,
  `inclusive` at 27% pays €15.12. The fixture prices both readings so the decision can be made
  against real numbers — **it is not an approved basis.**
- **§2** item-level evidence, where it genuinely exists, and the withdrawal of `unique_line_match`:
  a €90 refund on a cart of €160 + €90 is no longer guessed.
- **§2b** two concurrent webhook deliveries where the older read finishes writing last — refused on
  the timestamp, and refused again on a tied timestamp because the status may not regress.
- **§3** coverage: a period nobody has attested is not clean, however empty it looks.
- **§4** the carried balance across Q4 → Q1 → Q2, raised once and consumed once.
