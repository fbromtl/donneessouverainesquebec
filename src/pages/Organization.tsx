import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { useSession } from '../lib/session'
import { rpc, supabase } from '../lib/supabase'
import { KIND_LABEL, longDate, money, type Invoice } from '../lib/types'
import { Badge, Button, Field, Input, Notice, PageHeader, Panel, StatusBadge } from '../ui'

interface MemberRow {
  user_id: string
  role: 'admin' | 'member'
  is_voting_delegate: boolean
  profiles: { full_name: string | null; email: string; job_title: string | null } | null
}
interface InviteRow {
  id: string
  email: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
}

/** Lien d'invitation à copier. Le jeton n'existe en clair qu'ici, une seule fois. */
export function InviteLink({ token, email }: { token: string; email: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/invitation/${token}`
  return (
    <Notice tone="ok" title={`Invitation créée pour ${email}`}>
      <p>Copiez ce lien et envoyez-le-lui. Il n'est affiché qu'une fois et reste valide 30 jours.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 text-sm" aria-label="Lien d'invitation" />
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url)
              setCopied(true)
              setTimeout(() => setCopied(false), 1800)
            } catch {
              /* le champ reste sélectionnable à la main */
            }
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'Copié' : 'Copier'}
        </Button>
      </div>
    </Notice>
  )
}

export function inviteState(i: { accepted_at: string | null; revoked_at: string | null; expires_at: string }) {
  if (i.accepted_at) return <Badge tone="ok">Acceptée</Badge>
  if (i.revoked_at) return <Badge>Annulée</Badge>
  if (new Date(i.expires_at) < new Date()) return <Badge>Expirée</Badge>
  return <Badge tone="accent">En attente</Badge>
}

export default function Organization() {
  const { ctx, refresh } = useSession()
  const qc = useQueryClient()
  const org = ctx?.org
  const m = ctx?.membership
  const admin = org?.my_role === 'admin'
  const canInvite = admin && (m?.status === 'pending_approval' || m?.status === 'active')
  const [leaving, setLeaving] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ token: string; email: string } | null>(null)

  const members = useQuery({
    queryKey: ['org', org?.id, 'equipe'],
    enabled: !!org,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_members')
        .select('user_id, role, is_voting_delegate, profiles(full_name, email, job_title)')
        .eq('org_id', org!.id)
        .order('created_at')
      if (error) throw error
      return data as unknown as MemberRow[]
    },
  })
  const invoices = useQuery({
    queryKey: ['org', org?.id, 'factures'],
    enabled: !!org && admin,
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices').select('*').eq('org_id', org!.id).order('issued_at', { ascending: false })
      if (error) throw error
      return data as Invoice[]
    },
  })
  const invites = useQuery({
    queryKey: ['org', org?.id, 'invitations'],
    enabled: !!org && admin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('id, email, created_at, expires_at, accepted_at, revoked_at')
        .eq('org_id', org!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as InviteRow[]
    },
  })

  if (!org) return <Navigate to="/adhesion" replace />

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setCreated(null)
    try {
      const token = await rpc<string>('create_invitation', { p_email: email, p_org: org!.id })
      setCreated({ token, email: email.trim() })
      setEmail('')
      await qc.invalidateQueries({ queryKey: ['org', org!.id, 'invitations'] })
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  async function setDelegate(userId: string) {
    try {
      await rpc('org_set_delegate', { p_org: org!.id, p_user: userId })
      await Promise.all([members.refetch(), refresh()])
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <PageHeader title={org.name} lead={[KIND_LABEL[org.kind], org.city].filter(Boolean).join(', ')} />

      <div className="flex flex-col gap-10">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Adhésion</h2>
          {m ? (
            <Panel className="grid gap-x-8 gap-y-5 p-6 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-sm text-ink-3">Statut</p>
                <div className="mt-1">
                  <StatusBadge status={m.status} />
                </div>
              </div>
              <div>
                <p className="text-sm text-ink-3">Catégorie</p>
                <p className="mt-1 font-medium">{m.tier.label}</p>
              </div>
              <div>
                <p className="text-sm text-ink-3">Cotisation annuelle</p>
                <p className="mt-1 font-medium tabular-nums">{money(m.price_cents)}</p>
              </div>
              <div>
                <p className="text-sm text-ink-3">{m.ends_on ? 'Valide jusqu’au' : 'Déposée le'}</p>
                <p className="mt-1 font-medium">{longDate(m.ends_on ?? m.submitted_at)}</p>
              </div>
            </Panel>
          ) : (
            <Notice title="Aucune adhésion pour l'instant.">
              {admin ? (
                <Link className="text-accent underline-offset-4 hover:underline" to="/adhesion">
                  Compléter l'adhésion
                </Link>
              ) : (
                "L'administrateur du compte peut la compléter."
              )}
            </Notice>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold">Équipe</h2>
          <p className="mt-1 mb-3 text-ink-2">
            Les personnes rattachées à {org.name} profitent de l'espace des membres.
            {m?.tier.has_vote ? " Le délégué votant porte la voix de l'organisation à l'assemblée." : ''}
          </p>
          <Panel>
            <ul className="divide-y divide-line">
              {(members.data ?? []).map((p) => (
                <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.profiles?.full_name || p.profiles?.email}</p>
                    <p className="truncate text-sm text-ink-3">{[p.profiles?.job_title, p.profiles?.email].filter(Boolean).join(', ')}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {p.role === 'admin' && <Badge>Administrateur du compte</Badge>}
                    {p.is_voting_delegate && <Badge tone="seal">Délégué votant</Badge>}
                    {admin && m?.tier.has_vote && !p.is_voting_delegate && (
                      <Button size="sm" variant="quiet" onClick={() => setDelegate(p.user_id)}>
                        Désigner comme délégué
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          {admin && !canInvite && <p className="mt-4 text-sm text-ink-3">Vous pourrez inviter vos collègues dès que l'adhésion sera payée.</p>}
          {canInvite && (
            <div className="mt-5 flex flex-col gap-4">
              <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1">
                  <Field label="Inviter un collègue" htmlFor="invite" error={error}>
                    <Input id="invite" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="collegue@organisation.ca" />
                  </Field>
                </div>
                <Button type="submit" variant="secondary" loading={busy}>
                  Créer l'invitation
                </Button>
              </form>
              {created && <InviteLink token={created.token} email={created.email} />}
              {(invites.data ?? []).length > 0 && (
                <ul className="divide-y divide-line border-y border-line text-[15px]">
                  {invites.data!.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0 truncate">{i.email}</span>
                      <span className="flex items-center gap-3 text-sm text-ink-3">
                        Invité le {longDate(i.created_at)}
                        {inviteState(i)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {admin && (
          <section>
            <h2 className="mb-3 text-lg font-semibold">Factures et reçus</h2>
            {(invoices.data ?? []).length === 0 ? (
              <p className="text-ink-3">Vos factures apparaîtront ici après le dépôt de votre adhésion.</p>
            ) : (
              <Panel className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-[15px]">
                  <thead className="border-b border-line text-sm text-ink-3">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Numéro</th>
                      <th className="px-5 py-2.5 font-medium">Date</th>
                      <th className="px-5 py-2.5 text-right font-medium">Total</th>
                      <th className="px-5 py-2.5 font-medium">État</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {invoices.data!.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-5 py-3 font-medium tabular-nums">{inv.number}</td>
                        <td className="px-5 py-3 text-ink-2">{longDate(inv.issued_at)}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{money(inv.total_cents)}</td>
                        <td className="px-5 py-3">
                          {inv.status === 'paid' ? <Badge tone="ok">Payée</Badge> : inv.status === 'void' ? <Badge>Annulée</Badge> : <Badge tone="warn">À payer</Badge>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link className="text-accent underline-offset-4 hover:underline" to={`/facture/${inv.id}`}>
                            {inv.status === 'paid' ? 'Reçu' : 'Ouvrir'}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )}
          </section>
        )}

        {!admin && (
          <section>
            <h2 className="mb-1 text-lg font-semibold">Quitter l'organisation</h2>
            <p className="mb-3 text-ink-2">Votre compte reste ouvert, comme invité. Vous pourrez rejoindre une autre organisation ou adhérer à votre nom.</p>
            {error && !admin && (
              <div className="mb-3">
                <Notice tone="danger" title={error} />
              </div>
            )}
            {leaving ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  onClick={async () => {
                    try {
                      await rpc('leave_org')
                      await refresh()
                    } catch (err) {
                      setError((err as Error).message)
                      setLeaving(false)
                    }
                  }}
                >
                  Oui, quitter {org.name}
                </Button>
                <Button variant="quiet" onClick={() => setLeaving(false)}>
                  Annuler
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setLeaving(true)}>
                Quitter {org.name}
              </Button>
            )}
          </section>
        )}
      </div>
    </>
  )
}
