import { readFileSync, readdirSync } from 'fs'
import { describe, expect, it } from 'vitest'

const fixtureDirectory = 'test/fixtures'
const fixtureExpectations = [
  'actors.hew',
  'advanced_features.hew',
  'async.hew',
  'closures.hew',
  'enums_match.hew',
  'errors.hew',
  'generics_imports.hew',
  'if_let.hew',
  'machines_duration.hew',
  'select_join.hew',
  'syntax_comprehensive.hew',
  'wire_supervisor.hew',
]

function sourceWithoutLineComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .join('\n')
}

describe('controlled fixture language surface', () => {
  const fixtures = readdirSync(fixtureDirectory)
    .filter(file => file.endsWith('.hew'))
    .sort()

  it('classifies every controlled fixture', () => {
    expect(fixtures).toEqual(fixtureExpectations)
  })

  it.each(fixtures)('%s excludes retired language spellings', fixture => {
    const source = sourceWithoutLineComments(readFileSync(`${fixtureDirectory}/${fixture}`, 'utf-8'))

    expect(source).not.toMatch(/\bwire\s+(?:type|enum|struct)\b/)
    expect(source).not.toMatch(/\bstruct\b/)
    expect(source).not.toMatch(/\b(?:max_restarts|window|pure|cooperate|this|String|int)\b/)
    expect(source).not.toMatch(/\bscope\s*\|/)
    expect(source).not.toMatch(/\bspawn\s+(?:move\s+)?\(/)
    expect(source).not.toMatch(/(?:->|:|,)\s*\*\s*(?!const\b|mut\b)[A-Za-z_]/)
    expect(source).not.toMatch(/^\s*[A-Z][A-Za-z0-9_]*(?:\([^)]*\))?\s*,\s*$/m)
    expect(source).not.toMatch(/(?<![.A-Za-z0-9_])(?:Some|None)\s*\(/)
  })
})
