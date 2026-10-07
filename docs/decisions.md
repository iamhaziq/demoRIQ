# Phase 4 spec: True Cost of Stock and decision rules

Source: build-guide.md, Phase 4, made exact by the pitch-deck prototype (its numbers are kept in ml/tests/fixtures/deck_examples.json).
All 10 prototype products are reproduced exactly by ml/tests/test_decisions.py.
Code: ml/retailiq_ml/decisions/ (pure Python: no Modal, no database).

## True Cost of Stock (`true_cost.py`), per product, per year
V = units on hand × unit cost. f = financed share = min(1, loan outstanding ÷ shop stock value at cost).

| Part | Formula | Default |
| --- | --- | --- |
| Financing | V × f × loan rate | 8% |
| Opportunity | V × (1 − f) × opportunity rate | 15% |
| Service (handling) | V × service rate | 3% |
| Risk (spoilage, damage) | V × risk rate (product override, else shop default) | 12% |
| Space | storage cost × product share of space | |

Storage cost per year = (rent + utilities) × 12 × storage share of rent. A product's share of space =
units × shelf space per unit ÷ the shop's total (shelf space per unit defaults to 1; the prototype
used 1 for small items, 6 for large).

The guide's formula V × (r_loan + r_opp + r_risk) + rent + handling charged both loan interest and
opportunity cost on the same ringgit; the prototype splits V by how it was financed, which is used here.

Daily cost = annual ÷ 365. Cost per unit per day is rounded to RM0.0001 and the holding cost is
built from it (as in the deck).

## Hold or clear (`true_cost.hold_or_clear`)
- Holding window: days until the next selling season (shop default 60, product override; the deck
  used 60 for food, 180 for seasonal goods).
- Holding cost per unit = cost per unit per day × holding days.
- Share never sold = 1 − expected sold ÷ units, where expected sold = min(units, P50 demand over the
  holding window, without a discount).
- **Break-even discount** = share never sold + holding cost per unit ÷ selling price.
  Any discount below it beats holding. ≥ 100% = clear at any discount.
- Recommended discount: the smallest step (10%, 20%, 30%) below break-even. We have no price-response
  model yet, so "the step the forecast says will clear the stock" is not modelled; the reason says so.
- Cash released = units × price × (1 − discount) × clearance sell-through (assumed 80%, as in the
  deck, stated in the reason), at the recommended step, or at the smallest step when holding is better
  (as the deck does). Interest avoided per year = cash released × loan rate.
- Decision: CLEAR when some stock is expected to be left at the end of the window and a step exists;
  otherwise HOLD.

## Reorder (`reorder.py`)
1. Daily demand = mean daily P50 over the forecast. Days of cover = on hand ÷ daily demand.
2. Reorder when days of cover < lead time + review days (default 7).
3. Order = P50 demand over (lead + review) + safety stock − on hand − on order.
4. Safety stock = P90 − P50 demand over the lead time, with days added in quadrature
   (same rule as quantiles.py; for a flat forecast, 28-day spread × √(lead ÷ 28)).
5. Round up to the supplier's pack size. Cash required = qty × unit cost.

The deck shows 4.0 days of cover from the last 28 days' average sales; the guide's rule uses the
forecast (4.45 days for the same product). The order quantity (306) is the same either way.

## Every result carries a reason
Each function returns its result and a `reason` dict with every input and intermediate number;
decisions.reason_json stores it for the app's Why / Worth / Source.
