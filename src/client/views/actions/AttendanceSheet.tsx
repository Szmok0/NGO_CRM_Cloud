// Lista obecności do druku z przeglądarki (w desktopie PDF z Electrona). Widoczna tylko przy drukowaniu (`hidden print:block`).
import type { ActionDetail } from '@shared/types'
import { pl } from '../../i18n/pl'
import { dateRange, formatDate, timeRange } from '../../lib/format'

export function AttendanceSheet({ detail, orgName }: { detail: ActionDetail; orgName: string }) {
  const a = detail.action
  const people = detail.participants.filter((p) => p.status !== 'resigned' && !p.contact.deleted)
  const sessions = detail.sessions
  const leaders = [...new Set(sessions.map((s) => s.leader?.label).filter(Boolean))]
  const columns = sessions.length ? sessions : [null]

  return (
    <div className="hidden bg-white p-2 text-[11pt] text-black print:block">
      <div className="mb-1 text-[10pt]">{orgName}</div>
      <h1 className="mb-1 text-[16pt] font-bold">{pl.print.title}</h1>
      <h2 className="mb-2 text-[13pt] font-semibold">{a.title}</h2>
      <div className="mb-3 flex flex-wrap gap-x-6 text-[10pt]">
        <span>
          {pl.print.term}: {dateRange(a.startDate, a.endDate) || pl.common.none}
        </span>
        <span>
          {pl.print.place}: {a.place || pl.common.none}
        </span>
        {leaders.length > 0 && (
          <span>
            {pl.print.trainer}: {leaders.join(', ')}
          </span>
        )}
      </div>
      <table className="w-full border-collapse text-[10pt]">
        <thead>
          <tr>
            <th className="w-10 border border-black px-1 py-1">{pl.print.lp}</th>
            <th className="w-56 border border-black px-2 py-1 text-left">{pl.print.name}</th>
            {columns.map((s, i) => (
              <th key={s?.id ?? i} className="border border-black px-1 py-1 text-center font-normal">
                {s ? (
                  <>
                    <div className="font-semibold">{formatDate(s.date)}</div>
                    <div className="text-[8pt]">{timeRange(s.startTime, s.endTime)}</div>
                  </>
                ) : (
                  pl.print.signature
                )}
                {s && <div className="text-[8pt] italic">{pl.print.signature}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((p, i) => (
            <tr key={p.id} className="h-9 break-inside-avoid">
              <td className="border border-black text-center">{i + 1}</td>
              <td className="border border-black px-2">{p.contact.label}</td>
              {columns.map((s, j) => (
                <td key={s?.id ?? j} className="border border-black" />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
