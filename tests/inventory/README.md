# Inventory tests

Integration tests for inventory, checkout and the newsletter that run the real `api/` handlers against real Postgres and
PostgREST (what Supabase serves `/rest/v1` with), plus the storefront, checkout
and dashboard in Chromium, and the /fragrance NÉANT teaser (`fragrance.test.mjs`).
Stripe is an in-process test double
(`stripe-double.mjs`): no request reaches Stripe and nothing can be charged.
Every test file creates and drops its own database.

## Requirements

- Postgres 14+ reachable as a superuser. Defaults: `PGHOST=/tmp PGPORT=54329 PGUSER=postgres`.
  For example:
  ```sh
  initdb -D /var/tmp/evpg -A trust -U postgres
  pg_ctl -D /var/tmp/evpg -o "-p 54329 -k /tmp" -l /var/tmp/evpg.log start
  ```
- PostgREST 12 at `./.postgrest/postgrest` (or set `POSTGREST_BIN`):
  ```sh
  mkdir -p .postgrest && curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ -C .postgrest
  ```
- Chromium for the browser tests (`CHROMIUM_PATH`, defaults to the Playwright build in `/opt/pw-browsers`).

## Run

```sh
npm install
npm test
STRICT_GRANTS=1 npm test   # as a newer Supabase project: no default grants
```
