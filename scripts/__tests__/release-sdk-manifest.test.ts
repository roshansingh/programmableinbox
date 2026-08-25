import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parsePyprojectVersion,
  parsePackageJsonVersion,
  parsePomVersion,
  parseCsprojVersion,
  parseGoVersionFile,
  parseVersion,
  getManifestVersion,
  MANIFEST_PATHS,
  SDK_LANGUAGES,
  ROOT,
} from '../release/sdk-manifest.mjs'

describe('parsePyprojectVersion', () => {
  it('reads the [project] version line', () => {
    const content = `[project]\nname = "programmableinbox"\nversion = "0.1.0"\ndescription = "x"\n`
    expect(parsePyprojectVersion(content)).toBe('0.1.0')
  })

  it('does not match a version pinned on a dependency line', () => {
    const content = `[project]\nname = "x"\nversion = "1.2.3"\n\ndependencies = [\n  "urllib3 (>=2.6.3,<3.0.0)",\n]\n`
    expect(parsePyprojectVersion(content)).toBe('1.2.3')
  })

  it('throws when no version line exists', () => {
    expect(() => parsePyprojectVersion('[project]\nname = "x"\n')).toThrow(/version/)
  })
})

describe('parsePackageJsonVersion', () => {
  it('reads the top-level version field', () => {
    expect(parsePackageJsonVersion(JSON.stringify({ name: '@x/y', version: '0.1.0' }))).toBe('0.1.0')
  })

  it('throws when version is missing', () => {
    expect(() => parsePackageJsonVersion(JSON.stringify({ name: '@x/y' }))).toThrow(/version/)
  })
})

describe('parsePomVersion', () => {
  it('reads the 4-space-indented project version, not a nested plugin version', () => {
    const content = [
      '<project>',
      '    <groupId>com.programmableinbox</groupId>',
      '    <artifactId>sdk</artifactId>',
      '    <version>0.1.0</version>',
      '    <build>',
      '        <plugins>',
      '            <plugin>',
      '                <artifactId>maven-enforcer-plugin</artifactId>',
      '                <version>3.1.0</version>',
      '            </plugin>',
      '        </plugins>',
      '    </build>',
      '</project>',
    ].join('\n')
    expect(parsePomVersion(content)).toBe('0.1.0')
  })

  it('throws when no top-level version tag exists', () => {
    expect(() => parsePomVersion('<project>\n    <artifactId>sdk</artifactId>\n</project>\n')).toThrow(/version/)
  })
})

describe('parseCsprojVersion', () => {
  it('reads the Version property', () => {
    const content = '<Project>\n  <PropertyGroup>\n    <Version>0.1.0</Version>\n  </PropertyGroup>\n</Project>\n'
    expect(parseCsprojVersion(content)).toBe('0.1.0')
  })

  it('throws when no Version tag exists', () => {
    expect(() => parseCsprojVersion('<Project></Project>')).toThrow(/Version/)
  })
})

describe('parseGoVersionFile', () => {
  it('trims surrounding whitespace and the trailing newline', () => {
    expect(parseGoVersionFile('0.1.0\n')).toBe('0.1.0')
  })

  it('throws on an empty file', () => {
    expect(() => parseGoVersionFile('\n')).toThrow(/empty/)
  })
})

describe('parseVersion', () => {
  it('dispatches to the parser for the given language', () => {
    expect(parseVersion('go', '1.2.3\n')).toBe('1.2.3')
  })

  it('throws for an unknown language', () => {
    expect(() => parseVersion('rust', '1.0.0')).toThrow(/unknown/)
  })
})

describe('getManifestVersion', () => {
  // These read the real repo files rather than fixtures, on purpose: the
  // point of this test is to catch the manifest and the parser drifting
  // apart (e.g. a regenerated pom.xml whose indentation changed), which a
  // fixture-only test can't see.
  it.each(SDK_LANGUAGES)('reads a non-empty version for %s from the real manifest', (lang) => {
    const version = getManifestVersion(lang)
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('reads from the given root override', () => {
    expect(getManifestVersion('go', ROOT)).toBe(readFileSync(resolve(ROOT, MANIFEST_PATHS.go), 'utf8').trim())
  })
})
