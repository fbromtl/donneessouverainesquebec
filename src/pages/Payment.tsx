import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CircleCheck, Lock, Printer } from 'lucide-react'
import { kickEmails } from '../lib/courriels'
import { useSession } from '../lib/session'
import { rpc, supabase } from '../lib/supabase'
import { longDate, money, type Invoice } from '../lib/types'
import { Badge, Button, Field, Input, Notice, PageHeader, Panel, Splash, Wordmark } from '../ui'

type InvoiceWithOrg = Invoice & { organizations: { name: string; city: string | null } | null }

function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ['facture', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices').select('*, organizations(name, city)').eq('id', id!).maybeSingle()
      if (error) throw error
      return data as InvoiceWithOrg | null
    },
  })
}

function Lines({ inv }: { inv: Invoice }) {
  return (
    <dl className="flex flex-col gap-2 text-[15px]">
      <div className="flex justify-between gap-4">
        <dt className="text-ink-2">{inv.description}</dt>
        <dd className="tabular-nums">{money(inv.subtotal_cents)}</dd>
      </div>
      {inv.gst_cents > 0 && (
        <div className="flex justify-between gap-4 text-ink-2">
          <dt>TPS</dt>
          <dd className="tabular-nums">{money(inv.gst_cents)}</dd>
        </div>
      )}
      {inv.qst_cents > 0 && (
        <div className="flex justify-between gap-4 text-ink-2">
          <dt>TVQ</dt>
          <dd className="tabular-nums">{money(inv.qst_cents)}</dd>
        </div>
      )}
      <div className="mt-2 flex justify-between gap-4 border-t border-line pt-3 font-semibold">
        <dt>Total</dt>
        <dd className="tabular-nums">{money(inv.total_cents)}</dd>
      </div>
    </dl>
  )
}

/**
 * Guichet de paiement simulé.
 * Il tient la place du fournisseur de paiement québécois à venir : même parcours, aucune carte débitée.
 * Les champs de carte sont en lecture seule pour que personne n'y saisisse une vraie carte.
 */
export function Checkout() {
  const { invoiceId } = useParams()
  const { refresh, ctx } = useSession()
  const navigate = useNavigate()
  const q = useInvoice(invoiceId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (q.isLoading) return <Splash />
  const inv = q.data
  if (!inv) return <Navigate to="/" replace />
  if (inv.status === 'paid') return <Navigate to="/adhesion/merci" replace />

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      await new Promise((r) => setTimeout(r, 900))
      await rpc('pay_invoice_simulated', { p_invoice: inv!.id })
      kickEmails()
      await refresh()
      navigate('/adhesion/merci', { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <div className="flex flex-col px-5 py-6 sm:px-10 lg:px-16 lg:py-10">
        <Link to="/" className="flex w-fit items-center gap-2 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          Revenir au portail
        </Link>
        <div className="mt-8 lg:mt-16 lg:max-w-[400px]">
          <Wordmark />
          <p className="mt-8 text-ink-2">Payer la facture {inv.number}</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">{money(inv.total_cents)}</p>
          <div className="mt-8">
            <Lines inv={inv} />
          </div>
          <p className="mt-6 text-sm text-ink-3">{inv.organizations?.name}</p>
        </div>
      </div>

      <div className="border-line bg-surface px-5 py-8 sm:px-10 lg:border-l lg:px-16 lg:py-10">
        <div className="lg:mt-24 lg:max-w-[420px]">
          <Notice tone="warn" title="Paiement simulé">
            Aucune carte n'est débitée. Cet écran tient la place du fournisseur de paiement québécois qui sera branché ici.
          </Notice>

          <h1 className="mt-7 text-xl font-semibold">Payer par carte</h1>
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Numéro de carte" htmlFor="carte" hint="Carte de test fournie par la simulation.">
              <Input id="carte" readOnly value="4242 4242 4242 4242" className="tabular-nums" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Expiration" htmlFor="exp">
                <Input id="exp" readOnly value="12 / 34" className="tabular-nums" />
              </Field>
              <Field label="Code de sécurité" htmlFor="cvc">
                <Input id="cvc" readOnly value="123" className="tabular-nums" />
              </Field>
            </div>
            <Field label="Nom sur la carte" htmlFor="titulaire">
              <Input id="titulaire" readOnly value={ctx?.profile?.full_name ?? ''} />
            </Field>
          </div>

          {error && (
            <div className="mt-4">
              <Notice tone="danger" title={error} />
            </div>
          )}

          <Button size="lg" className="mt-6 w-full" loading={busy} onClick={pay}>
            <Lock className="size-4" aria-hidden />
            {busy ? 'Traitement…' : `Payer ${money(inv.total_cents)}`}
          </Button>
          <p className="mt-4 text-sm text-ink-3">
            Vous préférez payer par virement ou par chèque ?{' '}
            <Link className="text-accent underline-offset-4 hover:underline" to={`/facture/${inv.id}`}>
              Voir la facture
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

/** Après le paiement ou la demande de facture : ce qui se passe maintenant. */
export function Thanks() {
  const { ctx } = useSession()
  const [params] = useSearchParams()
  const transfer = params.get('mode') === 'virement'
  const inv = ctx?.open_invoice
  const m = ctx?.membership
  if (!m) return <Navigate to="/" replace />

  const steps = transfer
    ? [
        ['Réglez la facture', `Par virement ou par chèque, en indiquant le numéro ${inv?.number ?? ''}. L'équipe de DSQ vous transmet ses coordonnées de paiement.`],
        ['DSQ confirme la réception', 'Votre demande passe alors au conseil d’administration.'],
        ['Le conseil confirme votre adhésion', 'Votre statut se met à jour ici, sur votre page d’accueil.'],
      ]
    : [
        ['Le conseil d’administration confirme votre adhésion', 'Votre statut se met à jour ici, sur votre page d’accueil.'],
        ['Invitez vos collègues', 'Depuis Mon organisation, pour qu’ils profitent eux aussi de l’espace des membres.'],
        ['Gardez votre reçu', 'Il reste disponible en tout temps dans Mon organisation.'],
      ]

  return (
    <div className="mx-auto max-w-[620px]">
      <span className="flex size-12 items-center justify-center rounded-full bg-ok-soft text-ok">
        <CircleCheck className="size-7" aria-hidden />
      </span>
      <h1 className="mt-5 text-[28px] leading-tight font-semibold">
        {transfer ? 'Votre demande est enregistrée' : m.status === 'active' ? 'Vous êtes membre. Bienvenue !' : 'Paiement reçu. Bienvenue !'}
      </h1>
      <p className="mt-2 text-ink-2">
        {transfer
          ? `Votre facture est prête. Il ne reste qu'à la régler pour que ${ctx?.org?.name ?? 'votre adhésion'} avance.`
          : `Merci de rejoindre Données Souveraines Québec. Vous avez dès maintenant accès à l'espace des membres.`}
      </p>

      <ol className="mt-8 flex flex-col">
        {steps.map(([title, detail], i) => (
          <li key={title} className="flex gap-4 border-t border-line py-4 last:border-b">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-[13px] font-semibold text-ink-2 tabular-nums">
              {i + 1}
            </span>
            <div>
              <p className="font-medium">{title}</p>
              <p className="text-sm text-ink-3">{detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-wrap gap-2">
        {transfer && inv ? (
          <Link to={`/facture/${inv.id}`}>
            <Button>Voir la facture</Button>
          </Link>
        ) : (
          <Link to="/organisation">
            <Button>Inviter mes collègues</Button>
          </Link>
        )}
        <Link to="/">
          <Button variant="secondary">Aller à l'accueil</Button>
        </Link>
      </div>
    </div>
  )
}

/** Facture ou reçu, imprimable. */
export function InvoiceView() {
  const { invoiceId } = useParams()
  const q = useInvoice(invoiceId)
  if (q.isLoading) return <Splash />
  const inv = q.data
  if (!inv) return <Navigate to="/" replace />
  const paid = inv.status === 'paid'

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={paid ? 'Reçu' : 'Facture'}
          actions={
            <>
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden />
                Imprimer ou enregistrer en PDF
              </Button>
              {inv.status === 'open' && (
                <Link to={`/paiement/${inv.id}`}>
                  <Button>Payer par carte</Button>
                </Link>
              )}
            </>
          }
        />
      </div>
      <Panel className="max-w-[720px] p-8 sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <Wordmark />
          <div className="text-right">
            <p className="text-lg font-semibold">{paid ? 'Reçu' : 'Facture'} {inv.number}</p>
            <p className="text-sm text-ink-3">Émise le {longDate(inv.issued_at)}</p>
            <div className="mt-2">
              {paid ? <Badge tone="ok">Payée le {longDate(inv.paid_at)}</Badge> : inv.status === 'void' ? <Badge>Annulée</Badge> : <Badge tone="warn">À payer</Badge>}
            </div>
          </div>
        </div>

        <div className="mt-10">
          <p className="text-sm text-ink-3">Facturé à</p>
          <p className="font-medium">{inv.organizations?.name}</p>
          {inv.organizations?.city && <p className="text-ink-2">{inv.organizations.city}</p>}
        </div>

        <div className="mt-8 border-t border-line pt-6">
          <Lines inv={inv} />
        </div>

        {inv.status === 'open' && (
          <p className="mt-8 text-sm text-ink-2">
            Pour payer par virement ou par chèque, indiquez le numéro {inv.number}. L'équipe de Données Souveraines Québec vous transmet ses
            coordonnées de paiement : go@donneessouveraines.quebec.
          </p>
        )}
        <p className="mt-8 text-sm text-ink-3">Données Souveraines Québec, Montréal (Québec), Canada</p>
      </Panel>
    </>
  )
}
