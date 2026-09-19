import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../prompt'
import { EMAIL_CATEGORIES, EMAIL_CATEGORY_DEFINITIONS } from '../types'

/** The lines the model reads as its category menu: everything between the heading and RULES. */
function categoryMenu(prompt: string): string[] {
  return prompt
    .slice(prompt.indexOf('CATEGORIES'), prompt.indexOf('RULES:'))
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '')
}

describe('buildSystemPrompt category definitions', () => {
  it('gives the model every category with its one-line definition, so it labels from meanings and not just names', () => {
    const prompt = buildSystemPrompt()

    for (const category of EMAIL_CATEGORIES) {
      expect(prompt).toContain(`- ${category}: ${EMAIL_CATEGORY_DEFINITIONS[category]}`)
    }
  })

  it('offers exactly the categories the schema allows, one per line and in the same order', () => {
    const names = categoryMenu(buildSystemPrompt()).map((line) => line.split(':')[0])

    expect(names).toEqual(EMAIL_CATEGORIES.map((category) => `- ${category}`))
  })

  it('shows the same category menu whether or not a code is being requested, so labels do not depend on that question', () => {
    expect(categoryMenu(buildSystemPrompt({ extractOtp: true }))).toEqual(categoryMenu(buildSystemPrompt()))
  })
})

describe('buildSystemPrompt', () => {
  it('says nothing about one-time codes by default, so a regex hit is never second-guessed', () => {
    const prompt = buildSystemPrompt()

    expect(prompt).not.toMatch(/\botp\b/i)
    expect(prompt).not.toMatch(/one-time/i)
  })

  it('leaves the default prompt identical when extractOtp is explicitly false', () => {
    expect(buildSystemPrompt({ extractOtp: false })).toBe(buildSystemPrompt())
  })

  describe('with extractOtp', () => {
    const prompt = buildSystemPrompt({ extractOtp: true })

    it('asks for an otp field and shows it in the JSON shape the model must match', () => {
      expect(prompt).toMatch(/- otp:/)
      expect(prompt).toContain('"otp":')
    })

    it('asks for the phrase that justifies the code, capped so it cannot be the whole email', () => {
      expect(prompt).toMatch(/- otpEvidence:/)
      expect(prompt).toContain('"otpEvidence":')
      expect(prompt).toMatch(/200 characters/)
      expect(prompt).toMatch(/character for character/i)
    })

    it('tells the model to copy the code exactly as printed and never to invent one', () => {
      expect(prompt).toMatch(/exactly as (it is )?printed/i)
      expect(prompt).toMatch(/never (invent|guess)|do not (invent|guess)/i)
    })

    it('tells the model to answer null when there is no such code', () => {
      expect(prompt).toMatch(/otp[^\n]*null/i)
    })

    it('excludes the look-alike tokens the regex extractor also rejects', () => {
      for (const term of ['promo', 'coupon', 'zip', 'tracking', 'order']) {
        expect(prompt.toLowerCase()).toContain(term)
      }
    })

    it('still asks for categories, ctaJudgments and timestamps', () => {
      expect(prompt).toContain('categories')
      expect(prompt).toContain('ctaJudgments')
      expect(prompt).toContain('timestamps')
    })
  })
})
