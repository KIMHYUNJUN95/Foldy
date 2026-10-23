-- Attendance, payroll and annual-leave integrity hardening.
-- Mutating functions are deliberately service-role only: application server actions perform
-- authorization and the database function supplies the transaction boundary.

alter table public.attendance_attempt_logs
  drop constraint if exists attendance_attempt_logs_failure_reason_check;

alter table public.attendance_attempt_logs
  add constraint attendance_attempt_logs_failure_reason_check
  check (failure_reason is null or failure_reason in (
    'gps_denied', 'gps_unavailable', 'gps_inaccurate', 'outside_radius', 'qr_invalid',
    'qr_scan_failed', 'wifi_not_supported', 'wifi_not_matched',
    'open_break_blocks_clock_out', 'midnight_crossing', 'open_session_exists'
  ));

alter table public.annual_leave_requests
  add column if not exists balance_override_reason text;

create or replace function public.validate_transport_reimbursement_item()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_target_month date;
  v_source_type text;
  v_source_id uuid;
begin
  select target_month into v_target_month
  from public.transport_reimbursement_reports
  where id = new.report_id
    and organization_id = new.organization_id
    and user_id = new.user_id;
  if v_target_month is null then
    raise exception 'transport report scope mismatch';
  end if;
  if date_trunc('month', new.usage_date)::date <> v_target_month then
    raise exception 'transport usage date is outside report month';
  end if;
  if new.property_id is not null and not exists (
    select 1 from public.properties p
    where p.id = new.property_id and p.organization_id = new.organization_id
  ) then
    raise exception 'transport property scope mismatch';
  end if;

  if new.entry_mode = 'manual' then
    new.attendance_session_id := null;
    return new;
  end if;

  v_source_type := new.work_context ->> 'linkedSourceType';
  begin
    v_source_id := (new.work_context ->> 'linkedSourceId')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid linked transport source';
  end;

  if v_source_type = 'attendance' then
    if new.attendance_session_id is distinct from v_source_id or not exists (
      select 1 from public.attendance_sessions s
      where s.id = v_source_id
        and s.organization_id = new.organization_id
        and s.user_id = new.user_id
        and s.operating_date = new.usage_date
        and s.status <> 'invalid'
    ) then
      raise exception 'invalid linked attendance source';
    end if;
  elsif v_source_type = 'cleaning' then
    new.attendance_session_id := null;
    if not exists (
      select 1 from public.cleaning_sessions s
      where s.id = v_source_id
        and s.organization_id = new.organization_id
        and s.staff_user_id = new.user_id
        and s.cleaning_date = new.usage_date
    ) then
      raise exception 'invalid linked cleaning source';
    end if;
  else
    raise exception 'linked transport source is required';
  end if;

  return new;
end;
$$;

drop trigger if exists transport_reimbursement_items_validate on public.transport_reimbursement_items;
create trigger transport_reimbursement_items_validate
before insert or update on public.transport_reimbursement_items
for each row execute function public.validate_transport_reimbursement_item();

create or replace function public.set_annual_leave_baseline_atomic(
  p_organization_id uuid,
  p_user_id uuid,
  p_hire_date date,
  p_base_amount numeric,
  p_bonus_amount numeric,
  p_baseline_date date,
  p_allow_overwrite boolean default false
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and m.role <> 'part_time_staff'
  ) then
    return 'target_not_found';
  end if;

  if p_base_amount < 0 or p_base_amount > 40 or p_bonus_amount < 0 or p_bonus_amount > 8 then
    return 'invalid_amount';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_user_id::text, 0));

  if not p_allow_overwrite and exists (
    select 1 from public.annual_leave_baselines
    where organization_id = p_organization_id and user_id = p_user_id
  ) then
    return 'baseline_exists';
  end if;

  update public.profiles
  set hire_date = p_hire_date
  where id = p_user_id;
  if not found then return 'target_not_found'; end if;

  insert into public.annual_leave_baselines (
    organization_id, user_id, base_amount, bonus_amount, baseline_date
  ) values (
    p_organization_id, p_user_id, p_base_amount, p_bonus_amount, p_baseline_date
  )
  on conflict (organization_id, user_id) do update
  set base_amount = excluded.base_amount,
      bonus_amount = excluded.bonus_amount,
      baseline_date = excluded.baseline_date;

  return 'ok';
end;
$$;

create or replace function public.finalize_attendance_month_atomic(
  p_organization_id uuid,
  p_user_id uuid,
  p_target_month date,
  p_actor_user_id uuid,
  p_total_paid_minutes integer,
  p_gross_amount numeric,
  p_rate_breakdown jsonb,
  p_allowance_breakdown jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prior_id uuid;
  v_snapshot_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_user_id::text || ':' || p_target_month::text, 0)
  );

  if p_target_month >= date_trunc('month', timezone('Asia/Tokyo', now()))::date then
    raise exception 'attendance target month is not closed';
  end if;
  if exists (
    select 1 from public.attendance_month_snapshots
    where organization_id = p_organization_id and user_id = p_user_id
      and target_month = p_target_month and status = 'finalized'
  ) then
    raise exception 'attendance month is already finalized';
  end if;
  if exists (
    select 1 from public.attendance_sessions s
    where s.organization_id = p_organization_id and s.user_id = p_user_id
      and s.operating_date >= p_target_month
      and s.operating_date < (p_target_month + interval '1 month')::date
      and s.status <> 'invalid'
      and (
        s.clock_in_at is null or s.clock_out_at is null or
        s.status in ('open', 'reopened', 'abandoned') or
        s.review_state in ('review_required', 'pending_correction')
      )
  ) then
    raise exception 'attendance month has unresolved sessions';
  end if;
  if exists (
    select 1
    from public.attendance_breaks b
    join public.attendance_sessions s on s.id = b.session_id
    where s.organization_id = p_organization_id and s.user_id = p_user_id
      and s.operating_date >= p_target_month
      and s.operating_date < (p_target_month + interval '1 month')::date
      and b.ended_at is null
  ) then
    raise exception 'attendance month has an open break';
  end if;
  if exists (
    select 1 from public.attendance_correction_requests r
    left join public.attendance_sessions s on s.id = r.session_id
    where r.organization_id = p_organization_id and r.requested_by_user_id = p_user_id
      and r.status in ('requested', 'in_review')
      and (
        (s.operating_date >= p_target_month and s.operating_date < (p_target_month + interval '1 month')::date)
        or (
          r.session_id is null
          and r.desired_clock_in_at >= (p_target_month::timestamp at time zone 'Asia/Tokyo')
          and r.desired_clock_in_at < (
            (p_target_month + interval '1 month')::timestamp at time zone 'Asia/Tokyo'
          )
        )
      )
  ) then
    raise exception 'attendance month has a pending correction';
  end if;
  if exists (
    select 1 from public.attendance_sessions s
    where s.organization_id = p_organization_id and s.user_id = p_user_id
      and s.operating_date >= p_target_month
      and s.operating_date < (p_target_month + interval '1 month')::date
      and s.status = 'completed'
      and s.review_state in ('normal', 'approved_correction')
      and exists (
        select 1 from public.employment_type_history e
        where e.organization_id = p_organization_id and e.user_id = p_user_id
          and e.employment_type = 'hourly' and e.effective_from <= s.operating_date
          and (e.effective_to is null or e.effective_to >= s.operating_date)
      )
      and not exists (
        select 1 from public.hourly_rate_history h
        where h.organization_id = p_organization_id and h.user_id = p_user_id
          and h.effective_from <= s.operating_date
          and (h.effective_to is null or h.effective_to >= s.operating_date)
      )
  ) then
    raise exception 'attendance month has missing hourly-rate coverage';
  end if;

  select id into v_prior_id
  from public.attendance_month_snapshots
  where organization_id = p_organization_id
    and user_id = p_user_id
    and target_month = p_target_month
    and status <> 'superseded'
  order by created_at desc
  limit 1
  for update;

  update public.attendance_month_snapshots
  set status = 'superseded'
  where organization_id = p_organization_id
    and user_id = p_user_id
    and target_month = p_target_month
    and status <> 'superseded';

  insert into public.attendance_month_snapshots (
    organization_id, user_id, target_month, status, total_paid_minutes, gross_amount,
    rate_breakdown, allowance_breakdown, finalized_by_user_id, finalized_at,
    supersedes_snapshot_id
  ) values (
    p_organization_id, p_user_id, p_target_month, 'finalized', p_total_paid_minutes,
    p_gross_amount, coalesce(p_rate_breakdown, '[]'::jsonb),
    coalesce(p_allowance_breakdown, '[]'::jsonb), p_actor_user_id, now(), v_prior_id
  ) returning id into v_snapshot_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, 'attendance_month_finalize',
    'attendance_month_snapshot', v_snapshot_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'target_month', p_target_month,
      'gross_amount', p_gross_amount,
      'total_paid_minutes', p_total_paid_minutes,
      'supersedes_snapshot_id', v_prior_id
    )
  );

  return v_snapshot_id;
end;
$$;

create or replace function public.reopen_attendance_month_atomic(
  p_organization_id uuid,
  p_user_id uuid,
  p_target_month date,
  p_snapshot_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_user_id::text || ':' || p_target_month::text, 0)
  );
  update public.attendance_month_snapshots
  set status = 'reopened'
  where id = p_snapshot_id
    and organization_id = p_organization_id
    and user_id = p_user_id
    and target_month = p_target_month
    and status = 'finalized';
  if not found then return false; end if;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, 'attendance_month_reopen',
    'attendance_month_snapshot', p_snapshot_id,
    jsonb_build_object('user_id', p_user_id, 'target_month', p_target_month, 'reason', trim(p_reason))
  );
  return true;
end;
$$;

create or replace function public.mutate_attendance_session_with_audit(
  p_organization_id uuid,
  p_session_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_reason text,
  p_before_json jsonb,
  p_changes jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_break_minutes integer;
  v_clock_in_at timestamptz;
  v_clock_out_at timestamptz;
  v_user_id uuid;
  v_operating_date date;
begin
  select user_id, operating_date into v_user_id, v_operating_date
  from public.attendance_sessions
  where id = p_session_id and organization_id = p_organization_id;
  if v_user_id is null then return false; end if;
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || v_user_id::text || ':' || date_trunc('month', v_operating_date)::date::text,
      0
    )
  );
  if exists (
    select 1 from public.attendance_month_snapshots
    where organization_id = p_organization_id and user_id = v_user_id
      and target_month = date_trunc('month', v_operating_date)::date and status = 'finalized'
  ) then
    raise exception 'finalized attendance month is locked';
  end if;

  update public.attendance_sessions
  set clock_in_at = case when p_changes ? 'clock_in_at' then (p_changes ->> 'clock_in_at')::timestamptz else clock_in_at end,
      clock_out_at = case when p_changes ? 'clock_out_at' then (p_changes ->> 'clock_out_at')::timestamptz else clock_out_at end,
      clock_in_site_id = case when p_changes ? 'clock_in_site_id' then (p_changes ->> 'clock_in_site_id')::uuid else clock_in_site_id end,
      clock_out_site_id = case when p_changes ? 'clock_out_site_id' then (p_changes ->> 'clock_out_site_id')::uuid else clock_out_site_id end,
      status = case when p_changes ? 'status' then p_changes ->> 'status' else status end,
      review_state = case when p_changes ? 'review_state' then p_changes ->> 'review_state' else review_state end,
      invalidated_at = case when p_changes ? 'invalidated_at' then (p_changes ->> 'invalidated_at')::timestamptz else invalidated_at end,
      invalidated_by_user_id = case when p_changes ? 'invalidated_by_user_id' then (p_changes ->> 'invalidated_by_user_id')::uuid else invalidated_by_user_id end,
      invalidated_reason = case when p_changes ? 'invalidated_reason' then p_changes ->> 'invalidated_reason' else invalidated_reason end,
      abandoned_at = case when p_changes ? 'abandoned_at' then (p_changes ->> 'abandoned_at')::timestamptz else abandoned_at end
  where id = p_session_id and organization_id = p_organization_id;
  if not found then return false; end if;

  if p_changes ? 'break_total_minutes' then
    v_break_minutes := (p_changes ->> 'break_total_minutes')::integer;
    if v_break_minutes < 0 then raise exception 'break minutes must be non-negative'; end if;
    select clock_in_at, clock_out_at into v_clock_in_at, v_clock_out_at
    from public.attendance_sessions where id = p_session_id for update;
    if v_break_minutes > 0 and (
      v_clock_in_at is null or v_clock_out_at is null or
      v_clock_in_at + make_interval(mins => v_break_minutes) > v_clock_out_at
    ) then
      raise exception 'break minutes exceed session duration';
    end if;
    delete from public.attendance_breaks
    where organization_id = p_organization_id and session_id = p_session_id;
    if v_break_minutes > 0 then
      insert into public.attendance_breaks (
        organization_id, session_id, started_at, ended_at
      ) values (
        p_organization_id, p_session_id, v_clock_in_at,
        v_clock_in_at + make_interval(mins => v_break_minutes)
      );
    end if;
  end if;

  insert into public.attendance_session_audits (
    organization_id, session_id, actor_user_id, action_type, reason, before_json, after_json
  ) values (
    p_organization_id, p_session_id, p_actor_user_id, p_action_type, trim(p_reason),
    coalesce(p_before_json, '{}'::jsonb), coalesce(p_changes, '{}'::jsonb)
  );
  return true;
end;
$$;

create or replace function public.create_attendance_session_with_audit(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_reason text,
  p_values jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session_id uuid;
  v_user_id uuid := (p_values ->> 'user_id')::uuid;
  v_operating_date date := (p_values ->> 'operating_date')::date;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || v_user_id::text || ':' || date_trunc('month', v_operating_date)::date::text,
      0
    )
  );
  if exists (
    select 1 from public.attendance_month_snapshots
    where organization_id = p_organization_id and user_id = v_user_id
      and target_month = date_trunc('month', v_operating_date)::date and status = 'finalized'
  ) then
    raise exception 'finalized attendance month is locked';
  end if;

  insert into public.attendance_sessions (
    organization_id, user_id, operating_date, status, review_state,
    clock_in_at, clock_in_site_id, clock_in_method,
    clock_out_at, clock_out_site_id, clock_out_method,
    manual_location, manual_created, manual_created_by_user_id, manual_created_reason
  ) values (
    p_organization_id, v_user_id, v_operating_date,
    p_values ->> 'status', p_values ->> 'review_state',
    (p_values ->> 'clock_in_at')::timestamptz, (p_values ->> 'clock_in_site_id')::uuid,
    p_values ->> 'clock_in_method', (p_values ->> 'clock_out_at')::timestamptz,
    (p_values ->> 'clock_out_site_id')::uuid, p_values ->> 'clock_out_method',
    p_values ->> 'manual_location', coalesce((p_values ->> 'manual_created')::boolean, true),
    p_actor_user_id, p_values ->> 'manual_created_reason'
  ) returning id into v_session_id;

  insert into public.attendance_session_audits (
    organization_id, session_id, actor_user_id, action_type, reason, before_json, after_json
  ) values (
    p_organization_id, v_session_id, p_actor_user_id, p_action_type, trim(p_reason),
    '{}'::jsonb, p_values
  );
  return v_session_id;
end;
$$;

create or replace function public.approve_attendance_correction_atomic(
  p_organization_id uuid,
  p_request_id uuid,
  p_actor_user_id uuid,
  p_comment text,
  p_session_id uuid,
  p_create_session boolean,
  p_action_type text,
  p_before_json jsonb,
  p_session_values jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_reviewer uuid;
  v_applied_session_id uuid;
begin
  select status, reviewed_by_user_id into v_status, v_reviewer
  from public.attendance_correction_requests
  where id = p_request_id and organization_id = p_organization_id
  for update;

  if v_status is null or v_status not in ('requested', 'in_review') then return null; end if;
  if v_status = 'in_review' and v_reviewer is not null and v_reviewer <> p_actor_user_id then
    return null;
  end if;

  if p_create_session then
    v_applied_session_id := public.create_attendance_session_with_audit(
      p_organization_id, p_actor_user_id, p_action_type, p_comment, p_session_values
    );
  else
    if p_session_id is null or not public.mutate_attendance_session_with_audit(
      p_organization_id, p_session_id, p_actor_user_id, p_action_type,
      p_comment, p_before_json, p_session_values
    ) then
      return null;
    end if;
    v_applied_session_id := p_session_id;
  end if;

  update public.attendance_correction_requests
  set status = 'approved',
      session_id = v_applied_session_id,
      review_comment = nullif(trim(p_comment), ''),
      reviewed_by_user_id = p_actor_user_id,
      reviewed_at = now()
  where id = p_request_id and organization_id = p_organization_id;

  return v_applied_session_id;
end;
$$;

create or replace function public.set_attendance_history_atomic(
  p_organization_id uuid,
  p_user_id uuid,
  p_actor_user_id uuid,
  p_kind text,
  p_effective_from date,
  p_hourly_rate numeric default null,
  p_employment_type text default null,
  p_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_close_date date := p_effective_from - 1;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_user_id::text || ':' || p_kind, 0)
  );

  if p_kind = 'hourly_rate' then
    delete from public.hourly_rate_history
    where organization_id = p_organization_id and user_id = p_user_id
      and effective_to is null and effective_from >= p_effective_from;
    update public.hourly_rate_history set effective_to = v_close_date
    where organization_id = p_organization_id and user_id = p_user_id
      and effective_to is null and effective_from < p_effective_from;
    insert into public.hourly_rate_history (
      organization_id, user_id, hourly_rate, effective_from, effective_to, created_by_user_id
    ) values (
      p_organization_id, p_user_id, p_hourly_rate, p_effective_from, null, p_actor_user_id
    ) returning id into v_id;
    insert into public.audit_logs (
      organization_id, actor_user_id, action, target_type, target_id, metadata
    ) values (
      p_organization_id, p_actor_user_id, 'hourly_rate_set', 'hourly_rate_history', v_id,
      jsonb_build_object('user_id', p_user_id, 'hourly_rate', p_hourly_rate,
        'effective_from', p_effective_from, 'note', nullif(trim(p_note), ''))
    );
  elsif p_kind = 'employment_type' then
    delete from public.employment_type_history
    where organization_id = p_organization_id and user_id = p_user_id
      and effective_to is null and effective_from >= p_effective_from;
    update public.employment_type_history set effective_to = v_close_date
    where organization_id = p_organization_id and user_id = p_user_id
      and effective_to is null and effective_from < p_effective_from;
    insert into public.employment_type_history (
      organization_id, user_id, employment_type, effective_from, effective_to, created_by_user_id
    ) values (
      p_organization_id, p_user_id, p_employment_type, p_effective_from, null, p_actor_user_id
    ) returning id into v_id;
    insert into public.audit_logs (
      organization_id, actor_user_id, action, target_type, target_id, metadata
    ) values (
      p_organization_id, p_actor_user_id, 'employment_type_set', 'employment_type_history', v_id,
      jsonb_build_object('user_id', p_user_id, 'employment_type', p_employment_type,
        'effective_from', p_effective_from, 'note', nullif(trim(p_note), ''))
    );
  else
    raise exception 'unsupported attendance history kind';
  end if;
  return v_id;
end;
$$;

revoke all on function public.set_annual_leave_baseline_atomic(uuid, uuid, date, numeric, numeric, date, boolean)
  from public, anon, authenticated;
revoke all on function public.finalize_attendance_month_atomic(uuid, uuid, date, uuid, integer, numeric, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.reopen_attendance_month_atomic(uuid, uuid, date, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.mutate_attendance_session_with_audit(uuid, uuid, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_attendance_session_with_audit(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.approve_attendance_correction_atomic(uuid, uuid, uuid, text, uuid, boolean, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.set_attendance_history_atomic(uuid, uuid, uuid, text, date, numeric, text, text)
  from public, anon, authenticated;

grant execute on function public.set_annual_leave_baseline_atomic(uuid, uuid, date, numeric, numeric, date, boolean)
  to service_role;
grant execute on function public.finalize_attendance_month_atomic(uuid, uuid, date, uuid, integer, numeric, jsonb, jsonb)
  to service_role;
grant execute on function public.reopen_attendance_month_atomic(uuid, uuid, date, uuid, uuid, text)
  to service_role;
grant execute on function public.mutate_attendance_session_with_audit(uuid, uuid, uuid, text, text, jsonb, jsonb)
  to service_role;
grant execute on function public.create_attendance_session_with_audit(uuid, uuid, text, text, jsonb)
  to service_role;
grant execute on function public.approve_attendance_correction_atomic(uuid, uuid, uuid, text, uuid, boolean, text, jsonb, jsonb)
  to service_role;
grant execute on function public.set_attendance_history_atomic(uuid, uuid, uuid, text, date, numeric, text, text)
  to service_role;
