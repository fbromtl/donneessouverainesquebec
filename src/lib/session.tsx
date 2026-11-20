import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc, supabase } from './supabase'
import { accessOf, type Access, type MyContext } from './types'

interface SessionValue {
  session: Session | null
  /** Vrai tant qu'on ne sait pas encore si quelqu'un est connecté. */
  booting: boolean
  ctx: MyContext | null
  ctxLoading: boolean
  access: Access
  isStaff: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooting(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (next) leaving = false
      setSession(next)
      setBooting(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null
  const query = useQuery({
    queryKey: ['contexte', userId],
    queryFn: () => rpc<MyContext>('get_my_context'),
    enabled: !!userId,
    staleTime: 15_000,
  })

  const value = useMemo<SessionValue>(() => {
    const ctx = userId ? (query.data ?? null) : null
    return {
      session,
      booting,
      ctx,
      ctxLoading: !!userId && query.isLoading,
      access: accessOf(ctx),
      isStaff: !!ctx?.staff_role,
      refresh: async () => {
        await qc.invalidateQueries()
      },
      signOut: async () => {
        // Après une déconnexion volontaire, on ne ramène pas la personne suivante sur cette page.
        leaving = true
        await supabase.auth.signOut()
        qc.clear()
        clearNext()
      },
    }
  }, [session, booting, userId, query.data, query.isLoading, qc])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession doit être utilisé dans SessionProvider')
  return v
}

/** Destination à rejoindre une fois la connexion terminée (le lien courriel ramène à la racine). */
const NEXT_KEY = 'dsq.suite'
let leaving = false
export const rememberNext = (path: string) => {
  if (leaving) return
  try {
    localStorage.setItem(NEXT_KEY, path)
  } catch {
    /* stockage indisponible : on retombera sur l'accueil */
  }
}
/** Lit la destination en attente sans l'effacer : la lecture peut se faire pendant le rendu. */
export const peekNext = (): string | null => {
  try {
    const v = localStorage.getItem(NEXT_KEY)
    return v && v.startsWith('/') && !v.startsWith('//') ? v : null
  } catch {
    return null
  }
}
export const clearNext = () => {
  try {
    localStorage.removeItem(NEXT_KEY)
  } catch {
    /* rien à effacer */
  }
}
