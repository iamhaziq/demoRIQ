# Phase 5 spec: decision agent (Gemini)

Source: build-guide.md, Phase 5. Code: supabase/functions/agent-ask/ and _shared/llm.ts.

## Flow
Frontend → `agent-ask` (user JWT) → Gemini picks a tool → the tool runs a query with the user's JWT
(RLS = their shop only) → result back to Gemini → … (max 5 rounds, 20 s budget) → number guardrail →
answer. Gemini never sees the database, Modal, or another shop; it never calculates.

## LLM layer (`_shared/llm.ts`)
- Model pinned in `MODEL_ID` = `gemini-3.6-flash` (stable, no shutdown date as of 2026-10-07).
  `gemini-3.8-flash` (Google's default) returned 503 on every call during setup; revisit monthly.
- `generateContent` (stateless: no conversation stored at Google between requests). The model's turn is
  appended to history unchanged so Gemini 3 thought signatures are preserved.
- Temperature left at the default: Google advises against lowering it on Gemini 3+ (it can cause
  looping), which overrides the guide's 0–0.3. Consistency comes from tools + guardrail.
- Thinking level LOW, 2048 max output tokens, 12 s per call, one retry on 429/500/503/504.
- Key: `GEMINI_API_KEY` in Supabase function secrets only (local: supabase/functions/.env, git-ignored).
  Use a paid-tier key for shop data and mention Google as the LLM provider in the privacy note.

## Tools (`agent-ask/tools.ts`)
| Tool | Reads |
| --- | --- |
| get_todays_actions() | top 3 current `decisions` by value_rm |
| get_forecast(product) | next 4 weeks of `forecasts` (P10/P50/P90), low-confidence flag |
| get_true_cost(product or "slow_stock") | `decisions.reason_json.true_cost`; slow_stock = all current CLEAR/HOLD rows, totals computed in code |
| get_reorder(product) | current REORDER decision |
| get_clearance(product) | current CLEAR/HOLD decision |
| find_product(name) | `find_products()` (pg_trgm on name, exact SKU) |
| get_data_status() | champion model version + WAPE, last ML job, low-confidence products, last upload |

Products are resolved by fuzzy match; a weak or ambiguous match returns `product_not_found` /
`ambiguous_product` with suggestions, and the agent asks which one. Every result carries `source`
(model version, model type, run date). Calls are validated against the declarations: unknown tools,
unknown or missing arguments, non-strings or over-long values are rejected, never guessed.

## Guardrail and fallback
- Every number in the answer (RM figures, quantities, %) must equal a number in this turn's tool
  results (or the question), at the precision written; fractions also match as percentages
  (0.08 = 8%). List markers are ignored.
- Fails → one retry telling Gemini which numbers are unsupported → still fails → templated answer
  built straight from the tool results.
- Gemini down, slow, rate-limited, or out of rounds → templated answer (today's actions if no tool ran).

## `decisions.reason_json` contract (written by Modal in Phase 7)
```json
{
  "product": {"name": "...", "sku": "..."},
  "as_of": "2026-10-06",
  "true_cost": { ...true_cost.TrueCost.reason },
  "reorder": { ...reorder.Reorder.reason, "qty": 306, "cash_required": 180.54 },
  "hold_or_clear": { ...true_cost.HoldOrClear.reason, "decision": "CLEAR", "discount_pct": 10,
                     "cash_released": 1496.88, "interest_avoided_per_year": 119.75,
                     "holding_cost_total": 302.4, "clear_at_any_discount": false }
}
```
`reorder` is present on REORDER rows, `hold_or_clear` on CLEAR/HOLD rows; `true_cost` on all.

## Logs
`agent_logs` (question, tool calls, answer, fallback reason, model, latency, tokens) only when
`shops.agent_log_consent` is true.

## Tests
- Unit (deno test): call validation, guardrail, language detection, templates, agent loop with a
  scripted fake LLM (multi-round, round cap, rejected calls, guardrail retry/fallback, LLM outage).
- Eval: 30 bilingual questions with the expected first tool, against the real model with canned
  tool data: `deno run -A supabase/functions/agent-ask/eval/run_eval.ts`. Run after every prompt or
  model change.
