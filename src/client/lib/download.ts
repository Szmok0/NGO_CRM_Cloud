// Zapis tekstu do pliku z przeglądarki (w desktopie okno „Zapisz jako” z Electrona): plik powstaje w przeglądarce,
// serwer go nie widzi. Link `blob:` to pobranie, nie połączenie, więc CSP (`connect-src 'self'`) go nie blokuje.
export function downloadText(fileName: string, content: string, type: string): void {
  downloadBlob(fileName, new Blob([content], { type }))
}

/** Pobranie bajtów (np. odszyfrowanego załącznika) pod podaną nazwą; typ nadaje wywołujący. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
