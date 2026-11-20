import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Building2, House, LogOut, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { useSession } from '../lib/session'
import { cx, Wordmark } from '../ui'

/** Écrans hors session : connexion, invitation, accueil des nouveaux. */
export function FocusShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="px-5 py-5 sm:px-8">
        <Wordmark />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-14">
        <div className={cx('w-full', wide ? 'max-w-[560px]' : 'max-w-[440px]')}>{children}</div>
      </main>
      <footer className="px-5 py-5 text-sm text-ink-3 sm:px-8">
        <a className="underline-offset-4 hover:underline" href="https://www.donneessouveraines.quebec/" target="_blank" rel="noreferrer">
          donneessouveraines.quebec
        </a>
      </footer>
    </div>
  )
}

interface NavItem {
  to: string
  label: string
  icon: typeof House
  end?: boolean
}

/** Coquille du portail : navigation à gauche, contenu au centre. */
export function AppShell() {
  const { ctx, isStaff, signOut } = useSession()
  const m = ctx?.membership
  const canJoin = !m || m.status === 'pending_payment' || m.status === 'refused' || m.status === 'expired' || m.status === 'cancelled'

  // Un module n'apparaît que s'il a quelque chose à montrer à cette personne.
  const items: NavItem[] = [
    { to: '/', label: 'Accueil', icon: House, end: true },
    ...(canJoin && (!ctx?.org || ctx.org.my_role === 'admin') ? [{ to: '/adhesion', label: 'Adhérer', icon: Sparkles }] : []),
    ...(ctx?.org ? [{ to: '/organisation', label: 'Mon organisation', icon: Building2 }] : []),
    ...(isStaff ? [{ to: '/admin', label: 'Administration', icon: ShieldCheck }] : []),
    { to: '/compte', label: 'Mon compte', icon: UserRound },
  ]

  const link = ({ isActive }: { isActive: boolean }) =>
    cx(
      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[15px] transition-colors',
      isActive ? 'bg-sunken font-medium text-ink' : 'text-ink-2 hover:bg-page hover:text-ink',
    )

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="no-print sticky top-0 hidden h-screen flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <div className="px-1">
          <Wordmark />
        </div>
        <nav className="mt-8 flex flex-col gap-0.5" aria-label="Navigation principale">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={link}>
              <it.icon className="size-[18px]" aria-hidden />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-line pt-4">
          <p className="truncate px-3 text-sm font-medium text-ink">{ctx?.profile?.full_name || ctx?.profile?.email}</p>
          {ctx?.org && <p className="truncate px-3 text-sm text-ink-3">{ctx.org.name}</p>}
          <button
            type="button"
            onClick={signOut}
            className="mt-2 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[15px] text-ink-2 hover:bg-page hover:text-ink"
          >
            <LogOut className="size-[18px]" aria-hidden />
            Se déconnecter
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="no-print border-b border-line bg-surface lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Wordmark compact />
            <button type="button" onClick={signOut} className="cursor-pointer rounded-lg p-2 text-ink-2 hover:bg-page" aria-label="Se déconnecter">
              <LogOut className="size-5" aria-hidden />
            </button>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]" aria-label="Navigation principale">
            {items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} className={(s) => cx(link(s), 'shrink-0 py-1.5 text-sm')}>
                {it.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1080px] px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
