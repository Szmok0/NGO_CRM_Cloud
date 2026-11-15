// Mini-kalendarz bieżącego miesiąca na „Dziś” (przeniesiony z desktopu).
import { useCallback, useMemo } from 'react'
import type { CalendarEntry } from '@shared/calendar'
import { monthGrid, weekday } from '@shared/dates'
import { holidayOn } from '@shared/holidays'
import { useApp } from '../app/context'
import { pl } from '../i18n/pl'
import { useDataChanged, useLoad } from '../lib/api'
import { entryTone } from '../lib/calendarUi'
import { cn } from '../lib/cn'
import { longDate, monthTitle, todayYmd } from '../lib/format'
import { Card } from './ui'

/** Mini-kalendarz bieżącego miesiąca z kropkami w kolorze wpisu; klik dnia → Kalendarz. */
export function MiniCalendar() {
  const { go } = useApp()
  const today = todayYmd()
  const days = useMemo(() => monthGrid(today), [today])
  const { data, reload } = useLoad('calendar.entries', { from: days[0]!, to: days[days.length - 1]! })
  useDataChanged(useCallback(() => reload(), [reload]))

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>()
    for (const e of data?.entries ?? []) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return m
  }, [data])
  const month = today.slice(0, 7)

  return (
    <Card
      title={monthTitle(today)}
      actions={
        <button type="button" className="cursor-pointer text-[13px] font-semibold text-primary hover:text-primary-hover hover:underline" onClick={() => go({ name: 'calendar' })}>
          {pl.today.openCalendar}
        </button>
      }
      flush
    >
      <div className="grid grid-cols-7 gap-0.5 px-3.5 pt-2.5 pb-3.5 text-center">
        {pl.time.weekdaysMini.map((w) => (
          <div key={w} aria-hidden="true" className="py-1 text-[11px] font-semibold text-muted-foreground">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const entries = byDay.get(d) ?? []
          const inMonth = d.startsWith(month)
          const isToday = d === today
          const holiday = holidayOn(d)
          const first = entries[0]
          return (
            <button
              key={d}
              type="button"
              onClick={() => go({ name: 'calendar', date: d, mode: 'list' })}
              aria-label={pl.calendar.dayLabel(longDate(d), entries.length) + (holiday ? `, ${pl.calendar.holidays[holiday]}` : '')}
              title={holiday ? pl.calendar.holidays[holiday] : undefined}
              className={cn(
                'flex h-9.5 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[10px] text-[13px] hover:bg-subtle',
                isToday && 'bg-primary font-bold text-white hover:bg-primary-hover',
                !isToday && !inMonth && 'text-faint',
                !isToday && inMonth && (holiday ? 'font-semibold text-destructive' : weekday(d) >= 5 ? 'text-muted-foreground' : 'text-foreground')
              )}
            >
              <span>{Number(d.slice(8))}</span>
              <span aria-hidden="true" className={cn('h-1.25 w-1.25 rounded-full', first ? (isToday ? 'bg-white' : entryTone(first).dot) : 'bg-transparent')} />
            </button>
          )
        })}
      </div>
    </Card>
  )
}
