-- Apply to the dedicated AgentReady Supabase project before deploying the app.
-- The Data API is used only from the server with a secret key. No public table policies.
create table if not exists public.agentready_analysis_runs (
  id uuid primary key,
  status text not null check (status in ('QUEUED', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED')),
  created_at timestamptz not null,
  record jsonb not null
);

create index if not exists agentready_analysis_runs_recent
  on public.agentready_analysis_runs (created_at desc, id desc);

alter table public.agentready_analysis_runs enable row level security;
revoke all on public.agentready_analysis_runs from anon, authenticated;
grant select, insert, update on public.agentready_analysis_runs to service_role;

-- A historical result is immutable even if future application code regresses.
create or replace function public.agentready_guard_terminal_run()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('COMPLETE', 'PARTIAL', 'FAILED') then
    raise exception 'Historical AgentReady runs are immutable';
  end if;
  if old.id <> new.id or old.created_at <> new.created_at then
    raise exception 'AgentReady run identity is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists agentready_guard_terminal_run on public.agentready_analysis_runs;
create trigger agentready_guard_terminal_run
  before update on public.agentready_analysis_runs
  for each row execute function public.agentready_guard_terminal_run();
