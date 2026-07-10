import { describe, it, expect } from 'vitest'
import { createRng } from '../src/sim/rng'

describe('createRng', () => {
  it('same seed produces the same first 5 floats', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = [a.next(), a.next(), a.next(), a.next(), a.next()]
    const seqB = [b.next(), b.next(), b.next(), b.next(), b.next()]
    expect(seqA).toEqual(seqB)
  })

  it('produces values in [0,1)', () => {
    const rng = createRng(1)
    for (let i = 0; i < 1000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('setState(getState()) roundtrip continues the sequence identically', () => {
    const a = createRng(99)
    a.next()
    a.next()
    const s = a.getState()
    const expected = [a.next(), a.next(), a.next()]

    const b = createRng(0)
    b.setState(s)
    expect([b.next(), b.next(), b.next()]).toEqual(expected)
  })

  it('int(1,3) stays within bounds over 100 draws', () => {
    const rng = createRng(7)
    for (let i = 0; i < 100; i++) {
      const v = rng.int(1, 3)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(3)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('pick returns an element from the array', () => {
    const rng = createRng(5)
    const arr = ['a', 'b', 'c']
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(rng.pick(arr))
    }
  })
})
