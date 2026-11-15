// Ustawienia: własne konto (dla każdego), ustawienia organizacji i użytkownicy programu (tylko administrator).
import { useState } from 'react'
import type { AccessListItem, ApiOutputs, InviteLink, Role, UserListItem } from '@shared/api'
import { ROLES } from '@shared/api'
import { Alert, Badge, Button, Card, ErrorNote, InputField, SelectField } from '../components/ui'
import { UnlockDialog } from '../components/UnlockDialog'
import { createSlot, importPublicKey } from '../crypto/keys'
import { pl } from '../i18n/pl'
import { call, errorMessage, isApiError, useLoad } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { openExportableOrgKeys, useKeyring } from '../lib/keyring'
import { AccessLogCard } from './AccessLogCard'
import { BackupsCard } from './BackupsCard'
import { OrgSettingsCard } from './OrgSettingsCard'
import { RecoverAccessCard } from './RecoverAccessCard'
import { RotateKeyCard } from './RotateKeyCard'

interface Props {
  me: ApiOutputs['auth.me']
  account: ApiOutputs['auth.account']
  onChangePassword: () => void
  onSignedOut: () => void
}

export function SettingsScreen({ me, account, onChangePassword, onSignedOut }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState(false)
  const { unlocked, hasOrgAccess } = useKeyring()
  const [rotateRequest, setRotateRequest] = useState(0)

  async function logoutAll() {
    try {
      await call('auth.logoutAll', {})
      onSignedOut()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">{pl.settings.title}</h1>
      <div className="mt-6 space-y-6">
        <Card
          title={pl.home.account}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onChangePassword}>
                {pl.home.changePassword}
              </Button>
              <Button variant="outline" size="sm" onClick={logoutAll}>
                {pl.home.logoutAll}
              </Button>
            </div>
          }
        >
          <ErrorNote>{error}</ErrorNote>
          <dl className="mt-4 grid grid-cols-[14rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">{pl.settings.organization}</dt>
            <dd>{account.orgName}</dd>
            <dt className="text-muted-foreground">{pl.home.email}</dt>
            <dd>{account.email}</dd>
            <dt className="text-muted-foreground">{pl.home.role}</dt>
            <dd>{pl.userRoles[me.role]}</dd>
            <dt className="text-muted-foreground">{pl.home.keys}</dt>
            <dd className={unlocked ? 'text-success' : 'text-warning'}>
              {unlocked ? (hasOrgAccess ? pl.home.keysUnlocked : pl.home.keysNoAccess) : pl.home.keysLocked}
              {!unlocked && (
                <Button className="ml-3" variant="outline" size="sm" onClick={() => setUnlocking(true)}>
                  {pl.unlock.open}
                </Button>
              )}
            </dd>
          </dl>
        </Card>
        {unlocking && <UnlockDialog userId={me.userId} onClose={() => setUnlocking(false)} />}
        {me.role === 'admin' && unlocked && !hasOrgAccess && <RecoverAccessCard onDone={() => undefined} />}
        {me.role === 'admin' && <OrgSettingsCard />}
        {me.role === 'admin' && <RotateKeyCard orgName={account.orgName} openRequest={rotateRequest} />}
        {me.role === 'admin' && <UsersPanel onRotate={() => setRotateRequest((n) => n + 1)} myId={me.userId} userKeysReady={unlocked && hasOrgAccess} onUnlock={() => setUnlocking(true)} onSignedOut={onSignedOut} />}
        {me.role === 'admin' && <BackupsCard storageConfigured={me.storageConfigured} email={account.email} />}
        {me.role === 'admin' && <AccessLogCard />}
      </div>
    </>
  )
}

const STATUS_TONE = { invited: 'info', active: 'success', disabled: 'muted' } as const
const inviteUrl = (token: string) => `${window.location.origin}/#zaproszenie=${token}`

function UsersPanel({ myId, userKeysReady, onUnlock, onSignedOut, onRotate }: { onRotate: () => void; myId: string; userKeysReady: boolean; onUnlock: () => void; onSignedOut: () => void }) {
  const { data, error: loadError, reload } = useLoad('users.list', {})
  const { data: access, reload: reloadAccess } = useLoad('access.list', {})
  const [rotateHint, setRotateHint] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('staff')
  const [link, setLink] = useState<{ email: string; link: InviteLink } | null>(null)
  const [copied, setCopied] = useState(false)

  /** Wspólna obsługa akcji: blokada przycisków, komunikat, odświeżenie listy. */
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      if (isApiError(e, 'UNAUTHENTICATED')) return onSignedOut()
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      reload()
      reloadAccess()
    }
  }
  /** Nadanie dostępu (D8): sloty do wszystkich niewycofanych wersji klucza powstają w przeglądarce administratora. */
  async function grant(userId: string, publicKey: string) {
    const keys = await openExportableOrgKeys()
    if (keys.size === 0) throw new Error(pl.access.noOwnAccess)
    const target = await importPublicKey(publicKey)
    const slots = await Promise.all([...keys].map(async ([keyVersion, key]) => ({ keyVersion, wrappedKey: await createSlot(key, target, keyVersion) })))
    await call('access.grant', { userId, slots })
  }
  const accessOf = (u: UserListItem): AccessListItem | undefined => access?.find((a) => a.userId === u.id)
  const showLink = (forEmail: string, l: InviteLink) => {
    setCopied(false)
    setLink({ email: forEmail, link: l })
  }
  const who = (u: UserListItem) => (u.name === u.email ? u.email : `${u.name} (${u.email})`)

  return (
    <Card
      title={pl.users.title}
      actions={
        !inviting && (
          <Button size="sm" onClick={() => (setInviting(true), setLink(null))}>
            {pl.users.invite}
          </Button>
        )
      }
    >
      {inviting && (
        <form
          className="mt-4 rounded-control border border-border bg-subtle p-4"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const mail = email.trim().toLowerCase()
              showLink(mail, await call('users.invite', { email: mail, role }))
              setInviting(false)
              setEmail('')
            })
          }}
        >
          <h3 className="text-sm font-semibold">{pl.users.inviteTitle}</h3>
          <div className="grid grid-cols-2 gap-4">
            <InputField label={pl.users.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoFocus required disabled={busy} />
            <SelectField label={pl.users.role} value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={busy}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {pl.userRoles[r]}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {pl.users.inviteSubmit}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setInviting(false)} disabled={busy}>
              {pl.users.cancel}
            </Button>
          </div>
        </form>
      )}

      {link && (
        <div className="mt-4 rounded-control border border-warning-border bg-warning-bg p-4">
          <h3 className="text-sm font-semibold">{pl.users.linkTitle}</h3>
          <p className="mt-1 text-sm text-secondary-foreground">{pl.users.linkIntro(link.email, formatDateTime(link.link.expiresAt))}</p>
          <p className="mt-2 select-all break-all rounded-control bg-background px-3 py-2 font-mono text-xs">{inviteUrl(link.link.token)}</p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={() => void navigator.clipboard.writeText(inviteUrl(link.link.token)).then(() => setCopied(true))}>
              {copied ? pl.users.copied : pl.users.copy}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLink(null)}>
              {pl.users.close}
            </Button>
          </div>
        </div>
      )}

      {rotateHint && (
        <div className="mt-4">
          <Alert tone="warning">
            <p className="font-semibold">{pl.access.rotateTitle}</p>
            <p className="mt-1">{pl.access.rotateText}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => (setRotateHint(false), onRotate())}>
                {pl.access.rotateAction}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRotateHint(false)}>
                {pl.access.rotateDismiss}
              </Button>
            </div>
          </Alert>
        </div>
      )}
      <ErrorNote>{error ?? loadError}</ErrorNote>
      {!data && !loadError && <p className="mt-4 text-sm text-muted-foreground">{pl.app.loading}</p>}
      {data && (
        <table className="mt-4 w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">{pl.users.name}</th>
              <th className="py-2 pr-3 font-medium">{pl.users.role}</th>
              <th className="py-2 pr-3 font-medium">{pl.users.status}</th>
              <th className="py-2 pr-3 font-medium">{pl.users.twoFactor}</th>
              <th className="py-2 pr-3 font-medium">{pl.users.lastLogin}</th>
              <th className="py-2 pr-3 font-medium">{pl.access.column}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className="border-b border-line align-top">
                <td className="py-2.5 pr-3">
                  <div className="font-medium">
                    {u.name === u.email ? '—' : u.name} {u.id === myId && <span className="font-normal text-muted-foreground">{pl.users.you}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="py-2.5 pr-3">
                  <select
                    aria-label={`${pl.users.role}: ${u.email}`}
                    className="rounded-control border border-input bg-background px-2 py-1 text-sm disabled:bg-muted disabled:text-faint"
                    value={u.role}
                    disabled={busy || u.status === 'disabled'}
                    onChange={(e) => {
                      const next = e.target.value as Role
                      if (window.confirm(pl.users.confirmRole(who(u), pl.userRoles[next]))) void run(() => call('users.setRole', { id: u.id, version: u.version, role: next }))
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {pl.userRoles[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2.5 pr-3">
                  <Badge tone={STATUS_TONE[u.status]}>{pl.users.statuses[u.status]}</Badge>
                  {u.status === 'invited' && <div className="mt-1 text-xs text-muted-foreground">{u.inviteExpiresAt ? pl.users.inviteUntil(formatDateTime(u.inviteExpiresAt)) : pl.users.inviteExpired}</div>}
                </td>
                <td className="py-2.5 pr-3">{u.totpEnabled ? pl.users.twoFactorOn : pl.users.twoFactorOff}</td>
                <td className="py-2.5 pr-3">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : pl.users.never}</td>
                <td className="py-2.5 pr-3">
                  {(() => {
                    const a = accessOf(u)
                    if (!a) return '—'
                    if (a.hasAccess)
                      return (
                        <div className="flex items-center gap-2">
                          <Badge tone="success">{pl.access.has}</Badge>
                          {u.id !== myId && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                window.confirm(pl.access.confirmRevoke(who(u))) &&
                                void run(async () => {
                                  if ((await call('access.revoke', { userId: u.id })).hadAccess) setRotateHint(true)
                                })
                              }
                            >
                              {pl.access.revoke}
                            </Button>
                          )}
                        </div>
                      )
                    if (!a.publicKey) return <span className="text-xs text-muted-foreground">{u.status === 'active' ? pl.access.noKey : '—'}</span>
                    return (
                      <div className="flex items-center gap-2">
                        <Badge tone="muted">{pl.access.none}</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            if (!userKeysReady) return onUnlock()
                            void run(() => grant(u.id, a.publicKey!))
                          }}
                        >
                          {pl.access.grant}
                        </Button>
                      </div>
                    )
                  })()}
                </td>
                <td className="py-2.5 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (u.status === 'invited' || window.confirm(pl.users.confirmReset(who(u)))) void run(async () => {
                          const r = await call('users.reset', { id: u.id, version: u.version })
                          showLink(u.email, r)
                          if (r.hadAccess) setRotateHint(true)
                        })
                      }}
                    >
                      {u.status === 'invited' ? pl.users.resend : pl.users.reset}
                    </Button>
                    {u.status !== 'disabled' && (
                      <Button variant="danger" size="sm" disabled={busy} onClick={() => window.confirm(pl.users.confirmDisable(who(u))) && void run(async () => {
                            if ((await call('users.disable', { id: u.id, version: u.version })).hadAccess) setRotateHint(true)
                          })
                        }>
                        {pl.users.disable}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
