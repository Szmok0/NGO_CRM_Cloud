// Kosz: usunięte osoby, działania, zadania i tematy z przywracaniem (przeniesiony z desktopu; przywrócenie odsyła `version`).
import { useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { TrashItem } from '@shared/types'
import { useApp } from '../app/context'
import { AnonymizeDialog } from '../components/AnonymizeDialog'
import { Badge, Button, Card, EmptyState, ErrorText, PageHeader, Table } from '../components/ui'
import { pl } from '../i18n/pl'
import { call, errorMessage, useLoad } from '../lib/api'
import { formatDateTime } from '../lib/format'

export function TrashView() {
  const { canWrite, session } = useApp()
  const isAdmin = session.me.role === 'admin'
  const { data, error, reload } = useLoad('trash.list', {})
  const [actionError, setActionError] = useState('')
  const [anonymizing, setAnonymizing] = useState<TrashItem | null>(null)

  const restore = async (t: TrashItem) => {
    setActionError('')
    try {
      await call('trash.restore', { entity: t.entity, id: t.id, version: t.version })
      reload()
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  return (
    <div>
      <PageHeader title={pl.trash.title} sub={pl.trash.hint} />
      <ErrorText>{error ?? actionError}</ErrorText>
      <Card flush>
        {data?.length === 0 && <EmptyState icon={<Trash2 size={20} />} text={pl.trash.empty} />}
        {data && data.length > 0 && (
          <div className="px-3 pb-2">
            <Table>
              <thead>
                <tr>
                  <th>{pl.trash.what}</th>
                  <th>{pl.contacts.name}</th>
                  <th>{pl.trash.deletedAt}</th>
                  <th>{pl.trash.deletedBy}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.entity + t.id}>
                    <td>
                      <Badge>{t.kind ? pl.contacts.kind[t.kind] : pl.trash.entity[t.entity]}</Badge>
                    </td>
                    <td className="font-semibold">{t.label || pl.contacts.anonymized}</td>
                    <td>{formatDateTime(t.deletedAt)}</td>
                    <td>{t.deletedBy}</td>
                    <td className="text-right">
                      {canWrite && (
                        <Button size="sm" variant="outline" onClick={() => void restore(t)}>
                          <RotateCcw size={13} /> {pl.trash.restore}
                        </Button>
                      )}
                      {isAdmin && t.entity === 'contacts' && t.kind === 'person' && t.label && (
                        <Button size="sm" variant="ghost" className="ml-1 text-destructive" onClick={() => setAnonymizing(t)}>
                          {pl.contacts.anonymizeButton}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      {anonymizing && <AnonymizeDialog contactId={anonymizing.id} label={anonymizing.label} onClose={() => setAnonymizing(null)} onDone={reload} />}
    </div>
  )
}
