// Wyszukiwarka osoby / instytucji z bazy (przeniesiona z desktopu).
import { useEffect, useState } from 'react'
import { Building2, User } from 'lucide-react'
import type { ContactListItem } from '@shared/types'
import { pl } from '../i18n/pl'
import { call } from '../lib/api'
import { Input } from './ui'

export function ContactPicker({
  onPick,
  kind = 'all',
  exclude = [],
  placeholder = pl.contacts.pickContact
}: {
  onPick: (c: ContactListItem) => void
  kind?: 'person' | 'institution' | 'all'
  exclude?: string[]
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<ContactListItem[]>([])
  const excludeKey = exclude.join(',')

  useEffect(() => {
    if (!q.trim()) {
      setItems([])
      return
    }
    const skip = new Set(excludeKey.split(','))
    const t = setTimeout(
      () =>
        void call('contacts.list', { kind, q })
          .then((r) => setItems(r.filter((c) => !skip.has(c.id)).slice(0, 12)))
          .catch(() => setItems([])),
      150
    )
    return () => clearTimeout(t)
  }, [q, kind, excludeKey])

  return (
    <div className="relative">
      <Input autoFocus placeholder={placeholder} aria-label={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {items.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg">
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                onPick(c)
                setQ('')
              }}
            >
              {c.kind === 'person' ? <User size={14} /> : <Building2 size={14} />}
              <span className="font-medium">{c.label}</span>
              <span className="text-xs text-muted-foreground">{[c.email, c.phone, c.city].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
