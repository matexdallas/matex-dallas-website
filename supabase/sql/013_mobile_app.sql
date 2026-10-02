-- Review and apply separately in Supabase. Does not migrate legacy dues payments.
begin;
alter table public.portal_access_requests alter column claimed_member_number drop not null;
alter table public.portal_access_requests add column if not exists app_first_name text;
alter table public.portal_access_requests add column if not exists app_last_name text;
alter table public.portal_access_requests add column if not exists requester_phone text;
-- Requests must start pending; review fields cannot be supplied by applicants.
drop policy if exists portal_requests_insert_own on public.portal_access_requests;
create policy portal_requests_insert_own on public.portal_access_requests for insert to authenticated
with check (user_id=auth.uid() and status='pending' and reviewed_at is null and reviewed_by is null and admin_note is null);
create or replace function public.request_app_access(p_first_name text,p_last_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_email text; v_phone text;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if nullif(trim(p_first_name),'') is null or nullif(trim(p_last_name),'') is null or length(p_first_name)>100 or length(p_last_name)>100 then raise exception 'First and last name are required (maximum 100 characters each)'; end if;
 select case when email_confirmed_at is not null then email end,case when phone_confirmed_at is not null then phone end into v_email,v_phone from auth.users where id=auth.uid();
 if nullif(v_email,'') is null and nullif(v_phone,'') is null then raise exception 'Verify your email or phone first'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if exists(select 1 from public.members where auth_user_id=auth.uid()) then raise exception 'An existing member profile is already linked. Contact MATEX.'; end if;
 select id into v_id from public.portal_access_requests where user_id=auth.uid() and status in ('pending','approved') order by created_at desc limit 1;
 if v_id is not null then return v_id; end if;
 insert into public.portal_access_requests(user_id,claimed_full_name,app_first_name,app_last_name,requester_email,requester_phone,status)
 values(auth.uid(),trim(p_first_name)||' '||trim(p_last_name),trim(p_first_name),trim(p_last_name),v_email,v_phone,'pending') returning id into v_id;
 return v_id;
end $$;
create or replace function public.review_app_access(p_request_id uuid,p_decision text,p_member_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.portal_access_requests%rowtype; v_member uuid; v_link uuid;
begin
 if not exists(select 1 from public.admins where id=auth.uid()) and not exists(select 1 from public.admin_users where user_id=auth.uid() and is_active and role in ('super_admin','membership_admin')) then raise exception 'Not authorized'; end if;
 if p_decision not in ('approved','denied') or p_decision is null then raise exception 'Invalid decision'; end if;
 select * into r from public.portal_access_requests where id=p_request_id and status='pending' for update;
 if not found or r.app_first_name is null or r.app_last_name is null then raise exception 'Pending app request not found'; end if;
 if p_decision='approved' then
  perform pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
  select id into v_member from public.members where auth_user_id=r.user_id;
  if v_member is not null and p_member_id is not null and v_member<>p_member_id then raise exception 'Account already linked to another member'; end if;
  if v_member is null and p_member_id is not null then
   select auth_user_id into v_link from public.members where id=p_member_id for update;
   if not found then raise exception 'Member not found'; end if;
   if v_link is not null and v_link<>r.user_id then raise exception 'Member already linked to another account'; end if;
   update public.members set auth_user_id=r.user_id,updated_at=now() where id=p_member_id;
   v_member:=p_member_id;
  elsif v_member is null then
   -- Do not silently create duplicates when an existing contact matches.
   if exists(select 1 from public.members where (nullif(r.requester_email,'') is not null and lower(email)=lower(r.requester_email)) or (nullif(r.requester_phone,'') is not null and regexp_replace(phone,'[^0-9]','','g')=regexp_replace(r.requester_phone,'[^0-9]','','g'))) then raise exception 'Existing contact found. Select the existing member ID.'; end if;
   insert into public.members(first_name,last_name,email,phone,auth_user_id,status) values(r.app_first_name,r.app_last_name,r.requester_email,r.requester_phone,r.user_id,'active') returning id into v_member;
  end if;
 end if;
 update public.portal_access_requests set status=p_decision,reviewed_at=now(),reviewed_by=auth.uid()::text where id=r.id;
 return v_member;
end $$;
create table if not exists public.app_announcements(id uuid primary key default gen_random_uuid(),title text not null,body text not null,created_at timestamptz not null default now());
alter table public.app_announcements enable row level security;
drop policy if exists app_announcements_read on public.app_announcements;
create policy app_announcements_read on public.app_announcements for select to authenticated using(exists(select 1 from public.members where auth_user_id=auth.uid() and status='active'));
drop policy if exists app_announcements_admin on public.app_announcements;
create policy app_announcements_admin on public.app_announcements for all to authenticated using(exists(select 1 from public.admins where id=auth.uid()) or exists(select 1 from public.admin_users where user_id=auth.uid() and is_active and role='super_admin')) with check(exists(select 1 from public.admins where id=auth.uid()) or exists(select 1 from public.admin_users where user_id=auth.uid() and is_active and role='super_admin'));
grant select,insert,update,delete on public.app_announcements to authenticated;
-- Scoped RPC avoids changing the legacy admin policies and returns no other household's data.
create or replace function public.app_membership_details()
returns table(membership_id uuid,membership_type text,membership_year integer,annual_total numeric,amount_paid numeric,balance_due numeric)
language sql stable security definer set search_path='' as $$
 select m.id,m.membership_type,m.membership_year,coalesce(m.annual_total,m.registration_fee+m.annual_dues),coalesce(sum(p.amount),0),greatest(coalesce(m.annual_total,m.registration_fee+m.annual_dues)-coalesce(sum(p.amount),0),0)
 from public.memberships m left join public.payments p on p.membership_id=m.id
 where exists(select 1 from public.membership_members mm join public.members u on u.id=mm.member_id where mm.membership_id=m.id and u.auth_user_id=auth.uid() and u.status='active')
 group by m.id,m.membership_type,m.membership_year,m.annual_total,m.registration_fee,m.annual_dues;
$$;
revoke all on function public.request_app_access(text,text) from public,anon;
revoke all on function public.review_app_access(uuid,text,uuid) from public,anon;
revoke all on function public.app_membership_details() from public,anon;
grant execute on function public.request_app_access(text,text),public.review_app_access(uuid,text,uuid),public.app_membership_details() to authenticated;
commit;
