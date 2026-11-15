// Ustawienia organizacji (tylko administrator): nazwa, dni do „wymaga uwagi”, profil i moduły, własne nazwy ról.
// W desktopie trzy osobne karty; tu jedna z jednym zapisem, bo zapis odsyła `version` całego wiersza ustawień.
import { useState } from 'react'
import { Save } from 'lucide-react'
import { ROLES, type RoleLabels } from '@shared/domain'
import { MODULES, PROFILE_DEFAULT_MODULES, PROFILES, type ModuleId, type Profile } from '@shared/modules'
import { useApp } from '../app/context'
import { Badge, Button, Card, Checkbox, ErrorText, Field, Input, Select } from '../components/ui'
import { pl } from '../i18n/pl'
import { call, errorMessage } from '../lib/api'

/** Moduły, których widoków jeszcze nie ma w wersji chmurowej, pokazujemy jako „wkrótce”. */
const notYetInCloud = new Set<ModuleId>(['knowledge'])

export function OrgSettingsCard() {
  const { session, refreshSession } = useApp()
  const s = session.settings
  const [orgName, setOrgName] = useState(s.orgName)
  const [staleDays, setStaleDays] = useState(String(s.staleDays))
  const [profile, setProfile] = useState<Profile>(s.profile)
  const [enabled, setEnabled] = useState<ModuleId[]>(s.enabledModules)
  const [labels, setLabels] = useState<RoleLabels>(s.roleLabels)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setMsg('')
    setError('')
    setBusy(true)
    try {
      await call('settings.update', { version: s.version, orgName, profile, enabledModules: enabled, roleLabels: labels, staleDays: Number(staleDays) || 30 })
      await refreshSession()
      setMsg(pl.orgSettings.saved)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={pl.orgSettings.title}>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field label={pl.orgSettings.orgName}>
            <Input maxLength={200} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          </Field>
          <Field label={pl.orgSettings.staleDays}>
            <Input type="number" min={1} max={3650} className="w-28" value={staleDays} onChange={(e) => setStaleDays(e.target.value)} />
          </Field>
          <Field label={pl.orgSettings.profile}>
            <div className="flex gap-2">
              <Select value={profile} onChange={(e) => setProfile(e.target.value as Profile)}>
                {PROFILES.map((p) => (
                  <option key={p} value={p}>
                    {pl.profiles[p]}
                  </option>
                ))}
              </Select>
              <Button variant="outline" onClick={() => setEnabled(PROFILE_DEFAULT_MODULES[profile])}>
                {pl.orgSettings.applyProfile}
              </Button>
            </div>
          </Field>
          <fieldset>
            <legend className="text-sm font-medium text-secondary-foreground">{pl.orgSettings.modules}</legend>
            <p className="mb-1.5 text-xs text-muted-foreground">{pl.orgSettings.modulesHint}</p>
            <ul className="grid grid-cols-2 gap-1.5">
              {MODULES.map((m) => {
                const soon = m.status === 'soon' || notYetInCloud.has(m.id)
                return (
                  <li key={m.id}>
                    <label className={`flex items-center gap-2 text-sm ${soon ? 'text-muted-foreground' : ''}`}>
                      <Checkbox
                        disabled={soon || m.alwaysOn}
                        checked={!soon && (m.alwaysOn || enabled.includes(m.id))}
                        onChange={(e) => setEnabled((x) => (e.target.checked ? [...x, m.id] : x.filter((y) => y !== m.id)))}
                      />
                      {pl.modules[m.id]}
                      {soon && <Badge>{pl.orgSettings.soon}</Badge>}
                      {!soon && m.alwaysOn && <span className="text-xs text-muted-foreground">({pl.orgSettings.alwaysOn})</span>}
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-secondary-foreground">{pl.orgSettings.roleNames}</legend>
          <p className="mb-3 text-xs text-muted-foreground">{pl.orgSettings.roleNamesHint}</p>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <Field key={r} label={pl.roles[r]}>
                <Input maxLength={40} placeholder={pl.roles[r]} value={labels[r] ?? ''} onChange={(e) => setLabels({ ...labels, [r]: e.target.value })} />
              </Field>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button disabled={busy || !orgName.trim()} onClick={() => void save()}>
          <Save size={14} /> {pl.orgSettings.save}
        </Button>
        {msg && (
          <span role="status" className="text-sm text-success">
            {msg}
          </span>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  )
}
