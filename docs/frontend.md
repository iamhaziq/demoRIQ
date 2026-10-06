# Phase 6 spec: connect the frontend to Supabase

Source: build-guide.md, Phase 6. Rule: the UI only formats numbers; every number comes from Supabase.

## Where the frontend uses demo data today
Everything flows through `src/data.js` (loads `src/data/demo-data.json`) and `src/data/pitch-content.json`.

| Where | Demo data used | Real source | Backend gap |
| --- | --- | --- | --- |
| `format.js` | `meta.currency` | constant `RM` | – |
| `Shell.jsx` TopBar | `meta.store`, `meta.as_of`, demo badge | `shops.name`, last prediction run date | – |
| `Today.jsx` KPIs | `kpis.inventory_value`, `carrying_cost_per_month`, `cash_trapped`, `slow_sku_count` | shop totals view | **needs per-product metrics** (see A) |
| `Today.jsx` cards | `cards[]` (title, decision, why, evidence, impact, draft, confidence, sources) | `decisions` (current) + `reason_json`, mapped to card props in `src/lib/cards.js` | **confidence** not stored (B) |
| `DecisionCard.jsx` Approve / Dismiss / Undo | local state only | insert `decision_feedback` (done / not_now; Undo deletes nothing, adds a newer row) | – |
| `Forecast.jsx` product list | done (step 4) | `products`; opens on the largest current REORDER | – |
| `Forecast.jsx` chart | done (step 4) | `sales` (120 days to the run date) + `forecast_daily`, via `src/lib/forecastData.js` | – |
| `Forecast.jsx` side panel | done (step 4) | `product_metrics` (incl. `confidence`) + current REORDER decision | – |
| `StockCost.jsx` table | per product: stock, value, age, days of cover, cost/day, cost/30d | product metrics | **only products with a decision have cost data** (A) |
| `StockCost.jsx` breakdown | `cost_components`, `carrying_rate_pct`, cost for 1/30/180/365 days | product metrics (true cost reason) | (A) |
| `StockCost.jsx` hold-or-clear slider | `hold_or_clear.by_sell_through[]` (50–95%) | `reason_json.hold_or_clear` | **sensitivity rows not stored** (D) |
| `StockCost.jsx` Debt Freedom | cash released, interest avoided, `meta.financing_label` | `reason_json.hold_or_clear`, `shops.loan_rate_pct` | (D) |
| `AskBar.jsx` / `AgentOverlay.jsx` | done (step 3): `src/lib/ask.js` calls `agent-ask`; suggested questions are constants there | `functions.invoke('agent-ask')` | overlay shows the agent's text answer as sent (no card); fallback answers are labelled |
| `App.jsx` `?demo=1`, `Cards.jsx` `?cards=1` | pitch-video autopilot and title cards | keep on demo JSON (decision needed) | – |

## Screens the guide needs that do not exist yet
Login (magic link / phone OTP), Upload + column mapping (+ templates in `public/templates/`), Data health card
(`uploads.health_json`), "Preparing your forecasts" (`ml_jobs` via Realtime), Settings (shop rates, product lead
times / pack size / holding days, agent log consent).

## Backend additions needed first (written by Modal, so the UI never calculates)
- **A. `product_metrics`** table, one row per product per prediction run (current rows only): on hand, stock value,
  days of cover, age (days since last stock increase), true cost components / annual / per day / 30 / 180 / 365 days,
  rate, forecast 28-day P10/P50/P90, low_confidence, confidence label (same rule as B), slow-stock flag. Plus a `shop_kpis` view for the Today tiles.
- **B. confidence** label in `reason_json` (Low when low_confidence, otherwise from the champion's backtest WAPE).
- **C. `forecast_daily`** table (28 rows per product, replaced each run) for the chart; weekly rows stay for the agent
  and live scoring.
- **D. hold-or-clear sensitivity**: `by_sell_through` rows (50–95%) in `reason_json.hold_or_clear`, computed by the
  same `hold_or_clear()` function.

## Order of work (one screen per session, per the guide)
0. Backend additions A–D (pipeline + migration + tests).
1. Supabase client (`src/lib/supabase.js`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) + Login.
2. Today (KPIs + decision cards + feedback). 3. Ask box → agent-ask. 4. Forecast. 5. Stock Cost.
6. Upload + mapping + health + job status. 7. Settings. Each with loading, empty and error states.
