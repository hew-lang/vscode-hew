import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const fixtureDirectory = 'test/fixtures'
const compiler = process.env.HEW_COMPILER
const fixtureExpectations = {
  'actors.hew': { kind: 'accept' },
  'advanced_features.hew': { kind: 'accept' },
  'async.hew': { kind: 'accept' },
  'closures.hew': { kind: 'accept' },
  'enums_match.hew': { kind: 'accept' },
  'errors.hew': {
    kind: 'diagnostic',
    diagnostics: [
      'type mismatch: expected `i64`, found `string`',
      'undefined variable `nonexistent_var`',
      'non-exhaustive match: missing None',
    ],
  },
  'generics_imports.hew': { kind: 'accept' },
  'if_let.hew': { kind: 'accept' },
  'machines_duration.hew': { kind: 'accept' },
  'select_join.hew': { kind: 'accept' },
  'syntax_comprehensive.hew': { kind: 'accept' },
  'wire_supervisor.hew': { kind: 'accept' },
}

const retiredDiagnostics = [
  'unknown type `int`',
  'unknown type `String`',
  'unexpected \'wire\'',
  'E_BARE_VARIANT_PATTERN',
  'E_CLOSURE_PIPE_SYNTAX',
  'E_SPAWN_LAMBDA_SYNTAX_REMOVED',
  'E_PATH_LEGACY_SEPARATOR',
  'E_LEGACY_TURBOFISH',
]

if (!compiler) {
  console.error('HEW_COMPILER must name the Hew compiler used to validate fixtures.')
  process.exit(2)
}

const fixtures = readdirSync(fixtureDirectory)
  .filter(file => file.endsWith('.hew'))
  .sort()
const classifiedFixtures = Object.keys(fixtureExpectations).sort()

if (JSON.stringify(fixtures) !== JSON.stringify(classifiedFixtures)) {
  console.error('Every controlled fixture must have an explicit expectation.')
  console.error(`Found: ${fixtures.join(', ')}`)
  console.error(`Classified: ${classifiedFixtures.join(', ')}`)
  process.exit(2)
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

  const fixtureOutput = diagnostics
    .filter(diagnostic => diagnostic.file === fixturePath)
    .map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
    .join('\n')

  for (const diagnostic of retiredDiagnostics) {
    if (fixtureOutput.includes(diagnostic)) {
      console.error(`${fixture}: failed first on retired syntax: ${diagnostic}`)
      failed = true
    }
  }

  if (expectation.kind === 'accept') {
    if (result.status !== 0) {
      console.error(`${fixture}: expected a successful compiler check.`)
      console.error(output)
      failed = true
    }
    continue
  }

  if (result.status === 0) {
    console.error(`${fixture}: expected intentional diagnostics, but check succeeded.`)
    failed = true
  }

  for (const diagnostic of expectation.diagnostics) {
    if (!fixtureOutput.includes(diagnostic)) {
      console.error(`${fixture}: missing expected diagnostic: ${diagnostic}`)
      failed = true
    }
  }

}

if (failed) {
  process.exit(1)
}

console.log(`Validated ${fixtures.length} controlled fixtures with ${compiler}.`)
