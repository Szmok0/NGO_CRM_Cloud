// Kreator zmiany klucza organizacji (D9): wyjaśnienie → nowy klucz odzyskiwania do wydruku (potwierdzenie 4 ostatnich znaków)
// → przeszyfrowanie z paskiem postępu → koniec. Przerwaną zmianę (odświeżenie, blokada, błąd) można wznowić.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button, Card, ErrorNote, InfoNote, InputField } from '../components/ui'
import { pl } from '../i18n/pl'
import { errorMessage } from '../lib/api'
import { barWidth } from '../lib/bar'
import { useKeyring } from '../lib/keyring'
import { newRecoveryKey, reencryptAll, rotationInProgress, startRotation, type NewRecoveryKey } from '../lib/rotation'

type Step = 'idle' | 'intro' | 'recovery' | 'running' | 'done'

interface Props {
  orgName: string
  /** Rośnie, gdy baner po odebraniu dostępu prosi o otwarcie kreatora. */
  openRequest: number
}

export function RotateKeyCard({ orgName, openRequest }: Props) {
  const { unlocked, hasOrgAccess } = useKeyring()
  const [step, setStep] = useState<Step>('idle')
  const [started, setStarted] = useState(false)
  const [recovery, setRecovery] = useState<NewRecoveryKey | null>(null)
  const [confirm, setConfirm] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const ready = unlocked && hasOrgAccess

  // Po odświeżeniu: jeśli zmiana już trwa, od razu proponujemy dokończenie.
  useEffect(() => {
    if (!ready) return
    rotationInProgress()
      .then((r) => {
        if (!r) return
        setStarted(true)
        setStep((s) => (s === 'idle' ? 'running' : s))
      })
      .catch(() => undefined)
  }, [ready])

  useEffect(() => {
    if (openRequest === 0) return
    setStep((s) => (s === 'idle' ? 'intro' : s))
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [openRequest])

  async function toRecovery() {
    setBusy(true)
    setError(null)
    try {
      setRecovery(await newRecoveryKey())
      setConfirm('')
      setStep('recovery')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  /** Start (z nowym kluczem odzyskiwania) albo wznowienie; po błędzie przycisk „Spróbuj ponownie” zaczyna od pierwszej partii. */
  async function run(start?: NewRecoveryKey) {
    setBusy(true)
    setError(null)
    setStep('running')
    try {
      if (start) {
        await startRotation(start)
        setStarted(true)
        setRecovery(null)
      }
      await reencryptAll((done, total) => setProgress({ done, total }))
      setStarted(false)
      setStep('done')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function submitRecovery(e: FormEvent) {
    e.preventDefault()
    if (!recovery) return
    if (confirm.trim().toUpperCase() !== recovery.text.slice(-4)) return setError(pl.setup.recovery.confirmWrong)
    void run(recovery)
  }

  /** Drukuje tylko klucz: reszta aplikacji jest w druku ukryta (styles.css, klasa na body). */
  function print() {
    document.body.classList.add('print-recovery')
    window.print()
    document.body.classList.remove('print-recovery')
  }

  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <div ref={ref}>
      <Card title={pl.rotate.title}>
        {step === 'idle' && (
          <>
            <p className="text-sm text-secondary-foreground">{pl.rotate.summary}</p>
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={() => setStep('intro')} disabled={!ready}>
                {pl.rotate.open}
              </Button>
              {!ready && <p className="mt-2 text-xs text-muted-foreground">{pl.rotate.needAccess}</p>}
            </div>
          </>
        )}

        {step === 'intro' && (
          <>
            <p className="text-sm text-secondary-foreground">{pl.rotate.intro}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-secondary-foreground">
              {pl.rotate.points.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <ErrorNote>{error}</ErrorNote>
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={toRecovery} disabled={busy}>
                {pl.rotate.next}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setStep('idle')} disabled={busy}>
                {pl.rotate.cancel}
              </Button>
            </div>
          </>
        )}

        {step === 'recovery' && recovery && (
          <>
            <p className="rounded-control border border-warning-border bg-warning-bg px-3 py-2 text-sm font-medium text-orange">{pl.setup.recovery.warning}</p>
            <p className="mt-3 text-sm text-secondary-foreground">{pl.rotate.recoveryIntro}</p>
            <div className="mt-4 rounded-control border border-border p-4">
              <p className="select-all break-words font-mono text-lg leading-relaxed tracking-wide">{recovery.text}</p>
            </div>
            {createPortal(
              <div className="hidden print:block">
                <p className="text-sm font-semibold">{pl.setup.recovery.printTitle}</p>
                <p className="text-sm">{pl.setup.recovery.printOrg(orgName)}</p>
                <p className="mt-2 break-words font-mono text-lg leading-relaxed tracking-wide">{recovery.text}</p>
              </div>,
              document.body
            )}
            <form onSubmit={submitRecovery}>
              <div className="mt-4">
                <Button type="button" variant="outline" size="sm" onClick={print}>
                  {pl.setup.recovery.print}
                </Button>
              </div>
              <InputField label={pl.setup.recovery.confirm} hint={pl.setup.recovery.confirmHint} value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={4} autoComplete="off" required />
              <ErrorNote>{error}</ErrorNote>
              <div className="mt-4 flex gap-2">
                <Button type="submit" size="sm" disabled={busy || confirm.trim().length !== 4}>
                  {pl.rotate.start}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => (setRecovery(null), setStep('idle'))} disabled={busy}>
                  {pl.rotate.cancel}
                </Button>
              </div>
            </form>
          </>
        )}

        {step === 'running' && (
          <>
            <p className="text-sm text-secondary-foreground">{busy ? pl.rotate.running : started ? pl.rotate.resume : pl.rotate.running}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
              <div className={`h-full rounded-full bg-primary ${barWidth(pct)}`} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{progress ? pl.rotate.progress(progress.done, progress.total) : pl.rotate.preparing}</p>
            <ErrorNote>{error}</ErrorNote>
            {!busy && (
              <div className="mt-4">
                <Button size="sm" onClick={() => void run()} disabled={!ready}>
                  {error ? pl.rotate.retry : pl.rotate.continue}
                </Button>
                {!ready && <p className="mt-2 text-xs text-muted-foreground">{pl.rotate.needAccess}</p>}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{pl.rotate.keepOpen}</p>
          </>
        )}

        {step === 'done' && (
          <>
            <InfoNote>{pl.rotate.done}</InfoNote>
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={() => (setProgress(null), setStep('idle'))}>
                {pl.rotate.close}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
