-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.my'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.my');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

create temp table j1 as select * from public.enqueue_ml_job('predict');
select is((select created from j1), true, 'first request queues a job');
select is((select count(*)::int from public.ml_jobs where status = 'queued'), 1, 'one queued job, own shop');

create temp table j2 as select * from public.enqueue_ml_job('train');
select is((select created from j2), false, 'second request while queued is not a new job');
select is((select job_id from j2), (select job_id from j1), 'and returns the running job');

select public.attach_ml_job_call((select job_id from j1), 'fc-123');
select is((select modal_call_id from public.ml_jobs where id = (select job_id from j1)), 'fc-123', 'call id recorded');

select throws_ok($$insert into public.ml_jobs (shop_id, type) values (public.current_shop_id(), 'train')$$,
  '42501', null, 'users still cannot insert ml_jobs directly');
select throws_ok($$select public.enqueue_ml_job('drop')$$, '22023', null, 'unknown job types rejected');

-- User B cannot see or touch A's job.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select public.attach_ml_job_call((select job_id from j1), null, 'hijack');
reset role;
select is((select status from public.ml_jobs where id = (select job_id from j1)), 'queued', 'other users cannot fail my job');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select created from public.enqueue_ml_job('predict')), true, 'shops queue independently');
reset role;

select * from finish();
rollback;
