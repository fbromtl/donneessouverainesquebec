import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useSession } from '../lib/session'
import { rpc, supabase } from '../lib/supabase'
import { longDate, money, type EmployeeRange, type OrgKind, type Tier } from '../lib/types'
import { Button, Checkbox, Chip, ChoiceTile, cx, Field, Input, Notice, PageHeader, Panel } from '../ui'

const RANGES: [EmployeeRange, string][] = [
  ['1-25', '1 à 25'],
  ['26-50', '26 à 50'],
  ['51-100', '51 à 100'],
  ['101-250', '101 à 250'],
  ['251-500', '251 à 500'],
  ['501+', '501 et plus'],
]
const SECTORS = [
  'Technologies numériques, TI',
  'Données, IA, analytique',
  'Cybersécurité',
  'Recherche et innovation',
  'Secteur public ou parapublic',
  'Services-conseils',
  'Autre',
]
const MOTIVATIONS = [
  'Contribuer aux réflexions sur la souveraineté numérique',
  "Participer à un réseau de pratique et d'expertise",
  'Suivre ou influencer les politiques publiques',
  'Accéder aux activités, événements et groupes de travail',
  'Positionner mon organisation comme acteur engagé',
]
const INVOLVEMENT = ['De façon régulière', "À l'occasion", "Comme observateur pour l'instant"]
const STEPS = ['Organisation', 'Engagement', 'Paiement']
const DRAFT_KEY = 'dsq.adhesion'

interface Draft {
  kind: OrgKind | null
  org_name: string
  employee_range: EmployeeRange | null
  website: string
  city: string
  sectors: string[]
  motivations: string[]
  involvement: string
  consent_communications: boolean
  public_listing: boolean
  declaration: boolean
  signed_name: string
  method: 'card' | 'transfer'
}

function readDraft(): Partial<Draft> {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<Draft>
  } catch {
    return {}
  }
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

function Stepper({ step, onGo }: { step: number; onGo: (i: number) => void }) {
  return (
    <ol className="mb-8 flex items-center gap-2 text-sm sm:gap-3">
      {STEPS.map((label, i) => {
        const done = i < step
        const current = i === step
        return (
          <li key={label} className="flex items-center gap-2 sm:gap-3">
            {i > 0 && <span className={cx('h-px w-5 sm:w-10', done || current ? 'bg-ink' : 'bg-line-strong')} aria-hidden />}
            <button
              type="button"
              disabled={!done}
              onClick={() => onGo(i)}
              aria-current={current ? 'step' : undefined}
              className={cx('flex items-center gap-2 rounded-full', done && 'cursor-pointer')}
            >
              <span
                className={cx(
                  'flex size-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums',
                  current && 'bg-ink text-white',
                  done && 'bg-accent-soft text-accent-ink',
                  !current && !done && 'border border-line-strong text-ink-3',
                )}
              >
                {done ? <Check className="size-4" aria-label="Terminé" /> : i + 1}
              </span>
              <span className={cx(current ? 'font-medium text-ink' : 'text-ink-3', !current && 'hidden sm:inline')}>{label}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** Le reçu qui se construit pendant qu'on remplit : le tarif n'est jamais une surprise. */
function Summary({ draft, tier, displayName }: { draft: Draft; tier: Tier | null; displayName: string }) {
  return (
    <Panel className="p-5 xl:sticky xl:top-8 xl:p-6">
      {/* Écran étroit : une bande compacte au-dessus du formulaire. Écran large : une colonne qui suit le défilement. */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 xl:block">
        <div className="min-w-0">
          <p className="text-sm text-ink-3">Votre adhésion</p>
          <p className="mt-1 truncate text-lg font-semibold">{displayName || 'Votre organisation'}</p>
        </div>
        <div className="xl:mt-5 xl:border-t xl:border-line xl:pt-5">
          {tier ? (
            <>
              <p className="text-ink-2">{tier.label}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums xl:text-4xl">
                {money(tier.price_cents)}
                <span className="ml-1.5 text-base font-normal text-ink-3">par an</span>
              </p>
            </>
          ) : (
            <p className="max-w-[34ch] text-ink-3">
              {draft.kind === 'entreprise_qc' ? "Indiquez le nombre d'employés pour voir votre tarif." : 'Choisissez qui adhère pour voir votre tarif.'}
            </p>
          )}
        </div>
      </div>

      <dl className="mt-5 hidden flex-col gap-2.5 border-t border-line pt-5 text-sm xl:flex">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-3">Droit de vote à l'assemblée</dt>
          <dd className="font-medium">{tier ? (tier.has_vote ? 'Oui' : 'Non') : '—'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-3">Durée</dt>
          <dd className="font-medium">12 mois</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-3">Rabais au Forum DSQ</dt>
          <dd className="font-medium">40 %</dd>
        </div>
      </dl>
      <p className="mt-5 hidden text-sm text-ink-3 xl:block">
        L'adhésion prend effet après le paiement et la confirmation du conseil d'administration.
      </p>
    </Panel>
  )
}

export default function Join() {
  const { ctx, refresh } = useSession()
  const navigate = useNavigate()
  const org = ctx?.org
  const m = ctx?.membership

  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() => ({
    kind: org?.kind ?? null,
    org_name: org?.kind === 'individu' ? '' : (org?.name ?? ''),
    employee_range: org?.employee_range ?? null,
    website: org?.website ?? '',
    city: org?.city ?? '',
    sectors: org?.sectors ?? [],
    motivations: m?.answers?.motivations ?? [],
    involvement: m?.answers?.involvement ?? '',
    consent_communications: false,
    public_listing: org?.public_listing ?? false,
    declaration: false,
    signed_name: ctx?.profile?.full_name ?? '',
    method: 'card',
    ...readDraft(),
  }))
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  // Chaque étape commence en haut de page.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [step])

  // Le brouillon survit à un rechargement de la page, sans rien envoyer avant la fin.
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      /* stockage indisponible : le brouillon ne survivra pas à un rechargement */
    }
  }, [draft])

  const tiers = useQuery({
    queryKey: ['paliers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('membership_tiers').select('*').order('sort')
      if (error) throw error
      return data as Tier[]
    },
    staleTime: Infinity,
  })

  const tier = useMemo(() => {
    if (!draft.kind || !tiers.data) return null
    const range = draft.kind === 'entreprise_qc' ? draft.employee_range : null
    return tiers.data.find((t) => t.kind === draft.kind && (t.employee_range ?? null) === range) ?? null
  }, [draft.kind, draft.employee_range, tiers.data])

  const priceOf = (kind: OrgKind) => {
    const list = (tiers.data ?? []).filter((t) => t.kind === kind).map((t) => t.price_cents)
    if (!list.length) return ''
    const min = Math.min(...list)
    const max = Math.max(...list)
    return min === max ? money(min) : `${money(min)} à ${money(max)}`
  }

  if (m && (m.status === 'pending_approval' || m.status === 'active')) return <Navigate to="/organisation" replace />
  if (org && org.my_role !== 'admin') {
    return (
      <>
        <PageHeader title="Adhérer" />
        <Notice title="Cette démarche revient à l'administrateur du compte de votre organisation.">
          Demandez-lui de compléter l'adhésion de {org.name} depuis son espace.
        </Notice>
      </>
    )
  }

  const individual = draft.kind === 'individu'
  const displayName = individual ? (ctx?.profile?.full_name ?? '') : draft.org_name.trim()
  const step1Ok = !!draft.kind && (individual || draft.org_name.trim().length > 0) && (draft.kind !== 'entreprise_qc' || !!draft.employee_range)
  const step2Ok = draft.declaration && draft.signed_name.trim().length >= 2

  async function submit() {
    if (!tier) return
    setBusy(true)
    setError(null)
    try {
      const res = await rpc<{ membership_id: string; invoice_id: string }>('submit_membership', {
        p: {
          kind: draft.kind,
          org_name: individual ? '' : draft.org_name.trim(),
          employee_range: draft.kind === 'entreprise_qc' ? draft.employee_range : null,
          website: draft.website,
          city: draft.city,
          sectors: draft.sectors,
          answers: { motivations: draft.motivations, involvement: draft.involvement },
          consent_communications: draft.consent_communications,
          public_listing: draft.public_listing,
          declaration: draft.declaration,
          signed_name: draft.signed_name.trim(),
        },
      })
      if (draft.method === 'transfer') await rpc('choose_transfer', { p_invoice: res.invoice_id })
      sessionStorage.removeItem(DRAFT_KEY)
      await refresh()
      navigate(draft.method === 'card' ? `/paiement/${res.invoice_id}` : '/adhesion/merci?mode=virement')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Adhérer à Données Souveraines Québec" lead="Trois étapes. Vous pouvez revenir en arrière à tout moment : rien n'est envoyé avant la dernière." />
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="order-last min-w-0 xl:order-first">
          <Stepper step={step} onGo={setStep} />

          {step === 0 && (
            <div className="flex flex-col gap-8">
              <fieldset>
                <legend className="mb-3 text-lg font-semibold">Qui adhère ?</legend>
                <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
                  <ChoiceTile selected={draft.kind === 'entreprise_qc'} onSelect={() => set({ kind: 'entreprise_qc' })} title="Une entreprise du Québec" detail={`Membre corporatif, avec droit de vote. ${priceOf('entreprise_qc')} selon la taille.`} />
                  <ChoiceTile selected={draft.kind === 'institution'} onSelect={() => set({ kind: 'institution' })} title="Un organisme ou une institution" detail={`Organisme public, établissement d'enseignement, association. ${priceOf('institution')}.`} />
                  <ChoiceTile selected={draft.kind === 'entreprise_hors_qc'} onSelect={() => set({ kind: 'entreprise_hors_qc' })} title="Une entreprise hors Québec" detail={`Siège social ailleurs, mais adhère à la mission. ${priceOf('entreprise_hors_qc')}.`} />
                  <ChoiceTile selected={individual} onSelect={() => set({ kind: 'individu' })} title="Moi, à titre individuel" detail={`Adhésion personnelle. ${priceOf('individu')}.`} />
                </div>
              </fieldset>

              {draft.kind && !individual && (
                <Field label="Nom de l'organisation" htmlFor="org">
                  <Input id="org" autoComplete="organization" value={draft.org_name} onChange={(e) => set({ org_name: e.target.value })} />
                </Field>
              )}
              {individual && <p className="text-ink-2">L'adhésion sera au nom de {ctx?.profile?.full_name}.</p>}

              {draft.kind === 'entreprise_qc' && (
                <fieldset>
                  <legend className="mb-3 text-sm font-medium">Nombre d'employés</legend>
                  <div role="radiogroup" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {RANGES.map(([value, label]) => {
                      const t = tiers.data?.find((x) => x.employee_range === value)
                      return (
                        <ChoiceTile key={value} selected={draft.employee_range === value} onSelect={() => set({ employee_range: value })} title={label} detail={t ? money(t.price_cents) : undefined} />
                      )
                    })}
                  </div>
                </fieldset>
              )}

              {draft.kind && !individual && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Site web" htmlFor="site" optional>
                    <Input id="site" type="url" inputMode="url" autoComplete="url" value={draft.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" />
                  </Field>
                  <Field label="Ville" htmlFor="ville" optional>
                    <Input id="ville" autoComplete="address-level2" value={draft.city} onChange={(e) => set({ city: e.target.value })} />
                  </Field>
                </div>
              )}

              {draft.kind && (
                <fieldset>
                  <legend className="mb-3 text-sm font-medium">
                    Secteurs d'activité <span className="ml-1.5 font-normal text-ink-3">facultatif</span>
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {SECTORS.map((s) => (
                      <Chip key={s} selected={draft.sectors.includes(s)} onToggle={() => set({ sectors: toggle(draft.sectors, s) })}>
                        {s}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
              )}

              <div>
                <Button size="lg" disabled={!step1Ok} onClick={() => setStep(1)}>
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-8">
              <fieldset>
                <legend className="mb-3 text-lg font-semibold">
                  Ce qui vous amène <span className="ml-1.5 text-sm font-normal text-ink-3">facultatif</span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {MOTIVATIONS.map((s) => (
                    <Chip key={s} selected={draft.motivations.includes(s)} onToggle={() => set({ motivations: toggle(draft.motivations, s) })}>
                      {s}
                    </Chip>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-3 text-sm font-medium">
                  Souhaitez-vous vous impliquer ? <span className="ml-1.5 font-normal text-ink-3">facultatif</span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {INVOLVEMENT.map((s) => (
                    <Chip key={s} selected={draft.involvement === s} onToggle={() => set({ involvement: draft.involvement === s ? '' : s })}>
                      {s}
                    </Chip>
                  ))}
                </div>
              </fieldset>

              <div className="flex flex-col gap-3.5">
                <Checkbox id="comms" checked={draft.consent_communications} onChange={(v) => set({ consent_communications: v })}>
                  J'accepte de recevoir les communications de Données Souveraines Québec.
                </Checkbox>
                <Checkbox id="public" checked={draft.public_listing} onChange={(v) => set({ public_listing: v })}>
                  J'autorise DSQ à mentionner publiquement cette adhésion (nom et logo).
                </Checkbox>
              </div>

              <Panel className="p-5">
                <p className="text-lg font-semibold">Déclaration</p>
                <p className="mt-2 text-ink-2">
                  Je déclare avoir pris connaissance de la mission et des valeurs de Données Souveraines Québec et adhérer aux principes généraux de
                  l'association, incluant le respect de la souveraineté, de l'intérêt collectif et de l'éthique en matière de données.
                </p>
                <div className="mt-4 flex flex-col gap-4">
                  <Checkbox id="declaration" checked={draft.declaration} onChange={(v) => set({ declaration: v })}>
                    <span className="font-medium text-ink">Oui, j'adhère à cette déclaration.</span>
                  </Checkbox>
                  <Field label="Signature" htmlFor="signature" hint={`Écrivez votre nom complet. Signé le ${longDate(new Date().toISOString())}.`}>
                    <Input id="signature" autoComplete="name" value={draft.signed_name} onChange={(e) => set({ signed_name: e.target.value })} />
                  </Field>
                </div>
              </Panel>

              <div className="flex gap-2">
                <Button size="lg" disabled={!step2Ok} onClick={() => setStep(2)}>
                  Continuer
                </Button>
                <Button size="lg" variant="quiet" onClick={() => setStep(0)}>
                  Retour
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-8">
              <fieldset>
                <legend className="mb-3 text-lg font-semibold">Comment souhaitez-vous payer ?</legend>
                <div role="radiogroup" className="grid gap-3">
                  <ChoiceTile selected={draft.method === 'card'} onSelect={() => set({ method: 'card' })} title="Par carte, maintenant" detail="Votre demande part aussitôt au conseil d'administration." />
                  <ChoiceTile selected={draft.method === 'transfer'} onSelect={() => set({ method: 'transfer' })} title="Par virement ou par chèque, sur facture" detail="Votre demande avance dès que DSQ reçoit le paiement." />
                </div>
              </fieldset>

              <dl className="divide-y divide-line border-y border-line text-[15px]">
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-ink-3">Adhérent</dt>
                  <dd className="text-right font-medium">{displayName}</dd>
                </div>
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-ink-3">Catégorie</dt>
                  <dd className="text-right font-medium">{tier?.label}</dd>
                </div>
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-ink-3">Signé par</dt>
                  <dd className="text-right font-medium">{draft.signed_name}</dd>
                </div>
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-ink-3">Total</dt>
                  <dd className="text-right font-semibold tabular-nums">{tier ? money(tier.price_cents) : ''}</dd>
                </div>
              </dl>

              {error && <Notice tone="danger" title={error} />}

              <div className="flex gap-2">
                <Button size="lg" loading={busy} disabled={!tier || !step1Ok || !step2Ok} onClick={submit}>
                  {draft.method === 'card' ? 'Continuer vers le paiement' : 'Recevoir ma facture'}
                </Button>
                <Button size="lg" variant="quiet" onClick={() => setStep(1)} disabled={busy}>
                  Retour
                </Button>
              </div>
            </div>
          )}
        </div>

        <Summary draft={draft} tier={tier} displayName={displayName} />
      </div>
    </>
  )
}
