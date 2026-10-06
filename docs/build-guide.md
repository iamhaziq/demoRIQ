# RetailIQ MVP build guide

Oct 5, 2026 · @Hayyan

## What the MVP includes

The MVP turns your Netlify prototype into a working product for the 10 pilot shops (Nov–Dec 2026): a shop uploads its sales and stock, RetailIQ forecasts demand, computes the True Cost of Stock, and the decision agent answers in Malay or English using only those numbers.

In scope for the MVP:

- CSV/Excel upload of sales, products and stock (no live POS integrations yet)
- Demand forecast, 4 weeks ahead, per product
- True Cost of Stock and the hold-or-clear rule
- Reorder rule (forecast + lead time + safety stock)
- Decision agent that reads stored results and cites the source of every number
- Login, one shop per account, nightly retraining and inference

Out of scope until after the pilot: price intelligence, market signals beyond a holiday calendar, live POS APIs, multi-outlet, billing.

### Architecture: three layers, clear boundaries

The app, the ML and the language model are separate layers. **Supabase** runs the application, **Modal** runs every ML workload, and the **Google Gemini API** is the LLM layer behind the chatbot. The frontend only ever talks to Supabase; only Supabase Edge Functions talk to Modal or to Gemini.

&#91;embedded content: Supabase + Modal architecture · 3 crossings\]

Only four things cross a boundary: Modal reads clean training data from Postgres, Edge Functions trigger Modal jobs with a secret token, Modal writes forecasts and decisions back into Postgres, and the agent Edge Function sends a question plus that shop's tool results to Gemini and gets wording back.

| Layer | Responsible for | Never does |
| --- | --- | --- |
| Frontend (your Netlify app) | Screens, file preview, column mapping UI, chat box | Call Modal or Gemini, hold secrets, compute numbers |
| Supabase | Postgres, Auth, RLS, users, Storage (raw uploads, training snapshots), app data, Edge Functions (upload, agent, triggering ML) | Train or run models |
| Modal | Training, retraining, evaluation, versioning, deployment, batch inference, scheduled ML jobs, ML API endpoints | Store app data or serve users directly |
| LLM layer: Google Gemini API | Understanding the owner's question in Malay or English, choosing which data tool to call, wording the answer | Calculate numbers, store data, see another shop's data, get called from the browser |

The golden rules for the whole build:

1. **Models compute, the LLM only explains.** Every ringgit figure comes from tested Python code; the agent words the answer.
2. **Predictions flow back into Supabase.** Modal writes forecasts and decisions into Postgres; the app and agent read them from there, never from Modal at request time.
3. **Modal is private.** Its endpoints accept calls only from Supabase Edge Functions, authenticated with secrets.

**Stack:** Supabase (Postgres, Auth, Storage, Edge Functions in TypeScript) · Modal (Python: pandas, statsforecast, LightGBM) · Google Gemini API via the `@google/genai` SDK for the chatbot · your existing frontend on Netlify.

## Phase 0 — Project setup (day 1)

One repo, three top-level folders that mirror the architecture, and a `CLAUDE.md` that states the boundary so Claude Code never puts ML code in Supabase.

1. Install Node 20+, Python 3.11+, Git, the Supabase CLI and the Modal CLI (`pip install modal`, then `modal setup`). Create a Supabase project, a Modal account and a GitHub repo.
2. Create this layout:

```
retailiq/
  frontend/                  # existing Netlify app (talks to Supabase only)
  supabase/
    migrations/              # SQL: tables, RLS, functions
    functions/               # Edge Functions (TypeScript)
      ingest/                # validate + insert uploaded rows
      trigger-ml/            # calls Modal after an upload
      agent-ask/             # decision agent (Gemini API + DB tools)
      _shared/llm.ts         # the only file that calls the Gemini API
    seed.sql                 # holidays, demo shop
  ml/                        # Modal app (Python)
    app.py                   # Modal app, functions, cron, endpoints
    retailiq_ml/
      data.py                # read training data from Supabase
      features.py
      baselines.py
      forecast.py            # LightGBM quantile models
      evaluate.py            # backtest, WAPE
      registry.py            # model versions, champion/challenger
      decisions/             # true_cost.py, reorder.py (pure rules)
      writeback.py           # write forecasts + decisions to Supabase
    tests/
    pyproject.toml
  data/samples/
  docs/
  CLAUDE.md
```

3. Write `CLAUDE.md`:

```markdown
# RetailIQ
Decision tool for Malaysian grocery/sundry shops.

## Architecture (do not break)
- supabase/ = app backend: Postgres, Auth, RLS, Storage, Edge Functions. No ML code here.
- ml/ = Modal app: all training, evaluation, versioning, inference, scheduled ML jobs.
- frontend/ talks only to Supabase. Only Edge Functions call Modal or the Gemini API, with secrets.
- LLM layer = Google Gemini API, called only through supabase/functions/_shared/llm.ts. Model id is pinned there.
- Modal writes predictions back to Supabase tables; nothing reads predictions from Modal at request time.

## Rules
- Models compute, the LLM only explains. The agent never calculates ringgit values.
- Money in RM, 2 decimals. Every table has shop_id; every query filters by it.
- Every model/rule function has a pytest test with a hand-checked example.

## Commands
- Supabase local: supabase start | supabase db push | supabase functions serve
- Modal: cd ml && modal run app.py::train_shop --shop-id <id> | modal deploy app.py
- Tests: cd ml && pytest
```

4. Secrets: Supabase keys in `frontend/.env` (anon key only) and `supabase/functions/.env`; Modal secrets via `modal secret create` (never in the repo). The Gemini API key lives only in Supabase function secrets.

**Claude Code prompt to start:** *“Read CLAUDE.md. Scaffold supabase/ and ml/ as described. In ml/app.py create a Modal app named retailiq-ml with a hello function and a pytest setup. Don't add features yet.”*

## Phase 1 — Supabase: database, auth, storage (days 2–4)

Supabase holds every piece of application data, including the predictions Modal writes back; one canonical schema means neither the app nor the ML cares which POS a shop uses.

| Table | Key columns | Written by |
| --- | --- | --- |
| `shops` | id, owner\_user\_id, name, language, loan\_rate\_pct, rent\_per\_month, shelf\_area | App |
| `products` | id, shop\_id, sku, name, category, unit\_cost, unit\_price, supplier, lead\_time\_days, pack\_size | App (upload) |
| `sales` | shop\_id, product\_id, date, qty, revenue | App (upload) |
| `stock_snapshots` | shop\_id, product\_id, date, on\_hand, on\_order, received\_date | App (upload) |
| `uploads` | id, shop\_id, storage\_path, column\_map\_json, rows\_ok, rows\_rejected, status | App |
| `holidays` | date, name, region | Seed |
| `ml_jobs` | id, shop\_id, type (train/predict), status, modal\_call\_id, started\_at, finished\_at, error | Edge Function, then Modal |
| `model_versions` | id, shop\_id, version, model\_type, volume\_path, data\_snapshot\_path, wape, baseline\_wape, status (candidate/champion/retired), created\_at | Modal |
| `forecasts` | shop\_id, product\_id, model\_version\_id, week\_start, p10, p50, p90 | Modal |
| `decisions` | shop\_id, product\_id, model\_version\_id, type (REORDER/CLEAR/HOLD), qty, value\_rm, reason\_json, created\_at | Modal |
| `decision_feedback` | decision\_id, action (done/not\_now/wrong), at | App |

Steps:

1. Write the tables as SQL migrations in `supabase/migrations/` and apply with `supabase db push`.
2. **RLS on every table:** users can read rows only where `shop_id` belongs to them. Users can never write to `forecasts`, `decisions` or `model_versions`; only Modal can.
3. **A dedicated role for Modal.** Create a Postgres role (e.g. `ml_worker`) that can read `sales`, `products`, `stock_snapshots`, `holidays`, `shops` and write `forecasts`, `decisions`, `model_versions`, `ml_jobs`. Give Modal this role's connection string rather than the all-powerful service-role key.
4. **Storage buckets:** `raw-uploads` (private, the original files) and `training-snapshots` (private, the exact dataset each model version was trained on, as Parquet). Snapshots make every model version reproducible.
5. Seed `holidays` with Malaysian public holidays, Raya, CNY, Deepavali and school holidays for 2023–2027.
6. Auth: enable email magic link or phone OTP; create a `shops` row on first login.

**Claude Code prompt:** *“Create Supabase migrations for the tables in docs/schema.md with RLS so users only read their own shop\_id and cannot write forecasts, decisions or model\_versions. Add an ml\_worker role with the grants listed, and private storage buckets raw-uploads and training-snapshots.”*

## Phase 2 — Data ingestion in Supabase (days 5–9)

Ingestion is application work, so it lives in Supabase; Modal only ever sees clean rows. If a shop's file doesn't load in five minutes, nothing else matters, so build it to forgive messy files.

1. **Collect real files first.** Ask Zaeem to get a sales export from 3–4 target shops now (POS export, Excel, even a photo of a notebook page). Design against those, not the demo data.
2. **Provide RetailIQ templates** (`sales_template.xlsx`: date, product, qty, price; `stock_template.xlsx`: product, on hand, unit cost, supplier, lead time). Notebook shops fill these in.
3. **Upload flow:**
   1. Frontend uploads the original file to the `raw-uploads` bucket and creates an `uploads` row.
   2. Frontend parses it in the browser (SheetJS) and shows the first 20 rows.
   3. Auto-guess columns from English and Malay headers (`tarikh`→date, `kuantiti`/`qty`→qty, `harga`→price, `nama barang`→product); the owner confirms. Save the map per shop.
   4. Frontend calls the `ingest` Edge Function with the upload id and column map.
4. **`ingest` Edge Function** re-reads the file from Storage, applies the map and cleaning rules, inserts into `products`, `sales`, `stock_snapshots`, and records accepted/rejected counts. Cleaning rules, each tested:
   - dates in DD/MM/YYYY (Malaysian default) and other common formats
   - strip “RM” and commas from prices
   - merge duplicate product names (case, spacing)
   - aggregate receipts to one row per product per day
   - flag days with zero stock (stock-out, not zero demand)
   - reject negative or absurd quantities into a rejected-rows report
5. **Data health check:** products, days of history, % of products with 8+ weeks of sales. Show it to the owner.
6. **Hand-off to ML:** when ingest succeeds, it calls `trigger-ml` (Phase 7) so a new shop gets forecasts within minutes.

Minimum useful data: about 3 months of daily sales. Under 8 weeks per product, the ML falls back to simple averages and the agent says so.

**Claude Code prompt:** *“Build the ingest Edge Function in supabase/functions/ingest: read the file from the raw-uploads bucket, apply the column map, implement the cleaning rules in docs/ingest.md, insert rows for the caller's shop\_id only, and return a health summary. Add tests using the messy files in data/samples/.”*

## Phase 3 — Modal: training, evaluation, versioning (days 10–18)

Each shop gets its own model versions on Modal: train a challenger, backtest it against the current champion and the baselines, and promote it only if it wins. This is how “every business is different” is handled without custom work per shop. CPU is enough; LightGBM needs no GPU at this scale.

**Step 1 — Read data (`data.py`).** Using the `ml_worker` connection string from a Modal Secret, load one shop's clean `sales`, `products`, `stock_snapshots` and `holidays`. Always filter by `shop_id`. Save the exact dataset as Parquet to the `training-snapshots` bucket.

**Step 2 — Baselines (`baselines.py`).** With `statsforecast`: seasonal naive (same day last week), 28-day average, AutoETS, and Croston/ADIDA for slow, lumpy items. They are the safety net and the bar to beat.

**Step 3 — Features (`features.py`)**, one row per product per day:

- lags 7, 14, 28 days; rolling mean and std over 7 and 28 days
- day of week, month, payday window (around the 25th to the 1st)
- holiday flags and days until the next Raya, CNY, Deepavali, school holiday
- price and price relative to the product's usual price; category
- stock-out flag (stock-out days are excluded from training targets)

**Step 4 — Model (`forecast.py`).** One LightGBM model per shop across all its products, trained three times as quantile models (alpha 0.1, 0.5, 0.9) for P10/P50/P90. Forecast 28 days, summed to weeks for the app.

**Step 5 — Evaluate (`evaluate.py`).** Rolling-origin backtest: train to week N, predict 4 weeks, roll forward 3–4 times. Score with **WAPE** (total absolute error ÷ total sales).

**Step 6 — Version and promote (`registry.py`).**

1. Save the trained model to a Modal Volume at `/models/{shop_id}/v{n}/model.pkl` with its feature list and library versions.
2. Insert a `model_versions` row: status `candidate`, WAPE, baseline WAPE, volume path, snapshot path.
3. Promote to `champion` (and retire the old one) only if it beats the current champion and the best baseline by at least 5% WAPE. Otherwise keep the old champion.
4. If no LightGBM version beats the baselines, the champion is the best baseline. Products with under 8 weeks of history always use a baseline, flagged “low confidence”.
5. Rollback = flip a previous version back to `champion`.

Skeleton of `ml/app.py` (check names against Modal's current docs; Claude Code can do this for you):

```python
import modal

app = modal.App("retailiq-ml")
image = modal.Image.debian_slim().pip_install(
    "pandas", "pyarrow", "lightgbm", "statsforecast", "psycopg[binary]", "supabase"
)
models = modal.Volume.from_name("retailiq-models", create_if_missing=True)
secrets = [modal.Secret.from_name("retailiq-supabase")]

@app.function(image=image, volumes={"/models": models}, secrets=secrets, timeout=1800)
def train_shop(shop_id: str) -> dict:
    # load data -> snapshot -> train challenger -> backtest -> save -> maybe promote
    ...
    models.commit()

@app.function(image=image, volumes={"/models": models}, secrets=secrets, timeout=900)
def predict_shop(shop_id: str) -> dict:
    # load champion -> forecast 28 days -> run decision rules -> write back to Supabase
    ...
```

**Claude Code prompts:** *“Implement ml/retailiq\_ml/baselines.py, features.py, forecast.py and evaluate.py per docs/forecast.md with pytest tests on data/samples.”* Then: *“Implement registry.py and the train\_shop Modal function: snapshot data to the training-snapshots bucket, train a challenger, backtest it, save it to the retailiq-models volume, insert a model\_versions row and promote it only if it beats the champion and baselines by 5% WAPE.”*

## Phase 4 — True Cost of Stock and decision rules (days 19–23)

These are plain, deterministic Python functions, not ML. They live in `ml/retailiq_ml/decisions/` as a separate package from the model code, and run on Modal as the last step of `predict_shop`, right after inference, because they consume the P10/P50/P90 forecasts directly. The model never calls them and they never touch model internals, so they can move to a Postgres function or Edge Function later without changing the ML. Move the logic you already have in the prototype into `true_cost.py` and `reorder.py`, and lock every pitch-deck number into a test.

**True Cost of Stock** (per product, per day), from your five components:

```latex
\text{daily cost} = \frac{V \times (r_{loan} + r_{opp} + r_{risk}) + \text{shelf rent} + \text{handling}}{365}
```

where V = stock value at cost, r\_loan = the shop's loan rate, r\_opp = return the cash could earn, r\_risk = spoilage/damage rate for that category, shelf rent = the product's share of monthly rent by shelf space, handling = staff time. Store the per-shop rates in `shops` with sensible defaults the owner can change.

**Hold-or-clear rule:** clear when the discount needed is smaller than the cost of waiting.

```latex
\text{max discount} = \text{share expected never to sell} + \frac{\text{carrying cost until next season}}{\text{unit value}}
```

The “share expected never to sell” comes from the forecast: units on hand minus P50 demand until the next season, divided by units on hand. Recommend the smallest step (10%, 20%, 30%) below the max that the forecast says will clear the stock.

**Reorder rule:**

1. Days of cover = on hand ÷ forecast daily demand.
2. If days of cover < lead time + review days (e.g. 7), reorder.
3. Order qty = forecast demand over (lead time + review period) + safety stock − on hand − already on order.
4. Safety stock = P90 demand minus P50 demand over the lead time (uses your quantile forecasts directly).
5. Round up to the supplier's pack size.

**Write decisions with their reasons.** Every row in `decisions` stores `reason_json` with all inputs and intermediate numbers (stock, forecast, lead time, cost parts). The app and the agent show this as “Why / Worth / Source”, which delivers your “every number shows its source” promise.

**Claude Code prompt:** *“Implement ml/retailiq\_ml/decisions/true\_cost.py and reorder.py per docs/decisions.md as pure functions with no Modal or database imports. Write pytest tests that reproduce the two worked examples from our deck (slow product: 175 units, 10% clearance; fast seller: 579 units forecast, 4 days stock, 7-day lead time) exactly. Every function returns a result plus a reason dict.”*

## Phase 5 — LLM layer and decision agent: Gemini API (days 24–28)

The chatbot has two parts: the `agent-ask` Supabase Edge Function owns the data and the tools, and the Google Gemini API is the language layer that understands the question, picks a tool and words the answer. Gemini never touches the database or Modal, and never does arithmetic.

**How one question flows:**

1. The frontend sends the question to `agent-ask` with the user's JWT.
2. `agent-ask` sends the question, system prompt and tool declarations to Gemini.
3. Gemini replies with a function call (e.g. `get_reorder("Milo 1kg")`).
4. `agent-ask` runs that tool against Postgres with the user's JWT, so RLS limits it to their shop, and sends the result back to Gemini.
5. Steps 3–4 repeat until Gemini returns a final answer; the guardrail checks it before it reaches the owner.

**Set up the LLM layer:**

1. Get an API key from Google AI Studio and store it only as a Supabase function secret (`GEMINI_API_KEY`). It must never appear in the frontend.
2. Use the official `@google/genai` SDK in the Edge Function.
3. **Pick and pin a model.** Use a stable Gemini 3.x Flash model (fast and cheap enough for chat) and pin its exact model id in one config constant. Avoid Gemini 2.5 models: Google is shutting them down on 16 October 2026. Check Google's model list before the pilot and re-check monthly.
4. Put every Gemini call behind one small wrapper (`supabase/functions/_shared/llm.ts`: `chat(messages, tools)`). Model changes, retries and a future provider switch then touch one file.
5. Settings: low temperature (0–0.3) for consistent answers, a max output length, a timeout of about 20 seconds, and up to 5 tool rounds per question.
6. **Privacy:** Gemini receives the question and that shop's tool results, nothing else. Use a paid-tier key for shop data and check Google's data-use terms for the tier you choose; mention the LLM provider in your privacy note to shops.

**Tools (function declarations)**, each a SQL query in the Edge Function:

- `get_todays_actions()` — top 3 rows in `decisions` by RM value
- `get_forecast(product)` — next 4 weeks from `forecasts` (P10/P50/P90)
- `get_true_cost(product | "slow_stock")` — from `decisions.reason_json`
- `get_reorder(product)` and `get_clearance(product)`
- `find_product(name)` — fuzzy match on Malay and English names (Postgres `pg_trgm`)
- `get_data_status()` — champion model version, its WAPE, last run time, low-confidence products

Validate every function call Gemini returns against your schema before running it: unknown tool names or arguments are rejected, not guessed.

**System prompt rules:**

- Reply in the language the owner used (Malay or English).
- Use only numbers returned by tools; never estimate or calculate.
- Format: one decision line, then Why / Worth / Source (source = model version and date).
- If data is missing or low confidence, say so plainly and say what data would fix it.

**Guardrails and reliability:**

1. Check that every RM figure and quantity in the answer appears in that turn's tool results; if not, retry once, then fall back to a templated answer built straight from the data.
2. If Gemini is down, slow or rate-limited (429), show the templated answer for `get_todays_actions()` so the app still works without the LLM.
3. Log each question, tool calls, model id, latency and token use to an `agent_logs` table (with shop consent) to watch cost and quality.
4. Test set: 30 real-style questions in Malay and English (“Berapa kos stok perlahan saya?”, “Apa nak order minggu ni?”) with the expected tool call. Run it after every prompt or model change.

**Claude Code prompts:** *“Create supabase/functions/\_shared/llm.ts: a wrapper around the @google/genai SDK with a pinned model id constant, function calling, timeout, retry on 429 and token logging. Read GEMINI\_API\_KEY from function secrets.”* Then: *“Build supabase/functions/agent-ask using llm.ts: declare the tools in docs/agent.md, run each tool as a Postgres query with the caller's JWT, loop up to 5 rounds, validate function calls, apply the number-checking guardrail with a templated fallback, and add a test suite of 30 bilingual questions.”*

## Phase 6 — Connect the frontend to Supabase (days 29–33)

Keep your Netlify UI and replace its demo data with Supabase calls, screen by screen. The frontend never knows Modal exists.

1. **Find the demo data.** Ask Claude Code: *“List every place in frontend/ that uses hard-coded or mock data, and which Supabase table or Edge Function should replace it.”* That list is your task list.
2. **Add login** with the Supabase JS client (email magic link or phone OTP). Use only the anon key in the frontend; RLS does the protection.
3. **What each screen uses:**

| Screen | Supabase call |
| --- | --- |
| Upload + column mapping | Storage upload to `raw-uploads`, then `functions.invoke('ingest')` |
| Data health card | `uploads` row from ingest |
| “Preparing your forecasts” status | `ml_jobs` row, live via Supabase Realtime |
| Home: “What should I do today?” | select from `decisions` |
| Product detail chart | select from `forecasts` |
| True Cost breakdown | `decisions.reason_json` |
| Ask-a-question box | `functions.invoke('agent-ask')` |
| Settings (loan rate, rent, lead times) | update `shops`, `products` |
| “Did you act on this?” | insert into `decision_feedback` |

4. Put the Supabase URL and anon key in Netlify environment variables (e.g. `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
5. Add loading, empty (“upload your sales to see this”) and error states to every screen.
6. The Done / Not now / Wrong buttons on each decision are how you will measure cash released in the pilot.

**Claude Code prompt:** *“Replace the mock data on the Home screen with a Supabase query on decisions for the logged-in shop, using VITE\_SUPABASE\_URL and VITE\_SUPABASE\_ANON\_KEY. Add loading, empty and error states. Don't change the visual design.”* Do one screen per session.

## Phase 7 — Deploy Modal and connect it securely (days 34–38)

Modal runs inference in batch and on demand, writes results to Supabase, and accepts calls only from Supabase Edge Functions.

1. **Secrets in Modal:** `modal secret create retailiq-supabase` with the `ml_worker` Postgres connection string, the Supabase URL, and a storage key limited to the two buckets.
2. **Private ML endpoints:** expose `POST /train` and `POST /predict` from `app.py` as Modal web endpoints with Modal's proxy auth enabled, so every call must carry a Modal token pair. Store that token pair as Supabase function secrets. Endpoints `spawn` the job and return a call id immediately; they never wait for training to finish.
3. **`trigger-ml` Edge Function:** verifies the user's JWT, looks up their `shop_id` (never trust a shop id from the browser), inserts an `ml_jobs` row, calls Modal's `/train` then `/predict`, and stores the call id. Modal updates the `ml_jobs` row when it finishes or fails.
4. **Scheduled jobs on Modal** (cron is in UTC; 18:00 UTC = 2:00 am MYT):
   - nightly `predict_all`: for each active shop, load champion, forecast 28 days, run decision rules, write `forecasts` and `decisions`
   - weekly `train_all` (e.g. Sunday): train a challenger per shop, evaluate, promote if it wins
   - nightly `score_last_week`: compare past forecasts to actual sales and record live WAPE
   - each shop runs in its own call (`.map` over shop ids), so one bad shop never stops the others
5. **Write-back rules:** each prediction run writes with its `model_version_id` in one transaction and replaces that shop's previous future forecasts, so the app never shows half-written results.
6. **Deploy:** `modal deploy app.py` from `ml/`; deploy Edge Functions with `supabase functions deploy`. Add a GitHub Action that runs `pytest` and then both deploys on pushes to `main`.
7. **Monitoring:** failed `ml_jobs` rows trigger an email or WhatsApp alert to you; check live WAPE per shop weekly. If a champion is worse than its baseline for 2 weeks, investigate the shop's data or roll back.
8. **Data protection:** private buckets, RLS everywhere, Modal holding only the limited `ml_worker` role, daily database backups, and a privacy note for shops covering what you hold and why (Malaysia's PDPA applies).

**Claude Code prompt:** *“Add to ml/app.py: train and predict web endpoints with proxy auth that spawn jobs and return a call id; predict\_all, train\_all and score\_last\_week on Modal cron schedules mapped per shop; and status updates to ml\_jobs. Then build supabase/functions/trigger-ml that derives shop\_id from the JWT and calls those endpoints with the Modal token from function secrets.”*

## Phase 8 — Pilot readiness and measuring results

The pilot's job is to replace the “≈RM2,000 a year\*” estimates in your pricing slide with measured numbers. Decide now what you will measure.

Before the first pilot shop:

- [ ] One full test run with a real (anonymised) shop file: upload → forecast → decisions → agent answer, under 10 minutes
- [ ] Every number in the agent's answers traces to a `decisions` or `forecasts` row
- [ ] Owner can change loan rate, rent and lead times
- [ ] A one-page Malay/English onboarding guide and the upload templates
- [ ] Consent form covering data use and anonymised results

Measure per shop, from week 1:

| Metric | How |
| --- | --- |
| Forecast accuracy | WAPE vs seasonal-naive baseline, from `model_versions` |
| Cash released | RM value of CLEAR decisions marked “Done” × units actually sold |
| Stock-outs avoided | REORDER decisions marked “Done” where stock would have hit 0 before delivery |
| Engagement | Questions asked per week, decisions acted on |
| Value vs price | Cash released ÷ subscription (your 3× guarantee) |

Run a weekly 15-minute call or visit with each pilot shop; their “Wrong” clicks and complaints are your roadmap for the next version.

## Working with Claude Code, and the timeline

The build takes about 7 weeks part-time, putting the first pilot shop live around Nov 23 if you start this week and keep each phase small. Treat the day ranges in each phase as a guide, not a deadline.

&#91;embedded content: build roadmap · 7 phases, 1 gate\]

The forecast gets two weeks because backtesting on real shop data always surfaces data problems; frontend and deploy can run in parallel in the last week.

How to get the most from Claude Code:

- **One phase, one branch, small prompts.** Ask for one module at a time, review the diff, run tests, commit. Large “build everything” prompts produce code you can't debug.
- **Write the spec first.** For each phase, put a short `docs/<phase>.md` (the bullets from this guide) in the repo and point Claude Code to it.
- **Use plan mode** for anything touching several files: ask it to propose a plan, correct it, then let it build.
- **Tests are your contract.** Especially for money: the deck's worked examples must pass as tests before you trust any number in front of a shop owner.
- **Keep `CLAUDE.md` updated** with each new rule or command, so new sessions don't repeat old mistakes.
- **Understand the ML code yourself.** As technical head you will be asked how the forecast works; have Claude Code explain each model file to you line by line.
