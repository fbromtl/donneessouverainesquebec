-- Portail DSQ, lot 1 : comptes, organisations, adhésion, facturation, paiement simulé, invitations.
--
-- Principes
--   * Aucune écriture directe sur les tables sensibles : tout passe par des fonctions qui
--     vérifient qui appelle. Les lectures sont filtrées par les politiques RLS.
--   * Le palier d'accès d'une personne se déduit de l'adhésion de son organisation,
--     jamais d'un champ de son compte : un invité devient membre sans changer de compte.
--   * Portabilité : uniquement du Postgres standard, rien de propre à l'offre hébergée.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.org_kind as enum ('entreprise_qc', 'institution', 'entreprise_hors_qc', 'individu');
create type public.employee_range as enum ('1-25', '26-50', '51-100', '101-250', '251-500', '501+');
create type public.org_role as enum ('admin', 'member');
create type public.membership_status as enum ('pending_payment', 'pending_approval', 'active', 'refused', 'expired', 'cancelled');
create type public.invoice_status as enum ('open', 'paid', 'void');
create type public.staff_role as enum ('dg', 'ca', 'tresorier');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  job_title text,
  phone text,
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  kind public.org_kind not null,
  employee_range public.employee_range,
  website text,
  city text,
  sectors text[] not null default '{}',
  description text,
  public_listing boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null default 'member',
  is_voting_delegate boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
-- Pour l'instant, une personne appartient à une seule organisation.
create unique index org_members_one_org_per_user on public.org_members (user_id);
-- Un seul délégué votant par organisation.
create unique index org_members_one_delegate on public.org_members (org_id) where is_voting_delegate;

create table public.membership_tiers (
  code text primary key,
  kind public.org_kind not null,
  employee_range public.employee_range,
  label text not null,
  price_cents integer not null check (price_cents >= 0),
  has_vote boolean not null,
  sort integer not null
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  tier_code text not null references public.membership_tiers (code),
  status public.membership_status not null default 'pending_payment',
  price_cents integer not null,
  answers jsonb not null default '{}',
  signed_name text not null,
  declared_at timestamptz not null,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  paid_at timestamptz,
  decided_at timestamptz,
  refusal_reason text,
  starts_on date,
  ends_on date
);
create index memberships_org on public.memberships (org_id);
create index memberships_tier on public.memberships (tier_code);
create index memberships_submitted_by on public.memberships (submitted_by);
-- Une seule adhésion vivante par organisation.
create unique index memberships_one_live_per_org on public.memberships (org_id)
  where status in ('pending_payment', 'pending_approval', 'active');

create table public.membership_decisions (
  membership_id uuid not null references public.memberships (id) on delete cascade,
  staff_id uuid not null references public.profiles (id) on delete cascade,
  decision text not null check (decision in ('approve', 'refuse')),
  comment text,
  created_at timestamptz not null default now(),
  primary key (membership_id, staff_id)
);
create index membership_decisions_staff on public.membership_decisions (staff_id);

create sequence private.invoice_number_seq;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  org_id uuid not null references public.organizations (id) on delete cascade,
  membership_id uuid references public.memberships (id) on delete set null,
  description text not null,
  subtotal_cents integer not null,
  gst_cents integer not null default 0,
  qst_cents integer not null default 0,
  total_cents integer not null,
  status public.invoice_status not null default 'open',
  payment_method text check (payment_method in ('card', 'transfer')),
  issued_at timestamptz not null default now(),
  paid_at timestamptz
);
create index invoices_org on public.invoices (org_id);
create index invoices_membership on public.invoices (membership_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  provider text not null check (provider in ('simulation', 'manual')),
  method text not null check (method in ('card', 'transfer', 'cheque')),
  amount_cents integer not null,
  reference text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_invoice on public.payments (invoice_id);
create index payments_created_by on public.payments (created_by);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text not null,
  org_id uuid references public.organizations (id) on delete cascade,
  message text,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz
);
create index invitations_org on public.invitations (org_id);
create index invitations_invited_by on public.invitations (invited_by);
create index invitations_accepted_by on public.invitations (accepted_by);
create index invitations_email on public.invitations (lower(email));

create table public.staff (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role public.staff_role not null,
  created_at timestamptz not null default now()
);

-- Journal des consentements : on ajoute, on ne modifie jamais.
create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  purpose text not null check (purpose in ('communications', 'mention_publique')),
  granted boolean not null,
  source text not null,
  created_at timestamptz not null default now()
);
create index consents_user on public.consents (user_id, purpose, created_at desc);

-- Journal d'audit : en ajout seul, écrit uniquement par les fonctions ci-dessous.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  data jsonb not null default '{}'
);
create index audit_log_entity on public.audit_log (entity, entity_id);

create table public.settings (
  key text primary key,
  value jsonb not null
);

-- ---------------------------------------------------------------------------
-- Données de référence
-- ---------------------------------------------------------------------------
insert into public.membership_tiers (code, kind, employee_range, label, price_cents, has_vote, sort) values
  ('corp-1-25',    'entreprise_qc',      '1-25',    'Membre corporatif, 1 à 25 employés',     40000, true,  1),
  ('corp-26-50',   'entreprise_qc',      '26-50',   'Membre corporatif, 26 à 50 employés',    60000, true,  2),
  ('corp-51-100',  'entreprise_qc',      '51-100',  'Membre corporatif, 51 à 100 employés',   90000, true,  3),
  ('corp-101-250', 'entreprise_qc',      '101-250', 'Membre corporatif, 101 à 250 employés', 150000, true,  4),
  ('corp-251-500', 'entreprise_qc',      '251-500', 'Membre corporatif, 251 à 500 employés', 250000, true,  5),
  ('corp-501',     'entreprise_qc',      '501+',    'Membre corporatif, 501 employés et plus', 400000, true, 6),
  ('institution',  'institution',        null,      'Partenaire institutionnel',              75000, false, 7),
  ('hors-qc',      'entreprise_hors_qc', null,      'Partenaire corporatif',                 100000, false, 8),
  ('individu',     'individu',           null,      'Membre individuel',                       7500, false, 9);

insert into public.settings (key, value) values
  ('approvals_required', '1'),      -- nombre d'approbations du CA pour confirmer une adhésion
  ('term_months', '12'),            -- durée d'une adhésion
  ('payment_mode', '"simulation"'), -- 'simulation' tant qu'aucun fournisseur de paiement n'est branché
  ('gst_rate', '0'),                -- taxes : à confirmer avec le trésorier avant d'activer
  ('qst_rate', '0');

-- ---------------------------------------------------------------------------
-- Fonctions internes (schéma private, non exposé par l'API)
-- ---------------------------------------------------------------------------
create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()));
$$;

create function private.my_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m where m.user_id = (select auth.uid());
$$;

create function private.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = 'admin'
  );
$$;

create function private.setting_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::integer from public.settings s where s.key = p_key), p_default);
$$;

create function private.setting_num(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::numeric from public.settings s where s.key = p_key), p_default);
$$;

create function private.log(p_action text, p_entity text, p_entity_id text, p_data jsonb default '{}') returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values ((select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_data, '{}'::jsonb));
$$;

-- Active l'adhésion si elle est payée et que le CA a donné assez d'approbations.
create function private.try_activate(p_membership uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.membership_status;
  v_approvals integer;
begin
  select m.status into v_status from public.memberships m where m.id = p_membership for update;
  if v_status is distinct from 'pending_approval' then
    return;
  end if;
  select count(*) into v_approvals
    from public.membership_decisions d
    where d.membership_id = p_membership and d.decision = 'approve';
  if v_approvals >= private.setting_int('approvals_required', 1) then
    update public.memberships m
      set status = 'active',
          decided_at = now(),
          starts_on = current_date,
          ends_on = (current_date + make_interval(months => private.setting_int('term_months', 12)))::date
      where m.id = p_membership;
    perform private.log('adhesion_activee', 'membership', p_membership::text);
  end if;
end;
$$;

-- Enregistre un paiement, solde la facture et fait avancer l'adhésion.
create function private.settle_invoice(p_invoice uuid, p_provider text, p_method text, p_reference text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invoices%rowtype;
begin
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

-- Crée le profil à la création du compte.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Fonctions appelées par le portail
-- ---------------------------------------------------------------------------

-- Tout ce dont l'interface a besoin pour savoir qui est connecté, en un appel.
create function public.get_my_context() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = (select auth.uid())),
    'staff_role', (select s.role from public.staff s where s.user_id = (select auth.uid())),
    'org', (
      select to_jsonb(o) || jsonb_build_object('my_role', m.role, 'is_voting_delegate', m.is_voting_delegate)
      from public.org_members m
      join public.organizations o on o.id = m.org_id
      where m.user_id = (select auth.uid())
      limit 1
    ),
    'membership', (
      select to_jsonb(ms) || jsonb_build_object('tier', to_jsonb(t))
      from public.org_members m
      join public.memberships ms on ms.org_id = m.org_id
      join public.membership_tiers t on t.code = ms.tier_code
      where m.user_id = (select auth.uid())
      order by ms.submitted_at desc
      limit 1
    ),
    'open_invoice', (
      select to_jsonb(i)
      from public.org_members m
      join public.invoices i on i.org_id = m.org_id
      where m.user_id = (select auth.uid()) and i.status = 'open'
      order by i.issued_at desc
      limit 1
    ),
    'payment_mode', (select s.value #>> '{}' from public.settings s where s.key = 'payment_mode')
  );
$$;

-- Dépose (ou met à jour, tant qu'elle n'est pas payée) une demande d'adhésion.
create function public.submit_membership(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind public.org_kind;
  v_range public.employee_range;
  v_name text;
  v_signed text := btrim(coalesce(p ->> 'signed_name', ''));
  v_org uuid;
  v_role public.org_role;
  v_tier public.membership_tiers%rowtype;
  v_membership uuid;
  v_invoice uuid;
  v_live public.memberships%rowtype;
  v_gst integer;
  v_qst integer;
  v_sectors text[];
begin
  if v_uid is null then
    raise exception 'non_connecte';
  end if;
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
  if v_name = '' then
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
    values (v_name, v_kind, v_range, nullif(btrim(p ->> 'website'), ''), nullif(btrim(p ->> 'city'), ''),
            coalesce(v_sectors, '{}'), coalesce((p ->> 'public_listing')::boolean, false), v_uid)
    returning id into v_org;
    insert into public.org_members (org_id, user_id, role, is_voting_delegate)
    values (v_org, v_uid, 'admin', v_tier.has_vote);
  else
    if v_role <> 'admin' then
      raise exception 'reserve_a_l_administrateur';
    end if;
    select * into v_live from public.memberships m
      where m.org_id = v_org and m.status in ('pending_payment', 'pending_approval', 'active');
    if found and v_live.status <> 'pending_payment' then
      raise exception 'adhesion_deja_en_cours';
    end if;
    update public.organizations o
      set name = v_name, kind = v_kind, employee_range = v_range,
          website = nullif(btrim(p ->> 'website'), ''), city = nullif(btrim(p ->> 'city'), ''),
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
      set tier_code = v_tier.code, price_cents = v_tier.price_cents,
          answers = coalesce(p -> 'answers', '{}'::jsonb),
          signed_name = v_signed, declared_at = now(), submitted_by = v_uid, submitted_at = now()
      where m.id = v_membership;
    update public.invoices i
      set description = 'Adhésion annuelle : ' || v_tier.label,
          subtotal_cents = v_tier.price_cents, gst_cents = v_gst, qst_cents = v_qst,
          total_cents = v_tier.price_cents + v_gst + v_qst
      where i.membership_id = v_membership and i.status = 'open'
      returning i.id into v_invoice;
  else
    insert into public.memberships (org_id, tier_code, price_cents, answers, signed_name, declared_at, submitted_by)
    values (v_org, v_tier.code, v_tier.price_cents, coalesce(p -> 'answers', '{}'::jsonb), v_signed, now(), v_uid)
    returning id into v_membership;
  end if;

  if v_invoice is null then
    insert into public.invoices (number, org_id, membership_id, description, subtotal_cents, gst_cents, qst_cents, total_cents)
    values ('DSQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('private.invoice_number_seq')::text, 4, '0'),
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

-- Paiement par carte simulé. Refusé dès qu'un vrai fournisseur est configuré.
create function public.pay_invoice_simulated(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'non_connecte';
  end if;
  if (select s.value #>> '{}' from public.settings s where s.key = 'payment_mode') is distinct from 'simulation' then
    raise exception 'simulation_desactivee';
  end if;
  select i.org_id into v_org from public.invoices i where i.id = p_invoice;
  if v_org is null or not private.is_org_admin(v_org) then
    raise exception 'facture_introuvable';
  end if;
  perform private.settle_invoice(p_invoice, 'simulation', 'card',
    'SIM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));
end;
$$;

-- Le membre choisit de payer par virement : la facture reste ouverte.
create function public.choose_transfer(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select i.org_id into v_org from public.invoices i where i.id = p_invoice and i.status = 'open';
  if v_org is null or not private.is_org_admin(v_org) then
    raise exception 'facture_introuvable';
  end if;
  update public.invoices i set payment_method = 'transfer' where i.id = p_invoice;
  perform private.log('virement_choisi', 'invoice', p_invoice::text);
end;
$$;

-- L'équipe DSQ confirme la réception d'un virement ou d'un chèque.
create function public.staff_mark_paid(p_invoice uuid, p_method text, p_reference text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then
    raise exception 'reserve_a_l_equipe';
  end if;
  if p_method not in ('transfer', 'cheque') then
    raise exception 'mode_invalide';
  end if;
  perform private.settle_invoice(p_invoice, 'manual', p_method, nullif(btrim(coalesce(p_reference, '')), ''));
end;
$$;

-- Un membre du CA ou le DG approuve ou refuse une demande.
create function public.staff_decide(p_membership uuid, p_decision text, p_comment text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.membership_status;
begin
  if not private.is_staff() then
    raise exception 'reserve_a_l_equipe';
  end if;
  if p_decision not in ('approve', 'refuse') then
    raise exception 'decision_invalide';
  end if;
  select m.status into v_status from public.memberships m where m.id = p_membership for update;
  if v_status is null then
    raise exception 'adhesion_introuvable';
  end if;
  if v_status not in ('pending_payment', 'pending_approval') then
    raise exception 'adhesion_deja_tranchee';
  end if;
  if p_decision = 'refuse' and length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception 'motif_requis';
  end if;

  insert into public.membership_decisions (membership_id, staff_id, decision, comment)
  values (p_membership, (select auth.uid()), p_decision, nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (membership_id, staff_id)
  do update set decision = excluded.decision, comment = excluded.comment, created_at = now();

  perform private.log('adhesion_' || p_decision, 'membership', p_membership::text,
    jsonb_build_object('comment', p_comment));

  if p_decision = 'refuse' then
    update public.memberships m
      set status = 'refused', decided_at = now(), refusal_reason = btrim(p_comment)
      where m.id = p_membership;
    update public.invoices i set status = 'void' where i.membership_id = p_membership and i.status = 'open';
  else
    perform private.try_activate(p_membership);
  end if;
end;
$$;

-- Crée une invitation et renvoie son jeton, visible une seule fois.
create function public.create_invitation(p_email text, p_org uuid default null, p_message text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'non_connecte';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'courriel_invalide';
  end if;
  if p_org is null then
    if not private.is_staff() then
      raise exception 'reserve_a_l_equipe';
    end if;
  elsif not (private.is_org_admin(p_org) or private.is_staff()) then
    raise exception 'reserve_a_l_administrateur';
  end if;

  insert into public.invitations (token_hash, email, org_id, message, invited_by)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_email, p_org,
          nullif(btrim(coalesce(p_message, '')), ''), (select auth.uid()))
  returning id into v_id;

  perform private.log('invitation_creee', 'invitation', v_id::text, jsonb_build_object('org', p_org));
  return v_token;
end;
$$;

-- Ce que voit la personne qui ouvre un lien d'invitation, connectée ou non.
create function public.get_invitation(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.invitations%rowtype;
begin
  select * into v from public.invitations i
    where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  return jsonb_build_object(
    'status', case
      when v.revoked_at is not null then 'revoked'
      when v.accepted_at is not null then 'accepted'
      when v.expires_at < now() then 'expired'
      else 'valid' end,
    'email', v.email,
    'message', v.message,
    'org_name', (select o.name from public.organizations o where o.id = v.org_id),
    'inviter_name', (select pr.full_name from public.profiles pr where pr.id = v.invited_by)
  );
end;
$$;

-- Accepte une invitation. Le compte connecté doit porter le courriel invité.
create function public.accept_invitation(p_token text) returns jsonb
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
  select lower(pr.email) into v_email from public.profiles pr where pr.id = v_uid;
  if v_email is distinct from lower(v.email) then
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

create function public.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.invitations%rowtype;
begin
  select * into v from public.invitations i where i.id = p_id for update;
  if not found then
    raise exception 'invitation_invalide';
  end if;
  if not (private.is_staff() or v.invited_by = (select auth.uid())
          or (v.org_id is not null and private.is_org_admin(v.org_id))) then
    raise exception 'reserve_a_l_administrateur';
  end if;
  update public.invitations i set revoked_at = now() where i.id = p_id and i.accepted_at is null;
  perform private.log('invitation_revoquee', 'invitation', p_id::text);
end;
$$;

-- L'administrateur d'une organisation désigne son délégué votant.
create function public.org_set_delegate(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then
    raise exception 'reserve_a_l_administrateur';
  end if;
  if not exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_user) then
    raise exception 'membre_introuvable';
  end if;
  update public.org_members m set is_voting_delegate = false where m.org_id = p_org and m.is_voting_delegate;
  update public.org_members m set is_voting_delegate = true where m.org_id = p_org and m.user_id = p_user;
  perform private.log('delegue_designe', 'organization', p_org::text, jsonb_build_object('user', p_user));
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits : on retire tout, puis on n'accorde que le nécessaire.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.is_staff(), private.my_org_ids(), private.is_org_admin(uuid) to authenticated;

grant select on public.membership_tiers to anon, authenticated;
grant select on
  public.profiles, public.organizations, public.org_members, public.memberships,
  public.membership_decisions, public.invoices, public.payments, public.invitations,
  public.staff, public.consents, public.audit_log, public.settings
  to authenticated;
grant update (full_name, job_title, phone, onboarded_at) on public.profiles to authenticated;
grant update (website, city, sectors, description, public_listing) on public.organizations to authenticated;
grant insert (user_id, purpose, granted, source) on public.consents to authenticated;

grant execute on function public.get_invitation(text) to anon, authenticated;
grant execute on function
  public.get_my_context(),
  public.submit_membership(jsonb),
  public.pay_invoice_simulated(uuid),
  public.choose_transfer(uuid),
  public.staff_mark_paid(uuid, text, text),
  public.staff_decide(uuid, text, text),
  public.create_invitation(text, uuid, text),
  public.accept_invitation(text),
  public.revoke_invitation(uuid),
  public.org_set_delegate(uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Politiques d'accès aux lignes
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.membership_tiers enable row level security;
alter table public.memberships enable row level security;
alter table public.membership_decisions enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.invitations enable row level security;
alter table public.staff enable row level security;
alter table public.consents enable row level security;
alter table public.audit_log enable row level security;
alter table public.settings enable row level security;

-- Profils : le sien, ceux de son organisation, tous pour l'équipe DSQ.
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or (select private.is_staff())
  or id in (select m.user_id from public.org_members m where m.org_id in (select private.my_org_ids()))
);
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy organizations_select on public.organizations for select to authenticated using (
  id in (select private.my_org_ids()) or (select private.is_staff())
);
create policy organizations_update on public.organizations for update to authenticated
  using ((select private.is_org_admin(id))) with check ((select private.is_org_admin(id)));

create policy org_members_select on public.org_members for select to authenticated using (
  org_id in (select private.my_org_ids()) or (select private.is_staff())
);

create policy tiers_select on public.membership_tiers for select to anon, authenticated using (true);

create policy memberships_select on public.memberships for select to authenticated using (
  org_id in (select private.my_org_ids()) or (select private.is_staff())
);

create policy decisions_select on public.membership_decisions for select to authenticated using (
  (select private.is_staff())
);

-- Factures et paiements : l'administrateur de l'organisation et l'équipe DSQ.
create policy invoices_select on public.invoices for select to authenticated using (
  (select private.is_org_admin(org_id)) or (select private.is_staff())
);
create policy payments_select on public.payments for select to authenticated using (
  (select private.is_staff())
  or exists (select 1 from public.invoices i where i.id = invoice_id and (select private.is_org_admin(i.org_id)))
);

create policy invitations_select on public.invitations for select to authenticated using (
  (select private.is_staff())
  or invited_by = (select auth.uid())
  or (org_id is not null and (select private.is_org_admin(org_id)))
);

create policy staff_select on public.staff for select to authenticated using (
  user_id = (select auth.uid()) or (select private.is_staff())
);

create policy consents_select on public.consents for select to authenticated using (
  user_id = (select auth.uid())
);
create policy consents_insert on public.consents for insert to authenticated with check (
  user_id = (select auth.uid())
);

create policy audit_select on public.audit_log for select to authenticated using (
  (select private.is_staff())
);

create policy settings_select on public.settings for select to authenticated using (true);
