import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'

const grammarPath = 'syntaxes/hew.tmLanguage.json'

describe('Grammar structure', () => {
  const raw = readFileSync(grammarPath, 'utf-8')
  const grammar = JSON.parse(raw)

  it('parses as valid JSON', () => {
    expect(grammar).toBeDefined()
  })

  it('has required top-level fields', () => {
    expect(grammar).toHaveProperty('scopeName')
    expect(grammar).toHaveProperty('patterns')
    expect(grammar).toHaveProperty('repository')
    expect(grammar.scopeName).toBe('source.hew')
    expect(Array.isArray(grammar.patterns)).toBe(true)
    expect(typeof grammar.repository).toBe('object')
  })

  it('has no duplicate pattern names in repository', () => {
    const names = Object.keys(grammar.repository)
    const unique = new Set(names)
    expect(names.length).toBe(unique.size)
  })

  it('resolves all #include references', () => {
    const repositoryKeys = new Set(Object.keys(grammar.repository))
    const unresolvedRefs: string[] = []

    function checkPatterns(patterns: any[], context: string) {
      for (const pattern of patterns) {
        if (pattern.include) {
          const ref = pattern.include
          if (ref.startsWith('#')) {
            const name = ref.slice(1)
            if (!repositoryKeys.has(name)) {
              unresolvedRefs.push(`${context}: ${ref}`)
            }
          }
          // $self and $base are valid built-in references
        }
        if (pattern.patterns) {
          checkPatterns(pattern.patterns, context)
        }
      }
    }

    // Check top-level patterns
    checkPatterns(grammar.patterns, 'top-level')

    // Check repository entries
    for (const [key, entry] of Object.entries(grammar.repository)) {
      const e = entry as any
      if (e.patterns) {
        checkPatterns(e.patterns, `repository.${key}`)
      }
    }

    expect(unresolvedRefs).toEqual([])
  })
})
