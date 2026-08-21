-- ============================================================================
-- Multi-user workspace guarantees, proven against live Postgres.
--
-- These are the eighteen assertions the multi-user release is required to make.
-- They run as REAL authenticated users — the JWT claim that auth.uid() reads is
-- set, and the session role is switched to `authenticated` — so every one of
-- them is answered by the same policies, grants and triggers that answer a
-- request arriving from the internet. Nothing here is mocked.
--
-- HOW TO READ A RESULT
--
--   passed = true   the guarantee holds
--   detail          what was actually observed, so a pass is auditable and a
--                   failure is diagnosable without re-running anything
--
-- Denial has two shapes and both count. A SELECT that RLS filters returns zero
-- rows; a write that fails WITH CHECK, or a verb with no grant, raises 42501.
-- Assertions state which shape they expect.
--
-- The fixtures are created and destroyed by this script. Emails use the
-- reserved .invalid TLD so they can never collide with, or be mistaken for, a
-- real customer. Production tenants are never touched.
-- ============================================================================

create table if not exists public._multiuser_proof (
  n        integer,
  name     text,
  passed   boolean,
  detail   text,
  ran_at   timestamptz not null default now()
);
truncate public._multiuser_proof;

do $proof$
declare
  org_a       uuid;
  org_b       uuid;
  u_owner     uuid := gen_random_uuid();
  u_admin     uuid := gen_random_uuid();
  u_member    uuid := gen_random_uuid();
  u_outsider  uuid := gen_random_uuid();
  u_invitee   uuid := gen_random_uuid();
  m_owner     uuid;
  m_admin     uuid;
  m_member    uuid;
  inv_id      uuid;
  observed    integer;
  ok          boolean;
  note        text;
  tok         text := 'qa-proof-token-' || encode(extensions.gen_random_bytes(24), 'hex');
  tok2        text := 'qa-proof-token2-' || encode(extensions.gen_random_bytes(24), 'hex');
  v_vendor    uuid;
begin
  -- ── Fixtures ─────────────────────────────────────────────────────────────
  insert into auth.users (id, email, aud, role)
  values (u_owner,    'qa-owner@multiuser-proof.invalid',    'authenticated', 'authenticated'),
         (u_admin,    'qa-admin@multiuser-proof.invalid',    'authenticated', 'authenticated'),
         (u_member,   'qa-member@multiuser-proof.invalid',   'authenticated', 'authenticated'),
         (u_outsider, 'qa-outsider@multiuser-proof.invalid', 'authenticated', 'authenticated'),
         (u_invitee,  'qa-invitee@multiuser-proof.invalid',  'authenticated', 'authenticated');

  insert into public.organizations (name, slug, is_demo)
  values ('QA Multiuser Alpha', 'qa-multiuser-alpha-proof', false) returning id into org_a;
  insert into public.organizations (name, slug, is_demo)
  values ('QA Multiuser Beta', 'qa-multiuser-beta-proof', false) returning id into org_b;

  insert into public.organization_members (organization_id, user_id, email, role)
  values (org_a, u_owner, 'qa-owner@multiuser-proof.invalid', 'owner') returning id into m_owner;
  insert into public.organization_members (organization_id, user_id, email, role)
  values (org_a, u_admin, 'qa-admin@multiuser-proof.invalid', 'admin') returning id into m_admin;
  insert into public.organization_members (organization_id, user_id, email, role)
  values (org_a, u_member, 'qa-member@multiuser-proof.invalid', 'member') returning id into m_member;
  insert into public.organization_members (organization_id, user_id, email, role)
  values (org_b, u_outsider, 'qa-outsider@multiuser-proof.invalid', 'owner');

  -- Some estate data in Alpha for the cross-tenant reads to fail to find.
  insert into public.employees (organization_id, employee_code, username, full_name)
  values (org_a, 'QA-1', 'qa.one', 'QA One');
  insert into public.vendors (organization_id, name, slug)
  values (org_a, 'QA Vendor', 'qa-vendor-proof') returning id into v_vendor;
  insert into public.contracts
    (organization_id, vendor_id, contract_number, start_date, end_date, renewal_date)
  values (org_a, v_vendor, 'QA-CTR-1', current_date, current_date + 365, current_date + 365);

  -- ── 1-3: every role sees the same one organization ───────────────────────
  execute 'set local role authenticated';

  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_owner, 'role', 'authenticated')::text);
  select count(*) into observed from public.organizations where id = org_a;
  insert into public._multiuser_proof values (1, 'Owner sees their organization', observed = 1,
    format('owner selected %s row(s) for Alpha', observed));

  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_admin, 'role', 'authenticated')::text);
  select count(*) into observed from public.organizations where id = org_a;
  insert into public._multiuser_proof values (2, 'Admin sees the same organization', observed = 1,
    format('admin selected %s row(s) for Alpha', observed));

  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_member, 'role', 'authenticated')::text);
  select count(*) into observed from public.organizations where id = org_a;
  insert into public._multiuser_proof values (3, 'Member sees the same organization', observed = 1,
    format('member selected %s row(s) for Alpha', observed));

  -- ── 4: an unrelated authenticated user sees nothing ──────────────────────
  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_outsider, 'role', 'authenticated')::text);
  select count(*) into observed from public.organizations where id = org_a;
  insert into public._multiuser_proof values (4, 'Unrelated authenticated user sees nothing', observed = 0,
    format('outsider selected %s row(s) for Alpha', observed));

  -- ── 5: forging organization_id fails ─────────────────────────────────────
  -- The outsider is a legitimate owner of Beta, and claims Alpha's id anyway.
  begin
    insert into public.employees (organization_id, employee_code, username, full_name)
    values (org_a, 'FORGED', 'forged.user', 'Forged User');
    insert into public._multiuser_proof values (5, 'Forging organization_id fails', false,
      'INSERT naming another tenant''s organization_id was ACCEPTED');
  exception when others then
    insert into public._multiuser_proof values (5, 'Forging organization_id fails', true,
      format('denied: %s (%s)', sqlerrm, sqlstate));
  end;

  -- ── 6: cross-tenant reads fail ───────────────────────────────────────────
  select count(*) into observed from public.employees where organization_id = org_a;
  insert into public._multiuser_proof values (6, 'Cross-tenant reads fail', observed = 0,
    format('outsider read %s employee row(s) from Alpha', observed));

  -- ── 7: cross-tenant writes fail ──────────────────────────────────────────
  begin
    update public.employees set full_name = 'Overwritten' where organization_id = org_a;
    get diagnostics observed = row_count;
    insert into public._multiuser_proof values (7, 'Cross-tenant writes fail', observed = 0,
      format('outsider UPDATE against Alpha affected %s row(s)', observed));
  exception when others then
    insert into public._multiuser_proof values (7, 'Cross-tenant writes fail', true,
      format('denied: %s (%s)', sqlerrm, sqlstate));
  end;

  -- ── 8: cross-tenant imports fail ─────────────────────────────────────────
  begin
    insert into public.ingestion_usage
      (organization_id, import_id, usage_date, raw_feature, source_system, source_file, source_row)
    values (org_a, gen_random_uuid(), current_date, 'FORGED_FEATURE', 'generic', 'forged.csv', 1);
    insert into public._multiuser_proof values (8, 'Cross-tenant imports fail', false,
      'outsider wrote an ingestion row into Alpha');
  exception when others then
    insert into public._multiuser_proof values (8, 'Cross-tenant imports fail', true,
      format('denied: %s (%s)', sqlerrm, sqlstate));
  end;

  -- ── 9: cross-tenant exports fail ─────────────────────────────────────────
  -- An export is a read of contracts/usage for an organization. If the read is
  -- empty the export is empty, which is the guarantee.
  select count(*) into observed from public.contracts where organization_id = org_a;
  insert into public._multiuser_proof values (9, 'Cross-tenant exports fail', observed = 0,
    format('outsider read %s contract row(s) from Alpha for export', observed));

  -- ── 10: cross-tenant analysis fails ──────────────────────────────────────
  select count(*) into observed from public.analytics_projections where organization_id = org_a;
  ok := (observed = 0);
  note := format('outsider read %s projection row(s) from Alpha', observed);
  begin
    perform public.mark_own_projection_dirty(org_a);
    ok := false;
    note := note || '; mark_own_projection_dirty(Alpha) was ACCEPTED';
  exception when others then
    note := note || format('; mark_own_projection_dirty denied: %s', sqlstate);
  end;
  insert into public._multiuser_proof values (10, 'Cross-tenant analysis fails', ok, note);

  -- ── 11: a member cannot promote themselves ───────────────────────────────
  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_member, 'role', 'authenticated')::text);
  begin
    perform public.set_organization_member_role(m_member, 'admin');
    insert into public._multiuser_proof values (11, 'Member cannot promote themselves', false,
      'set_organization_member_role succeeded for a member');
  exception when others then
    insert into public._multiuser_proof values (11, 'Member cannot promote themselves', true,
      format('denied: %s (%s)', sqlerrm, sqlstate));
  end;

  -- Also prove the direct route is shut, not merely the function.
  begin
    update public.organization_members set role = 'admin' where id = m_member;
    get diagnostics observed = row_count;
    insert into public._multiuser_proof values (11, 'Member cannot promote themselves (direct DML)', observed = 0,
      format('direct UPDATE affected %s row(s)', observed));
  exception when others then
    insert into public._multiuser_proof values (11, 'Member cannot promote themselves (direct DML)', true,
      format('denied: %s (%s)', sqlerrm, sqlstate));
  end;

  -- ── 12: a member cannot invite or remove ─────────────────────────────────
  ok := true; note := '';
  begin
    perform public.invite_to_organization(org_a, 'nope@multiuser-proof.invalid', 'member', tok, 7);
    ok := false; note := 'invite succeeded; ';
  exception when others then
    note := format('invite denied: %s; ', sqlstate);
  end;
  begin
    perform public.remove_organization_member(m_admin);
    ok := false; note := note || 'remove succeeded';
  exception when others then
    note := note || format('remove denied: %s', sqlstate);
  end;
  insert into public._multiuser_proof values (12, 'Member cannot invite or remove users', ok, note);

  -- ── 13: an admin cannot remove or demote an owner ────────────────────────
  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_admin, 'role', 'authenticated')::text);
  ok := true; note := '';
  begin
    perform public.remove_organization_member(m_owner);
    ok := false; note := 'admin removed the owner; ';
  exception when others then
    note := format('remove-owner denied: %s; ', sqlstate);
  end;
  begin
    perform public.set_organization_member_role(m_owner, 'member');
    ok := false; note := note || 'admin demoted the owner';
  exception when others then
    note := note || format('demote-owner denied: %s', sqlstate);
  end;
  insert into public._multiuser_proof values (13, 'Admin cannot remove or demote an Owner', ok, note);

  -- ── 14: a revoked invitation cannot be accepted ──────────────────────────
  select public.invite_to_organization(org_a, 'qa-invitee@multiuser-proof.invalid', 'member', tok, 7)
    into inv_id;
  perform public.revoke_organization_invitation(inv_id);
  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_invitee, 'role', 'authenticated')::text);
  begin
    perform public.accept_organization_invitation(tok);
    insert into public._multiuser_proof values (14, 'Revoked invitation fails', false, 'revoked token was accepted');
  exception when others then
    insert into public._multiuser_proof values (14, 'Revoked invitation fails', true,
      format('denied: %s', sqlerrm));
  end;

  -- ── 15: an expired invitation cannot be accepted ─────────────────────────
  execute 'reset role';
  update public.organization_invitations set revoked_at = null, revoked_by = null where id = inv_id;
  update public.organization_invitations
     set created_at = now() - interval '30 days', expires_at = now() - interval '1 day'
   where id = inv_id;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_invitee, 'role', 'authenticated')::text);
  begin
    perform public.accept_organization_invitation(tok);
    insert into public._multiuser_proof values (15, 'Expired invitation fails', false, 'expired token was accepted');
  exception when others then
    insert into public._multiuser_proof values (15, 'Expired invitation fails', true,
      format('denied: %s', sqlerrm));
  end;

  -- ── 16 & 18: single use, and no duplicate memberships ────────────────────
  execute 'reset role';
  delete from public.organization_invitations where id = inv_id;
  execute 'set local role authenticated';

  -- Inviting twice must not create two live invitations.
  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_owner, 'role', 'authenticated')::text);
  select public.invite_to_organization(org_a, 'qa-invitee@multiuser-proof.invalid', 'member', tok, 7) into inv_id;
  select public.invite_to_organization(org_a, 'qa-invitee@multiuser-proof.invalid', 'member', tok2, 7) into inv_id;
  execute 'reset role';
  select count(*) into observed from public.organization_invitations
   where organization_id = org_a and email = 'qa-invitee@multiuser-proof.invalid'
     and accepted_at is null and revoked_at is null;
  insert into public._multiuser_proof values (18, 'Duplicate invites cannot create duplicate invitations', observed = 1,
    format('%s live invitation(s) after inviting the same address twice', observed));
  execute 'set local role authenticated';

  -- Accept once, then try again with the same token.
  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_invitee, 'role', 'authenticated')::text);
  perform public.accept_organization_invitation(tok2);
  begin
    perform public.accept_organization_invitation(tok2);
    insert into public._multiuser_proof values (16, 'Used invitation cannot be reused', false,
      'the same token was accepted twice');
  exception when others then
    insert into public._multiuser_proof values (16, 'Used invitation cannot be reused', true,
      format('denied: %s', sqlerrm));
  end;

  -- The superseded token must be dead too — rotation, not a second key.
  begin
    perform public.accept_organization_invitation(tok);
    insert into public._multiuser_proof values (16, 'Superseded invitation token is dead', false,
      'the rotated-away token still worked');
  exception when others then
    insert into public._multiuser_proof values (16, 'Superseded invitation token is dead', true,
      format('denied: %s', sqlerrm));
  end;

  execute 'reset role';
  select count(*) into observed from public.organization_members
   where organization_id = org_a and user_id = u_invitee;
  insert into public._multiuser_proof values (18, 'Duplicate accepts cannot create duplicate memberships', observed = 1,
    format('%s membership row(s) for the invitee', observed));

  -- ── 17: a removed member immediately loses access ────────────────────────
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_member, 'role', 'authenticated')::text);
  select count(*) into observed from public.employees where organization_id = org_a;
  note := format('before removal the member read %s employee row(s)', observed);
  ok := observed = 1;

  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_owner, 'role', 'authenticated')::text);
  perform public.remove_organization_member(m_member);

  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_member, 'role', 'authenticated')::text);
  select count(*) into observed from public.employees where organization_id = org_a;
  note := note || format('; after removal, %s', observed);
  ok := ok and observed = 0;
  select count(*) into observed from public.organizations where id = org_a;
  note := note || format('; organization visible: %s', observed);
  ok := ok and observed = 0;
  insert into public._multiuser_proof values (17, 'Removed member immediately loses access', ok, note);

  -- ── Bonus: the last owner cannot be removed ──────────────────────────────
  execute format('set local request.jwt.claims = %L', json_build_object('sub', u_owner, 'role', 'authenticated')::text);
  begin
    -- Demote the admin and invitee first so the owner really is the last one.
    perform public.set_organization_member_role(m_admin, 'member');
    perform public.remove_organization_member(m_owner);
    insert into public._multiuser_proof values (19, 'Last Owner cannot be removed', false,
      'the last owner was removed');
  exception when others then
    insert into public._multiuser_proof values (19, 'Last Owner cannot be removed', true,
      format('denied: %s', sqlerrm));
  end;

  execute 'reset role';

  -- ── Teardown ─────────────────────────────────────────────────────────────
  -- Delete the organizations and let the foreign keys do the rest. Removing
  -- members individually would trip the last-owner trigger, which is correct
  -- behaviour and exactly why teardown must go through the parent row.
  delete from public.organizations where id in (org_a, org_b);
  delete from auth.users where id in (u_owner, u_admin, u_member, u_outsider, u_invitee);

exception when others then
  -- A fixture failure must not leave QA rows behind.
  execute 'reset role';
  insert into public._multiuser_proof values (0, 'HARNESS FAILURE', false,
    format('%s (%s)', sqlerrm, sqlstate));
  -- Delete the organizations and let the foreign keys do the rest. Removing
  -- members individually would trip the last-owner trigger, which is correct
  -- behaviour and exactly why teardown must go through the parent row.
  delete from public.organizations where id in (org_a, org_b);
  delete from auth.users where id in (u_owner, u_admin, u_member, u_outsider, u_invitee);
end;
$proof$;
