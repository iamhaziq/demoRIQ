-- Queue ML jobs for the caller's shop without the service-role key (used by trigger-ml).
-- Users still cannot write ml_jobs directly; these functions only ever touch their own shop's jobs.

-- Returns the new job, or the job already queued/running in the last 30 minutes (created = false).
create function public.enqueue_ml_job(p_type text)
returns table (job_id uuid, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid := public.current_shop_id();
  v_job uuid;
begin
  if v_shop is null then
    raise exception 'no shop for this user' using errcode = '42501';
  end if;
  if p_type not in ('train', 'predict') then
    raise exception 'job type must be train or predict' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ml_jobs:' || v_shop::text)); -- no double-queue on double-click
  select id into v_job from public.ml_jobs
  where shop_id = v_shop and status in ('queued', 'running') and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1;
  if v_job is not null then
    return query select v_job, false;
    return;
  end if;
  insert into public.ml_jobs (shop_id, type) values (v_shop, p_type) returning id into v_job;
  return query select v_job, true;
end $$;

-- Record Modal's call id, or mark the job failed if Modal could not be reached.
create function public.attach_ml_job_call(p_job uuid, p_call_id text, p_error text default null)
returns void
language sql security definer set search_path = '' as $$
  update public.ml_jobs set
    modal_call_id = p_call_id,
    status = case when p_error is null then status else 'failed' end,
    error = left(p_error, 1000),
    finished_at = case when p_error is null then finished_at else now() end
  where id = p_job and shop_id = public.current_shop_id() and status = 'queued'
$$;

revoke all on function public.enqueue_ml_job(text) from public, anon;
revoke all on function public.attach_ml_job_call(uuid, text, text) from public, anon;
grant execute on function public.enqueue_ml_job(text) to authenticated;
grant execute on function public.attach_ml_job_call(uuid, text, text) to authenticated;
