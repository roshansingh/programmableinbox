import { describe, it, expect, vi } from 'vitest'
import {
  isPyPiVersionPublished,
  isNpmVersionPublished,
  isMavenVersionPublished,
  isNuGetVersionPublished,
  isPublished,
  PACKAGE_IDENTITY,
} from '../release/registry-status.mjs'

/** A `fetch`-shaped stub that resolves to `{ status, json }` without any network I/O. */
function fakeFetch(status: number, body: unknown = {}) {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }))
}

describe('isPyPiVersionPublished', () => {
  it('is true when the version endpoint returns 200', async () => {
    const fetchImpl = fakeFetch(200)
    expect(await isPyPiVersionPublished({ name: 'programmableinbox' }, '0.1.0', { fetchImpl })).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith('https://pypi.org/pypi/programmableinbox/0.1.0/json')
  })

  it('is false, not an error, on 404', async () => {
    const fetchImpl = fakeFetch(404)
    expect(await isPyPiVersionPublished({ name: 'programmableinbox' }, '9.9.9', { fetchImpl })).toBe(false)
  })

  it('throws on an unexpected status', async () => {
    const fetchImpl = fakeFetch(500)
    await expect(isPyPiVersionPublished({ name: 'x' }, '1.0.0', { fetchImpl })).rejects.toThrow(/500/)
  })
})

describe('isNpmVersionPublished', () => {
  it('URL-encodes a scoped package name', async () => {
    const fetchImpl = fakeFetch(200)
    await isNpmVersionPublished({ name: '@programmableinbox/sdk' }, '0.1.0', { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledWith('https://registry.npmjs.org/%40programmableinbox%2Fsdk/0.1.0')
  })

  it('is false on 404', async () => {
    const fetchImpl = fakeFetch(404)
    expect(await isNpmVersionPublished({ name: '@programmableinbox/sdk' }, '9.9.9', { fetchImpl })).toBe(false)
  })
})

describe('isMavenVersionPublished', () => {
  it('is true when solrsearch reports a match', async () => {
    const fetchImpl = fakeFetch(200, { response: { numFound: 1 } })
    expect(
      await isMavenVersionPublished({ groupId: 'com.programmableinbox', artifactId: 'sdk' }, '0.1.0', { fetchImpl }),
    ).toBe(true)
  })

  it('is false when solrsearch reports zero matches', async () => {
    const fetchImpl = fakeFetch(200, { response: { numFound: 0 } })
    expect(
      await isMavenVersionPublished({ groupId: 'com.programmableinbox', artifactId: 'sdk' }, '9.9.9', { fetchImpl }),
    ).toBe(false)
  })
})

describe('isNuGetVersionPublished', () => {
  it('is true when the version appears (case-insensitively) in the flat-container index', async () => {
    const fetchImpl = fakeFetch(200, { versions: ['0.0.9', '0.1.0'] })
    expect(await isNuGetVersionPublished({ id: 'ProgrammableInbox.Sdk' }, '0.1.0', { fetchImpl })).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith('https://api.nuget.org/v3-flatcontainer/programmableinbox.sdk/index.json')
  })

  it('is false when the index exists but lacks this version', async () => {
    const fetchImpl = fakeFetch(200, { versions: ['0.0.9'] })
    expect(await isNuGetVersionPublished({ id: 'ProgrammableInbox.Sdk' }, '0.1.0', { fetchImpl })).toBe(false)
  })

  it('is false when the package has never been published (index 404s)', async () => {
    const fetchImpl = fakeFetch(404)
    expect(await isNuGetVersionPublished({ id: 'ProgrammableInbox.Sdk' }, '0.1.0', { fetchImpl })).toBe(false)
  })
})

describe('isPublished', () => {
  it('dispatches to the right checker and package identity for each language', async () => {
    // Maven's "not found" is a 200 with numFound: 0, unlike the 404 the other
    // three registries use — see isMavenVersionPublished.
    const notFoundStatusByLang: Record<string, number> = { python: 404, typescript: 404, java: 200, csharp: 404 }
    for (const lang of Object.keys(PACKAGE_IDENTITY)) {
      const fetchImpl = fakeFetch(notFoundStatusByLang[lang], { response: { numFound: 0 } })
      await expect(isPublished(lang, '0.1.0', { fetchImpl })).resolves.toBe(false)
    }
  })

  it('throws for a language with no registry checker (e.g. go)', async () => {
    await expect(isPublished('go', '0.1.0')).rejects.toThrow(/no registry checker/)
  })
})
