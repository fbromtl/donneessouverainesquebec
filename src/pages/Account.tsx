import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useSession } from '../lib/session'
import { errorMessage, supabase } from '../lib/supabase'
import { longDate } from '../lib/types'
import { Button, Checkbox, Field, Input, Notice, PageHeader, Panel } from '../ui'

interface Consent {
  purpose: string
  granted: boolean
  source: string
  created_at: string
}

export default function Account() {
  const { ctx, refresh, signOut } = useSession()
  const p = ctx?.profile
  const [name, setName] = useState(p?.full_name ?? '')
  const [title, setTitle] = useState(p?.job_title ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const consents = useQuery({
    queryKey: ['consentements', p?.id],
    enabled: !!p,
    queryFn: async () => {
      const { data, error } = await supabase.from('consents').select('purpose, granted, source, created_at').order('created_at', { ascending: false })
      if (error) throw error
      return data as Consent[]
    },
  })
  const news = consents.data?.find((c) => c.purpose === 'communications')

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!p) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('profiles').update({ full_name: name.trim(), job_title: title.trim() || null }).eq('id', p.id)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    await refresh()
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function setNews(granted: boolean) {
    if (!p) return
    const { error } = await supabase.from('consents').insert({ user_id: p.id, purpose: 'communications', granted, source: 'mon_compte' })
    if (error) setError(errorMessage(error))
    await consents.refetch()
  }

  // Tout ce que le portail détient sur la personne, dans un format réutilisable.
  function exportData() {
    const payload = {
      exporte_le: new Date().toISOString(),
      profil: ctx?.profile,
      organisation: ctx?.org,
      adhesion: ctx?.membership,
      consentements: consents.data ?? [],
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'mes-donnees-dsq.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader title="Mon compte" lead={p?.email} />
      <div className="flex max-w-[640px] flex-col gap-10">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Profil</h2>
          <Panel className="p-6">
            <form onSubmit={save} className="flex flex-col gap-4">
              <Field label="Prénom et nom" htmlFor="nom" error={error}>
                <Input id="nom" required minLength={2} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Fonction" htmlFor="fonction" optional>
                <Input id="fonction" autoComplete="organization-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <div className="flex items-center gap-3">
                <Button type="submit" loading={busy}>
                  Enregistrer
                </Button>
                {saved && (
                  <span className="text-sm text-ok" role="status">
                    Enregistré
                  </span>
                )}
              </div>
            </form>
          </Panel>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Mes données</h2>
          <p className="mt-1 mb-3 text-ink-2">Vous décidez de ce que DSQ fait de vos renseignements, et vous pouvez les récupérer en tout temps.</p>
          <Panel className="flex flex-col gap-5 p-6">
            <Checkbox id="news" checked={news?.granted ?? false} onChange={setNews}>
              Recevoir les communications de Données Souveraines Québec par courriel.
              {news && <span className="mt-0.5 block text-sm text-ink-3">Dernier choix enregistré le {longDate(news.created_at)}.</span>}
            </Checkbox>
            <div className="border-t border-line pt-5">
              <Button variant="secondary" onClick={exportData}>
                <Download className="size-4" aria-hidden />
                Télécharger mes données
              </Button>
              <p className="mt-2 text-sm text-ink-3">Profil, organisation, adhésion et historique de vos consentements, dans un fichier JSON.</p>
            </div>
          </Panel>
          <div className="mt-4">
            <Notice title="Supprimer votre compte">Écrivez à go@donneessouveraines.quebec. La suppression en libre-service arrive dans une prochaine version.</Notice>
          </div>
        </section>

        <div>
          <Button variant="secondary" onClick={signOut}>
            Se déconnecter
          </Button>
        </div>
      </div>
    </>
  )
}
