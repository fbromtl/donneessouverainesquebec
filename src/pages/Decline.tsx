import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { FocusShell } from '../layouts/Shells'
import { rpc } from '../lib/supabase'
import { Button, Notice, Panel } from '../ui'

/**
 * « Ne plus recevoir d'invitations » : atteinte depuis le pied d'un courriel d'invitation.
 * Un clic est demandé pour que les robots qui préchargent les liens ne le déclenchent pas.
 */
export default function Decline() {
  const { token = '' } = useParams()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'unknown' | 'error'>('idle')
  const [email, setEmail] = useState('')

  async function confirm() {
    setState('busy')
    try {
      const res = await rpc<{ status: 'done' | 'unknown'; email?: string }>('decline_invitation', { p_token: token })
      setEmail(res.email ?? '')
      setState(res.status)
    } catch {
      setState('error')
    }
  }

  return (
    <FocusShell>
      <h1 className="text-[28px] leading-tight font-semibold">Ne plus recevoir d'invitations</h1>
      <p className="mt-2 mb-7 text-ink-2">
        Données Souveraines Québec ne vous enverra plus d'invitation à cette adresse, et celle-ci sera annulée.
      </p>
      <Panel className="p-6 shadow-raised">
        {state === 'done' ? (
          <Notice tone="ok" title="C'est noté.">
            {email ? `Plus aucune invitation ne sera envoyée à ${email}.` : 'Plus aucune invitation ne vous sera envoyée.'} Vous pouvez fermer cette page.
          </Notice>
        ) : state === 'unknown' ? (
          <Notice tone="warn" title="Ce lien n'est pas reconnu.">
            Écrivez à go@donneessouveraines.quebec et nous retirerons votre adresse à la main.
          </Notice>
        ) : (
          <div className="flex flex-col gap-4">
            {state === 'error' && <Notice tone="danger" title="La demande n'a pas pu être enregistrée. Réessayez dans un instant." />}
            <Button size="lg" loading={state === 'busy'} onClick={confirm}>
              Ne plus m'inviter
            </Button>
          </div>
        )}
      </Panel>
    </FocusShell>
  )
}
