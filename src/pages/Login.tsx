import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { FocusShell } from '../layouts/Shells'
import { useSession } from '../lib/session'
import { errorMessage, supabase } from '../lib/supabase'
import { Button, Field, Input, Notice, Panel } from '../ui'

// Comptes de démonstration : visibles uniquement en développement local, jamais dans la version publiée.
const DEMO_PASSWORD = import.meta.env.DEV ? (import.meta.env.VITE_DEMO_PASSWORD as string | undefined) : undefined
const DEMO_ACCOUNTS: [string, string][] = [
  ['nouveau@demo.dsq.test', 'Nouvel arrivant'],
  ['collegue@demo.dsq.test', 'Collègue invité'],
  ['dg@demo.dsq.test', 'Direction générale'],
  ['ca@demo.dsq.test', "Conseil d'administration"],
]

/** Connexion par courriel, sans mot de passe. Sert aussi sur la page d'invitation. */
export function EmailSignIn({ fixedEmail, cta = 'Recevoir mon lien de connexion' }: { fixedEmail?: string; cta?: string }) {
  const [email, setEmail] = useState(fixedEmail ?? '')
  const [stage, setStage] = useState<'saisie' | 'envoye'>('saisie')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
    })
    setBusy(false)
    if (error) setError(errorMessage(error))
    else setStage('envoye')
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError(errorMessage(error))
  }

  if (stage === 'envoye') {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
            <MailCheck className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-medium">Consultez votre boîte de réception</p>
            <p className="mt-0.5 text-ink-2">
              Nous avons envoyé un lien à <span className="font-medium text-ink">{email.trim()}</span>. Cliquez dessus pour entrer.
            </p>
          </div>
        </div>
        <form onSubmit={verify} className="flex flex-col gap-3 border-t border-line pt-5">
          <Field label="Code reçu par courriel" htmlFor="code" optional error={error} hint="Si le courriel contient un code, vous pouvez l'entrer ici au lieu de cliquer sur le lien.">
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" loading={busy} disabled={code.trim().length < 6}>
              Valider le code
            </Button>
            {!fixedEmail && (
              <Button variant="quiet" onClick={() => { setStage('saisie'); setError(null); setCode('') }}>
                Utiliser une autre adresse
              </Button>
            )}
          </div>
        </form>
      </div>
    )
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-4">
      <Field label="Courriel professionnel" htmlFor="courriel" error={error}>
        <Input
          id="courriel"
          type="email"
          required
          autoComplete="email"
          autoFocus={!fixedEmail}
          readOnly={!!fixedEmail}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="vous@organisation.ca"
        />
      </Field>
      <Button type="submit" size="lg" loading={busy}>
        {cta}
      </Button>
      <p className="text-sm text-ink-3">Aucun mot de passe à retenir. Si vous êtes nouveau, le même lien crée votre compte.</p>
    </form>
  )
}

export default function Login() {
  const { session } = useSession()
  const [demoError, setDemoError] = useState<string | null>(null)
  const [demoBusy, setDemoBusy] = useState<string | null>(null)
  if (session) return <Navigate to="/" replace />

  async function demo(email: string) {
    if (!DEMO_PASSWORD) return
    setDemoBusy(email)
    setDemoError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password: DEMO_PASSWORD })
    setDemoBusy(null)
    if (error) setDemoError(errorMessage(error))
  }

  return (
    <FocusShell>
      <h1 className="text-[28px] leading-tight font-semibold">Entrez dans le portail</h1>
      <p className="mt-2 mb-7 text-ink-2">Membres, invités et futurs membres : un seul point d'entrée.</p>
      <Panel className="p-6 shadow-raised">
        <EmailSignIn />
      </Panel>

      {DEMO_PASSWORD && (
        <div className="mt-8">
          <p className="text-sm font-medium text-ink">Comptes de démonstration</p>
          <p className="mt-0.5 mb-3 text-sm text-ink-3">Visibles seulement sur ce poste de développement.</p>
          <div className="flex flex-wrap gap-2">
            {DEMO_ACCOUNTS.map(([email, label]) => (
              <Button key={email} variant="secondary" size="sm" loading={demoBusy === email} onClick={() => demo(email)}>
                {label}
              </Button>
            ))}
          </div>
          {demoError && (
            <div className="mt-3">
              <Notice tone="danger" title={demoError} />
            </div>
          )}
        </div>
      )}
    </FocusShell>
  )
}
