-- Ingest write path and data health summary. Both run as the caller (security invoker), so RLS
-- limits them to the caller's shop.

-- Writes one cleaned upload in a single transaction. Products are matched on name_key; rows
-- for an existing product/day are replaced, so re-uploading a file is safe.
create function public.ingest_commit(p_products jsonb, p_sales jsonb, p_stock jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_shop uuid := public.current_shop_id();
  v_products int;
  v_sales int;
  v_stock int;
begin
  if v_shop is null then
    raise exception 'no shop for this user' using errcode = '42501';
  end if;

  -- New products get defaults; existing ones are only updated with values the file provided,
  -- so an upload never blanks out lead times or costs the owner already set.
  insert into public.products (shop_id, name, sku, category, unit_cost, unit_price, supplier,
                               lead_time_days, pack_size)
  select v_shop, x.name, x.sku, x.category, x.unit_cost, x.unit_price, x.supplier,
         coalesce(x.lead_time_days, 7), coalesce(x.pack_size, 1)
  from jsonb_to_recordset(coalesce(p_products, '[]')) as x(
    name text, sku text, category text, unit_cost numeric, unit_price numeric, supplier text,
    lead_time_days int, pack_size int)
  on conflict (shop_id, name_key) do nothing;

  update public.products p set
    sku = coalesce(x.sku, p.sku),
    category = coalesce(x.category, p.category),
    unit_cost = coalesce(x.unit_cost, p.unit_cost),
    unit_price = coalesce(x.unit_price, p.unit_price),
    supplier = coalesce(x.supplier, p.supplier),
    lead_time_days = coalesce(x.lead_time_days, p.lead_time_days),
    pack_size = coalesce(x.pack_size, p.pack_size)
  from jsonb_to_recordset(coalesce(p_products, '[]')) as x(
    name text, sku text, category text, unit_cost numeric, unit_price numeric, supplier text,
    lead_time_days int, pack_size int)
  where p.shop_id = v_shop and p.name_key = lower(x.name);
  get diagnostics v_products = row_count;

  insert into public.sales as s (shop_id, product_id, date, qty, revenue)
  select v_shop, p.id, x.date, x.qty, x.revenue
  from jsonb_to_recordset(coalesce(p_sales, '[]')) as x(product text, date date, qty numeric, revenue numeric)
  join public.products p on p.shop_id = v_shop and p.name_key = lower(x.product)
  on conflict (shop_id, product_id, date) do update set qty = excluded.qty, revenue = excluded.revenue;
  get diagnostics v_sales = row_count;

  insert into public.stock_snapshots as s (shop_id, product_id, date, on_hand, on_order)
  select v_shop, p.id, x.date, x.on_hand, x.on_order
  from jsonb_to_recordset(coalesce(p_stock, '[]')) as x(product text, date date, on_hand numeric, on_order numeric)
  join public.products p on p.shop_id = v_shop and p.name_key = lower(x.product)
  on conflict (shop_id, product_id, date) do update
    set on_hand = excluded.on_hand, on_order = excluded.on_order;
  get diagnostics v_stock = row_count;

  return jsonb_build_object('products', v_products, 'sales', v_sales, 'stock', v_stock);
end $$;

revoke all on function public.ingest_commit(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.ingest_commit(jsonb, jsonb, jsonb) to authenticated;

-- Data health card: how much history the caller's shop has. "8 weeks of history" for a product
-- means its first sale is at least 56 days before the shop's latest sale date.
create function public.shop_data_health()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with shop as (select public.current_shop_id() as id),
  per_product as (
    select s.product_id, min(s.date) as first_date
    from public.sales s, shop where s.shop_id = shop.id
    group by s.product_id
  ),
  span as (
    select min(s.date) as first_date, max(s.date) as last_date
    from public.sales s, shop where s.shop_id = shop.id
  )
  select jsonb_build_object(
    'products', (select count(*) from public.products p, shop where p.shop_id = shop.id),
    'products_with_sales', (select count(*) from per_product),
    'first_date', span.first_date,
    'last_date', span.last_date,
    'days_of_history', coalesce(span.last_date - span.first_date + 1, 0),
    'pct_products_8_weeks', coalesce(round(100.0
        * (select count(*) from per_product where span.last_date - per_product.first_date >= 56)
        / nullif((select count(*) from per_product), 0), 1), 0),
    'stockout_days', (select count(*) from public.stock_snapshots k, shop
                      where k.shop_id = shop.id and k.on_hand = 0),
    'enough_history', coalesce(span.last_date - span.first_date + 1, 0) >= 90
  )
  from span
$$;

revoke all on function public.shop_data_health() from public, anon;
grant execute on function public.shop_data_health() to authenticated;
