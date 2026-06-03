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

  it('includes v0.5 actor keywords and excludes removed ones', () => {
    const actorPattern = grammar.repository.keywords.patterns.find(
      (p: any) => p.name === 'keyword.actor.hew'
    )
    expect(actorPattern).toBeDefined()
    // v0.5: fork added, terminate removed
    expect(actorPattern.match).toMatch(/\bfork\b/)
    expect(actorPattern.match).not.toMatch(/\bterminate\b/)
  })

  it('marks rejected keywords as invalid.removed.hew, not keyword.reserved.hew', () => {
    const allPatterns = grammar.repository.keywords.patterns
    // try/catch/race/foreign are rejected by the parser with migration diagnostics
    const removedPattern = allPatterns.find(
      (p: any) => p.name === 'invalid.removed.hew'
    )
    expect(removedPattern).toBeDefined()
    expect(removedPattern.match).toMatch(/\btry\b/)
    expect(removedPattern.match).toMatch(/\bcatch\b/)
    expect(removedPattern.match).toMatch(/\brace\b/)
    expect(removedPattern.match).toMatch(/\bforeign\b/)
    // must NOT be labelled as merely reserved
    const reservedPattern = allPatterns.find(
      (p: any) => p.name === 'keyword.reserved.hew'
    )
    expect(reservedPattern).toBeUndefined()
  })

  it('does not include the legacy <- send operator', () => {
    function hasPattern(patterns: any[], name: string): boolean {
      for (const p of patterns) {
        if (p.name === name) return true
        if (p.patterns && hasPattern(p.patterns, name)) return true
      }
      return false
    }
    // <- was never a real Hew operator; actor sends are method-call style
    expect(hasPattern(grammar.repository.operators.patterns, 'keyword.operator.send.hew')).toBe(false)
  })

  it('does not include mut in declaration keywords', () => {
    const declPattern = grammar.repository.keywords.patterns.find(
      (p: any) => p.name === 'keyword.declaration.hew'
    )
    expect(declPattern).toBeDefined()
    // mut is operator-context only (*mut T in extern/FFI/unsafe); not a general declaration keyword
    expect(declPattern.match).not.toMatch(/\bmut\b/)
  })

  it('includes raw pointer type rule scoped to extern/FFI/unsafe', () => {
    const pointerRule = grammar.repository.types.patterns.find(
      (p: any) => p.name === 'meta.type.pointer.raw.hew'
    )
    expect(pointerRule).toBeDefined()
    // must match *const and *mut but NOT *var (legacy, rejected by parser)
    expect(pointerRule.match).toMatch(/const/)
    expect(pointerRule.match).toMatch(/mut/)
    expect(pointerRule.match).not.toMatch(/var/)
  })

  it('includes initial in contextual identifiers', () => {
    const contextualPattern = grammar.repository.variables.patterns.find(
      (p: any) => p.name === 'variable.language.contextual.hew'
    )
    expect(contextualPattern).toBeDefined()
    // initial is a real machine contextual keyword (eat_machine_kw, parser:979-998)
    expect(contextualPattern.match).toMatch(/\binitial\b/)
  })
})
