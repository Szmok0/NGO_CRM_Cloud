// Szerokość paska postępu jako klasa (CSP blokuje atrybut style; w desktopie `style={{ width }}`), w krokach co 10%.
const BAR_WIDTH = ['w-0', 'w-[10%]', 'w-[20%]', 'w-[30%]', 'w-[40%]', 'w-[50%]', 'w-[60%]', 'w-[70%]', 'w-[80%]', 'w-[90%]', 'w-full'] as const

export const barWidth = (pct: number | null): string => BAR_WIDTH[Math.round(Math.min(100, Math.max(0, pct ?? 0)) / 10)]!
