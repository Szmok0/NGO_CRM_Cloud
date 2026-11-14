import { describe, expect, it } from 'vitest'
import { AVATAR_COLORS, avatarClass, avatarColor, initials } from './avatar'

describe('awatar', () => {
  it('ten sam id → ten sam kolor, z palety', () => {
    const id = '7d1f3c2a-0000-4000-8000-000000000001'
    expect(avatarColor(id)).toBe(avatarColor(id))
    expect(AVATAR_COLORS).toContain(avatarColor(id))
  })

  it('klasa tła ma ten sam kolor co avatarColor (CSP: bez atrybutu style)', () => {
    for (let i = 0; i < 20; i++) expect(avatarClass(`id-${i}`)).toBe(`bg-[${avatarColor(`id-${i}`)}]`)
  })

  it('różne id rozkładają się na kilka kolorów', () => {
    const colors = new Set(Array.from({ length: 50 }, (_, i) => avatarColor(`id-${i}`)))
    expect(colors.size).toBeGreaterThan(3)
  })

  it('inicjały z imienia i nazwiska', () => {
    expect(initials('Anna Koordynatorka')).toBe('AK')
    expect(initials('  łucja   żmijewska kowalska ')).toBe('ŁŻ')
    expect(initials('Stowarzyszenie')).toBe('S')
  })
})
