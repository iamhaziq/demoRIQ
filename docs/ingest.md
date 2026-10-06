# Phase 2 spec: data ingestion

Source: build-guide.md, Phase 2.

## Flow
1. Frontend uploads the original file to `raw-uploads/<shop_id>/<uuid>-<filename>` and inserts an `uploads` row (kind `sales` or `stock`).
2. Frontend parses the file in the browser (SheetJS), shows 20 rows, auto-guesses columns with `guessColumns()` from `supabase/functions/_shared/columns.ts` (shared with the Edge Function), and the owner confirms.
3. Frontend calls `functions.invoke('ingest', { body: { upload_id, column_map } })`.
4. `ingest` (user's JWT, so RLS applies): reads the file from Storage, applies the map and the cleaning rules, then calls `ingest_commit()` which writes products/sales/stock in one transaction, then `shop_data_health()`. Results are saved on the `uploads` row and returned.
5. (Phase 7) on success, call `trigger-ml`.

## Column map
`{ "<field>": "<header in the file>" }`.
- sales: required `date`, `product`, `qty`; optional `sku`, `price` (unit price), `revenue` (line total), `category`.
- stock: required `product`, `on_hand`; optional `date` (default today, MYT), `sku`, `on_order`, `unit_cost`, `unit_price`, `supplier`, `lead_time_days`, `pack_size`, `category`.

Headers are guessed from English and Malay aliases (`tarikh`→date, `kuantiti`/`qty`→qty, `harga`→price, `nama barang`→product, ...). Exact matches win over partial ones; each header is used once.

## Cleaning rules (each has a test in supabase/functions/ingest/clean.test.ts)
- **Dates:** DD/MM/YYYY is the Malaysian default (also `-` and `.` separators, 2-digit years), ISO YYYY-MM-DD, `5 Okt 2026` / `Oct 5, 2026` with English or Malay month names, Excel serial numbers. Invalid calendar dates, years outside 2000–2100 and dates after today are rejected.
- **Money:** strip `RM`, commas and spaces; `(12.50)` is negative and rejected. Rounded to 2 decimals.
- **Quantities:** strip commas and unit words (`pcs`, `unit`); negative, unreadable, or above 10,000 per row are rejected.
- **Product names:** trimmed, internal whitespace collapsed; duplicates merge case-insensitively (same key as the DB `products.name_key`). The first spelling seen is kept.
- **Sales aggregation:** receipts are summed to one row per product per day. If there is no revenue column, revenue = qty × unit price.
- **Stock:** one snapshot per product per day (last row wins). `on_hand = 0` marks a stock-out day (zero stock, not zero demand); the ML excludes those days from training targets.
- Blank rows are skipped silently. Every rejected row is reported with its spreadsheet row number and reason.

## Health summary (`shop_data_health()`)
Products, products with sales, first/last sale date, days of history, % of products with 8+ weeks of history, stock-out days, and `enough_history` (≥ 90 days). Under 8 weeks per product, the ML falls back to simple averages.

## Limits
Files up to 20 MB (bucket limit) and 200,000 rows.
