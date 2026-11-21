import { Component, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { clearNext, peekNext, rememberNext, useSession } from './lib/session'
import { AppShell } from './layouts/Shells'
import { Splash } from './ui'
import Login from './pages/Login'
import Welcome from './pages/Welcome'
import Home from './pages/Home'
import Join from './pages/Join'
import { Checkout, InvoiceView, Thanks } from './pages/Payment'
import Organization from './pages/Organization'
import Invitation from './pages/Invitation'
import Decline from './pages/Decline'
import Admin from './pages/Admin'
import Account from './pages/Account'

/** Reprend la destination retenue avant la connexion, puis l'oublie. */
function Resume({ to }: { to: string }) {
  useEffect(() => clearNext(), [])
  return <Navigate to={to} replace />
}

/**
 * Tout ce qui est derrière demande une session, puis un profil complété.
 * Une seule décision de redirection par rendu, dans cet ordre :
 *   1. pas de session : connexion, en retenant où la personne voulait aller ;
 *   2. une invitation en attente : on l'accepte avant tout, pour que l'accueil montre déjà son organisation ;
 *   3. profil incomplet : accueil des nouveaux ;
 *   4. une autre destination en attente : on la reprend.
 */
function Gate() {
  const { session, booting, ctx, ctxLoading } = useSession()
  const loc = useLocation()
  const here = loc.pathname + loc.search
  const pending = peekNext()

  useEffect(() => {
    if (session && pending === here) clearNext()
  }, [session, pending, here])

  if (booting || (session && (ctxLoading || !ctx))) return <Splash />
  if (!session) {
    if (loc.pathname !== '/') rememberNext(here)
    return <Navigate to="/connexion" replace />
  }

  const onboarded = !!ctx?.profile?.onboarded_at
  const resumable = pending && pending !== here ? pending : null
  if (resumable?.startsWith('/invitation/')) return <Resume to={resumable} />
  if (!onboarded) return loc.pathname === '/bienvenue' ? <Outlet /> : <Navigate to="/bienvenue" replace />
  if (resumable) return <Resume to={resumable} />
  return <Outlet />
}

/** Si un écran plante, on le dit et on propose une sortie, plutôt qu'une page blanche. */
class Safety extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-[440px]">
          <h1 className="text-2xl font-semibold">Cette page n'a pas pu s'afficher</h1>
          <p className="mt-2 text-ink-2">Revenez à l'accueil et réessayez. Si le problème persiste, écrivez à go@donneessouveraines.quebec.</p>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            className="mt-5 inline-flex h-10 cursor-pointer items-center rounded-lg bg-ink px-4 font-medium text-white"
          >
            Revenir à l'accueil
          </button>
        </div>
      </div>
    )
  }
}

function StaffOnly() {
  const { isStaff } = useSession()
  return isStaff ? <Outlet /> : <Navigate to="/" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Safety>
      <Routes>
        <Route path="/connexion" element={<Login />} />
        <Route path="/invitation/:token" element={<Invitation />} />
        <Route path="/invitation/:token/refuser" element={<Decline />} />
        <Route element={<Gate />}>
          <Route path="/bienvenue" element={<Welcome />} />
          <Route path="/paiement/:invoiceId" element={<Checkout />} />
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="/adhesion" element={<Join />} />
            <Route path="/adhesion/merci" element={<Thanks />} />
            <Route path="/organisation" element={<Organization />} />
            <Route path="/facture/:invoiceId" element={<InvoiceView />} />
            <Route path="/compte" element={<Account />} />
            <Route element={<StaffOnly />}>
              <Route path="/admin" element={<Admin />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Safety>
    </BrowserRouter>
  )
}
