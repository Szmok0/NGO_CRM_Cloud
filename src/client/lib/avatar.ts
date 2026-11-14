// Awatary z inicjałami. Paleta z makiety; każdy kolor ma kontrast z białym tekstem ≥ 4,5:1.
export const AVATAR_COLORS = ['#0F7F73', '#6D3FC0', '#C2416B', '#B4530A', '#2E5BBA', '#11703D'] as const

/** Te same kolory jako klasy (CSP blokuje atrybut style); kolejność jak w AVATAR_COLORS. */
const AVATAR_CLASSES = ['bg-[#0F7F73]', 'bg-[#6D3FC0]', 'bg-[#C2416B]', 'bg-[#B4530A]', 'bg-[#2E5BBA]', 'bg-[#11703D]'] as const

/** Indeks koloru stały dla danego id (FNV-1a). */
function avatarIndex(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % AVATAR_COLORS.length
}

/** Stały kolor dla danego id. */
export const avatarColor = (id: string): string => AVATAR_COLORS[avatarIndex(id)]!

/** Klasa tła awatara dla danego id. */
export const avatarClass = (id: string): string => AVATAR_CLASSES[avatarIndex(id)]!

/** Inicjały: pierwsze litery dwóch pierwszych słów. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toLocaleUpperCase('pl-PL'))
    .join('')
}
