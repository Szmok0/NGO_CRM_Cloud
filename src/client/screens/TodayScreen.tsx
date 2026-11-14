// Pusty ekran „Dziś” (moduły dojdą w ZADANIU_02).
import { Sun } from 'lucide-react'
import { InfoNote } from '../components/ui'
import { pl } from '../i18n/pl'

export function TodayScreen({ name, notice }: { name: string; notice?: string | null }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">{pl.home.title}</h1>
      <InfoNote>{notice}</InfoNote>
      <p className="mt-6 text-lg">{pl.home.greeting(name)}</p>
      <div className="mt-6 flex flex-col items-center gap-2 rounded-card border border-border bg-background py-12 text-center shadow-card">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Sun size={20} />
        </span>
        <p className="max-w-md text-sm text-muted-foreground">{pl.home.empty}</p>
      </div>
    </>
  )
}
