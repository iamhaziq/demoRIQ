-- Row level security: a signed-in user sees only their own shop. Users never write
-- forecasts, decisions, model_versions or ml_jobs (Modal / Edge Functions do).

-- The caller's shop. security definer so it can read shops without recursing into RLS.
create function public.current_shop_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.shops where owner_user_id = auth.uid()
$$;
revoke all on function public.current_shop_id() from public, anon;
grant execute on function public.current_shop_id() to authenticated;

-- Create the shop on signup (one shop per account).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.shops (owner_user_id) values (new.id) on conflict (owner_user_id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Table privileges. Start from nothing, then grant only what each role needs.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.shops to authenticated;
grant update (name, language, loan_rate_pct, opportunity_rate_pct, risk_rate_pct, rent_per_month,
              storage_share_of_rent, shelf_area, handling_per_month, review_days)
  on public.shops to authenticated;

grant select, insert, update, delete on public.products, public.sales, public.stock_snapshots
  to authenticated;
grant select, insert, update on public.uploads to authenticated;
grant select on public.holidays, public.ml_jobs, public.model_versions, public.forecasts,
  public.decisions to authenticated;
grant select, insert on public.decision_feedback to authenticated;

-- New tables must opt in to grants explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Enable RLS everywhere.
alter table public.shops enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.stock_snapshots enable row level security;
alter table public.uploads enable row level security;
alter table public.holidays enable row level security;
alter table public.ml_jobs enable row level security;
alter table public.model_versions enable row level security;
alter table public.forecasts enable row level security;
alter table public.decisions enable row level security;
alter table public.decision_feedback enable row level security;

-- shops
create policy shops_select_own on public.shops for select to authenticated
  using (owner_user_id = (select auth.uid()));
create policy shops_update_own on public.shops for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

-- Shop-owned tables the user can edit (uploads and settings).
create policy products_own on public.products for all to authenticated
  using (shop_id = (select public.current_shop_id()))
  with check (shop_id = (select public.current_shop_id()));
create policy sales_own on public.sales for all to authenticated
  using (shop_id = (select public.current_shop_id()))
  with check (shop_id = (select public.current_shop_id()));
create policy stock_snapshots_own on public.stock_snapshots for all to authenticated
  using (shop_id = (select public.current_shop_id()))
  with check (shop_id = (select public.current_shop_id()));
create policy uploads_own on public.uploads for all to authenticated
  using (shop_id = (select public.current_shop_id()))
  with check (shop_id = (select public.current_shop_id()));

-- Read-only for users (writes come from Modal / service role).
create policy ml_jobs_select_own on public.ml_jobs for select to authenticated
  using (shop_id = (select public.current_shop_id()));
create policy model_versions_select_own on public.model_versions for select to authenticated
  using (shop_id = (select public.current_shop_id()));
create policy forecasts_select_own on public.forecasts for select to authenticated
  using (shop_id = (select public.current_shop_id()));
create policy decisions_select_own on public.decisions for select to authenticated
  using (shop_id = (select public.current_shop_id()));

-- Feedback: read and add own, no edits.
create policy decision_feedback_select_own on public.decision_feedback for select to authenticated
  using (shop_id = (select public.current_shop_id()));
create policy decision_feedback_insert_own on public.decision_feedback for insert to authenticated
  with check (shop_id = (select public.current_shop_id()));

-- Reference data.
create policy holidays_read on public.holidays for select to authenticated using (true);
