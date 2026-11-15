// Zapis tekstu do pliku z przeglądarki (w desktopie okno „Zapisz jako” z Electrona): plik powstaje w przeglądarce,
// serwer go nie widzi. Link `blob:` to pobranie, nie połączenie, więc CSP (`connect-src 'self'`) go nie blokuje.
export function downloadText(fileName: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
