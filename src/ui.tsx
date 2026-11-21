import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { Check, CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-react'
import { STATUS_LABEL, type MembershipStatus } from './lib/types'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ----------------------------------------------------------------------------
   Boutons : un seul bouton principal par écran.
---------------------------------------------------------------------------- */
type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-[#182a5c] shadow-ctl',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-page shadow-ctl',
  quiet: 'text-ink-2 hover:bg-sunken hover:text-ink',
  danger: 'bg-surface text-danger border border-line-strong hover:bg-danger-soft shadow-ctl',
}
const SIZE = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-[15px]', lg: 'h-12 px-5 text-base' }

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE; loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

/* ----------------------------------------------------------------------------
   Champs de formulaire : étiquette au-dessus, aide ou erreur en dessous.
---------------------------------------------------------------------------- */
const CONTROL =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-[15px] text-ink shadow-ctl placeholder:text-ink-3 ' +
  'focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20 disabled:bg-sunken disabled:text-ink-2 read-only:bg-page'

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-1.5 font-normal text-ink-3">facultatif</span>}
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1.5 text-sm text-danger" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        hint && <p className="text-sm text-ink-3">{hint}</p>
      )}
    </div>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, 'h-10', className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, 'min-h-24 py-2', className)} {...rest} />
}

/** Case à cocher avec son texte. */
export function Checkbox({
  checked,
  onChange,
  children,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
  id: string
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-[15px] text-ink-2">
      <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer size-5 cursor-pointer appearance-none rounded-md border border-line-strong bg-surface shadow-ctl checked:border-ink checked:bg-ink"
        />
        <Check className="pointer-events-none absolute size-3.5 text-white opacity-0 peer-checked:opacity-100" aria-hidden />
      </span>
      <span>{children}</span>
    </label>
  )
}

/** Tuile de choix exclusif (bouton radio). */
export function ChoiceTile({
  selected,
  onSelect,
  title,
  detail,
  aside,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  detail?: string
  aside?: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cx(
        'flex w-full cursor-pointer items-start gap-3 rounded-xl border bg-surface p-4 text-left transition-colors',
        selected ? 'border-ink ring-1 ring-ink' : 'border-line-strong hover:border-ink-3',
      )}
    >
      <span
        className={cx(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-ink bg-ink' : 'border-line-strong bg-surface',
        )}
        aria-hidden
      >
        {selected && <span className="size-2 rounded-full bg-white" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink">{title}</span>
        {detail && <span className="mt-0.5 block text-sm text-ink-3">{detail}</span>}
      </span>
      {aside && <span className="shrink-0 text-sm font-medium text-ink tabular-nums">{aside}</span>}
    </button>
  )
}

/** Pastille à bascule, pour les choix multiples. */
export function Chip({ selected, onToggle, children }: { selected: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cx(
        'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors',
        selected
          ? 'border-ink bg-ink text-white'
          : 'border-line-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink',
      )}
    >
      {selected && <Check className="size-3.5" aria-hidden />}
      {children}
    </button>
  )
}

/* ----------------------------------------------------------------------------
   Surfaces et états
---------------------------------------------------------------------------- */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-xl border border-line bg-surface', className)}>{children}</section>
}

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'seal'
const TONE: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-accent-soft text-accent-ink',
  seal: 'bg-seal-soft text-seal',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-medium whitespace-nowrap', TONE[tone])}>
      {children}
    </span>
  )
}

const STATUS_TONE: Record<MembershipStatus, Tone> = {
  pending_payment: 'warn',
  pending_approval: 'accent',
  active: 'ok',
  refused: 'danger',
  expired: 'neutral',
  cancelled: 'neutral',
}
export function StatusBadge({ status }: { status: MembershipStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
}

export function Notice({ tone = 'accent', title, children }: { tone?: 'accent' | 'warn' | 'ok' | 'danger'; title?: string; children?: ReactNode }) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'accent' ? Info : CircleAlert
  return (
    <div className={cx('flex gap-3 rounded-xl px-4 py-3 text-[15px]', TONE[tone])} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx(title && 'mt-0.5', 'text-ink-2')}>{children}</div>}
      </div>
    </div>
  )
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-semibold">{title}</h1>
        {lead && <p className="mt-1.5 max-w-[62ch] text-ink-2">{lead}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  )
}

export function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center text-ink-3" role="status" aria-label="Chargement">
      <LoaderCircle className="size-6 animate-spin" aria-hidden />
    </div>
  )
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#0D1C3F" />
        <path d="M9 9h7a7 7 0 0 1 0 14H9z" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" />
        <circle cx="16" cy="16" r="2.2" fill="#3CC5CB" />
      </svg>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold text-ink">{compact ? 'DSQ' : 'Données Souveraines Québec'}</span>
        <span className="block text-[13px] text-ink-3">Portail des membres</span>
      </span>
    </span>
  )
}
