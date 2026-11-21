import { supabase } from './supabase'

/** Ce que la fonction d'envoi répond après une invitation. */
export interface InvitationSent {
  /** `smtp` : le courriel est parti. `simulation` : aucun fournisseur n'est branché, rien n'est parti. */
  mode: 'smtp' | 'simulation'
  /** En simulation seulement : le lien que le courriel aurait contenu, pour le transmettre à la main. */
  link?: string
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('courriels', { body })
  if (error) {
    // La fonction répond en JSON avec un message lisible ; à défaut, on reste factuel.
    let message = "Le courriel n'a pas pu être envoyé."
    try {
      const detail = await (error as { context?: Response }).context?.json()
      if (detail?.message) message = String(detail.message)
    } catch {
      /* réponse illisible : on garde le message par défaut */
    }
    throw new Error(message)
  }
  return data as T
}

/** Envoie le courriel d'une invitation qui vient d'être créée. */
export const sendInvitationEmail = (token: string) => invoke<InvitationSent>({ action: 'invitation', token })

/** Indique si un fournisseur de courriel est branché. */
export const emailStatus = () => invoke<{ mode: 'smtp' | 'simulation' }>({ action: 'etat' })

/**
 * Demande à la fonction d'envoyer ce que la base a mis en file (reçu, confirmation, refus…).
 * Sans attendre la réponse : un courriel en retard ne doit jamais bloquer l'écran.
 */
export function kickEmails() {
  void invoke({ action: 'traiter' }).catch(() => {})
}
