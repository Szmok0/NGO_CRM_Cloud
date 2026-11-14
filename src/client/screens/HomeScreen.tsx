// Pusty ekran „Dziś” z danymi konta (moduły: ZADANIE_02; układ z menu: krok 8).
import { useState } from 'react'
import type { ApiOutputs, Role } from '@shared/api'
import { Button, ErrorNote, InfoNote } from '../components/ui'
import { pl } from '../i18n/pl'
import { call, errorMessage } from '../lib/api'

interface Props {
  account: ApiOutputs['auth.account']
  role: Role
  keysUnlocked: boolean
  notice?: string | null
  onChangePassword: () => void
  onSignedOut: () => void
}

export function HomeScreen({ account, role, keysUnlocked, notice, onChangePassword, onSignedOut }: Props) {
  const [error, setError] = useState<string | null>(null)

  async function logout(method: 'auth.logout' | 'auth.logoutAll') {
    try {
      await call(method, {})
      onSignedOut()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-10 font-sans text-slate-800">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{pl.home.title}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onChangePassword}>
            {pl.home.changePassword}
          </Button>
          <Button variant="secondary" onClick={() => logout('auth.logoutAll')}>
            {pl.home.logoutAll}
          </Button>
          <Button onClick={() => logout('auth.logout')}>{pl.home.logout}</Button>
        </div>
      </header>
      <InfoNote>{notice}</InfoNote>
      <ErrorNote>{error}</ErrorNote>
      <p className="mt-6 text-lg">{pl.home.greeting(account.name)}</p>
      <p className="mt-2 text-slate-500">{pl.home.empty}</p>

      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">{pl.home.account}</h2>
        <dl className="mt-3 grid grid-cols-[14rem_1fr] gap-y-2 text-sm">
          <dt className="text-slate-500">{pl.home.email}</dt>
          <dd>{account.email}</dd>
          <dt className="text-slate-500">{pl.home.role}</dt>
          <dd>{pl.roles[role]}</dd>
          <dt className="text-slate-500">{pl.home.keys}</dt>
          <dd className={keysUnlocked ? 'text-emerald-700' : 'text-amber-700'}>{keysUnlocked ? pl.home.keysUnlocked : pl.home.keysLocked}</dd>
        </dl>
      </section>
    </main>
  )
}
