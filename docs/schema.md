# Phase 1 spec: database, auth, storage

Source: build-guide.md, Phase 1. Migrations live in supabase/migrations/, pgTAP tests in supabase/tests/database/.

## Tables (all in `public`, all with `shop_id` except `holidays`)
| Table | Notes |
| --- | --- |
| shops | One per auth user (`owner_user_id` unique). Created by trigger on signup. Holds True Cost rates (defaults from prototype: loan 8%, opportunity 15%, risk 3%, storage share of rent 15%). |
| products | Unique per shop on normalised name (lower, trimmed, single spaces) so ingest merges duplicates. Trigram index on name for `find_product`. |
| sales | One row per shop/product/day (PK). qty may be fractional (kg). |
| stock_snapshots | One row per shop/product/day (PK). |
| uploads | One per uploaded file; holds column map, counts, health summary, rejected rows. |
| holidays | Reference data, readable by any signed-in user. Lunar dates are estimates; verify against the gazette. |
| ml_jobs | Inserted by trigger-ml (service role), updated by Modal. |
| model_versions | Modal only. At most one `champion` per shop (partial unique index). |
| forecasts | Modal only. PK (shop_id, product_id, week_start): each run replaces future weeks; past weeks are kept for scoring. |
| decisions | Modal only. Old rows are kept (feedback points at them) and marked `superseded_at`; current = `superseded_at is null`. |
| decision_feedback | User inserts own (done / not_now / wrong). |

## Access
- `public.current_shop_id()`: the caller's shop id from `auth.uid()`.
- authenticated users: SELECT own-shop rows on every table; INSERT/UPDATE/DELETE own rows on products, sales, stock_snapshots, uploads; INSERT decision_feedback; UPDATE only rate/setting columns on shops. Never write forecasts, decisions, model_versions, ml_jobs.
- anon: nothing.
- `ml_worker` (Modal): read sales, products, stock_snapshots, holidays, shops; write forecasts, decisions, model_versions, ml_jobs. Created NOLOGIN in the migration; password is set by hand, never in git:
  `alter role ml_worker with login password '<from a password manager>';`
  Connect via the Supavisor pooler as user `ml_worker.<project-ref>`.

## Storage
- `raw-uploads` (private): users read/write only under `<shop_id>/...`.
- `training-snapshots` (private): no user access. Modal's write path is decided in Phase 3.
