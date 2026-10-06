-- Feedback is append-only (owners cannot edit or delete rows), so Undo is recorded as an action.
-- A decision's current state is its latest feedback row; the history stays for pilot measurement.
alter table public.decision_feedback drop constraint decision_feedback_action_check;
alter table public.decision_feedback add constraint decision_feedback_action_check
  check (action in ('done', 'not_now', 'wrong', 'undo'));
create index decision_feedback_latest on public.decision_feedback (decision_id, at desc);
