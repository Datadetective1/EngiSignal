-- ============================================================================
-- Multi-user workspaces: invitations, roles, and the rules that govern them.
--
-- ── WHERE AUTHORIZATION LIVES ───────────────────────────────────────────────
--
-- In the database. Not in a server action that could be bypassed by calling
-- PostgREST directly, and not in a React component that only decides what to
-- render. The application may hide a button; it is never the thing that stops
-- the operation.
--
-- Membership changes are therefore removed from the reach of ordinary DML
-- entirely. Before this migration an admin could PATCH /rest/v1/
-- organization_members and set an owner's role to whatever they liked: the
-- policy checked "are you an admin of this organization" and nothing else. The
-- table now has no INSERT, UPDATE or DELETE policy and `authenticated` holds no
-- grant for those verbs, so the only ways in are the SECURITY DEFINER functions
-- at the bottom of this file, each of which encodes the full rule.
--
-- ── THE INVARIANT THAT IS NOT A FUNCTION'S JOB ──────────────────────────────
--
-- "An organization always has at least one owner" is a property of the data, so
-- it is a trigger rather than a check inside each function. A rule enforced in
-- four places is a rule that will eventually be enforced in three.
--
-- ── TOKENS ──────────────────────────────────────────────────────────────────
--
-- The database stores only a SHA-256 hash and hashes the candidate itself, so
-- the invitation secret exists in exactly two places: the email that carried it
-- and the URL the recipient clicks. A dump of this table lets nobody join
-- anything.
-- ============================================================================

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- `member` is a writing role. A Member is a normal user of the product — they
-- import data, run analysis and record decisions — so they belong with the
-- roles that can write. `viewer` deliberately remains read-only.
create or replace function private.can_write_org(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'analyst', 'member')
  );
$$;

-- Owner is the only role that may act on another owner. Admin stops short.
create or replace function private.is_org_owner(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

revoke execute on function private.is_org_owner(uuid) from public, anon;
grant execute on function private.is_org_owner(uuid) to authenticated;

-- ── Invitations ─────────────────────────────────────────────────────────────

create table if not exists public.organization_invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- Stored already normalized so the unique index below cannot be defeated by
  -- casing, and so a lookup never has to remember to lower() the column.
  email            text not null,
  role             public.org_role not null,
  -- SHA-256 hex of the token. Never the token.
  token_hash       text not null,
  invited_by       uuid not null,
  invited_by_email text not null default '',
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_by      uuid,
  revoked_at       timestamptz,
  revoked_by       uuid,
  constraint organization_invitations_role_allowed
    check (role in ('admin', 'member')),
  constraint organization_invitations_single_terminal_state
    check (accepted_at is null or revoked_at is null),
  constraint organization_invitations_email_normalized
    check (email = lower(btrim(email)) and position('@' in email) > 1),
  constraint organization_invitations_expires_after_creation
    check (expires_at > created_at)
);

create unique index if not exists organization_invitations_token_hash_key
  on public.organization_invitations (token_hash);

-- At most one live invitation per address per organization. This is what makes
-- inviting twice safe: the second attempt updates the first row instead of
-- racing it, so a double-clicked button cannot produce two valid tokens.
create unique index if not exists organization_invitations_one_live_per_email
  on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

create index if not exists organization_invitations_org_idx
  on public.organization_invitations (organization_id);
create index if not exists organization_invitations_email_idx
  on public.organization_invitations (email);

alter table public.organization_invitations enable row level security;
alter table public.organization_invitations force row level security;

-- Only the people who can manage membership can read the invitation list. A
-- Member has no business enumerating who else has been asked to join.
drop policy if exists organization_invitations_select on public.organization_invitations;
create policy organization_invitations_select on public.organization_invitations
  for select to authenticated
  using (private.is_org_admin(organization_id));

-- No INSERT/UPDATE/DELETE policy, and no grant for those verbs, on purpose.
-- Both locks are set: a policy added by mistake later still finds no privilege,
-- and a grant added by mistake later still finds no policy.
revoke all on public.organization_invitations from anon, authenticated;
grant select on public.organization_invitations to authenticated;

-- ── Membership is function-only from here on ────────────────────────────────

drop policy if exists organization_members_insert on public.organization_members;
drop policy if exists organization_members_update on public.organization_members;
drop policy if exists organization_members_delete on public.organization_members;

revoke insert, update, delete on public.organization_members from authenticated, anon;

-- ── The last-owner invariant ────────────────────────────────────────────────

create or replace function public.enforce_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining integer;
begin
  if tg_op = 'DELETE' then
    -- Dropping the whole organization cascades to its members. That is not the
    -- last owner being removed, it is the organization ceasing to exist, and
    -- blocking it here would make an organization undeletable. The parent row
    -- is already gone by the time the cascade fires, which is how we tell.
    if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
      return old;
    end if;
    if old.role <> 'owner' then
      return old;
    end if;
    select count(*) into remaining
    from public.organization_members m
    where m.organization_id = old.organization_id and m.role = 'owner' and m.id <> old.id;
    if remaining = 0 then
      raise exception 'last_owner: an organization must always have at least one owner'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.role = 'owner' and new.role <> 'owner' then
    select count(*) into remaining
    from public.organization_members m
    where m.organization_id = old.organization_id and m.role = 'owner' and m.id <> old.id;
    if remaining = 0 then
      raise exception 'last_owner: an organization must always have at least one owner'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists organization_members_last_owner on public.organization_members;
create trigger organization_members_last_owner
  before update or delete on public.organization_members
  for each row execute function public.enforce_last_owner();

-- ── Invite ──────────────────────────────────────────────────────────────────

create or replace function public.invite_to_organization(
  org_id      uuid,
  invite_email text,
  invite_role  public.org_role,
  raw_token    text,
  ttl_days     integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller     uuid := (select auth.uid());
  caller_mail text;
  normalized text := lower(btrim(invite_email));
  hashed     text;
  invitation uuid;
begin
  if caller is null then
    raise exception 'authentication_required' using errcode = 'insufficient_privilege';
  end if;
  if not private.is_org_admin(org_id) then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  -- An admin inviting an owner would be a promotion path around the owner rule.
  if invite_role not in ('admin', 'member') then
    raise exception 'invalid_role' using errcode = 'check_violation';
  end if;
  if normalized = '' or position('@' in normalized) < 2 then
    raise exception 'invalid_email' using errcode = 'check_violation';
  end if;
  -- 32 characters of a base64url-encoded 32-byte secret is the shortest thing
  -- the application can legitimately send. Anything shorter is a bug upstream.
  if raw_token is null or length(raw_token) < 32 then
    raise exception 'weak_token' using errcode = 'check_violation';
  end if;
  if ttl_days is null or ttl_days < 1 or ttl_days > 30 then
    raise exception 'invalid_ttl' using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.organization_id = org_id and lower(btrim(u.email)) = normalized
  ) then
    raise exception 'already_member' using errcode = 'unique_violation';
  end if;

  hashed := encode(extensions.digest(raw_token, 'sha256'), 'hex');
  select u.email into caller_mail from auth.users u where u.id = caller;

  insert into public.organization_invitations
    (organization_id, email, role, token_hash, invited_by, invited_by_email, expires_at)
  values
    (org_id, normalized, invite_role, hashed, caller, coalesce(caller_mail, ''),
     now() + make_interval(days => ttl_days))
  on conflict (organization_id, email) where accepted_at is null and revoked_at is null
  do update set
    role             = excluded.role,
    token_hash       = excluded.token_hash,
    invited_by       = excluded.invited_by,
    invited_by_email = excluded.invited_by_email,
    created_at       = now(),
    expires_at       = excluded.expires_at
  returning id into invitation;

  return invitation;
end;
$$;

-- ── Accept ──────────────────────────────────────────────────────────────────

create or replace function public.accept_organization_invitation(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller      uuid := (select auth.uid());
  caller_mail text;
  inv         public.organization_invitations%rowtype;
  hashed      text;
begin
  if caller is null then
    raise exception 'authentication_required' using errcode = 'insufficient_privilege';
  end if;
  if raw_token is null or btrim(raw_token) = '' then
    raise exception 'invalid_invitation' using errcode = 'check_violation';
  end if;

  hashed := encode(extensions.digest(raw_token, 'sha256'), 'hex');

  -- FOR UPDATE closes the double-accept race: two requests carrying the same
  -- token serialize here, and the second finds accepted_at already set.
  select * into inv
  from public.organization_invitations
  where token_hash = hashed
  for update;

  if inv.id is null then
    raise exception 'invalid_invitation' using errcode = 'check_violation';
  end if;
  if inv.revoked_at is not null then
    raise exception 'invitation_revoked' using errcode = 'check_violation';
  end if;
  if inv.accepted_at is not null then
    raise exception 'invitation_already_used' using errcode = 'check_violation';
  end if;
  if inv.expires_at <= now() then
    raise exception 'invitation_expired' using errcode = 'check_violation';
  end if;

  select u.email into caller_mail from auth.users u where u.id = caller;

  -- The token proves someone opened the email; it does not prove who is signed
  -- in. Without this check, a forwarded link would let any account join.
  if caller_mail is null or lower(btrim(caller_mail)) <> inv.email then
    raise exception 'invitation_email_mismatch' using errcode = 'insufficient_privilege';
  end if;

  -- Idempotent. A retried request, a double click or a back button must not
  -- produce a second membership or silently change an existing role.
  insert into public.organization_members (organization_id, user_id, email, display_name, role)
  values (inv.organization_id, caller, caller_mail, split_part(caller_mail, '@', 1), inv.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations
     set accepted_at = now(), accepted_by = caller
   where id = inv.id;

  return inv.organization_id;
end;
$$;

-- ── Revoke ──────────────────────────────────────────────────────────────────

create or replace function public.revoke_organization_invitation(invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  inv    public.organization_invitations%rowtype;
begin
  if caller is null then
    raise exception 'authentication_required' using errcode = 'insufficient_privilege';
  end if;

  select * into inv from public.organization_invitations where id = invitation_id for update;
  if inv.id is null then
    raise exception 'invalid_invitation' using errcode = 'check_violation';
  end if;
  if not private.is_org_admin(inv.organization_id) then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if inv.accepted_at is not null then
    raise exception 'invitation_already_used' using errcode = 'check_violation';
  end if;
  if inv.revoked_at is not null then
    return true;  -- already revoked; revoking again is not an error
  end if;

  update public.organization_invitations
     set revoked_at = now(), revoked_by = caller
   where id = inv.id;
  return true;
end;
$$;

-- ── Remove a member ─────────────────────────────────────────────────────────

create or replace function public.remove_organization_member(member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.organization_members%rowtype;
begin
  if caller is null then
    raise exception 'authentication_required' using errcode = 'insufficient_privilege';
  end if;

  select * into target from public.organization_members where id = member_id for update;
  if target.id is null then
    raise exception 'not_found' using errcode = 'check_violation';
  end if;
  if not private.is_org_admin(target.organization_id) then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if target.role = 'owner' and not private.is_org_owner(target.organization_id) then
    raise exception 'owner_protected' using errcode = 'insufficient_privilege';
  end if;

  -- The last-owner trigger has the final say on whether this is allowed.
  delete from public.organization_members where id = target.id;
  return true;
end;
$$;

-- ── Change a role ───────────────────────────────────────────────────────────

create or replace function public.set_organization_member_role(
  member_id uuid,
  new_role  public.org_role
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.organization_members%rowtype;
begin
  if caller is null then
    raise exception 'authentication_required' using errcode = 'insufficient_privilege';
  end if;
  if new_role not in ('owner', 'admin', 'member') then
    raise exception 'invalid_role' using errcode = 'check_violation';
  end if;

  select * into target from public.organization_members where id = member_id for update;
  if target.id is null then
    raise exception 'not_found' using errcode = 'check_violation';
  end if;
  if not private.is_org_admin(target.organization_id) then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  -- Only an owner may touch an owner, or mint one. Without the second clause an
  -- admin could promote themselves and then act as an owner.
  if target.role = 'owner' and not private.is_org_owner(target.organization_id) then
    raise exception 'owner_protected' using errcode = 'insufficient_privilege';
  end if;
  if new_role = 'owner' and not private.is_org_owner(target.organization_id) then
    raise exception 'owner_protected' using errcode = 'insufficient_privilege';
  end if;

  if target.role = new_role then
    return true;
  end if;

  -- The last-owner trigger has the final say on a demotion.
  update public.organization_members set role = new_role where id = target.id;
  return true;
end;
$$;

-- ── Provisioning must not strand an invited person in a private workspace ───

create or replace function public.bootstrap_organization(org_name text default null)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  caller      uuid := (select auth.uid());
  caller_mail text;
  existing    uuid;
  new_org     uuid;
  base_slug   text;
  final_slug  text;
  suffix      integer := 0;
begin
  if caller is null then
    raise exception 'bootstrap_organization requires an authenticated caller';
  end if;

  -- Already a member of something: return it rather than creating duplicates.
  select m.organization_id into existing
  from public.organization_members m
  where m.user_id = caller
  order by m.created_at
  limit 1;

  if existing is not null then
    return existing;
  end if;

  select email into caller_mail from auth.users where id = caller;

  -- ── THE INVITED-USER CASE ────────────────────────────────────────────────
  --
  -- This function is the backstop that guarantees a signed-in user always has
  -- somewhere to be, and it is called on sign-in and on every workspace load.
  -- For an invited person that guarantee is actively harmful: they confirm
  -- their email, the app loads, a private tenant is minted for them, and the
  -- shared workspace they were invited to is nowhere in sight -- while their
  -- invitation sits pending forever, because accepting it would now be their
  -- SECOND membership and the workspace resolver only ever reads the first.
  --
  -- So a pending invitation suppresses provisioning and reports "nothing yet".
  -- The caller routes to the invitation instead. Returning null rather than
  -- raising keeps this a state the application can handle, not an error.
  if exists (
    select 1
    from public.organization_invitations i
    where i.email = lower(btrim(coalesce(caller_mail, '')))
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
  ) then
    return null;
  end if;

  base_slug := regexp_replace(
    lower(coalesce(nullif(trim(org_name), ''), split_part(coalesce(caller_mail, 'workspace'), '@', 2), 'workspace')),
    '[^a-z0-9]+', '-', 'g'
  );
  base_slug := trim(both '-' from base_slug);
  if base_slug is null or base_slug = '' then
    base_slug := 'workspace';
  end if;

  final_slug := base_slug;
  while exists (select 1 from public.organizations o where o.slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix::text;
  end loop;

  insert into public.organizations (name, slug, is_demo)
  values (coalesce(nullif(trim(org_name), ''), initcap(replace(base_slug, '-', ' '))), final_slug, false)
  returning id into new_org;

  -- The creator owns it. Role is fixed here, not supplied by the caller.
  insert into public.organization_members (organization_id, user_id, email, display_name, role)
  values (new_org, caller, coalesce(caller_mail, ''), split_part(coalesce(caller_mail, ''), '@', 1), 'owner');

  return new_org;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke execute on function public.invite_to_organization(uuid, text, public.org_role, text, integer) from public, anon;
revoke execute on function public.accept_organization_invitation(text) from public, anon;
revoke execute on function public.revoke_organization_invitation(uuid) from public, anon;
revoke execute on function public.remove_organization_member(uuid) from public, anon;
revoke execute on function public.set_organization_member_role(uuid, public.org_role) from public, anon;
revoke execute on function public.enforce_last_owner() from public, anon;

grant execute on function public.invite_to_organization(uuid, text, public.org_role, text, integer) to authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid) to authenticated;
grant execute on function public.remove_organization_member(uuid) to authenticated;
grant execute on function public.set_organization_member_role(uuid, public.org_role) to authenticated;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Every organization must have an owner for the rules above to mean anything.
-- Both production tenants already do, so this is expected to change zero rows;
-- it exists so that is a verified fact rather than an assumption, and so the
-- migration is safe to run against any environment.

update public.organization_members m
set role = 'owner'
from (
  select distinct on (x.organization_id) x.id, x.organization_id
  from public.organization_members x
  where x.organization_id in (
    select o.id from public.organizations o
    where not exists (
      select 1 from public.organization_members y
      where y.organization_id = o.id and y.role = 'owner'
    )
  )
  order by x.organization_id, x.created_at
) first_member
where m.id = first_member.id;
