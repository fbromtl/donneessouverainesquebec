import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { FocusShell } from '../layouts/Shells'
import { useSession } from '../lib/session'
import { errorMessage, supabase } from '../lib/supabase'
import { Button, Checkbox, Field, Input, Panel } from '../ui'

/** Première visite : deux champs, puis on entre. */
export default function Welcome() {
  const { ctx, refresh, signOut } = useSession()
  const navigate = useNavigate()
  const [name, setName] = useState(ctx?.profile?.full_name ?? '')
  const [title, setTitle] = useState(ctx?.profile?.job_title ?? '')
  const [news, setNews] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const id = ctx?.profile?.id
    if (!id) return
    setBusy(true)
    setError(null)
    const { error: e1 } = await supabase
      .from('profiles')
      .update({ full_name: name.trim(), job_title: title.trim() || null, onboarded_at: new Date().toISOString() })
      .eq('id', id)
    // Le consentement est consigné qu'il soit donné ou non : c'est une trace datée.
    const { error: e2 } = e1
      ? { error: null }
      : await supabase.from('consents').insert({ user_id: id, purpose: 'communications', granted: news, source: 'accueil' })
    if (e1 || e2) {
      setBusy(false)
      setError(errorMessage(e1 ?? e2))
      return
    }
    await refresh()
    navigate('/', { replace: true })
  }

  return (
    <FocusShell>
      <h1 className="text-[28px] leading-tight font-semibold">Faisons connaissance</h1>
      <p className="mt-2 mb-7 text-ink-2">Deux informations suffisent pour ouvrir votre espace.</p>
      <Panel className="p-6 shadow-raised">
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label="Prénom et nom" htmlFor="nom" error={error}>
            <Input id="nom" required minLength={2} autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Fonction" htmlFor="fonction" optional>
            <Input id="fonction" autoComplete="organization-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Directrice des technologies" />
          </Field>
          <Checkbox id="nouvelles" checked={news} onChange={setNews}>
            Recevoir les nouvelles de Données Souveraines Québec par courriel. Vous pourrez changer d'avis dans Mon compte.
          </Checkbox>
          <Button type="submit" size="lg" loading={busy} disabled={name.trim().length < 2}>
            Ouvrir mon espace
          </Button>
        </form>
      </Panel>
      <p className="mt-5 text-sm text-ink-3">
        Connecté avec {ctx?.profile?.email}.{' '}
        <button type="button" onClick={signOut} className="cursor-pointer text-accent underline-offset-4 hover:underline">
          Utiliser une autre adresse
        </button>
      </p>
    </FocusShell>
  )
}
