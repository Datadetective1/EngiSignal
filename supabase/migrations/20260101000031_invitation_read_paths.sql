-- ============================================================================
-- The two reads an invited person needs before they are a member.
--
-- An invitee is in a genuine bootstrapping bind: RLS quite correctly shows them
-- nothing about an organization they have not joined, so the page that asks
-- "do you want to join Northvane Aerospace?" cannot name Northvane Aerospace,
-- and the page that says "you have a pending invitation" cannot find it. Both
-- reads therefore go through definer functions that answer a narrow question
-- and disclose nothing else.
--
-- WHAT EACH ONE IS ALLOWED TO SAY
--
-- preview_invitation() answers only for a caller who already holds the token,
-- and returns exactly what the invitation email they are holding already told
-- them: the workspace name, the role offered, and which address it was sent to.
-- It is callable without signing in, because the person clicking the link in
-- their mail has not necessarily signed in yet — and a 256-bit token is the
-- authentication for this one fact. It deliberately reveals nothing about the
-- estate, the members, or whether the address has an EngiSignal account.
--
-- An unknown, revoked, expired or spent token all return a row with a status
-- and no workspace name, so the page can explain what happened without the
-- response shape itself becoming an oracle.
--
-- my_pending_invitations() answers only about the CALLER'S OWN address, taken
-- from auth.uid() and never from an argument. It cannot be pointed at anyone
-- else.
--
-- ── ACCEPTING WITHOUT THE TOKEN ─────────────────────────────────────────────
--
-- accept_invitation_by_id() exists because a user who lands in the app without
-- their original link — confirmed their email in a different browser, lost the
-- mail, clicked through from a bookmark — must still be able to join. It is not
-- a weaker door: acceptance has always required the signed-in address to match
-- the invited address, and Supabase has already verified control of that
-- address. The token proves possession of the email; the session proves the
-- same thing more strongly. Guessing an invitation id gains nothing.
-- ============================================================================

create or replace function public.preview_invitation(raw_token text)
returns table (status text, organization_name text, invited_role public.org_role, invited_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  inv public.organization_invitations%rowtype;
  hashed text;
begin
  if raw_token is null or btrim(raw_token) = '' then
    return query select 'invalid'::text, null::text, null::public.org_role, null::text;
    return;
  end if;

  hashed := encode(extensions.digest(raw_token, 'sha256'), 'hex');
  select * into inv from public.organization_invitations where token_hash = hashed;

  if inv.id is null then
    return query select 'invalid'::text, null::text, null::public.org_role, null::text;
    return;
  end if;
  if inv.revoked_at is not null then
    return query select 'revoked'::text, null::text, null::public.org_role, inv.email;
    return;
  end if;
  if inv.accepted_at is not null then
    return query select 'accepted'::text, null::text, null::public.org_role, inv.email;
    return;
  end if;
  if inv.expires_at <= now() then
    return query select 'expired'::text, null::text, null::public.org_role, inv.email;
    return;
  end if;

  return query
    select 'pending'::text, o.name, inv.role, inv.email
    from public.organizations o
    where o.id = inv.organization_id;
end;
$$;

create or replace function public.my_pending_invitations()
returns table (
  id uuid,
  organization_name text,
  invited_role public.org_role,
  invited_by_email text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_mail text;
begin
  if caller is null then
    return;
  end if;
  select lower(btrim(u.email)) into caller_mail from auth.users u where u.id = caller;
  if caller_mail is null then
    return;
  end if;

  return query
    select i.id, o.name, i.role, i.invited_by_email, i.expires_at
    from public.organization_invitations i
    join public.organizations o on o.id = i.organization_id
    where i.email = caller_mail
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
    order by i.created_at;
end;
$$;

create or replace function public.accept_invitation_by_id(invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller      uuid := (select auth.uid());
  caller_mail text;
  inv         public.organization_invitations%rowtype;
begin
  if caller is null then
    raise exception 'authentication_required' using errcode = 'insufficient_privilege';
  end if;

  select * into inv from public.organization_invitations where id = invitation_id for update;

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
  if caller_mail is null or lower(btrim(caller_mail)) <> inv.email then
    raise exception 'invitation_email_mismatch' using errcode = 'insufficient_privilege';
  end if;

  insert into public.organization_members (organization_id, user_id, email, display_name, role)
  values (inv.organization_id, caller, caller_mail, split_part(caller_mail, '@', 1), inv.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations
     set accepted_at = now(), accepted_by = caller
   where id = inv.id;

  return inv.organization_id;
end;
$$;

revoke execute on function public.preview_invitation(text) from public;
revoke execute on function public.my_pending_invitations() from public, anon;
revoke execute on function public.accept_invitation_by_id(uuid) from public, anon;

-- The link in an email is clicked by someone who may not be signed in yet.
grant execute on function public.preview_invitation(text) to anon, authenticated;
grant execute on function public.my_pending_invitations() to authenticated;
grant execute on function public.accept_invitation_by_id(uuid) to authenticated;
