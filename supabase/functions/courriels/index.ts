// Fonction d'envoi des courriels du portail.
//
// Trois actions, toutes réservées à une personne connectée :
//   etat        indique si un fournisseur de courriel est branché ;
//   traiter     envoie ce que la base a mis en file (reçus, confirmations, refus…) ;
//   invitation  envoie le courriel d'une invitation, avec un lien qui connecte en un clic.
//
// L'envoi se fait par SMTP standard : n'importe quel fournisseur convient, et on en change en
// modifiant des secrets, pas du code. Sans secrets SMTP, la fonction est en « simulation » :
// elle rédige et consigne chaque courriel, mais rien ne part.
//
// Secrets attendus pour un envoi réel :
//   SMTP_HOST, SMTP_PORT (465 par défaut ; 25 et 587 sont bloqués par l'hébergeur de la fonction),
//   SMTP_USER, SMTP_PASS, EMAIL_FROM (ex. « Données Souveraines Québec <portail@exemple.quebec> »),
//   SITE_URL (adresse publique du portail, obligatoire dès qu'un courriel part réellement).

import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6'
import { rediger, type Courriel } from './gabarits.ts'

const SMTP = {
  host: Deno.env.get('SMTP_HOST'),
  port: Number(Deno.env.get('SMTP_PORT') ?? '465'),
  user: Deno.env.get('SMTP_USER'),
  pass: Deno.env.get('SMTP_PASS'),
  from: Deno.env.get('EMAIL_FROM'),
}
const MODE: 'smtp' | 'simulation' = SMTP.host && SMTP.user && SMTP.pass && SMTP.from ? 'smtp' : 'simulation'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Clé de service : nouveau format d'abord, ancien format tant qu'il existe. */
function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
    if (typeof keys?.default === 'string') return keys.default
  } catch {
    /* format inattendu : on essaie l'ancienne variable */
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!legacy) throw new Error('clé de service introuvable')
  return legacy
}

/**
 * Adresse du portail à mettre dans les liens.
 * On ne se fie à l'origine de l'appel qu'en simulation, quand rien ne part : sinon n'importe qui
 * pourrait faire envoyer par DSQ des courriels pointant vers un autre site.
 */
function siteFor(req: Request): string | null {
  const fixed = Deno.env.get('SITE_URL')?.replace(/\/+$/, '')
  if (fixed) return fixed
  if (MODE === 'simulation') {
    const origin = req.headers.get('origin')
    if (origin && /^https?:\/\/[^\s/]+$/.test(origin)) return origin
  }
  return null
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Les adresses de démonstration (.test) ne reçoivent jamais de vrai courriel.
const deliverable = (email: string) => MODE === 'smtp' && !/\.test$/i.test(email)

async function deliver(to: string, mail: Courriel): Promise<'sent' | 'simulated'> {
  if (!deliverable(to)) return 'simulated'
  const transport = nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass },
  })
  await transport.sendMail({ from: SMTP.from, to, subject: mail.subject, text: mail.text, html: mail.html })
  return 'sent'
}

/** Envoie ce que la base a mis en file. */
async function processQueue(admin: SupabaseClient, site: string) {
  const { data: rows, error } = await admin.rpc('claim_emails', { p_limit: 20 })
  if (error) throw error
  let done = 0
  for (const row of rows ?? []) {
    let mail: Courriel | null = null
    try {
      mail = rediger(row.template, row.payload ?? {}, site)
      const status = await deliver(row.to_email, mail)
      await admin
        .from('email_outbox')
        .update({ status, subject: mail.subject, body_text: mail.text, error: null, sent_at: new Date().toISOString() })
        .eq('id', row.id)
      done++
    } catch (e) {
      await admin
        .from('email_outbox')
        .update({ status: 'failed', subject: mail?.subject ?? null, body_text: mail?.text ?? null, error: String((e as Error).message ?? e).slice(0, 500) })
        .eq('id', row.id)
    }
  }
  return { mode: MODE, traites: done }
}

/** Fabrique un jeton qui connecte la personne invitée en un clic. Crée son compte s'il n'existe pas. */
async function loginToken(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const p = data?.properties
  if (error || !p?.hashed_token) return ''
  return `?jeton=${encodeURIComponent(p.hashed_token)}&genre=${encodeURIComponent(p.verification_type ?? 'magiclink')}`
}

async function sendInvitation(admin: SupabaseClient, user: User, token: string, site: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return json(400, { message: "Cette invitation n'est plus valide." })

  const { data: inv } = await admin
    .from('invitations')
    .select('id, email, message, invited_by, expires_at, accepted_at, revoked_at, organizations(name)')
    .eq('token_hash', await sha256(token))
    .maybeSingle()
  if (!inv || inv.accepted_at || inv.revoked_at || new Date(inv.expires_at) < new Date()) {
    return json(404, { message: "Cette invitation n'est plus valide." })
  }

  const { data: staff } = await admin.from('staff').select('user_id').eq('user_id', user.id).maybeSingle()
  if (inv.invited_by !== user.id && !staff) return json(403, { message: "Vous n'êtes pas l'auteur de cette invitation." })

  const { count } = await admin
    .from('email_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('template', 'invitation')
    .eq('payload->>invitation_id', inv.id)
  if ((count ?? 0) >= 3) return json(429, { message: 'Cette invitation a déjà été envoyée trois fois.' })

  const { data: inviter } = await admin.from('profiles').select('full_name').eq('id', inv.invited_by).maybeSingle()
  const org = (inv.organizations as { name?: string } | null)?.name ?? null

  // Le lien qui connecte ne quitte la fonction que dans le courriel lui-même. En simulation, seule
  // l'équipe de DSQ le reçoit à l'écran, pour pouvoir essayer ; les autres ont le lien simple.
  const real = deliverable(inv.email)
  const login = real || staff ? await loginToken(admin, inv.email) : ''
  const base = `${site}/invitation/${token}`
  const mail = rediger(
    'invitation',
    { org_name: org, inviter_name: inviter?.full_name ?? null, message: inv.message, link: base + login, decline: `${base}/refuser` },
    site,
  )

  let status: 'sent' | 'simulated' | 'failed' = 'simulated'
  let failure: string | null = null
  try {
    status = await deliver(inv.email, mail)
  } catch (e) {
    status = 'failed'
    failure = String((e as Error).message ?? e).slice(0, 500)
  }

  // On consigne le courriel sans ses jetons : ils ne doivent exister que chez le destinataire.
  const redacted = mail.text.split(base + login).join(`${site}/invitation/…`).split(base).join(`${site}/invitation/…`)
  await admin.from('email_outbox').insert({
    template: 'invitation',
    to_email: inv.email,
    payload: { invitation_id: inv.id, org_name: org },
    status,
    subject: mail.subject,
    body_text: redacted,
    error: failure,
    sent_at: status === 'failed' ? null : new Date().toISOString(),
  })

  if (status === 'failed') return json(502, { message: "Le service d'envoi a refusé le courriel." })
  return json(200, { mode: status === 'sent' ? 'smtp' : 'simulation', link: status === 'simulated' ? base + login : undefined })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { message: 'Méthode non permise.' })

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // La passerelle laisse passer un appel portant seulement la clé publique : on exige ici une vraie session.
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } }
    if (!data.user) return json(401, { message: 'Votre session a expiré. Reconnectez-vous.' })

    const body = await req.json().catch(() => ({}))
    if (body.action === 'etat') return json(200, { mode: MODE })

    const site = siteFor(req)
    if (!site) return json(500, { message: "L'adresse du portail (SITE_URL) n'est pas configurée." })

    if (body.action === 'traiter') return json(200, await processQueue(admin, site))
    if (body.action === 'invitation') return await sendInvitation(admin, data.user, String(body.token ?? ''), site)
    return json(400, { message: 'Action inconnue.' })
  } catch (e) {
    console.error('courriels', e)
    return json(500, { message: "Le courriel n'a pas pu être envoyé." })
  }
})
