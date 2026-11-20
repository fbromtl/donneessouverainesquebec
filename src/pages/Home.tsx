import { Link } from 'react-router-dom'
import { ArrowUpRight, BadgeCheck, Check, Lock } from 'lucide-react'
import { useSession } from '../lib/session'
import { firstName, longDate, money } from '../lib/types'
import { Badge, Button, Notice, PageHeader, Panel } from '../ui'

const SITE = 'https://www.donneessouveraines.quebec'
const OPEN = [
  { title: 'Manifeste pour la souveraineté des données', detail: 'Les quatre piliers de notre plan.', href: `${SITE}/manifeste` },
  { title: "Feuille de route : l'émancipation numérique du Québec", detail: '42 pages, rédigées par six comités.', href: `${SITE}/feuille-de-route` },
  { title: 'Votre Indice de Souveraineté Numérique', detail: 'Un score sur 100 en 10 à 15 minutes.', href: `${SITE}/sondage` },
  { title: 'Événements à venir', detail: 'Forum, assemblée, rencontres de réseautage.', href: `${SITE}/evenements` },
]
const MEMBER = [
  { title: 'Rabais de 40 % au Forum DSQ', detail: "Sur le tarif d'admission, pour les membres en règle." },
  { title: 'Comités de travail', detail: 'Contribuez aux positions et aux outils produits par DSQ.' },
  { title: "Droit de vote à l'assemblée générale", detail: 'Pour les membres corporatifs : une organisation, une voix.' },
  { title: 'Votre organisation parmi les membres', detail: 'Affichée sur le site de DSQ, si vous le souhaitez.' },
]

/** La prochaine chose à faire, selon où en est l'adhésion. Une seule action principale. */
function NextStep() {
  const { ctx } = useSession()
  const m = ctx?.membership
  const inv = ctx?.open_invoice
  const isAdmin = !ctx?.org || ctx.org.my_role === 'admin'

  if (m?.status === 'active') {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-5 p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-seal-soft text-seal">
            <BadgeCheck className="size-6" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold">{ctx?.org?.name} est membre en règle</p>
            <p className="mt-0.5 text-ink-2">
              {m.tier.label}, jusqu'au {longDate(m.ends_on)}.{m.tier.has_vote ? ' Avec droit de vote.' : ''}
            </p>
          </div>
        </div>
        <Link to="/organisation">
          <Button variant="secondary">Voir mon organisation</Button>
        </Link>
      </Panel>
    )
  }

  if (m?.status === 'pending_approval') {
    return (
      <Notice tone="ok" title="Paiement reçu. Le conseil d'administration confirme maintenant votre adhésion.">
        Rien d'autre à faire de votre côté. Vous avez déjà accès à l'espace des membres, et votre statut se mettra à jour ici.
      </Notice>
    )
  }

  if (m?.status === 'pending_payment') {
    if (!isAdmin) {
      return (
        <Notice tone="warn" title="L'adhésion de votre organisation attend son paiement.">
          L'administrateur du compte de {ctx?.org?.name} peut le régler depuis son espace.
        </Notice>
      )
    }
    const transfer = inv?.payment_method === 'transfer'
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-5 p-6">
        <div>
          <p className="text-lg font-semibold">{transfer ? 'Nous attendons votre paiement' : 'Il reste une étape : le paiement'}</p>
          <p className="mt-0.5 text-ink-2">
            {transfer
              ? `Facture ${inv?.number} de ${money(inv?.total_cents ?? 0)}, à régler par virement ou par chèque.`
              : `${m.tier.label}, ${money(inv?.total_cents ?? m.price_cents)}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {inv && transfer && (
            <Link to={`/facture/${inv.id}`}>
              <Button variant="secondary">Voir la facture</Button>
            </Link>
          )}
          {inv && (
            <Link to={`/paiement/${inv.id}`}>
              <Button>{transfer ? 'Payer par carte' : `Payer ${money(inv.total_cents)}`}</Button>
            </Link>
          )}
        </div>
      </Panel>
    )
  }

  if (m?.status === 'refused') {
    return (
      <Notice tone="danger" title="Votre demande d'adhésion n'a pas été acceptée.">
        {m.refusal_reason ? `Motif indiqué : ${m.refusal_reason}. ` : ''}Pour en discuter, écrivez à go@donneessouveraines.quebec.
      </Notice>
    )
  }

  if (!isAdmin) {
    return (
      <Notice title={`${ctx?.org?.name} n'a pas encore d'adhésion.`}>
        L'administrateur du compte de votre organisation peut la compléter en quelques minutes.
      </Notice>
    )
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-6 p-6 sm:p-8">
        <div className="max-w-[46ch]">
          <p className="text-xl font-semibold">Devenez membre de Données Souveraines Québec</p>
          <p className="mt-1.5 text-ink-2">
            Trois étapes, environ trois minutes. Votre tarif s'affiche dès la première, bien avant de payer.
          </p>
        </div>
        <Link to="/adhesion">
          <Button size="lg">Adhérer</Button>
        </Link>
      </div>
      <dl className="grid grid-cols-1 border-t border-line text-sm sm:grid-cols-3">
        {[
          ['Individu', '75 $ par an'],
          ['Entreprise du Québec', '400 $ à 4 000 $ par an, selon la taille'],
          ['Organisme ou institution', '750 $ par an'],
        ].map(([k, v]) => (
          <div key={k} className="border-line px-6 py-4 not-last:border-b sm:not-last:border-r sm:not-last:border-b-0 sm:px-8">
            <dt className="text-ink-3">{k}</dt>
            <dd className="mt-0.5 font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

export default function Home() {
  const { ctx, access } = useSession()
  const name = firstName(ctx?.profile?.full_name)
  const member = access !== 'invite'

  return (
    <>
      <PageHeader
        title={name ? `Bonjour ${name}` : 'Bonjour'}
        lead={member ? 'Voici où en est votre adhésion et ce qui vous est ouvert.' : "Vous êtes ici comme invité. Tout ce qui suit est gratuit, sauf mention contraire."}
      />
      <NextStep />

      <div className="mt-10 grid gap-10 xl:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold">Ouvert à tous</h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {OPEN.map((r) => (
              <li key={r.href}>
                <a href={r.href} target="_blank" rel="noreferrer" className="group flex items-start justify-between gap-4 py-3.5">
                  <span>
                    <span className="block font-medium text-ink group-hover:text-accent-ink">{r.title}</span>
                    <span className="block text-sm text-ink-3">{r.detail}</span>
                  </span>
                  <ArrowUpRight className="mt-1 size-4 shrink-0 text-ink-3 group-hover:text-accent-ink" aria-label="Ouvre le site de DSQ" />
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Ce que l'adhésion vous donne</h2>
            {member ? <Badge tone="ok">Inclus pour vous</Badge> : <Badge>Réservé aux membres</Badge>}
          </div>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {MEMBER.map((r) => (
              <li key={r.title} className="flex items-start gap-3 py-3.5">
                {member ? (
                  <Check className="mt-1 size-4 shrink-0 text-ok" aria-label="Inclus" />
                ) : (
                  <Lock className="mt-1 size-4 shrink-0 text-ink-3" aria-label="Réservé aux membres" />
                )}
                <span>
                  <span className="block font-medium text-ink">{r.title}</span>
                  <span className="block text-sm text-ink-3">{r.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
