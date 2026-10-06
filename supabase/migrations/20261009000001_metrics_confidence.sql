-- Forecast confidence label per product (same rule as reason_json.confidence on decisions), so the
-- Forecast screen can show it for products without a decision. Null on rows written before this column.
alter table public.product_metrics add column confidence text check (confidence in ('High', 'Medium', 'Low'));
