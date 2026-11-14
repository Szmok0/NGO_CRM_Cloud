// Kod QR do konfiguracji 2FA: obrazek SVG tworzony na serwerze (biblioteka `qrcode`).
// SVG ma tylko atrybuty (bez <style>, style="" i skryptów), więc nie koliduje ze ścisłą CSP.
import qrcode from 'qrcode'

export function qrSvg(text: string): Promise<string> {
  return qrcode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
}
