-- Durcissement après relecture de sécurité du lot 1.
--
--   1. Une approbation ne survit plus à une modification de la demande.
--   2. Dépôt et paiement ne peuvent plus se croiser : même ordre de verrouillage partout
--      (adhésion, puis facture), une seule facture vivante par adhésion, et aucune activation
--      sans facture payée au montant du palier.
--   3. Le contenu d'une demande est validé et borné avant d'être enregistré.
--   4. Invitations : quota, message borné, adhésion payée exigée pour inviter dans une
--      organisation, courriel vérifié exigé pour accepter, et possibilité de quitter.
--   5. Droits resserrés : empreinte du jeton illisible, mention publique non modifiable en direct.
--   6. Dates d'adhésion calculées à l'heure du Québec.

-- ---------------------------------------------------------------------------
-- Activation : payée au bon montant, et approuvée
-- ---------------------------------------------------------------------------
create or replace function private.try_activate(p_membership uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.memberships%rowtype;
  v_approvals integer;
  v_today date := (now() at time zone 'America/Toronto')::date;
begin
  select * into v_m from public.memberships m where m.id = p_membership for update;
  if not found or v_m.status <> 'pending_approval' then
    return;
  end if;
  if not exists (
    select 1 from public.invoices i
    where i.membership_id = p_membership and i.status = 'paid' and i.subtotal_cents = v_m.price_cents
  ) then
    return;
  end if;
  select count(*) into v_approvals
    from public.membership_decisions d
    where d.membership_id = p_membership and d.decision = 'approve';
  if v_approvals >= private.setting_int('approvals_required', 1) then
    update public.memberships m
      set status = 'active',
          decided_at = now(),
          starts_on = v_today,
          ends_on = (v_today + make_interval(months => private.setting_int('term_months', 12)))::date
      where m.id = p_membership;
    perform private.log('adhesion_activee', 'membership', p_membership::text);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Règlement d'une facture : on verrouille l'adhésion d'abord, la facture ensuite
-- ---------------------------------------------------------------------------
create or replace function private.settle_invoice(p_invoice uuid, p_provider text, p_method text, p_reference text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invoices%rowtype;
  v_membership uuid;
begin
  select i.membership_id into v_membership from public.invoices i where i.id = p_invoice;
  if v_membership is not null then
    perform 1 from public.memberships m where m.id = v_membership for update;
  end if;

  select * into v_inv from public.invoices i where i.id = p_invoice for update;
  if not found then
    raise exception 'facture_introuvable';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'facture_deja_reglee';
  end if;

  insert into public.payments (invoice_id, provider, method, amount_cents, reference, created_by)
  values (p_invoice, p_provider, p_method, v_inv.total_cents, p_reference, (select auth.uid()));

  update public.invoices i
    set status = 'paid', paid_at = now(),
        payment_method = case when p_method = 'card' then 'card' else 'transfer' end
    where i.id = p_invoice;

  if v_inv.membership_id is not null then
    update public.memberships m
      set status = 'pending_approval', paid_at = now()
      where m.id = v_inv.membership_id and m.status = 'pending_payment';
    perform private.try_activate(v_inv.membership_id);
  end if;

  perform private.log('facture_payee', 'invoice', p_invoice::text,
    jsonb_build_object('provider', p_provider, 'method', p_method, 'amount_cents', v_inv.total_cents));
end;
$$;

create unique index invoices_one_live_per_membership
  on public.invoices (membership_id) where status <> 'void';

-- ---------------------------------------------------------------------------
-- Dépôt d'une demande : validée, verrouillée, et qui remet les approbations à zéro
-- ---------------------------------------------------------------------------
create or replace function public.submit_membership(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind public.org_kind;
  v_range public.employee_range;
  v_name text;
  v_signed text := btrim(coalesce(p ->> 'signed_name', ''));
  v_website text := nullif(btrim(coalesce(p ->> 'website', '')), '');
  v_city text := nullif(btrim(coalesce(p ->> 'city', '')), '');
  v_org uuid;
  v_role public.org_role;
  v_tier public.membership_tiers%rowtype;
  v_membership uuid;
  v_invoice uuid;
  v_live public.memberships%rowtype;
  v_gst integer;
  v_qst integer;
  v_sectors text[];
  v_answers jsonb;
begin
  if v_uid is null then
    raise exception 'non_connecte';
  end if;

  -- Forme et taille de la demande : rien d'inattendu n'atteint la base ni l'écran de l'équipe.
  if pg_column_size(p) > 8000
     or jsonb_typeof(coalesce(p -> 'answers', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p #> '{answers,motivations}', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p #> '{answers,involvement}', '""'::jsonb)) <> 'string'
     or jsonb_typeof(coalesce(p -> 'sectors', '[]'::jsonb)) <> 'array' then
    raise exception 'demande_invalide';
  end if;
  if jsonb_array_length(coalesce(p #> '{answers,motivations}', '[]'::jsonb)) > 12
     or jsonb_array_length(coalesce(p -> 'sectors', '[]'::jsonb)) > 12
     or exists (
       select 1 from jsonb_array_elements(coalesce(p #> '{answers,motivations}', '[]'::jsonb)) e
       where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 160)
     or exists (
       select 1 from jsonb_array_elements(coalesce(p -> 'sectors', '[]'::jsonb)) e
       where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 80)
     or length(coalesce(p #>> '{answers,involvement}', '')) > 100
     or length(v_signed) > 120
     or length(coalesce(v_website, '')) > 300
     or length(coalesce(v_city, '')) > 120 then
    raise exception 'demande_invalide';
  end if;
  v_answers := jsonb_build_object(
    'motivations', coalesce(p #> '{answers,motivations}', '[]'::jsonb),
    'involvement', coalesce(p #>> '{answers,involvement}', ''));

  if coalesce((p ->> 'declaration')::boolean, false) is not true then
    raise exception 'declaration_requise';
  end if;
  if length(v_signed) < 2 then
    raise exception 'signature_requise';
  end if;

  begin
    v_kind := (p ->> 'kind')::public.org_kind;
  exception when others then
    raise exception 'type_invalide';
  end;
  if v_kind is null then
    raise exception 'type_invalide';
  end if;

  if v_kind = 'entreprise_qc' then
    begin
      v_range := (p ->> 'employee_range')::public.employee_range;
    exception when others then
      raise exception 'taille_requise';
    end;
    if v_range is null then
      raise exception 'taille_requise';
    end if;
  else
    v_range := null;
  end if;

  v_name := btrim(coalesce(p ->> 'org_name', ''));
  if v_kind = 'individu' and v_name = '' then
    select coalesce(nullif(btrim(pr.full_name), ''), pr.email) into v_name from public.profiles pr where pr.id = v_uid;
  end if;
  if v_name = '' or length(v_name) > 200 then
    raise exception 'nom_requis';
  end if;

  select array_agg(x) into v_sectors
    from jsonb_array_elements_text(coalesce(p -> 'sectors', '[]'::jsonb)) as x;

  select t.* into v_tier
    from public.membership_tiers t
    where t.kind = v_kind and t.employee_range is not distinct from v_range;
  if not found then
    raise exception 'palier_introuvable';
  end if;

  select m.org_id, m.role into v_org, v_role from public.org_members m where m.user_id = v_uid;

  if v_org is null then
    insert into public.organizations (name, kind, employee_range, website, city, sectors, public_listing, created_by)
    values (v_name, v_kind, v_range, v_website, v_city,
            coalesce(v_sectors, '{}'), coalesce((p ->> 'public_listing')::boolean, false), v_uid)
    returning id into v_org;
    insert into public.org_members (org_id, user_id, role, is_voting_delegate)
    values (v_org, v_uid, 'admin', v_tier.has_vote);
  else
    if v_role <> 'admin' then
      raise exception 'reserve_a_l_administrateur';
    end if;
    -- Verrou : un paiement en cours sur cette adhésion attend la fin de ce dépôt, et inversement.
    select * into v_live from public.memberships m
      where m.org_id = v_org and m.status in ('pending_payment', 'pending_approval', 'active')
      for update;
    if found and v_live.status <> 'pending_payment' then
      raise exception 'adhesion_deja_en_cours';
    end if;
    update public.organizations o
      set name = v_name, kind = v_kind, employee_range = v_range,
          website = v_website, city = v_city,
          sectors = coalesce(v_sectors, '{}'),
          public_listing = coalesce((p ->> 'public_listing')::boolean, false)
      where o.id = v_org;
  end if;

  v_gst := round(v_tier.price_cents * private.setting_num('gst_rate', 0));
  v_qst := round(v_tier.price_cents * private.setting_num('qst_rate', 0));

  if v_live.id is not null then
    -- Demande déjà commencée et pas encore payée : on la met à jour, même numéro de facture.
    v_membership := v_live.id;
    update public.memberships m
      set tier_code = v_tier.code, price_cents = v_tier.price_cents, answers = v_answers,
          signed_name = v_signed, declared_at = now(), submitted_by = v_uid, submitted_at = now()
      where m.id = v_membership and m.status = 'pending_payment';
    if not found then
      raise exception 'adhesion_deja_en_cours';
    end if;
    -- La demande a changé : ce que le conseil avait approuvé n'est plus ce qui est déposé.
    delete from public.membership_decisions d where d.membership_id = v_membership;
    update public.invoices i
      set description = 'Adhésion annuelle : ' || v_tier.label,
          subtotal_cents = v_tier.price_cents, gst_cents = v_gst, qst_cents = v_qst,
          total_cents = v_tier.price_cents + v_gst + v_qst
      where i.membership_id = v_membership and i.status = 'open'
      returning i.id into v_invoice;
  else
    insert into public.memberships (org_id, tier_code, price_cents, answers, signed_name, declared_at, submitted_by)
    values (v_org, v_tier.code, v_tier.price_cents, v_answers, v_signed, now(), v_uid)
    returning id into v_membership;
  end if;

  if v_invoice is null then
    insert into public.invoices (number, org_id, membership_id, description, subtotal_cents, gst_cents, qst_cents, total_cents)
    values ('DSQ-' || to_char(now() at time zone 'America/Toronto', 'YYYY') || '-' || lpad(nextval('private.invoice_number_seq')::text, 4, '0'),
            v_org, v_membership, 'Adhésion annuelle : ' || v_tier.label,
            v_tier.price_cents, v_gst, v_qst, v_tier.price_cents + v_gst + v_qst)
    returning id into v_invoice;
  end if;

  insert into public.consents (user_id, purpose, granted, source) values
    (v_uid, 'communications', coalesce((p ->> 'consent_communications')::boolean, false), 'demande_adhesion'),
    (v_uid, 'mention_publique', coalesce((p ->> 'public_listing')::boolean, false), 'demande_adhesion');

  perform private.log('adhesion_deposee', 'membership', v_membership::text,
    jsonb_build_object('tier', v_tier.code, 'org', v_org));

  return jsonb_build_object('membership_id', v_membership, 'invoice_id', v_invoice);
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create or replace function public.create_invitation(p_email text, p_org uuid default null, p_message text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'non_connecte';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'courriel_invalide';
  end if;
  if length(coalesce(p_message, '')) > 500 then
    raise exception 'message_trop_long';
  end if;
  if p_org is null then
    if not private.is_staff() then
      raise exception 'reserve_a_l_equipe';
    end if;
  elsif not private.is_staff() then
    if not private.is_org_admin(p_org) then
      raise exception 'reserve_a_l_administrateur';
    end if;
    -- Seule une organisation dont l'adhésion est payée peut rattacher des personnes.
    if not exists (
      select 1 from public.memberships m
      where m.org_id = p_org and m.status in ('pending_approval', 'active')
    ) then
      raise exception 'adhesion_requise_pour_inviter';
    end if;
  end if;
  if (select count(*) from public.invitations i
      where i.invited_by = v_uid and i.created_at > now() - interval '24 hours') >= 50 then
    raise exception 'quota_invitations';
  end if;

  insert into public.invitations (token_hash, email, org_id, message, invited_by)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_email, p_org,
          nullif(btrim(coalesce(p_message, '')), ''), v_uid)
  returning id into v_id;

  perform private.log('invitation_creee', 'invitation', v_id::text, jsonb_build_object('org', p_org));
  return v_token;
end;
$$;

-- Le courriel comparé est celui que le service de connexion a vérifié, pas une copie.
create or replace function public.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v public.invitations%rowtype;
  v_email text;
  v_current_org uuid;
begin
  if v_uid is null then
    raise exception 'non_connecte';
  end if;
  select * into v from public.invitations i
    where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    for update;
  if not found or v.revoked_at is not null or v.expires_at < now() then
    raise exception 'invitation_invalide';
  end if;
  select lower(u.email) into v_email
    from auth.users u
    where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null or v_email is distinct from lower(v.email) then
    raise exception 'courriel_different';
  end if;
  if v.accepted_at is not null then
    return jsonb_build_object('org_id', v.org_id, 'already', true);
  end if;

  if v.org_id is not null then
    select m.org_id into v_current_org from public.org_members m where m.user_id = v_uid;
    if v_current_org is null then
      insert into public.org_members (org_id, user_id, role) values (v.org_id, v_uid, 'member');
    elsif v_current_org <> v.org_id then
      raise exception 'deja_dans_une_organisation';
    end if;
  end if;

  update public.invitations i set accepted_at = now(), accepted_by = v_uid where i.id = v.id;
  perform private.log('invitation_acceptee', 'invitation', v.id::text);
  return jsonb_build_object('org_id', v.org_id, 'already', false);
end;
$$;

-- Une personne rattachée par invitation peut toujours repartir.
create function public.leave_org() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.org_members%rowtype;
begin
  select * into v_row from public.org_members m where m.user_id = v_uid for update;
  if not found then
    raise exception 'membre_introuvable';
  end if;
  if v_row.role = 'admin' then
    raise exception 'administrateur_ne_peut_pas_quitter';
  end if;
  delete from public.org_members m where m.user_id = v_uid;
  perform private.log('organisation_quittee', 'organization', v_row.org_id::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Le courriel du profil suit celui du compte
-- ---------------------------------------------------------------------------
create function private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p set email = coalesce(new.email, '') where p.id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
revoke all on function public.leave_org() from public, anon, authenticated;
grant execute on function public.leave_org() to authenticated;
revoke all on function private.handle_user_email_change() from public, anon, authenticated;

-- L'empreinte du jeton d'invitation ne sort plus de la base.
revoke select on public.invitations from authenticated;
grant select (id, email, org_id, message, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on public.invitations to authenticated;

-- La mention publique ne change que par une demande d'adhésion, qui consigne le consentement.
revoke update (public_listing) on public.organizations from authenticated;

alter table public.consents
  add constraint consents_source_check check (source in ('demande_adhesion', 'accueil', 'mon_compte'));
