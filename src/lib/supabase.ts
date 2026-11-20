import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!url || !key) {
  throw new Error(
    'Configuration manquante : copiez .env.example vers .env.local et renseignez VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

export const supabase = createClient(url, key)

/** Messages lisibles pour les refus renvoyés par les fonctions de la base. */
const MESSAGES: Record<string, string> = {
  non_connecte: 'Votre session a expiré. Reconnectez-vous.',
  declaration_requise: 'Cochez la déclaration pour continuer.',
  signature_requise: 'Écrivez votre nom complet pour signer.',
  type_invalide: 'Choisissez qui adhère.',
  taille_requise: "Indiquez le nombre d'employés.",
  nom_requis: "Indiquez le nom de l'organisation.",
  palier_introuvable: 'Aucun palier ne correspond à ces réponses.',
  reserve_a_l_administrateur: "Seul l'administrateur du compte de votre organisation peut faire ceci.",
  reserve_a_l_equipe: "Cette action est réservée à l'équipe de DSQ.",
  adhesion_deja_en_cours: 'Votre organisation a déjà une adhésion en cours.',
  adhesion_deja_tranchee: 'Cette demande a déjà été traitée.',
  adhesion_introuvable: 'Demande introuvable.',
  facture_introuvable: 'Facture introuvable.',
  facture_deja_reglee: 'Cette facture est déjà réglée.',
  simulation_desactivee: 'Le paiement simulé est désactivé.',
  motif_requis: 'Indiquez le motif du refus.',
  courriel_invalide: 'Cette adresse courriel ne semble pas valide.',
  invitation_invalide: "Cette invitation n'est plus valide.",
  courriel_different: "Cette invitation a été envoyée à une autre adresse que celle de votre compte.",
  deja_dans_une_organisation: 'Votre compte est déjà rattaché à une autre organisation.',
  membre_introuvable: "Cette personne ne fait pas partie de l'organisation.",
  demande_invalide: 'Certaines réponses sont trop longues ou mal formées. Vérifiez la demande.',
  message_trop_long: 'Le message ne peut pas dépasser 500 caractères.',
  quota_invitations: "Vous avez atteint la limite de 50 invitations par jour.",
  adhesion_requise_pour_inviter: "Vous pourrez inviter vos collègues dès que l'adhésion sera payée.",
  administrateur_ne_peut_pas_quitter: "L'administrateur du compte ne peut pas quitter son organisation.",
}

export function errorMessage(error: unknown): string {
  const raw =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)
  const code = Object.keys(MESSAGES).find((k) => raw.includes(k))
  if (code) return MESSAGES[code]
  if (/rate limit/i.test(raw)) return 'Trop de tentatives. Réessayez dans quelques minutes.'
  if (/not authorized|smtp/i.test(raw))
    return "L'envoi de courriels n'est pas encore configuré pour cette adresse."
  if (/invalid login|invalid.*credentials/i.test(raw)) return 'Identifiants incorrects.'
  if (/expired|invalid.*otp|token/i.test(raw)) return 'Ce code est incorrect ou expiré. Demandez-en un nouveau.'
  if (/failed to fetch|network/i.test(raw)) return 'Connexion impossible. Vérifiez votre accès à Internet.'
  return "Une erreur est survenue. Réessayez, et écrivez-nous si elle persiste."
}

/** Appelle une fonction de la base et lève une erreur lisible en cas de refus. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(errorMessage(error))
  return data as T
}
