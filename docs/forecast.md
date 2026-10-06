# Phase 3 spec: forecasting, evaluation, versioning (Modal)

Source: build-guide.md, Phase 3. Code in ml/retailiq_ml/. Pure modules (panel, baselines, features,
forecast, evaluate, quantiles, registry rules) have no Modal or DB imports; data.py, snapshots.py and
pipeline.py do I/O; app.py only wraps pipeline functions as Modal functions.

## Daily panel (`panel.py`)
- One row per product per day from the product's first sale to `as_of` (the shop's last sales date).
  Days with no sales row are 0 (shops record only what sold).
- `stockout` = a stock snapshot that day with on_hand = 0. Stock-out days are excluded from
  training targets and from scoring (zero stock, not zero demand).
- `history_days` per product = days from first sale to as_of. Under 56 days (8 weeks) =
  **low confidence**: always forecast with the 28-day average, flagged.

## Baselines (`baselines.py`, statsforecast)
Seasonal naive (season 7), 28-day window average, AutoETS (season 7), CrostonOptimized, ADIDA.
Stock-out days are filled with the product's recent median before fitting (statsforecast needs
complete series).

## Features (`features.py`), one row per product per day
**Direct forecasting:** every demand-history feature uses data at least 28 days old (= the horizon),
so all 28 days are predicted in one pass. This replaces the guide's lags 7/14: on a 28-day horizon
those need recursion (feeding predictions back in), which scored worse in backtests.
- same-weekday lags 28/35/42/49 and their mean; rolling means over 7/28/56 days and std over 28,
  all ending 28 days back
- day of week, month, day of month, payday window (25th to 1st)
- holiday today flag; days until next Raya, CNY, Deepavali, any holiday (capped at 60)
- price and price ÷ product's median price; category (categorical)

## Model (`forecast.py`)
One LightGBM model set per shop across all products. **P50 = expected demand** from a Poisson
objective (summing daily medians of skewed counts under-forecasts weeks); P10/P90 from quantile
models (alpha 0.1, 0.9). Clipped so 0 ≤ P10 ≤ P50 ≤ P90. Needs more than 28 days of history.

On noisy data a 28-day average is hard to beat; LightGBM earns promotion only where it learns real
structure (payday, holidays, price). The 5% rule decides per shop.

## Quantiles (`quantiles.py`)
- Baselines give a point forecast only. Daily P10/P90 come from a negative binomial with that mean
  and the product's dispersion (variance/mean of non-stock-out daily sales; Poisson if var ≤ mean).
- **Daily to weekly:** P50_week = sum of daily P50. Spreads add in quadrature (days treated as
  independent): P90_week = P50_week + sqrt(sum (P90_d − P50_d)²), same for P10, floored at 0.
  The same helper gives demand over a lead time for Phase 4.

## Evaluation (`evaluate.py`)
Rolling-origin backtest: 4 windows, cutoffs 7 days apart, ending 28 days before as_of; each window
trains up to the cutoff and predicts 28 days. **WAPE** = Σ|forecast − actual| ÷ Σ actual, on
product-week sums over non-stock-out days, pooled across products and windows.

## Versioning and promotion (`registry.py`)
- The candidate is the best of LightGBM and the baselines on the same backtest.
  Promotion compares the candidate with the current champion's stored WAPE.
- Promote when there is no champion, or candidate WAPE ≤ 0.95 × champion WAPE (5% relative).
  LightGBM must also beat the best baseline by 5%, otherwise the best baseline is the candidate.
- Artifacts: Modal Volume `/models/{shop_id}/v{n}/` with `model.pkl` (LightGBM boosters, or the
  baseline name), `meta.json` (features, params, library versions, trained_through). Training data
  snapshot as Parquet in the `training-snapshots` bucket at `{shop_id}/v{n}.parquet`.
- `model_versions` row per training run (candidate → champion; old champion → retired).
  Rollback = set an older version back to champion (`registry.rollback`).
