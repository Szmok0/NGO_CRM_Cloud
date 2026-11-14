// Własna deklaracja typów dla biblioteki `qrcode` (decyzja MOC: bez @types/qrcode).
// Tylko to, czego używamy: kod QR jako tekst SVG.
declare module 'qrcode' {
  interface SvgOptions {
    type: 'svg'
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    margin?: number
  }
  const qrcode: {
    toString(text: string, options: SvgOptions): Promise<string>
  }
  export default qrcode
}
