import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Health } from '@shared/health'
import { AppContext, type AppContextValue, type CreateKind, type Route, type SessionInfo } from './app/context'
import { ActivityDialog } from './components/ActivityForm'
import { ActionDetailView } from './views/actions/ActionDetail'
import { ActionForm } from './views/actions/ActionForm'
import { ActionsList } from './views/actions/ActionsList'
import { TopicDetailView, TopicsView } from './views/TopicsView'
import { ContactCard } from './views/contacts/ContactCard'
import { ContactForm } from './views/contacts/ContactForm'
import { ContactsList } from './views/contacts/ContactsList'
import { Layout } from './app/Layout'
import { AuthCard } from './components/ui'
import { toBase64 } from './crypto/encoding'
import { pl } from './i18n/pl'
import { call, isApiError, setupApi } from './lib/api'
import { keysUnlocked, lockKeys, unlockKeys } from './lib/keyring'
import { ChangePasswordScreen } from './screens/ChangePasswordScreen'
import { InviteScreen } from './screens/InviteScreen'
import { LoginScreen } from './screens/LoginScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SetupWizard } from './screens/SetupWizard'
import { TodayScreen } from './screens/TodayScreen'
import { TotpSetupScreen } from './screens/TotpSetupScreen'

const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Token z jednorazowego linku: `#zaproszenie=TOKEN` (część po # nie jest wysyłana do serwera ani zapisywana w jego logach). */
const inviteTokenFromHash = () => /^#zaproszenie=([A-Za-z0-9_-]{20,200})$/.exec(window.location.hash)?.[1] ?? null

type View =
  | { name: 'loading' }
  | { name: 'message'; text: string; appSecretHint?: string }
  | { name: 'setup' }
  | { name: 'invite'; token: string }
  | { name: 'login'; resumeCode: boolean }
  | { name: 'totpSetup'; wrapKey: CryptoKey | null }
  | { name: 'app' | 'changePassword'; session: SessionInfo; notice?: string }

const loadSession = async (): Promise<SessionInfo> => {
  const [me, account, settings] = await Promise.all([call('auth.me', {}), call('auth.account', {}), call('settings.get', {})])
  return { me, account, settings }
}

export function App() {
  const [view, setView] = useState<View>({ name: 'loading' })
  const [history, setHistory] = useState<Route[]>([{ name: 'today' }])
  const [creating, setCreating] = useState<CreateKind | null>(null)

  /** Ustala widok na podstawie sesji; po pełnym logowaniu odblokowuje klucze, jeśli w tej karcie podano hasło. */
  const enter = useCallback(async (wrapKey: CryptoKey | null = null, notice?: string) => {
    try {
      const me = await call('auth.me', {})
      const account = await call('auth.account', {})
      if (!me.totpVerified) return setView(account.totpEnabled ? { name: 'login', resumeCode: true } : { name: 'totpSetup', wrapKey })
      if (wrapKey) await unlockKeys(wrapKey, me.userId).catch(() => false)
      setHistory([{ name: 'today' }])
      setView({ name: 'app', session: { me, account, settings: await call('settings.get', {}) }, notice })
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
        if (health.status === 'setup') {
          // Brak APP_SECRET: podpowiadamy losową wartość (powstaje tutaj, w przeglądarce; serwer jej nie zna).
          const appSecretHint = health.missing.includes('APP_SECRET') ? toBase64Url(crypto.getRandomValues(new Uint8Array(48))) : undefined
          return setView({ name: 'message', text: pl.app.setupNeeded(health.missing.join(', ')), appSecretHint })
        }
        const token = inviteTokenFromHash()
        return token ? setView({ name: 'invite', token }) : enter()
      })
      .catch(() => setView({ name: 'message', text: pl.app.serverError }))
  }, [enter])

  const toLogin = () => {
    lockKeys()
    // link z zaproszenia znika z paska adresu (i z historii tej karty)
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
    setView({ name: 'login', resumeCode: false })
  }
  const logout = useCallback(() => void call('auth.logout', {}).catch(() => undefined).then(toLogin), [])

  const refreshSession = useCallback(async () => {
    const session = await loadSession()
    setView((v) => (v.name === 'app' || v.name === 'changePassword' ? { ...v, session } : v))
  }, [])

  const session = view.name === 'app' ? view.session : null
  const ctx = useMemo<AppContextValue | null>(() => {
    if (!session) return null
    return {
      session,
      refreshSession,
      route: history[history.length - 1]!,
      go: (r) => setHistory((h) => [...h.slice(-30), r]),
      back: () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)),
      canGoBack: history.length > 1,
      roleLabel: (r) => session.settings.roleLabels[r] || pl.roles[r],
      moduleOn: (m) => session.settings.enabledModules.includes(m),
      canWrite: session.me.role !== 'readonly',
      create: setCreating,
      logout
    }
  }, [session, history, refreshSession, logout])

  switch (view.name) {
    case 'loading':
      return <p className="p-10 text-muted-foreground">{pl.app.loading}</p>
    case 'message':
      return (
        <AuthCard title={pl.app.name} wide>
          <p className="mt-4 text-warning">{view.text}</p>
          {view.appSecretHint && (
            <>
              <p className="mt-4 text-sm text-muted-foreground">{pl.setup.appSecretHint}</p>
              <p className="mt-1 select-all break-all rounded-control bg-muted px-3 py-2 font-mono text-sm">{view.appSecretHint}</p>
            </>
          )}
        </AuthCard>
      )
    case 'setup':
      return <SetupWizard onDone={toLogin} />
    case 'invite':
      return <InviteScreen token={view.token} onDone={toLogin} />
    case 'login':
      return <LoginScreen key={String(view.resumeCode)} resumeCode={view.resumeCode} onSignedIn={(wrapKey) => enter(wrapKey)} onTotpSetup={(wrapKey) => setView({ name: 'totpSetup', wrapKey })} />
    case 'totpSetup':
      return <TotpSetupScreen onDone={() => enter(view.wrapKey)} onCancel={logout} />
    case 'changePassword':
      return (
        <ChangePasswordScreen
          userId={view.session.me.userId}
          email={view.session.account.email}
          onDone={(wrapKey) => enter(wrapKey, pl.home.passwordChanged)}
          onCancel={() => setView({ ...view, name: 'app', notice: undefined })}
          onSignedOut={toLogin}
        />
      )
    case 'app':
      return (
        <AppContext.Provider value={ctx}>
          <Layout>
            {ctx!.route.name === 'settings' ? (
              <SettingsScreen
                me={view.session.me}
                account={view.session.account}
                keysUnlocked={keysUnlocked()}
                onChangePassword={() => setView({ ...view, name: 'changePassword' })}
                onSignedOut={toLogin}
              />
            ) : (
              <RouteView route={ctx!.route} name={view.session.account.name} notice={view.notice} />
            )}
          </Layout>
          {(creating === 'person' || creating === 'institution') && <ContactForm kind={creating} onClose={() => setCreating(null)} onSaved={(id) => ctx!.go({ name: 'contact', id })} />}
          {creating === 'action' && <ActionForm onClose={() => setCreating(null)} onSaved={(id) => ctx!.go({ name: 'action', id })} />}
          {(creating === 'note' || creating === 'contactEntry') && (
            <ActivityDialog type={creating === 'note' ? 'note' : 'contact'} onClose={() => setCreating(null)} onSaved={(id) => ctx!.go({ name: 'contact', id })} />
          )}
        </AppContext.Provider>
      )
  }
}

function RouteView({ route, name, notice }: { route: Exclude<Route, { name: 'settings' }>; name: string; notice?: string }) {
  switch (route.name) {
    case 'today':
      return <TodayScreen name={name} notice={notice} />
    case 'contacts':
      return <ContactsList />
    case 'contact':
      return <ContactCard key={route.id} id={route.id} />
    case 'actions':
      return <ActionsList />
    case 'action':
      return <ActionDetailView key={route.id} id={route.id} />
    case 'topics':
      return <TopicsView />
    case 'topic':
      return <TopicDetailView key={route.id} id={route.id} />
  }
}
