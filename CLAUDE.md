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
- Edge Functions use the caller's JWT, never the service-role key; privileged steps are security definer SQL functions scoped by current_shop_id().
- supabase/functions/_shared/columns.ts and sheet.ts are pure TS shared with the frontend (Vite imports them); no Deno APIs there.
- Frontend: data logic in plain modules under src/lib taking the Supabase client as a parameter (testable with Deno); hooks only wire them to React. Missing numbers render as '–', never 0.
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
- Tests (agent tools + endpoint, local stack + functions serve): deno run -A --config supabase/functions/deno.json supabase/tests/agent_tools_e2e.ts
- Agent eval vs real Gemini (30 bilingual questions; run after any prompt/model change): deno run -A supabase/functions/agent-ask/eval/run_eval.ts
- Tests (frontend pure modules, after npm install): deno test --allow-read --config supabase/functions/deno.json src/lib
- Today screen e2e (after local_predict.py): deno run -A --config supabase/functions/deno.json supabase/tests/today_e2e.ts <shop_id>
- Forecast screen e2e (after local_predict.py): deno run -A --config supabase/functions/deno.json supabase/tests/forecast_e2e.ts <shop_id>
- Stock Cost screen e2e (after local_predict.py): deno run -A --config supabase/functions/deno.json supabase/tests/stock_cost_e2e.ts <shop_id>
- Upload e2e (local stack + functions; checks Realtime job status): deno run -A --config supabase/functions/deno.json supabase/tests/upload_e2e.ts
- Ask box e2e (after local_predict.py, functions running): deno run -A --config supabase/functions/deno.json supabase/tests/ask_e2e.ts <shop_id>
- Frontend local: .env.local points at the local stack; magic-link emails in Mailpit http://127.0.0.1:54324
- Upload templates: deno run -A scripts/make_templates.ts (writes public/templates/)
- ML end-to-end on the local stack: cd ml && .venv/Scripts/python scripts/local_train.py | scripts/local_predict.py
- Agent reads pipeline output: deno run -A --config supabase/functions/deno.json supabase/tests/agent_on_pipeline_e2e.ts <shop_id>
- Deploy/ops runbook: docs/deploy.md (CI in .github/workflows/ci.yml deploys main after tests)
- Specs per phase: docs/schema.md, docs/ingest.md, docs/forecast.md, docs/decisions.md, docs/agent.md
- Deck numbers are locked in ml/tests/fixtures/deck_examples.json; never edit expected values to make a test pass.
