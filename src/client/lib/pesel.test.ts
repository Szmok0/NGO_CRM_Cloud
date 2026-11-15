// Numery PESEL fikcyjne (wyliczone tylko pod sumę kontrolną).
import { describe, expect, it } from 'vitest'
import { isValidPesel } from './pesel'

describe('isValidPesel', () => {
  it('przyjmuje poprawne numery z XX i XXI wieku', () => {
    expect(isValidPesel('85031212343')).toBe(true) // 12.03.1985
    expect(isValidPesel('02270803624')).toBe(true) // 08.07.2002
  })

  it('odrzuca złą sumę kontrolną', () => {
    expect(isValidPesel('85031212344')).toBe(false)
    expect(isValidPesel('02270803625')).toBe(false)
  })

  it('odrzuca zły format', () => {
    expect(isValidPesel('')).toBe(false)
    expect(isValidPesel('8503121234')).toBe(false)
    expect(isValidPesel('850312123430')).toBe(false)
    expect(isValidPesel('8503121234a')).toBe(false)
    expect(isValidPesel(' 85031212343')).toBe(false)
  })

  it('odrzuca nieistniejącą datę przy poprawnej sumie', () => {
    expect(isValidPesel('90023000000')).toBe(false) // 30.02.1990
  })
})
