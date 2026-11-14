// Komponenty w stylu shadcn/ui na natywnych elementach HTML, przeniesione z desktopu (src/renderer/components/ui.tsx).
// Różnice wobec desktopu: warianty jako zwykłe mapy klas (bez class-variance-authority) i bez atrybutów style,
// bo ścisła CSP je blokuje. Kolory z tokenów w styles.css.
import { forwardRef, useEffect, useRef, type ComponentProps, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/cn'
import { avatarClass, initials } from '../lib/avatar'

const BUTTON_VARIANTS = {
  default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  outline: 'border border-input bg-background text-foreground hover:bg-subtle',
  ghost: 'text-foreground hover:bg-muted',
  soft: 'bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft/70',
  destructive: 'bg-destructive text-white hover:bg-destructive/90',
  /** obramowany czerwony (np. „Wyłącz” przy koncie) */
  danger: 'border border-destructive-soft bg-background text-destructive hover:bg-destructive-soft',
  link: 'text-primary underline-offset-4 hover:underline hover:text-primary-hover px-0'
}
const BUTTON_SIZES = { default: 'h-9 px-3.5', sm: 'h-8 px-2.5 text-xs', icon: 'h-9 w-9', lg: 'h-10 px-4' }

export function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof BUTTON_VARIANTS; size?: keyof typeof BUTTON_SIZES }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    />
  )
}

const field =
  'h-9 w-full rounded-control border border-input bg-background px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(({ className, ...props }, ref) => <input ref={ref} className={cn(field, className)} {...props} />)
Input.displayName = 'Input'

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'h-auto min-h-20 py-2', className)} {...props} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(field, 'pr-7', className)} {...props} />
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <input type="checkbox" className={cn('h-4 w-4 accent-primary', className)} {...props} />
}

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cn('flex flex-col gap-1 text-sm', className)}>
      <span className="font-medium text-secondary-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** Karta: biała, zaokrąglona, z opcjonalnym nagłówkiem. `flush` = treść bez wewnętrznego odstępu. */
export function Card({
  className,
  title,
  sub,
  actions,
  flush,
  children
}: {
  className?: string
  title?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  flush?: boolean
  children: ReactNode
}) {
  return (
    <section className={cn('min-w-0 rounded-card border border-border bg-background shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-base font-bold">{title}</h2>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">{actions}</div>
        </header>
      )}
      <div className={flush ? '' : 'px-5 py-4'}>{children}</div>
    </section>
  )
}

const BADGE_TONES = {
  default: 'bg-muted text-secondary-foreground',
  muted: 'bg-muted text-muted-foreground',
  primary: 'bg-primary-soft text-primary-soft-foreground',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  orange: 'bg-warning-soft text-orange',
  violet: 'bg-violet-soft text-violet',
  danger: 'bg-destructive-soft text-destructive'
}
export type Tone = keyof typeof BADGE_TONES

/** Chip (statusy, typy, role). */
export function Badge({ className, tone = 'default', ...props }: ComponentProps<'span'> & { tone?: Tone }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', BADGE_TONES[tone], className)} {...props} />
}

export function Alert({ tone = 'warning', children }: { tone?: 'warning' | 'danger' | 'info'; children: ReactNode }) {
  const cls = {
    warning: 'border-warning-border bg-warning-bg text-orange',
    danger: 'border-destructive/30 bg-destructive-soft text-destructive',
    info: 'border-primary/30 bg-primary-soft text-primary-soft-foreground'
  }[tone]
  return <div className={cn('rounded-control border px-3 py-2 text-sm', cls)}>{children}</div>
}

/** Rozmiary awatara używane w widokach (w desktopie dowolna liczba w atrybucie style). */
const AVATAR_SIZES = {
  24: 'h-6 w-6 text-[10px]',
  26: 'h-[26px] w-[26px] text-[10px]',
  28: 'h-7 w-7 text-[10px]',
  30: 'h-[30px] w-[30px] text-[11px]',
  32: 'h-8 w-8 text-xs',
  34: 'h-[34px] w-[34px] text-xs',
  36: 'h-9 w-9 text-[13px]',
  40: 'h-10 w-10 text-sm',
  64: 'h-16 w-16 text-[23px]'
}

/** Awatar z inicjałami; kolor stały dla danego id. */
export function Avatar({ id, name, size = 32, className }: { id: string; name: string; size?: keyof typeof AVATAR_SIZES; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', AVATAR_SIZES[size], avatarClass(id), className)}>
      {initials(name)}
    </span>
  )
}

/** Pusty stan: ikona, jedno zdanie, opcjonalnie przycisk akcji. */
export function EmptyState({ icon, text, action }: { icon: ReactNode; text: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</span>
      <p className="text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  )
}

/** Okno modalne na natywnym <dialog>. */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={cn('m-auto rounded-card border border-border bg-background p-0 text-foreground shadow-xl', wide ? 'w-[min(900px,92vw)]' : 'w-[min(560px,92vw)]')}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-base font-bold">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zamknij">
              <X size={16} />
            </Button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; badge?: ReactNode }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => {
        const active = value === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              '-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm',
              active ? 'border-primary font-bold text-primary-soft-foreground' : 'border-transparent font-medium text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
            {t.badge != null && <span className={cn('rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-primary-soft text-primary-soft-foreground' : 'bg-line text-secondary-foreground')}>{t.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Przełącznik segmentowy (np. Miesiąc / Tydzień / Lista). */
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex overflow-hidden rounded-control border border-input">
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'h-8.5 cursor-pointer px-3.5 text-[13px]',
            i > 0 && 'border-l border-input',
            value === o.id ? 'bg-nav font-semibold text-white' : 'bg-background font-medium text-foreground hover:bg-subtle'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <table
      className={cn(
        'w-full border-collapse text-sm [&_td]:border-b [&_td]:border-line [&_td]:px-2.5 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:px-2.5 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground [&_tbody_tr:hover]:bg-subtle',
        className
      )}
      {...props}
    />
  )
}

export function PageHeader({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      {children}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-muted-foreground">{children}</p>
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="text-sm text-destructive">{children}</p> : null
}

// ---------- tylko w chmurze: ekrany poza menu (logowanie, kreator, zaproszenie, 2FA, zmiana hasła) ----------

/** Karta na środku strony: logowanie, kreator, zaproszenie. */
export function AuthCard({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="min-h-full overflow-y-auto px-4 py-12 print:p-0">
      <main className={cn('mx-auto rounded-card border border-border bg-background p-8 shadow-card print:border-0 print:shadow-none', wide ? 'max-w-xl' : 'max-w-md')}>
        <h1 className="text-xl font-semibold">{title}</h1>
        {children}
      </main>
    </div>
  )
}

const authControl =
  'mt-1 block w-full rounded-control border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-muted disabled:text-faint'

/** Pole z etykietą na ekranach logowania i w krótkich formularzach (etykieta nad polem, odstęp nad). */
export function InputField({ label, hint, className, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn('mt-4 block text-sm', className)}>
      <span className="font-medium text-secondary-foreground">{label}</span>
      <input {...input} className={authControl} />
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function SelectField({ label, className, children, ...select }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={cn('mt-4 block text-sm', className)}>
      <span className="font-medium text-secondary-foreground">{label}</span>
      <select {...select} className={authControl}>
        {children}
      </select>
    </label>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="mt-4 rounded-control border border-destructive-soft bg-destructive-soft px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  ) : null
}

export function InfoNote({ children }: { children: ReactNode }) {
  return children ? (
    <p role="status" className="mt-4 rounded-control bg-success-soft px-3 py-2 text-sm text-success">
      {children}
    </p>
  ) : null
}
