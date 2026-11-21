import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { emailStatus, kickEmails, sendInvitationEmail, type InvitationSent } from '../lib/courriels'
import { useSession } from '../lib/session'
import { rpc, supabase } from '../lib/supabase'
import { KIND_LABEL, longDate, money, type Membership, type OrgKind } from '../lib/types'
import { Badge, Button, cx, Field, Input, Notice, PageHeader, Panel, Textarea } from '../ui'
import { InviteLink, inviteState } from './Organization'

type Row = Membership & {
  organizations: { name: string; kind: OrgKind; city: string | null; website: string | null } | null
  membership_tiers: { label: string; has_vote: boolean } | null
  invoices: { id: string; number: string; total_cents: number; status: string; payment_method: string | null; payments: { provider: string }[] }[]
  submitter: { full_name: string | null; email: string; job_title: string | null } | null
  membership_decisions: { decision: string; staff_id: string }[]
}
interface InviteRow {
  id: string
  email: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  organizations: { name: string } | null
  inviter: { full_name: string | null } | null
}

const SELECT =
  '*, organizations(name, kind, city, website), membership_tiers(label, has_vote), invoices(id, number, total_cents, status, payment_method, payments(provider)), ' +
  'submitter:profiles!memberships_submitted_by_fkey(full_name, email, job_title), membership_decisions(decision, staff_id)'

/** Une demande d'adhésion, avec les seules actions utiles à son état. */
function Request({ row, me, onDone }: { row: Row; me: string; onDone: () => void }) {
  const [mode, setMode] = useState<'idle' | 'refuse' | 'paid'>('idle')
  const [text, setText] = useState('')
  const [method, setMethod] = useState<'transfer' | 'cheque'>('transfer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inv = row.invoices.find((i) => i.status !== 'void') ?? row.invoices[0]
  const paid = inv?.status === 'paid'
  const simulated = !!inv?.payments?.some((p) => p.provider === 'simulation')
  const approvedByMe = row.membership_decisions.some((d) => d.staff_id === me && d.decision === 'approve')
  // Les réponses viennent du demandeur : on ne suppose rien de leur forme.
  const motivations = Array.isArray(row.answers?.motivations) ? row.answers.motivations.filter((x) => typeof x === 'string') : []

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await rpc(fn, args)
      kickEmails()
      onDone()
      setMode('idle')
      setText('')
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-lg font-semibold">{row.organizations?.name}</p>
          <p className="text-sm text-ink-3">
            {[row.organizations ? KIND_LABEL[row.organizations.kind] : null, row.organizations?.city, `déposée le ${longDate(row.submitted_at)}`].filter(Boolean).join(', ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {paid && simulated ? (
            <Badge tone="warn">Paiement simulé</Badge>
          ) : paid ? (
            <Badge tone="ok">Payée{inv?.payment_method === 'card' ? ' par carte' : ''}</Badge>
          ) : inv?.payment_method === 'transfer' ? (
            <Badge tone="warn">Virement ou chèque attendu</Badge>
          ) : (
            <Badge tone="warn">Paiement attendu</Badge>
          )}
          {approvedByMe && <Badge tone="accent">Approuvée par vous</Badge>}
        </div>
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-3 text-[15px] sm:grid-cols-3">
        <div>
          <dt className="text-sm text-ink-3">Catégorie</dt>
          <dd>{row.membership_tiers?.label}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-3">Facture</dt>
          <dd className="tabular-nums">
            {inv?.number}, {money(inv?.total_cents ?? row.price_cents)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-3">Déposée par</dt>
          <dd className="truncate">{row.submitter?.full_name || row.submitter?.email}</dd>
          <dd className="truncate text-sm text-ink-3">{row.submitter?.email}</dd>
        </div>
      </dl>
      {motivations.length > 0 && (
        <p className="mt-3 text-sm text-ink-2">
          <span className="text-ink-3">Motivations : </span>
          {motivations.join(' ; ')}
        </p>
      )}

      {error && (
        <div className="mt-4">
          <Notice tone="danger" title={error} />
        </div>
      )}

      {mode === 'idle' && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          {!approvedByMe && (
            <Button loading={busy} onClick={() => run('staff_decide', { p_membership: row.id, p_decision: 'approve' })}>
              Approuver
            </Button>
          )}
          {!paid && inv && (
            <Button variant="secondary" onClick={() => setMode('paid')}>
              Confirmer un paiement reçu
            </Button>
          )}
          <Button variant="danger" onClick={() => setMode('refuse')}>
            Refuser
          </Button>
          {approvedByMe && !paid && <p className="self-center text-sm text-ink-3">L'adhésion s'activera à la réception du paiement.</p>}
        </div>
      )}

      {mode === 'refuse' && (
        <form
          className="mt-5 flex flex-col gap-3 border-t border-line pt-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            run('staff_decide', { p_membership: row.id, p_decision: 'refuse', p_comment: text })
          }}
        >
          <Field label="Motif du refus" htmlFor={`motif-${row.id}`} hint="Le demandeur verra ce motif sur sa page d'accueil.">
            <Textarea id={`motif-${row.id}`} required minLength={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={busy}>
              Refuser la demande
            </Button>
            <Button variant="quiet" onClick={() => setMode('idle')}>
              Annuler
            </Button>
          </div>
        </form>
      )}

      {mode === 'paid' && inv && (
        <form
          className="mt-5 flex flex-col gap-3 border-t border-line pt-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            run('staff_mark_paid', { p_invoice: inv.id, p_method: method, p_reference: text })
          }}
        >
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Mode de paiement reçu">
            {(
              [
                ['transfer', 'Virement'],
                ['cheque', 'Chèque'],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={method === v}
                onClick={() => setMethod(v)}
                className={cx(
                  'h-9 cursor-pointer rounded-full border px-4 text-sm',
                  method === v ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-2',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <Field label="Référence" htmlFor={`ref-${row.id}`} optional hint="Numéro de virement ou de chèque, pour le rapprochement.">
            <Input id={`ref-${row.id}`} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Confirmer {money(inv.total_cents)} reçus
            </Button>
            <Button variant="quiet" onClick={() => setMode('idle')}>
              Annuler
            </Button>
          </div>
        </form>
      )}
    </Panel>
  )
}

interface OutboxRow {
  id: string
  template: string
  to_email: string
  status: 'queued' | 'sending' | 'sent' | 'simulated' | 'failed'
  subject: string | null
  body_text: string | null
  error: string | null
  created_at: string
}
const TEMPLATE_LABEL: Record<string, string> = {
  paiement_recu: 'Paiement reçu',
  adhesion_confirmee: 'Adhésion confirmée',
  adhesion_refusee: 'Demande refusée',
  facture_a_regler: 'Facture à régler',
  demande_a_traiter: "Demande à traiter, pour l'équipe",
  invitation: 'Invitation',
}
function mailState(status: OutboxRow['status']) {
  if (status === 'sent') return <Badge tone="ok">Envoyé</Badge>
  if (status === 'simulated') return <Badge tone="warn">Simulé</Badge>
  if (status === 'failed') return <Badge tone="danger">Échec</Badge>
  return <Badge tone="accent">En file</Badge>
}

const TABS = [
  ['demandes', 'Demandes'],
  ['membres', 'Membres'],
  ['invitations', 'Invitations'],
  ['courriels', 'Courriels'],
] as const

export default function Admin() {
  const { ctx } = useSession()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab = params.get('onglet') ?? 'demandes'
  const me = ctx?.profile?.id ?? ''

  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ token: string; email: string; sent: InvitationSent | null; sendError: string | null } | null>(null)

  const rows = useQuery({
    queryKey: ['admin', 'adhesions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('memberships').select(SELECT).in('status', ['pending_payment', 'pending_approval', 'active']).order('submitted_at')
      if (error) throw error
      return data as unknown as Row[]
    },
  })
  const invites = useQuery({
    queryKey: ['admin', 'invitations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('id, email, created_at, expires_at, accepted_at, revoked_at, organizations(name), inviter:profiles!invitations_invited_by_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as unknown as InviteRow[]
    },
  })

  const outbox = useQuery({
    queryKey: ['admin', 'courriels'],
    enabled: tab === 'courriels',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_outbox')
        .select('id, template, to_email, status, subject, body_text, error, created_at')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as OutboxRow[]
    },
  })
  const mail = useQuery({ queryKey: ['etat-courriels'], queryFn: emailStatus, staleTime: 60_000, retry: false })

  const all = rows.data ?? []
  const pending = all.filter((r) => r.status !== 'active')
  const active = all.filter((r) => r.status === 'active')
  const paidInvoices = all.flatMap((r) => r.invoices).filter((i) => i.status === 'paid')
  const isSimulated = (i: Row['invoices'][number]) => !!i.payments?.some((p) => p.provider === 'simulation')
  const collected = paidInvoices.filter((i) => !isSimulated(i)).reduce((s, i) => s + i.total_cents, 0)
  const simulatedTotal = paidInvoices.filter(isSimulated).reduce((s, i) => s + i.total_cents, 0)
  const reload = () => qc.invalidateQueries({ queryKey: ['admin'] })

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setCreated(null)
    try {
      const token = await rpc<string>('create_invitation', { p_email: email, p_message: message })
      let sent: InvitationSent | null = null
      let sendError: string | null = null
      try {
        sent = await sendInvitationEmail(token)
      } catch (err) {
        sendError = (err as Error).message
      }
      setCreated({ token, email: email.trim(), sent, sendError })
      setEmail('')
      setMessage('')
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <>
      <PageHeader title="Administration" lead="Les demandes d'adhésion à traiter, les membres en règle et les invitations envoyées." />

      {ctx?.payment_mode === 'simulation' && (
        <div className="mb-6">
          <Notice tone="warn" title="Paiement par carte en mode simulation">
            Aucun argent n'est encaissé par carte tant qu'un fournisseur de paiement n'est pas branché. Les paiements simulés sont signalés sur chaque demande
            {simulatedTotal > 0 ? ` et totalisent ${money(simulatedTotal)}, exclus des cotisations encaissées` : ''}.
          </Notice>
        </div>
      )}

      <dl className="mb-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {[
          ['Demandes à traiter', String(pending.length)],
          ['Membres en règle', String(active.length)],
          ['Cotisations encaissées', money(collected)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-5 py-4">
            <dt className="text-sm text-ink-3">{k}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-6 flex gap-1 border-b border-line" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setParams({ onglet: id }, { replace: true })}
            className={cx(
              '-mb-px cursor-pointer border-b-2 px-3 py-2.5 text-[15px]',
              tab === id ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'demandes' &&
        (pending.length === 0 ? (
          <p className="text-ink-3">Aucune demande en attente. Les nouvelles demandes d'adhésion apparaîtront ici.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {pending.map((r) => (
              <Request key={r.id} row={r} me={me} onDone={reload} />
            ))}
          </div>
        ))}

      {tab === 'membres' &&
        (active.length === 0 ? (
          <p className="text-ink-3">Aucun membre en règle pour l'instant. Une adhésion payée et approuvée apparaît ici.</p>
        ) : (
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[15px]">
              <thead className="border-b border-line text-sm text-ink-3">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Organisation</th>
                  <th className="px-5 py-2.5 font-medium">Catégorie</th>
                  <th className="px-5 py-2.5 font-medium">Vote</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cotisation</th>
                  <th className="px-5 py-2.5 font-medium">Échéance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {active.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium">{r.organizations?.name}</p>
                      <p className="text-sm text-ink-3">{r.submitter?.email}</p>
                    </td>
                    <td className="px-5 py-3 text-ink-2">{r.membership_tiers?.label}</td>
                    <td className="px-5 py-3 text-ink-2">{r.membership_tiers?.has_vote ? 'Oui' : 'Non'}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{money(r.price_cents)}</td>
                    <td className="px-5 py-3 text-ink-2">{longDate(r.ends_on)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ))}

      {tab === 'invitations' && (
        <div className="flex flex-col gap-6">
          <Panel className="p-5">
            <form onSubmit={invite} className="flex flex-col gap-4">
              <p className="text-lg font-semibold">Inviter quelqu'un sur le portail</p>
              <Field label="Courriel" htmlFor="adm-invite" error={error}>
                <Input id="adm-invite" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="personne@organisation.ca" />
              </Field>
              <Field label="Mot d'accompagnement" htmlFor="adm-message" optional hint="Affiché sur la page d'invitation.">
                <Textarea id="adm-message" value={message} onChange={(e) => setMessage(e.target.value)} />
              </Field>
              <div>
                <Button type="submit" loading={busy}>
                  Envoyer l'invitation
                </Button>
              </div>
            </form>
          </Panel>
          {created && <InviteLink token={created.token} email={created.email} sent={created.sent} sendError={created.sendError} />}

          {(invites.data ?? []).length === 0 ? (
            <p className="text-ink-3">Aucune invitation envoyée pour l'instant.</p>
          ) : (
            <Panel className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[15px]">
                <thead className="border-b border-line text-sm text-ink-3">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Courriel</th>
                    <th className="px-5 py-2.5 font-medium">Pour</th>
                    <th className="px-5 py-2.5 font-medium">Invité par</th>
                    <th className="px-5 py-2.5 font-medium">Date</th>
                    <th className="px-5 py-2.5 font-medium">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {invites.data!.map((i) => (
                    <tr key={i.id}>
                      <td className="px-5 py-3 font-medium">{i.email}</td>
                      <td className="px-5 py-3 text-ink-2">{i.organizations?.name ?? 'Le portail'}</td>
                      <td className="px-5 py-3 text-ink-2">{i.inviter?.full_name ?? ''}</td>
                      <td className="px-5 py-3 text-ink-2">{longDate(i.created_at)}</td>
                      <td className="px-5 py-3">{inviteState(i)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}
      {tab === 'courriels' && (
        <div className="flex flex-col gap-4">
          {mail.data?.mode === 'simulation' && (
            <Notice tone="warn" title="Envoi de courriels en mode simulation">
              Aucun service d'envoi n'est branché. Les courriels ci-dessous ont été rédigés, mais aucun n'est parti.
            </Notice>
          )}
          {(outbox.data ?? []).length === 0 ? (
            <p className="text-ink-3">Aucun courriel pour l'instant. Reçus, confirmations et invitations apparaîtront ici.</p>
          ) : (
            <Panel>
              <ul className="divide-y divide-line">
                {outbox.data!.map((c) => (
                  <li key={c.id}>
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.subject ?? TEMPLATE_LABEL[c.template] ?? c.template}</span>
                          <span className="block truncate text-sm text-ink-3">
                            {c.to_email}, {longDate(c.created_at)}
                          </span>
                        </span>
                        {mailState(c.status)}
                      </summary>
                      <pre className="overflow-x-auto border-t border-line bg-page px-5 py-4 font-sans text-sm whitespace-pre-wrap text-ink-2">
                        {c.error ? `Erreur : ${c.error}\n\n` : ''}
                        {c.body_text ?? "Ce courriel n'a pas encore été rédigé."}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </>
  )
}
