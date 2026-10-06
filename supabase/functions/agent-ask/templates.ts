// Language detection and templated answers built straight from tool results. Used when Gemini
// is unavailable or its answer fails the number guardrail. No arithmetic here: only formatting.

export type Lang = 'ms' | 'en'

const MS = new Set([
  'apa', 'berapa', 'saya', 'aku', 'nak', 'hendak', 'perlu', 'patut', 'kena', 'minggu', 'ni', 'ini', 'stok',
  'kos', 'tak', 'tidak', 'untuk', 'barang', 'jual', 'jualan', 'bila', 'boleh', 'mana', 'hari', 'bulan',
  'harga', 'beli', 'pesan', 'buat', 'perlahan', 'lambat', 'habis', 'tolong', 'ke', 'ada', 'lagi', 'yang',
  'dan', 'kedai', 'diskaun', 'untung', 'rugi', 'sekarang', 'esok', 'depan', 'banyak', 'mahal', 'murah',
])
const EN = new Set([
  'what', 'how', 'should', 'my', 'the', 'is', 'much', 'many', 'do', 'does', 'i', 'this', 'week', 'cost',
  'which', 'when', 'need', 'to', 'of', 'for', 'sell', 'buy', 'today', 'next', 'are', 'can', 'will', 'stock',
])

export function detectLanguage(question: string, fallback: Lang): Lang {
  const words = question.toLowerCase().match(/[a-z]+/g) ?? []
  const ms = words.filter((w) => MS.has(w)).length
  const en = words.filter((w) => EN.has(w)).length
  if (ms === 0 && en === 0) return fallback
  return ms >= en ? 'ms' : 'en'
}

const L = {
  why: { ms: 'Sebab', en: 'Why' },
  worth: { ms: 'Nilai', en: 'Worth' },
  source: { ms: 'Sumber', en: 'Source' },
}

export const rm = (n: unknown) =>
  typeof n === 'number'
    ? `RM${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '-'

type Any = Record<string, any>

function sourceLine(src: Any | undefined, lang: Lang): string {
  if (!src || src.model_version == null) return `${L.source[lang]}: RetailIQ${src?.run_date ? `, ${src.run_date}` : ''}`
  return `${L.source[lang]}: ${lang === 'ms' ? 'model' : 'model'} v${src.model_version} (${src.model_type})${src.run_date ? `, ${src.run_date}` : ''}`
}

function actionLine(a: Any, lang: Lang): string {
  if (a.type === 'REORDER') {
    return lang === 'ms'
      ? `Pesan ${a.qty} unit ${a.product} (${rm(a.value_rm)}).`
      : `Order ${a.qty} units of ${a.product} (${rm(a.value_rm)}).`
  }
  const d = a.details ?? {}
  return lang === 'ms'
    ? `Jual murah ${a.product} dengan diskaun ${d.discount_pct}% (lepaskan ${rm(a.value_rm)}).`
    : `Clear ${a.product} at ${d.discount_pct}% off (releases ${rm(a.value_rm)}).`
}

export function renderActions(r: Any, lang: Lang): string {
  if (!r.actions?.length) {
    return lang === 'ms'
      ? 'Belum ada cadangan. Muat naik jualan dan stok anda dahulu supaya RetailIQ boleh membuat ramalan.'
      : 'No recommendations yet. Upload your sales and stock first so RetailIQ can make forecasts.'
  }
  const head = lang === 'ms' ? 'Tindakan utama hari ini:' : "Today's top actions:"
  const lines = r.actions.map((a: Any, i: number) => `${i + 1}. ${actionLine(a, lang)}`)
  return [head, ...lines, sourceLine(r.source, lang)].join('\n')
}

export function renderReorder(r: Any, lang: Lang): string {
  if (r.decision !== 'REORDER') {
    return lang === 'ms' ? `Tak perlu pesan ${r.product} sekarang.` : `No need to order ${r.product} now.`
  }
  const d = r.details ?? {}
  return [
    lang === 'ms' ? `Pesan ${r.qty} unit ${r.product}.` : `Order ${r.qty} units of ${r.product}.`,
    `${L.why[lang]}: ${lang === 'ms'
      ? `stok cukup untuk ${d.days_of_cover} hari, pembekal perlukan ${d.lead_time_days} hari.`
      : `stock covers ${d.days_of_cover} days and the supplier needs ${d.lead_time_days} days.`}`,
    `${L.worth[lang]}: ${lang === 'ms' ? 'tunai diperlukan' : 'cash needed'} ${rm(r.cash_required)}.`,
    sourceLine(r.source, lang),
  ].join('\n')
}

export function renderClearance(r: Any, lang: Lang): string {
  if (r.decision !== 'CLEAR' && r.decision !== 'HOLD') {
    return lang === 'ms' ? `${r.product} bukan stok perlahan.` : `${r.product} is not slow stock.`
  }
  const d = r.details ?? {}
  const first = r.decision === 'CLEAR'
    ? (lang === 'ms' ? `Mula jualan murah ${d.discount_pct}% untuk ${r.product}.` : `Start a ${d.discount_pct}% clearance on ${r.product}.`)
    : (lang === 'ms' ? `Simpan ${r.product} buat masa ini.` : `Hold ${r.product} for now.`)
  return [
    first,
    `${L.why[lang]}: ${lang === 'ms'
      ? `diskaun di bawah ${d.break_even_discount_pct}% lebih baik daripada menyimpan.`
      : `any discount below ${d.break_even_discount_pct}% beats holding.`}`,
    `${L.worth[lang]}: ${lang === 'ms' ? 'tunai dilepaskan' : 'cash released'} ${rm(d.cash_released)}.`,
    sourceLine(r.source, lang),
  ].join('\n')
}

export function renderTrueCost(r: Any, lang: Lang): string {
  if (Array.isArray(r.slow_stock)) {
    if (!r.slow_stock.length) return lang === 'ms' ? 'Tiada stok perlahan buat masa ini.' : 'No slow stock right now.'
    return [
      lang === 'ms'
        ? `Stok perlahan anda (${r.products} barang) berharga ${rm(r.total_stock_value)} dan kos ${rm(r.total_cost_per_day)} sehari.`
        : `Your slow stock (${r.products} products) is worth ${rm(r.total_stock_value)} and costs ${rm(r.total_cost_per_day)} a day.`,
      `${L.worth[lang]}: ${rm(r.total_annual_cost)} ${lang === 'ms' ? 'setahun' : 'a year'}.`,
      sourceLine(r.source, lang),
    ].join('\n')
  }
  const t = r.true_cost ?? {}
  return [
    lang === 'ms'
      ? `${r.product} kos ${rm(t.cost_per_day)} sehari untuk disimpan.`
      : `${r.product} costs ${rm(t.cost_per_day)} a day to hold.`,
    `${L.worth[lang]}: ${rm(t.annual_cost)} ${lang === 'ms' ? 'setahun' : 'a year'}.`,
    sourceLine(r.source, lang),
  ].join('\n')
}

export function renderForecast(r: Any, lang: Lang): string {
  const lines = (r.forecast ?? []).map((w: Any) =>
    `${w.week_start}: ${w.likely} (${lang === 'ms' ? 'julat' : 'range'} ${w.low}–${w.high})`)
  return [
    lang === 'ms' ? `Ramalan jualan ${r.product} (unit seminggu):` : `${r.product} demand forecast (units per week):`,
    ...lines,
    ...(r.low_confidence ? [lang === 'ms' ? 'Keyakinan rendah: sejarah jualan kurang 8 minggu.' : 'Low confidence: under 8 weeks of sales history.'] : []),
    sourceLine(r.source, lang),
  ].join('\n')
}

export function renderProductIssue(r: Any, lang: Lang): string {
  const options = (r.candidates ?? r.suggestions ?? []).join(', ')
  if (lang === 'ms') return options ? `Barang mana satu? ${options}` : `Saya tak jumpa barang "${r.query}".`
  return options ? `Which product do you mean? ${options}` : `I could not find a product called "${r.query}".`
}

/** Pick a template for the most useful tool result; null if none fits. */
export function renderFromResults(results: { name: string; result: Any }[], lang: Lang): string | null {
  for (const { name, result } of [...results].reverse()) {
    if (result?.error === 'product_not_found' || result?.error === 'ambiguous_product') return renderProductIssue(result, lang)
    if (result?.error) continue
    if (name === 'get_todays_actions') return renderActions(result, lang)
    if (name === 'get_reorder') return renderReorder(result, lang)
    if (name === 'get_clearance') return renderClearance(result, lang)
    if (name === 'get_true_cost') return renderTrueCost(result, lang)
    if (name === 'get_forecast') return renderForecast(result, lang)
  }
  return null
}

export const UNAVAILABLE: Record<Lang, string> = {
  ms: 'Maaf, pembantu tidak dapat menjawab sekarang. Sila cuba lagi sebentar.',
  en: 'Sorry, the assistant cannot answer right now. Please try again shortly.',
}
