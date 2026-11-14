// Proste elementy formularzy (docelowy wygląd jak w desktopie: ZADANIE_01, krok 8).
// Tylko klasy CSS, bez atrybutów style (ścisła CSP).
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto mt-16 max-w-md rounded-lg border border-slate-200 bg-white p-8 font-sans text-slate-800 shadow-sm">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </main>
  )
}

export function Field({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mt-4 block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        {...input}
        className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-base focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600 disabled:bg-slate-100"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Button({ variant = 'primary', ...props }: { variant?: 'primary' | 'secondary' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const look =
    variant === 'primary'
      ? 'bg-sky-700 text-white hover:bg-sky-800 disabled:bg-slate-400'
      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400'
  return <button type="button" {...props} className={`rounded px-4 py-2 text-sm font-medium ${look}`} />
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  ) : null
}

export function InfoNote({ children }: { children: ReactNode }) {
  return children ? (
    <p role="status" className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      {children}
    </p>
  ) : null
}
