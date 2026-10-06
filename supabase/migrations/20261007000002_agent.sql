-- Decision agent: fuzzy product search, question logs (with consent).

-- Fuzzy match on product names (Malay or English, typos). Runs as the caller: RLS applies.
-- exact = the full name or the SKU matches; a partial word match can score 1 without being exact.
create function public.find_products(q text, max_results int default 5)
returns table (id uuid, name text, sku text, category text, score real, exact boolean)
language sql stable security invoker set search_path = '' as $$
  with k as (select lower(regexp_replace(btrim(q), '\s+', ' ', 'g')) as key)
  select p.id, p.name, p.sku, p.category,
         greatest(extensions.similarity(p.name_key, k.key),
                  extensions.word_similarity(k.key, p.name_key))::real as score,
         (p.name_key = k.key or (p.sku is not null and lower(p.sku) = k.key)) as exact
  from public.products p, k
  where p.shop_id = public.current_shop_id()
  order by exact desc, score desc, p.name
  limit least(greatest(max_results, 1), 20)
$$;
revoke all on function public.find_products(text, int) from public, anon;
grant execute on function public.find_products(text, int) to authenticated;

-- Logging questions needs the shop's consent (pilot consent form).
alter table public.shops add column agent_log_consent boolean not null default false;
grant update (agent_log_consent) on public.shops to authenticated;

create table public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  question text not null,
  language text check (language in ('ms', 'en')),
  tool_calls jsonb not null default '[]',
  answer text,
  fallback text, -- null = model answer; otherwise why the templated answer was used
  model text,
  latency_ms integer,
  prompt_tokens integer,
  output_tokens integer,
  thoughts_tokens integer,
  created_at timestamptz not null default now()
);
create index agent_logs_shop on public.agent_logs (shop_id, created_at desc);

alter table public.agent_logs enable row level security;
grant select, insert on public.agent_logs to authenticated;
create policy agent_logs_select_own on public.agent_logs for select to authenticated
  using (shop_id = (select public.current_shop_id()));
create policy agent_logs_insert_own on public.agent_logs for insert to authenticated
  with check (shop_id = (select public.current_shop_id())
              and (select agent_log_consent from public.shops where id = shop_id));
