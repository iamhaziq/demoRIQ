# Phase 7: deploy and operations

## How the pieces connect
```
browser ──JWT──▶ ingest ──▶ trigger-ml ──Modal-Key/Secret──▶ Modal "jobs" endpoint ──spawn──▶ run_shop
                   │             │ enqueue_ml_job / attach_ml_job_call (as the user, RLS)       │
                   ▼             ▼                                                              ▼
               Postgres ◀──────────────────── ml_worker (pooler) ──── predict/train/score write back
```
- Modal crons (Asia/Kuala_Lumpur): `predict_all` daily 02:00, `train_all` Sunday 01:00,
  `score_all` Monday 03:00. Each runs one call per shop (`.map`, exceptions captured).
- Failures and "worse than baseline 2 weeks running" are emailed via Resend.
- Write-back: one transaction per shop. Weeks that have not started are replaced; a started week's
  forecast is never rewritten (honest live scoring in `forecast_scores`). Decisions are superseded,
  not deleted.

## One-time setup (owner)
1. Push migrations: `npx supabase db push` (from the repo root, project linked).
2. Hosted SQL editor: `alter role ml_worker with login password '<from a password manager>';`
   Dashboard → Connect → **Session pooler** string; user is `ml_worker.<project-ref>`.
3. `cd ml && .venv/Scripts/modal secret create retailiq-supabase DATABASE_URL="postgresql://ml_worker.<ref>:<pw>@<pooler-host>:5432/postgres"`
4. Resend: create an API key, then
   `.venv/Scripts/modal secret create retailiq-alerts RESEND_API_KEY=<key> ALERT_EMAIL=<your email>`
5. `.venv/Scripts/modal deploy app.py` → note the `jobs` endpoint URL.
6. Modal dashboard → Settings → Proxy auth tokens → create one. Then (repo root):
   `npx supabase secrets set MODAL_JOBS_URL=<jobs url> MODAL_KEY=<token id> MODAL_SECRET=<token secret> GEMINI_API_KEY=<key>`
7. `npx supabase functions deploy`
8. GitHub → Settings → Secrets: `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` (a Modal API token, `modal token new`),
   `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`. Environments → `production`
   → add yourself as required reviewer so every deploy waits for approval.

## Day-to-day
- Run one shop now: `modal run app.py::run_shop --shop-id <id> --mode predict`
- Roll back a model: `retailiq_ml.registry.rollback(conn, shop_id, version)`
- Weekly: check `forecast_scores` (live WAPE vs baseline) per shop.
- Data protection: private buckets, RLS everywhere, Modal holds only the ml_worker login (no storage
  or service-role key), Edge Functions hold no service-role key. Daily backups need the Supabase Pro plan;
  the privacy note for shops must cover Supabase, Modal and Google (Gemini) as processors (PDPA).
