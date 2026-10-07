-- "Preparing your forecasts" follows the shop's ml_jobs rows live. Realtime applies the table's RLS
-- (ml_jobs_select_own), so each owner only receives their own shop's job updates.
alter publication supabase_realtime add table public.ml_jobs;
