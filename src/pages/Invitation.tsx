import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FocusShell } from '../layouts/Shells'
import { clearNext, rememberNext, useSession } from '../lib/session'
import { rpc, supabase } from '../lib/supabase'
import { Button, Notice, Panel, Splash } from '../ui'
import { EmailSignIn } from './Login'

interface InvitationInfo {
  status: 'valid' | 'accepted' | 'expired' | 'revoked' | 'unknown'
  email?: string
  message?: string | null
  org_name?: string | null
  inviter_name?: string | null
}

/**
 * Page d'arrivée d'un lien d'invitation, connecté ou non.
 * Une invitation au portail s'accepte toute seule. Rejoindre une organisation demande un clic :
 * on ne rattache personne à une organisation sans son accord explicite.
 */
export default function Invitation() {
  const { token = '' } = useParams()
  const { session, booting, ctx, refresh, signOut } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loginExpired, setLoginExpired] = useState(false)
  const started = useRef(false)
  const loginTried = useRef(false)

  // Arrivée depuis le courriel : le lien porte un jeton qui connecte en un clic.
  // S'il a expiré, la page propose simplement d'en recevoir un nouveau.
  const jeton = params.get('jeton')
  const genre = params.get('genre')
  useEffect(() => {
    if (!jeton || booting || loginTried.current) return
    loginTried.current = true
    const forget = () => setParams({}, { replace: true })
    if (session) return forget()
    void (async () => {
      let { error } = await supabase.auth.verifyOtp({ token_hash: jeton, type: 'email' })
      if (error && (genre === 'signup' || genre === 'invite')) {
        ;({ error } = await supabase.auth.verifyOtp({ token_hash: jeton, type: genre }))
      }
      if (error) setLoginExpired(true)
      forget()
    })()
  }, [jeton, genre, booting, session, setParams])

  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => rpc<InvitationInfo>('get_invitation', { p_token: token }),
  })
  const d = info.data
  const status = d?.status
  const joinsOrg = !!d?.org_name

  const accept = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await rpc('accept_invitation', { p_token: token })
      clearNext()
      await refresh()
      navigate('/', { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }, [token, refresh, navigate])

  // Hors session : on retient l'invitation pour y revenir après le lien de connexion.
  useEffect(() => {
    if (!session && status === 'valid') rememberNext(`/invitation/${token}`)
  }, [session, status, token])

  useEffect(() => {
    if (!session || !ctx || started.current) return
    if (status === 'accepted') {
      started.current = true
      clearNext()
      navigate('/', { replace: true })
    } else if (status === 'valid' && !joinsOrg) {
      started.current = true
      void accept()
    }
  }, [session, ctx, status, joinsOrg, accept, navigate])

  if (info.isLoading) return <Splash />

  const dead = status === 'unknown' || status === 'expired' || status === 'revoked'

  return (
    <FocusShell>
      {dead && (
        <>
          <h1 className="text-[28px] leading-tight font-semibold">Cette invitation n'est plus valide</h1>
          <p className="mt-2 mb-7 text-ink-2">
            {status === 'expired' ? 'Elle a expiré.' : status === 'revoked' ? 'Elle a été annulée.' : 'Le lien est incomplet ou erroné.'} Demandez-en une
            nouvelle à la personne qui vous a invité, ou entrez directement dans le portail.
          </p>
          <Link to="/connexion">
            <Button>Entrer dans le portail</Button>
          </Link>
        </>
      )}

      {!dead && d && (
        <>
          <h1 className="text-[28px] leading-tight font-semibold">
            {joinsOrg ? `Rejoignez ${d.org_name} sur le portail de DSQ` : 'Vous êtes invité sur le portail de DSQ'}
          </h1>
          <p className="mt-2 text-ink-2">
            {d.inviter_name ? `${d.inviter_name} vous invite.` : 'Données Souveraines Québec vous invite.'} L'accès est gratuit
            {joinsOrg ? '.' : ' : vous pourrez adhérer plus tard si vous le souhaitez.'}
          </p>
          {d.message && <blockquote className="mt-5 border-l-2 border-accent pl-4 text-ink-2">{d.message}</blockquote>}

          <Panel className="mt-7 p-6 shadow-raised">
            {error ? (
              <div className="flex flex-col gap-4">
                <Notice tone="danger" title={error}>
                  L'invitation est destinée à {d.email}.
                </Notice>
                <Button variant="secondary" onClick={signOut}>
                  Me connecter avec une autre adresse
                </Button>
              </div>
            ) : session && joinsOrg && status === 'valid' ? (
              <div className="flex flex-col gap-4">
                <p className="text-ink-2">
                  Vous êtes connecté avec <span className="font-medium text-ink">{ctx?.profile?.email}</span>. En rejoignant {d.org_name}, ses
                  administrateurs verront votre nom et votre courriel. Vous pourrez quitter l'organisation à tout moment.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button loading={busy} onClick={accept}>
                    Rejoindre {d.org_name}
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => {
                      clearNext()
                      navigate('/', { replace: true })
                    }}
                  >
                    Pas maintenant
                  </Button>
                </div>
              </div>
            ) : session || (jeton && !loginExpired) ? (
              <p className="text-ink-2" role="status">
                Ouverture de votre espace…
              </p>
            ) : loginExpired ? (
              <div className="flex flex-col gap-4">
                <Notice tone="warn" title="Le lien de connexion du courriel a expiré.">
                  Votre invitation reste valide. Recevez un nouveau lien ci-dessous.
                </Notice>
                <EmailSignIn fixedEmail={d.email} />
              </div>
            ) : status === 'accepted' ? (
              <div className="flex flex-col gap-4">
                <p className="text-ink-2">Cette invitation a déjà été acceptée. Connectez-vous pour retrouver votre espace.</p>
                <EmailSignIn fixedEmail={d.email} />
              </div>
            ) : (
              <EmailSignIn fixedEmail={d.email} />
            )}
          </Panel>
        </>
      )}
    </FocusShell>
  )
}
