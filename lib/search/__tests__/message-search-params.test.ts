import { describe, expect, it } from 'vitest'
import {
  MAX_QUERY_LENGTH,
  MAX_FILTER_VALUES,
  SearchParamError,
  parseMessageSearch,
} from '../message-search-params'

function parse(query: string, opts: { grouped?: boolean } = {}) {
  return parseMessageSearch(new URLSearchParams(query), { grouped: opts.grouped ?? false })
}

describe('parseMessageSearch', () => {
  describe('absence', () => {
    it('returns null when no search parameter is present', () => {
      expect(parse('limit=50&cursor=abc')).toBeNull()
    })

    it('treats a whitespace-only q as absent', () => {
      expect(parse('q=%20%20')).toBeNull()
    })

    it('treats an empty from as absent', () => {
      expect(parse('from=')).toBeNull()
    })

    it('treats tags with no usable values as absent', () => {
      expect(parse('tags=%20,,%20')).toBeNull()
    })
  })

  describe('q', () => {
    it('trims the query', () => {
      expect(parse('q=%20invoice%20')?.q).toBe('invoice')
    })

    it('preserves websearch operators verbatim', () => {
      expect(parse('q=' + encodeURIComponent('"order confirmed" -refund'))?.q).toBe(
        '"order confirmed" -refund',
      )
    })

    it('accepts a query exactly at the length limit', () => {
      const q = 'a'.repeat(MAX_QUERY_LENGTH)
      expect(parse(`q=${q}`)?.q).toBe(q)
    })

    it('rejects a query over the length limit', () => {
      const q = 'a'.repeat(MAX_QUERY_LENGTH + 1)
      expect(() => parse(`q=${q}`)).toThrow(SearchParamError)
    })
  })

  describe('from', () => {
    it('trims and keeps the raw substring', () => {
      expect(parse('from=%20Support%20')?.from).toBe('Support')
    })

    it('rejects an over-long from', () => {
      expect(() => parse(`from=${'a'.repeat(MAX_QUERY_LENGTH + 1)}`)).toThrow(SearchParamError)
    })
  })

  describe('tags and categories', () => {
    it('accepts a repeated parameter', () => {
      expect(parse('tags=urgent&tags=billing')?.tags).toEqual(['urgent', 'billing'])
    })

    it('accepts a comma-separated parameter', () => {
      expect(parse('tags=urgent,billing')?.tags).toEqual(['urgent', 'billing'])
    })

    it('trims values and drops empty ones', () => {
      expect(parse('tags=%20urgent%20,,billing')?.tags).toEqual(['urgent', 'billing'])
    })

    it('de-duplicates values', () => {
      expect(parse('tags=urgent&tags=urgent')?.tags).toEqual(['urgent'])
    })

    it('parses categories the same way', () => {
      expect(parse('categories=receipt,otp')?.categories).toEqual(['receipt', 'otp'])
    })

    it('rejects more values than the cap rather than silently truncating', () => {
      const many = Array.from({ length: MAX_FILTER_VALUES + 1 }, (_, i) => `t${i}`).join(',')
      expect(() => parse(`tags=${many}`)).toThrow(SearchParamError)
    })

    it('accepts exactly the cap', () => {
      const many = Array.from({ length: MAX_FILTER_VALUES }, (_, i) => `t${i}`).join(',')
      expect(parse(`tags=${many}`)?.tags).toHaveLength(MAX_FILTER_VALUES)
    })
  })

  describe('combination', () => {
    it('carries every filter kind at once', () => {
      const search = parse('q=invoice&from=billing%40acme.com&tags=urgent&categories=receipt')

      expect(search).toEqual({
        q: 'invoice',
        from: 'billing@acme.com',
        tags: ['urgent'],
        categories: ['receipt'],
      })
    })

    it('leaves unused filters null or empty', () => {
      expect(parse('q=invoice')).toEqual({ q: 'invoice', from: null, tags: [], categories: [] })
    })
  })

  describe('grouped mode', () => {
    it('rejects any search parameter combined with grouped', () => {
      expect(() => parse('q=invoice', { grouped: true })).toThrow(SearchParamError)
      expect(() => parse('from=a', { grouped: true })).toThrow(SearchParamError)
      expect(() => parse('tags=urgent', { grouped: true })).toThrow(SearchParamError)
      expect(() => parse('categories=otp', { grouped: true })).toThrow(SearchParamError)
    })

    it('says why, so the client knows to turn grouping off', () => {
      expect(() => parse('q=invoice', { grouped: true })).toThrow(/grouped/i)
    })

    it('allows grouped when no search parameter is present', () => {
      expect(parse('limit=50', { grouped: true })).toBeNull()
    })
  })
})
