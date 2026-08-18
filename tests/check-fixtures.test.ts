import { describe, expect, it } from 'vitest'
import {
  fixtureExpectations,
  validateFixtureDiagnostics,
} from '../scripts/check-fixtures.mjs'

const fixture = 'errors.hew'
const fixturePath = `test/fixtures/${fixture}`
const expectation = fixtureExpectations[fixture]

function expectedDiagnostics() {
  if (expectation.kind !== 'diagnostic') {
    throw new Error(`${fixture} must be a diagnostic fixture.`)
  }

  return expectation.diagnostics.map(diagnostic => ({
    ...diagnostic,
    severity: 'error',
    file: fixturePath,
  }))
}

describe('fixture diagnostic validation', () => {
  it('rejects an unexpected fixture-owned error', () => {
    const failures = validateFixtureDiagnostics({
      fixture,
      fixturePath,
      expectation,
      status: 1,
      diagnostics: [
        ...expectedDiagnostics(),
        {
          code: 'UnexpectedError',
          message: 'unexpected diagnostic',
          severity: 'error',
          file: fixturePath,
        },
      ],
    })

    expect(failures).toContain(
      `${fixture}: unexpected fixture-owned diagnostic: UnexpectedError: unexpected diagnostic`,
    )
  })

  it('rejects a retired glob-import diagnostic', () => {
    const failures = validateFixtureDiagnostics({
      fixture,
      fixturePath,
      expectation,
      status: 1,
      diagnostics: [
        ...expectedDiagnostics(),
        {
          code: 'E_IMPORT_GLOB_REMOVED',
          message: 'glob imports are retired',
          severity: 'error',
          file: fixturePath,
        },
      ],
    })

    expect(failures).toContain(
      `${fixture}: failed first on retired syntax: E_IMPORT_GLOB_REMOVED`,
    )
  })
})
