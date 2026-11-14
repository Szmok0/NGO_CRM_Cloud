// Podstawowe elementy interfejsu w stylu wersji desktopowej (kolory i promienie: styles.css).
// Tylko klasy CSS, bez atrybutów style: ścisła CSP blokuje style wpisane w HTML.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

/** Karta na środku strony: logowanie, kreator, zaproszenie. */
export function Card({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="min-h-full overflow-y-auto px-4 py-12 print:p-0">
      <main className={cn('mx-auto rounded-card border border-border bg-background p-8 shadow-card print:border-0 print:shadow-none', wide ? 'max-w-xl' : 'max-w-md')}>
        <h1 className="text-xl font-semibold">{title}</h1>
        {children}
      </main>
    </div>
  )
}

/** Sekcja na stronie z menu (np. w ustawieniach). */
export function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-background p-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

const controlClass =
  'mt-1 block w-full rounded-control border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-muted disabled:text-faint'

export function Field({ label, hint, className, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn('mt-4 block text-sm', className)}>
      <span className="font-medium text-secondary-foreground">{label}</span>
      <input {...input} className={controlClass} />
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function SelectField({ label, className, children, ...select }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={cn('mt-4 block text-sm', className)}>
      <span className="font-medium text-secondary-foreground">{label}</span>
      <select {...select} className={controlClass}>
        {children}
      </select>
    </label>
  )
}

const BUTTON_VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-faint',
  secondary: 'border border-input bg-background text-secondary-foreground hover:bg-subtle disabled:text-faint',
  ghost: 'text-secondary-foreground hover:bg-muted disabled:text-faint',
  danger: 'border border-destructive-soft bg-background text-destructive hover:bg-destructive-soft disabled:text-faint'
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: { variant?: keyof typeof BUTTON_VARIANTS; size?: 'sm' | 'md' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn('inline-flex cursor-pointer items-center justify-center gap-2 rounded-control font-medium disabled:cursor-default', size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm', BUTTON_VARIANTS[variant], className)}
    />
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

const BADGE_TONES = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-destructive-soft text-destructive',
  info: 'bg-info-soft text-info'
}

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof BADGE_TONES; children: ReactNode }) {
  return <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', BADGE_TONES[tone])}>{children}</span>
}

const AVATAR_COLORS = ['bg-primary', 'bg-info', 'bg-violet', 'bg-warning', 'bg-success', 'bg-destructive']
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

/** Kółko z inicjałami; kolor wynika z identyfikatora, więc ta sama osoba ma zawsze ten sam. */
export function Avatar({ id, name, size = 'md' }: { id: string; name: string; size?: 'md' | 'lg' }) {
  const color = AVATAR_COLORS[[...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', size === 'lg' ? 'h-10 w-10 text-sm' : 'h-[34px] w-[34px] text-xs', color)}>
      {initials(name)}
    </span>
  )
}
