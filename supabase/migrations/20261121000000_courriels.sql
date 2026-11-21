-- Envoi de courriels : file d'attente, déclencheurs et refus d'invitation.
--
--   * Chaque courriel du portail passe par `email_outbox`. La base y dépose ce qu'il faut
--     envoyer ; la fonction `courriels` (supabase/functions) le rédige et l'envoie, ou le
--     simule tant qu'aucun fournisseur n'est branché. L'équipe voit tout ce qui est parti.
--   * Les courriels naissent de déclencheurs sur les tables, pas des fonctions métier :
--     celles-ci restent inchangées.
--   * Une personne invitée peut refuser d'être réinvitée (exigence de la loi anti-pourriel).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  template text not null check (template in (
    'paiement_recu', 'adhesion_confirmee', 'adhesion_refusee',
    'facture_a_regler', 'demande_a_traiter', 'invitation')),
  to_email text not null,
  to_user uuid references public.profiles (id) on delete set null,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'simulated', 'failed')),
  subject text,
  body_text text,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
create index email_outbox_status on public.email_outbox (status, created_at);
create index email_outbox_to_user on public.email_outbox (to_user);

-- Adresses qui ont demandé à ne plus être invitées.
create table public.email_suppressions (
  email text primary key,
  source text not null,
  created_at timestamptz not null default now()
);

alter table public.email_outbox enable row level security;
alter table public.email_suppressions enable row level security;

revoke all on public.email_outbox, public.email_suppressions from anon, authenticated;
grant select on public.email_outbox, public.email_suppressions to authenticated;

create policy email_outbox_select on public.email_outbox for select to authenticated using (
  (select private.is_staff())
);
create policy email_suppressions_select on public.email_suppressions for select to authenticated using (
  (select private.is_staff())
);

-- ---------------------------------------------------------------------------
-- Mise en file
-- ---------------------------------------------------------------------------
create function private.enqueue_email(p_template text, p_user uuid, p_payload jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.email_outbox (template, to_email, to_user, payload)
  select p_template, pr.email, pr.id, coalesce(p_payload, '{}'::jsonb)
  from public.profiles pr
  where pr.id = p_user and pr.email <> '';
$$;

-- Ce que les gabarits ont besoin de savoir sur une adhésion. Rien de sensible.
create function private.membership_payload(p_membership uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'membership_id', m.id,
    'org_name', o.name,
    'tier_label', t.label,
    'has_vote', t.has_vote,
    'ends_on', m.ends_on,
    'refusal_reason', m.refusal_reason,
    'invoice_id', i.id,
    'invoice_number', i.number,
    'total_cents', coalesce(i.total_cents, m.price_cents))
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  join public.membership_tiers t on t.code = m.tier_code
  left join lateral (
    select inv.id, inv.number, inv.total_cents
    from public.invoices inv
    where inv.membership_id = m.id and inv.status <> 'void'
    order by inv.issued_at desc
    limit 1
  ) i on true
  where m.id = p_membership;
$$;

create function private.notify_staff(p_payload jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.email_outbox (template, to_email, to_user, payload)
  select 'demande_a_traiter', pr.email, pr.id, p_payload
  from public.staff s
  join public.profiles pr on pr.id = s.user_id
  where pr.email <> '';
$$;

-- Une adhésion change d'état : on prévient la personne, et l'équipe s'il reste à approuver.
create function private.on_membership_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  v_payload := private.membership_payload(new.id);

  if new.status = 'pending_approval' then
    perform private.enqueue_email('paiement_recu', new.submitted_by, v_payload);
    if (select count(*) from public.membership_decisions d
        where d.membership_id = new.id and d.decision = 'approve')
       < private.setting_int('approvals_required', 1) then
      perform private.notify_staff(v_payload);
    end if;
  elsif new.status = 'active' then
    perform private.enqueue_email('adhesion_confirmee', new.submitted_by, v_payload);
  elsif new.status = 'refused' then
    perform private.enqueue_email('adhesion_refusee', new.submitted_by, v_payload);
  end if;
  return new;
end;
$$;

create trigger memberships_status_emails
  after update of status on public.memberships
  for each row execute function private.on_membership_status();

-- Le membre choisit le virement : il reçoit sa facture, et l'équipe sait qu'un paiement est attendu.
create function private.on_invoice_transfer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
  v_user uuid;
begin
  if new.status <> 'open' or new.payment_method is distinct from 'transfer'
     or old.payment_method is not distinct from new.payment_method or new.membership_id is null then
    return new;
  end if;
  select m.submitted_by into v_user from public.memberships m where m.id = new.membership_id;
  v_payload := private.membership_payload(new.membership_id) || jsonb_build_object('attente_virement', true);
  perform private.enqueue_email('facture_a_regler', v_user, v_payload);
  perform private.notify_staff(v_payload);
  return new;
end;
$$;

create trigger invoices_transfer_emails
  after update of payment_method on public.invoices
  for each row execute function private.on_invoice_transfer();

-- ---------------------------------------------------------------------------
-- Refus d'être invité
-- ---------------------------------------------------------------------------
create function private.block_suppressed_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.email_suppressions s where s.email = lower(new.email)) then
    raise exception 'destinataire_ne_souhaite_plus_etre_invite';
  end if;
  return new;
end;
$$;

create trigger invitations_respect_suppressions
  before insert on public.invitations
  for each row execute function private.block_suppressed_invitation();

-- Appelée depuis le lien « ne plus recevoir d'invitations » : le jeton prouve qu'on est le destinataire.
create function public.decline_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.invitations%rowtype;
begin
  select * into v from public.invitations i
    where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  update public.invitations i set revoked_at = now()
    where i.id = v.id and i.accepted_at is null and i.revoked_at is null;
  insert into public.email_suppressions (email, source) values (lower(v.email), 'invitation')
    on conflict (email) do nothing;
  perform private.log('invitations_refusees', 'invitation', v.id::text);
  return jsonb_build_object('status', 'done', 'email', v.email);
end;
$$;

-- ---------------------------------------------------------------------------
-- Prise en charge par la fonction d'envoi (rôle de service uniquement)
-- ---------------------------------------------------------------------------
-- Réserve un lot de courriels à envoyer. Reprend aussi ceux restés en cours depuis plus de
-- dix minutes et ceux qui ont échoué moins de trois fois.
create function public.claim_emails(p_limit integer default 20) returns setof public.email_outbox
language sql security definer set search_path = '' as $$
  update public.email_outbox o
    set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
  where o.id in (
    select q.id from public.email_outbox q
    where q.template <> 'invitation'
      and (q.status = 'queued'
        or (q.status = 'failed' and q.attempts < 3)
        or (q.status = 'sending' and q.claimed_at < now() - interval '10 minutes'))
    order by q.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 50))
    for update skip locked)
  returning o.*;
$$;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
revoke all on function
  private.enqueue_email(text, uuid, jsonb), private.membership_payload(uuid), private.notify_staff(jsonb),
  private.on_membership_status(), private.on_invoice_transfer(), private.block_suppressed_invitation()
  from public, anon, authenticated;

revoke all on function public.decline_invitation(text) from public, anon, authenticated;
grant execute on function public.decline_invitation(text) to anon, authenticated;

revoke all on function public.claim_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_emails(integer) to service_role;
