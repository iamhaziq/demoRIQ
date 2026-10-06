// Forecast screen queries. Plain module with the client passed in, so tests can run it too.
import { chartRows, historyStart, panel } from './forecast.js'

const METRIC_COLS = 'as_of, model_version_id, days_of_cover, forecast_p10, forecast_p50, forecast_p90, confidence, low_confidence'

/** Products for the picker, and the one to open first (the largest current reorder, else the first by name). */
export async function loadForecastProducts(supabase) {
  const [products, top] = await Promise.all([
    supabase.from('products').select('id, sku, name').order('name'),
    supabase
      .from('decisions')
      .select('product_id')
      .is('superseded_at', null)
      .eq('type', 'REORDER')
      .order('value_rm', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (products.error) throw products.error
  if (top.error) throw top.error
  const list = products.data ?? []
  return { products: list, defaultId: top.data?.product_id ?? list[0]?.id ?? null }
}

/** Chart rows and side panel for one product of the signed-in shop (RLS scopes every query). */
export async function loadProductForecast(supabase, productId) {
  const [product, metrics, daily, reorder] = await Promise.all([
    supabase.from('products').select('id, sku, name, lead_time_days').eq('id', productId).maybeSingle(),
    supabase.from('product_metrics').select(METRIC_COLS).eq('product_id', productId).maybeSingle(),
    supabase.from('forecast_daily').select('date, p10, p50, p90').eq('product_id', productId).order('date'),
    supabase
      .from('decisions')
      .select('qty, reason_json')
      .eq('product_id', productId)
      .eq('type', 'REORDER')
      .is('superseded_at', null)
      .maybeSingle(),
  ])
  for (const r of [product, metrics, daily, reorder]) if (r.error) throw r.error

  const m = metrics.data
  const [sales, model] = await Promise.all([
    m
      ? supabase.from('sales').select('date, qty').eq('product_id', productId)
        .gte('date', historyStart(m.as_of)).lte('date', m.as_of).order('date')
      : { data: [] },
    m?.model_version_id
      ? supabase.from('model_versions').select('version, model_type').eq('id', m.model_version_id).maybeSingle()
      : { data: null },
  ])
  for (const r of [sales, model]) if (r.error) throw r.error

  return {
    product: product.data,
    asOf: m?.as_of ?? null,
    rows: chartRows(sales.data ?? [], daily.data ?? []),
    panel: panel({ product: product.data, metrics: m, reorder: reorder.data, model: model.data }),
  }
}
