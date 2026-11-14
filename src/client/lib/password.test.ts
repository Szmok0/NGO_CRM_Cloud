import { describe, expect, it } from 'vitest'
import { pl } from '../i18n/pl'
import { passwordProblem } from './password'

describe('wymagania co do hasła (sprawdzane w przeglądarce)', () => {
  it('dobre hasła przechodzą', () => {
    for (const ok of ['konik-lampa-rzeka-41', 'Zielony Parasol Tańczy!', 'x7#Lq2!vB9@m']) expect(passwordProblem(ok, 'osoba@example.invalid')).toBeNull()
  })

  it('krótsze niż 12 znaków → odmowa', () => {
    expect(passwordProblem('krotkie123!')).toBe(pl.passwordRules.tooShort)
    expect(passwordProblem('')).toBe(pl.passwordRules.tooShort)
  })

  it('zbyt proste: powtórzenia i oczywiste ciągi', () => {
    for (const bad of ['aaaaaaaaaaaaaa', 'abababababab', 'password123456', 'haslohaslo123456', 'qwertyqwerty1']) {
      expect(passwordProblem(bad)).toBe(pl.passwordRules.tooSimple)
    }
  })

  it('zawiera adres e-mail albo jego część przed @ → odmowa', () => {
    expect(passwordProblem('anna.testowa@example.invalid!1', 'anna.testowa@example.invalid')).toBe(pl.passwordRules.containsEmail)
    expect(passwordProblem('Anna.Testowa-2026-xyz', 'anna.testowa@example.invalid')).toBe(pl.passwordRules.containsEmail)
  })
})
