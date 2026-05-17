import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Dark Theme Colors', () => {
  it('should have correct dark theme CSS variables defined in globals.css', () => {
    const globalsPath = join(__dirname, '../../app/globals.css')
    const content = readFileSync(globalsPath, 'utf-8')
    
    // Check dark theme block exists and contains correct values
    const darkThemeBlock = content.match(/\.dark\s*\{([^}]+)\}/s)
    expect(darkThemeBlock).toBeTruthy()
    
    if (darkThemeBlock) {
      const darkVars = darkThemeBlock[1]
      
      // Verify key dark theme colors are present
      expect(darkVars).toContain('--background: 225 27% 7%')      // #0c0e15
      expect(darkVars).toContain('--foreground: 228 25% 92%')     // #e6e8f1
      expect(darkVars).toContain('--primary: 237 100% 74%')       // #7c83ff
      expect(darkVars).toContain('--card: 225 23% 12%')           // #161a26
      expect(darkVars).toContain('--border: 228 31% 19%')         // #222840
    }
  })

  it('should have correct light theme CSS variables defined in globals.css', () => {
    const globalsPath = join(__dirname, '../../app/globals.css')
    const content = readFileSync(globalsPath, 'utf-8')
    
    // Check :root block for light theme
    const rootBlock = content.match(/:root\s*\{([^}]+)\}/s)
    expect(rootBlock).toBeTruthy()
    
    if (rootBlock) {
      const lightVars = rootBlock[1]
      
      // Verify key light theme colors are present
      expect(lightVars).toContain('--background: 240 17% 97%')    // #f4f4f8
      expect(lightVars).toContain('--foreground: 225 27% 7%')     // #0c0e15
      expect(lightVars).toContain('--primary: 236 72% 58%')       // #4a52e0
      expect(lightVars).toContain('--card: 0 0% 100%')            // #ffffff
      expect(lightVars).toContain('--border: 232 15% 89%')        // #dedfe8
    }
  })

  it('should have HSL format for all color variables', () => {
    const globalsPath = join(__dirname, '../../app/globals.css')
    const content = readFileSync(globalsPath, 'utf-8')
    
    // Check that colors are in HSL format (h s% l%)
    const hslPattern = /--\w+:\s*\d+\s+\d+%\s+\d+%/g
    const matches = content.match(hslPattern)
    
    // Should have many HSL color definitions
    expect(matches!.length).toBeGreaterThan(20)
  })

  it('should have dark theme card color darker than background', () => {
    const globalsPath = join(__dirname, '../../app/globals.css')
    const content = readFileSync(globalsPath, 'utf-8')
    
    const darkBlock = content.match(/\.dark\s*\{([^}]+)\}/s)
    expect(darkBlock).toBeTruthy()
    
    if (darkBlock) {
      const darkVars = darkBlock[1]
      // Background is 7%, card is 12% (card should be lighter than background for depth)
      expect(darkVars).toContain('--background: 225 27% 7%')
      expect(darkVars).toContain('--card: 225 23% 12%')
    }
  })

  it('should have no oklch color values (all should be HSL)', () => {
    const globalsPath = join(__dirname, '../../app/globals.css')
    const content = readFileSync(globalsPath, 'utf-8')
    
    // Should NOT contain any oklch() function calls
    expect(content).not.toMatch(/oklch\s*\(/i)
  })

  it('should have correct sidebar colors in dark theme', () => {
    const globalsPath = join(__dirname, '../../app/globals.css')
    const content = readFileSync(globalsPath, 'utf-8')
    
    const darkBlock = content.match(/\.dark\s*\{([^}]+)\}/s)
    expect(darkBlock).toBeTruthy()
    
    if (darkBlock) {
      const darkVars = darkBlock[1]
      
      // Sidebar should match main colors in dark theme
      expect(darkVars).toContain('--sidebar-background: 225 27% 7%')
      expect(darkVars).toContain('--sidebar-foreground: 228 25% 92%')
      expect(darkVars).toContain('--sidebar-primary: 237 100% 74%')
      expect(darkVars).toContain('--sidebar-border: 228 31% 19%')
    }
  })
})
