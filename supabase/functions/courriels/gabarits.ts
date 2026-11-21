// Gabarits des courriels du portail. Un gabarit reçoit des données déjà choisies par la base
// (aucun renseignement sensible) et rend un objet, un texte brut et une version HTML.

export interface Courriel {
  subject: string
  text: string
  html: string
}

type Donnees = Record<string, unknown>

const ORGANISME = 'Données Souveraines Québec'
const PIED = `${ORGANISME}, Montréal (Québec), Canada. go@donneessouveraines.quebec`

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const argent = (cents: unknown) =>
  new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: Number(cents) % 100 === 0 ? 0 : 2 }).format(
    Number(cents ?? 0) / 100,
  )

const jour = (iso: unknown) =>
  iso ? new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)) : ''

interface Contenu {
  subject: string
  titre: string
  /** Paragraphes en texte brut. Ils sont échappés pour la version HTML. */
  lignes: string[]
  /** Citation facultative (mot d'accompagnement d'une invitation). */
  citation?: string
  bouton?: { libelle: string; url: string }
  /** Mention ajoutée au pied, avec un lien. */
  retrait?: { libelle: string; url: string }
}

function assembler(c: Contenu): Courriel {
  const text = [
    c.titre,
    '',
    ...c.lignes,
    ...(c.citation ? ['', `« ${c.citation} »`] : []),
    ...(c.bouton ? ['', `${c.bouton.libelle} : ${c.bouton.url}`] : []),
    '',
    '--',
    PIED,
    ...(c.retrait ? [`${c.retrait.libelle} : ${c.retrait.url}`] : []),
  ].join('\n')

  const p = 'margin:0 0 14px;font-size:15px;line-height:1.55;color:#44506b'
  const html = `<!doctype html>
<html lang="fr-CA"><body style="margin:0;background:#f6f8fb;padding:32px 16px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#0d1c3f">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-size:14px;font-weight:600;color:#0d1c3f">${ORGANISME}</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;color:#0d1c3f">${esc(c.titre)}</h1>
${c.lignes.map((l) => `<p style="${p}">${esc(l)}</p>`).join('\n')}
${c.citation ? `<p style="${p};border-left:2px solid #0a7a80;padding-left:14px">${esc(c.citation)}</p>` : ''}
${c.bouton ? `<p style="margin:22px 0 0"><a href="${esc(c.bouton.url)}" style="display:inline-block;background:#0d1c3f;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:11px 18px;border-radius:8px">${esc(c.bouton.libelle)}</a></p>` : ''}
<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;line-height:1.5;color:#69748e">${esc(PIED)}${
    c.retrait ? `<br><a href="${esc(c.retrait.url)}" style="color:#69748e">${esc(c.retrait.libelle)}</a>` : ''
  }</p>
</div>
</body></html>`

  return { subject: c.subject, text, html }
}

/** Rend le courriel d'un gabarit. `site` est l'adresse du portail, sans barre finale. */
export function rediger(gabarit: string, d: Donnees, site: string): Courriel {
  const org = String(d.org_name ?? 'votre organisation')
  const total = argent(d.total_cents)

  switch (gabarit) {
    case 'paiement_recu':
      return assembler({
        subject: `Paiement reçu pour l'adhésion de ${org}`,
        titre: 'Nous avons bien reçu votre paiement',
        lignes: [
          `${total} pour : ${d.tier_label}.`,
          `Le conseil d'administration confirme maintenant l'adhésion de ${org}. Vous n'avez rien d'autre à faire, et vous avez déjà accès à l'espace des membres.`,
        ],
        bouton: d.invoice_id ? { libelle: 'Voir le reçu', url: `${site}/facture/${d.invoice_id}` } : undefined,
      })

    case 'adhesion_confirmee':
      return assembler({
        subject: `${org} est membre de ${ORGANISME}`,
        titre: 'Votre adhésion est confirmée',
        lignes: [
          `Le conseil d'administration a confirmé l'adhésion de ${org}. Elle est valide jusqu'au ${jour(d.ends_on)}.`,
          d.has_vote ? "Votre organisation dispose d'un droit de vote à l'assemblée générale, porté par son délégué votant." : 'Bienvenue parmi nous.',
          'Invitez vos collègues depuis Mon organisation pour qu’ils profitent eux aussi de l’espace des membres.',
        ],
        bouton: { libelle: 'Ouvrir mon espace', url: `${site}/` },
      })

    case 'adhesion_refusee':
      return assembler({
        subject: `Votre demande d'adhésion à ${ORGANISME}`,
        titre: "Votre demande d'adhésion n'a pas été retenue",
        lignes: [
          `Le conseil d'administration n'a pas retenu la demande d'adhésion de ${org}.`,
          ...(d.refusal_reason ? [`Motif indiqué : ${d.refusal_reason}`] : []),
          "Si un paiement a été versé, l'équipe communiquera avec vous pour le remboursement. Pour en discuter, écrivez à go@donneessouveraines.quebec.",
        ],
      })

    case 'facture_a_regler':
      return assembler({
        subject: `Votre facture ${d.invoice_number} de ${total}`,
        titre: 'Votre demande est enregistrée',
        lignes: [
          `Il reste à régler la facture ${d.invoice_number} de ${total} pour l'adhésion de ${org}.`,
          `Payez par virement ou par chèque en indiquant ce numéro. L'équipe de ${ORGANISME} vous transmet ses coordonnées de paiement.`,
          'Votre demande passe au conseil d’administration dès la réception du paiement.',
        ],
        bouton: d.invoice_id ? { libelle: 'Voir la facture', url: `${site}/facture/${d.invoice_id}` } : undefined,
      })

    case 'demande_a_traiter':
      return d.attente_virement
        ? assembler({
            subject: `Paiement attendu : ${org}`,
            titre: 'Une adhésion attend son paiement',
            lignes: [
              `${org} a choisi de régler par virement ou par chèque la facture ${d.invoice_number} de ${total} (${d.tier_label}).`,
              'Confirmez le paiement dans l’administration dès sa réception.',
            ],
            bouton: { libelle: "Ouvrir l'administration", url: `${site}/admin` },
          })
        : assembler({
            subject: `Demande d'adhésion à approuver : ${org}`,
            titre: "Une demande d'adhésion attend votre approbation",
            lignes: [`${org} a payé ${total} (${d.tier_label}). La demande attend la confirmation du conseil d'administration.`],
            bouton: { libelle: "Ouvrir l'administration", url: `${site}/admin` },
          })

    case 'invitation': {
      const qui = d.inviter_name ? String(d.inviter_name) : ORGANISME
      const vers = d.org_name ? `rejoindre ${d.org_name} sur le portail de ${ORGANISME}` : `entrer sur le portail des membres de ${ORGANISME}`
      return assembler({
        subject: d.org_name ? `${qui} vous invite à rejoindre ${d.org_name}` : `Vous êtes invité sur le portail de ${ORGANISME}`,
        titre: `${qui} vous invite`,
        lignes: [
          `Vous êtes invité à ${vers}.`,
          "L'accès est gratuit et ne demande aucun mot de passe : le bouton ci-dessous vous connecte directement. S'il a expiré, la page vous enverra un nouveau lien.",
        ],
        citation: d.message ? String(d.message) : undefined,
        bouton: { libelle: "Accepter l'invitation", url: String(d.link) },
        retrait: { libelle: "Ne plus recevoir d'invitations", url: String(d.decline) },
      })
    }

    default:
      throw new Error(`gabarit inconnu : ${gabarit}`)
  }
}
