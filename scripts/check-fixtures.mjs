import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const fixtureDirectory = 'test/fixtures'
export const fixtureExpectations = {
  'actors.hew': { kind: 'accept' },
  'advanced_features.hew': { kind: 'accept' },
  'async.hew': { kind: 'accept' },
  'closures.hew': { kind: 'accept' },
  'enums_match.hew': { kind: 'accept' },
  'errors.hew': {
    kind: 'diagnostic',
    diagnostics: [
      {
        code: 'Mismatch',
        message: 'type mismatch: expected `i64`, found `string`',
      },
      {
        code: 'UndefinedVariable',
        message: 'undefined variable `nonexistent_var`',
      },
      {
        code: 'NonExhaustiveMatch',
        message: 'non-exhaustive match: missing None',
      },
    ],
  },
  'generics_imports.hew': { kind: 'accept' },
  'if_let.hew': { kind: 'accept' },
  'machines_duration.hew': { kind: 'accept' },
  'select_join.hew': { kind: 'accept' },
  'syntax_comprehensive.hew': { kind: 'accept' },
  'wire_supervisor.hew': { kind: 'accept' },
}

export const retiredDiagnostics = [
  'unknown type `int`',
  'unknown type `String`',
  'unexpected \'wire\'',
  'E_BARE_VARIANT_PATTERN',
  'E_CLOSURE_PIPE_SYNTAX',
  'E_SPAWN_LAMBDA_SYNTAX_REMOVED',
  'E_PATH_LEGACY_SEPARATOR',
  'E_LEGACY_TURBOFISH',
  'E_IMPORT_GLOB_REMOVED',
]

function diagnosticKey(diagnostic) {
  return `${diagnostic.code}: ${diagnostic.message}`
}

function diagnosticCounts(diagnostics) {
  const counts = new Map()
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function validateFixtureDiagnostics({ fixture, fixturePath, expectation, status, diagnostics }) {
  const failures = []
  const fixtureDiagnostics = diagnostics.filter(diagnostic => diagnostic.file === fixturePath)
  const fixtureOutput = fixtureDiagnostics.map(diagnosticKey).join('\n')

  for (const diagnostic of retiredDiagnostics) {
    if (fixtureOutput.includes(diagnostic)) {
      failures.push(`${fixture}: failed first on retired syntax: ${diagnostic}`)
    }
  }

  if (expectation.kind === 'accept') {
    if (status !== 0) {
      failures.push(`${fixture}: expected a successful compiler check.`)
    }
    return failures
  }

  if (status === 0) {
    failures.push(`${fixture}: expected intentional diagnostics, but check succeeded.`)
  }

  const expectedDiagnostics = diagnosticCounts(expectation.diagnostics)
  const actualDiagnostics = diagnosticCounts(
    fixtureDiagnostics.filter(diagnostic => diagnostic.severity === 'error'),
  )

  for (const [diagnostic, expectedCount] of expectedDiagnostics) {
    const actualCount = actualDiagnostics.get(diagnostic) ?? 0
    if (actualCount < expectedCount) {
      failures.push(`${fixture}: missing expected diagnostic: ${diagnostic}`)
    }
  }

  for (const [diagnostic, actualCount] of actualDiagnostics) {
    const expectedCount = expectedDiagnostics.get(diagnostic) ?? 0
    if (actualCount > expectedCount) {
      failures.push(`${fixture}: unexpected fixture-owned diagnostic: ${diagnostic}`)
    }
  }

  return failures
}

export function runFixtureCheck(compiler = process.env.HEW_COMPILER) {
  if (!compiler) {
    console.error('HEW_COMPILER must name the Hew compiler used to validate fixtures.')
    return 2
  }

  const fixtures = readdirSync(fixtureDirectory)
    .filter(file => file.endsWith('.hew'))
    .sort()
  const classifiedFixtures = Object.keys(fixtureExpectations).sort()

  if (JSON.stringify(fixtures) !== JSON.stringify(classifiedFixtures)) {
    console.error('Every controlled fixture must have an explicit expectation.')
    console.error(`Found: ${fixtures.join(', ')}`)
    console.error(`Classified: ${classifiedFixtures.join(', ')}`)
    return 2
  }

  let failed = false

  for (const fixture of fixtures) {
    const expectation = fixtureExpectations[fixture]
    const fixturePath = join(fixtureDirectory, fixture)
    const result = spawnSync(compiler, ['check', '--format', 'json', fixturePath], {
      encoding: 'utf8',
    })
    const output = `${result.stdout}${result.stderr}`

    if (result.error) {
      console.error(`${fixture}: could not run ${compiler}: ${result.error.message}`)
      failed = true
      continue
    }

    let diagnostics
    try {
      diagnostics = JSON.parse(result.stdout)
    } catch {
      console.error(`${fixture}: compiler did not return JSON diagnostics.`)
      console.error(output)
      failed = true
      continue
    }

    const failures = validateFixtureDiagnostics({
      fixture,
      fixturePath,
      expectation,
      status: result.status,
      diagnostics,
    })
    for (const failure of failures) {
      console.error(failure)
      failed = true
    }
    if (failures.length > 0) {
      console.error(output)
    }
  }

  if (failed) {
    return 1
  }

  console.log(`Validated ${fixtures.length} controlled fixtures with ${compiler}.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runFixtureCheck())
}
