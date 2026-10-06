# RetailIQ
Decision tool for Malaysian grocery/sundry shops. Build plan: docs/build-guide.md (one phase per branch).

## Architecture (do not break)
- Repo root (src/, index.html, vite.config.js) = frontend (Vite + React, deployed on Netlify). Talks only to Supabase, anon key only.
- supabase/ = app backend: Postgres, Auth, RLS, Storage, Edge Functions (TypeScript/Deno). No ML code here.
- ml/ = Modal app (Python): all training, evaluation, versioning, inference, scheduled ML jobs.
- Only Edge Functions call Modal or the Gemini API, with secrets.
- LLM layer = Google Gemini API, called only through supabase/functions/_shared/llm.ts. Model id is pinned there.
- Modal writes predictions back to Supabase tables; nothing reads predictions from Modal at request time.

## Rules
- Models compute, the LLM only explains. The agent never calculates ringgit values.
- Money in RM, 2 decimals. Every table has shop_id; every query filters by it.
- Every model/rule function has a pytest test with a hand-checked example.
- ml/retailiq_ml/decisions/ is pure Python: no Modal or database imports.
- ML logic lives in retailiq_ml/pipeline.py (runs locally); ml/app.py only wraps it for Modal.
- supabase/functions/_shared/columns.ts is pure TS shared with the frontend (Vite imports it); no Deno APIs there.
- Never commit secrets: frontend uses .env.local (VITE_ vars, anon key only); supabase/functions/.env and Modal secrets stay out of git.

## Commands
- Frontend: npm install | npm run dev | npm run lint
- Supabase local (needs Docker): npx supabase start | npx supabase db push | npx supabase functions serve
- ML env: cd ml && py -3.12 -m venv .venv && .venv/Scripts/pip install -e ".[dev]"
- Modal: cd ml && modal run app.py::train_shop --shop-id <id> | modal deploy app.py
- Tests (ML): cd ml && .venv/Scripts/pytest
- Tests (DB, pgTAP): npx supabase test db
- Tests (Edge Function units): cd supabase/functions && deno test --allow-read --allow-import
- Tests (ingest end-to-end, local stack + functions serve running): deno run -A supabase/tests/ingest_e2e.ts
- Upload templates: deno run -A scripts/make_templates.ts (writes public/templates/)
- ML end-to-end on the local stack: cd ml && .venv/Scripts/python scripts/local_train.py
- Specs per phase: docs/schema.md, docs/ingest.md, docs/forecast.md
