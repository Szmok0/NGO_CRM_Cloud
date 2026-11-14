import { useCallback, useEffect, useState } from 'react'
import type { ApiOutputs } from '@shared/api'
import type { Health } from '@shared/health'
import { Card } from './components/ui'
import { pl } from './i18n/pl'
import { toBase64 } from './crypto/encoding'
import { call, isApiError, setupApi } from './lib/api'
import { SetupWizard } from './screens/SetupWizard'

const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
import { keysUnlocked, lockKeys, unlockKeys } from './lib/keyring'
import { ChangePasswordScreen } from './screens/ChangePasswordScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LoginScreen } from './screens/LoginScreen'
import { TotpSetupScreen } from './screens/TotpSetupScreen'

type View =
  | { name: 'loading' }
  | { name: 'message'; text: string; appSecretHint?: string }
  | { name: 'setup' }
  | { name: 'login'; resumeCode: boolean }
  | { name: 'totpSetup'; wrapKey: CryptoKey | null }
  | { name: 'home' | 'changePassword'; me: ApiOutputs['auth.me']; account: ApiOutputs['auth.account']; notice?: string }

export function App() {
  const [view, setView] = useState<View>({ name: 'loading' })

  /** Ustala widok na podstawie sesji; po pełnym logowaniu odblokowuje klucze, jeśli w tej karcie podano hasło. */
  const enter = useCallback(async (wrapKey: CryptoKey | null = null, notice?: string) => {
    try {
      const me = await call('auth.me', {})
      const account = await call('auth.account', {})
      if (!me.totpVerified) return setView(account.totpEnabled ? { name: 'login', resumeCode: true } : { name: 'totpSetup', wrapKey })
      if (wrapKey) await unlockKeys(wrapKey, me.userId).catch(() => false)
      setView({ name: 'home', me, account, notice })
    } catch (e) {
      lockKeys()
      if (!isApiError(e, 'UNAUTHENTICATED')) return setView({ name: 'message', text: pl.app.serverError })
      // Brak sesji: logowanie, chyba że instancja nie ma jeszcze żadnego konta (kreator).
      const { state } = await setupApi.status().catch(() => ({ state: 'done' as const }))
      if (state === 'available') setView({ name: 'setup' })
      else if (state === 'done') setView({ name: 'login', resumeCode: false })
      else setView({ name: 'message', text: state === 'no_token' ? pl.setup.noToken : pl.setup.tokenTooShort })
    }
  }, [])

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject(new Error(String(r.status)))))
      .then((health) => {
        if (health.status !== 'setup') return enter()
        // Brak APP_SECRET: podpowiadamy losową wartość (powstaje tutaj, w przeglądarce; serwer jej nie zna).
        const appSecretHint = health.missing.includes('APP_SECRET') ? toBase64Url(crypto.getRandomValues(new Uint8Array(48))) : undefined
        setView({ name: 'message', text: pl.app.setupNeeded(health.missing.join(', ')), appSecretHint })
      })
      .catch(() => setView({ name: 'message', text: pl.app.serverError }))
  }, [enter])

  const signedOut = () => {
    lockKeys()
    setView({ name: 'login', resumeCode: false })
  }

  switch (view.name) {
    case 'loading':
      return <p className="p-10 font-sans text-slate-500">{pl.app.loading}</p>
    case 'message':
      return (
        <Card title={pl.app.name} wide>
          <p className="mt-4 text-amber-800">{view.text}</p>
          {view.appSecretHint && (
            <>
              <p className="mt-4 text-sm text-slate-600">{pl.setup.appSecretHint}</p>
              <p className="mt-1 select-all break-all rounded bg-slate-100 px-3 py-2 font-mono text-sm">{view.appSecretHint}</p>
            </>
          )}
        </Card>
      )
    case 'setup':
      return <SetupWizard onDone={() => setView({ name: 'login', resumeCode: false })} />
    case 'login':
      return <LoginScreen key={String(view.resumeCode)} resumeCode={view.resumeCode} onSignedIn={(wrapKey) => enter(wrapKey)} onTotpSetup={(wrapKey) => setView({ name: 'totpSetup', wrapKey })} />
    case 'totpSetup':
      return <TotpSetupScreen onDone={() => enter(view.wrapKey)} onCancel={() => call('auth.logout', {}).catch(() => undefined).then(signedOut)} />
    case 'changePassword':
      return (
        <ChangePasswordScreen
          userId={view.me.userId}
          email={view.account.email}
          onDone={(wrapKey) => enter(wrapKey, pl.home.passwordChanged)}
          onCancel={() => setView({ ...view, name: 'home', notice: undefined })}
          onSignedOut={signedOut}
        />
      )
    case 'home':
      return (
        <HomeScreen
          account={view.account}
          role={view.me.role}
          keysUnlocked={keysUnlocked()}
          notice={view.notice}
          onChangePassword={() => setView({ ...view, name: 'changePassword' })}
          onSignedOut={signedOut}
        />
      )
  }
}
