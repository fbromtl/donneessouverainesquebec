export type OrgKind = 'entreprise_qc' | 'institution' | 'entreprise_hors_qc' | 'individu'
export type EmployeeRange = '1-25' | '26-50' | '51-100' | '101-250' | '251-500' | '501+'
export type MembershipStatus =
  | 'pending_payment'
  | 'pending_approval'
  | 'active'
  | 'refused'
  | 'expired'
  | 'cancelled'
export type StaffRole = 'dg' | 'ca' | 'tresorier'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  job_title: string | null
  phone: string | null
  onboarded_at: string | null
}

export interface Tier {
  code: string
  kind: OrgKind
  employee_range: EmployeeRange | null
  label: string
  price_cents: number
  has_vote: boolean
  sort: number
}

export interface Organization {
  id: string
  name: string
  kind: OrgKind
  employee_range: EmployeeRange | null
  website: string | null
  city: string | null
  sectors: string[]
  description: string | null
  public_listing: boolean
}

export interface Membership {
  id: string
  org_id: string
  tier_code: string
  status: MembershipStatus
  price_cents: number
  answers: { motivations?: string[]; involvement?: string }
  signed_name: string
  submitted_at: string
  paid_at: string | null
  decided_at: string | null
  refusal_reason: string | null
  starts_on: string | null
  ends_on: string | null
}

export interface Invoice {
  id: string
  number: string
  org_id: string
  membership_id: string | null
  description: string
  subtotal_cents: number
  gst_cents: number
  qst_cents: number
  total_cents: number
  status: 'open' | 'paid' | 'void'
  payment_method: 'card' | 'transfer' | null
  issued_at: string
  paid_at: string | null
}

export interface MyContext {
  profile: Profile | null
  staff_role: StaffRole | null
  org: (Organization & { my_role: 'admin' | 'member'; is_voting_delegate: boolean }) | null
  membership: (Membership & { tier: Tier }) | null
  open_invoice: Invoice | null
  payment_mode: string | null
}

/** Ce que la personne peut voir : déduit de l'adhésion de son organisation, jamais de son compte. */
export type Access = 'invite' | 'provisoire' | 'membre'

export function accessOf(ctx: MyContext | null | undefined): Access {
  const m = ctx?.membership
  if (!m) return 'invite'
  const today = new Date().toISOString().slice(0, 10)
  if (m.status === 'active' && (!m.ends_on || m.ends_on >= today)) return 'membre'
  if (m.status === 'pending_approval') return 'provisoire'
  return 'invite'
}

export const KIND_LABEL: Record<OrgKind, string> = {
  entreprise_qc: 'Entreprise du Québec',
  institution: 'Organisme ou institution',
  entreprise_hors_qc: 'Entreprise hors Québec',
  individu: 'Individu',
}

export const STATUS_LABEL: Record<MembershipStatus, string> = {
  pending_payment: 'Paiement attendu',
  pending_approval: 'Confirmation du CA attendue',
  active: 'Membre en règle',
  refused: 'Demande refusée',
  expired: 'Adhésion expirée',
  cancelled: 'Adhésion annulée',
}

export const money = (cents: number) =>
  new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)

export const longDate = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(iso.length === 10 ? `${iso}T12:00:00` : iso),
      )
    : ''

export const firstName = (full: string | null | undefined) => (full ?? '').trim().split(/\s+/)[0] ?? ''
