#!/usr/bin/env node

/**
 * TextMate Grammar Generator for Hew
 *
 * Reads the canonical syntax-data.json from the Hew compiler and updates
 * keyword and type regex patterns in hew.tmLanguage.json. Complex patterns
 * (strings, comments, function definitions, operators, etc.) are preserved
 * from the existing grammar — only simple keyword/type match regexes are
 * regenerated.
 *
 * Usage: node tools/generate-tmgrammar.mjs
 *
 * Environment variables:
 *   HEW_SYNTAX_DATA  Path to syntax-data.json (default: ../../hew/docs/syntax-data.json)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const syntaxDataPath = process.env.HEW_SYNTAX_DATA
  || resolve(__dirname, '../../hew/docs/syntax-data.json');
const grammarPath = resolve(__dirname, '../syntaxes/hew.tmLanguage.json');

// ── Validate inputs ────────────────────────────────────────────────

if (!existsSync(syntaxDataPath)) {
  console.error(`Error: syntax-data.json not found at ${syntaxDataPath}`);
  console.error('Set HEW_SYNTAX_DATA env var to the correct path.');
  process.exit(1);
}

if (!existsSync(grammarPath)) {
  console.error(`Error: hew.tmLanguage.json not found at ${grammarPath}`);
  process.exit(1);
}

console.log(`Reading syntax data from: ${syntaxDataPath}`);
console.log(`Updating grammar at:      ${grammarPath}\n`);

const syntaxData = JSON.parse(readFileSync(syntaxDataPath, 'utf8'));
const grammar = JSON.parse(readFileSync(grammarPath, 'utf8'));

const kw = syntaxData.keywords;
const types = syntaxData.types;

// ── Keyword group mapping ──────────────────────────────────────────
// Maps TextMate scope names to keyword arrays derived from syntax-data.json.
// Each keyword from all_keywords appears in exactly one scope.

const keywordGroups = {
  'keyword.control.hew': [
    ...kw.control_flow,
    // Actor keywords that serve as control flow
    'select', 'join', 'after', 'from', 'await', 'scope', 'cooperate',
  ],

  'keyword.declaration.hew': [
    ...kw.declarations,
  ],

  'keyword.actor.hew': [
    'actor', 'receive', 'init', 'spawn', 'move',
  ],

  'keyword.supervisor.hew': [
    'supervisor', 'child', 'restart', 'budget', 'strategy',
  ],

  'constant.language.strategy.hew': [
    'permanent', 'transient', 'temporary',
    'one_for_one', 'one_for_all', 'rest_for_one',
  ],

  'keyword.wire.hew': [...kw.wire],

  'keyword.other.hew': [
    ...kw.other,
    'isolated',
  ],

  'keyword.operator.logical.hew': ['and', 'or'],

  'constant.language.boolean.hew': ['true', 'false'],

  // Reserved keywords not yet used in the language
  'keyword.reserved.hew': [...kw.reserved_unused],
};

// ── Type group mapping ─────────────────────────────────────────────

const typeGroups = {
  'storage.type.numeric.hew': [
    ...types.integer,
    ...types.float,
  ],

  'storage.type.primitive.hew': [
    ...types.primitive,
  ],

  'storage.type.generic.hew': [
    ...types.collections,
    // Option/Result types and constructors (None handled by constant.language.none.hew)
    'Option', 'Result', 'Ok', 'Err', 'Some',
    // Smart pointers
    'Arc', 'Rc', 'Weak',
    // Other named types
    ...types.other,
  ],

  'storage.type.concurrency.hew': [
    ...types.concurrency,
  ],

  'storage.type.trait.hew': [
    'Send', 'Frozen', 'Copy',
  ],
};

// ── Contextual identifiers ─────────────────────────────────────────
// NOT keywords — have special meaning only in specific parser contexts.

const contextualNames = Object.keys(syntaxData.contextual_identifiers)
  .filter(name => name !== 'self' && name !== 'description'); // skip metadata and self (has its own pattern)

const contextualGroup = {
  'variable.language.contextual.hew': contextualNames,
};

// ── Merge all groups ───────────────────────────────────────────────

const allGroups = { ...keywordGroups, ...typeGroups, ...contextualGroup };

// ── Helper: build \b(word1|word2|...)\b regex ──────────────────────

function buildRegex(keywords) {
  const sorted = [...keywords].sort();
  return `\\b(${sorted.join('|')})\\b`;
}

// ── Update existing patterns by scope name ─────────────────────────

const changes = [];
const handled = new Set();

function updatePatterns(patterns, path) {
  for (const pattern of patterns) {
    const scope = pattern.name;
    if (scope && allGroups[scope] && pattern.match) {
      const newRegex = buildRegex(allGroups[scope]);
      if (pattern.match !== newRegex) {
        changes.push({
          scope,
          path,
          oldMatch: pattern.match,
          newMatch: newRegex,
          action: 'updated',
        });
        pattern.match = newRegex;
      }
      handled.add(scope);
    }
    if (pattern.patterns) {
      updatePatterns(pattern.patterns, path);
    }
  }
}

updatePatterns(grammar.patterns, 'patterns');

for (const [key, value] of Object.entries(grammar.repository)) {
  if (value.patterns) {
    updatePatterns(value.patterns, `repository.${key}`);
  }
}

// ── Add patterns for scopes not yet in the grammar ─────────────────

for (const [scope, keywords] of Object.entries(allGroups)) {
  if (handled.has(scope)) continue;

  let section;
  if (scope.startsWith('keyword.') || scope.startsWith('constant.language.')) {
    section = 'keywords';
  } else if (scope.startsWith('storage.type.')) {
    section = 'types';
  } else if (scope.startsWith('variable.language.')) {
    section = 'variables';
  } else {
    continue;
  }

  if (!grammar.repository[section]?.patterns) continue;

  const commentMap = {
    'keyword.reserved.hew': 'Reserved keywords (not yet used in the language)',
    'variable.language.contextual.hew': 'Contextual identifiers (special meaning in specific contexts)',
  };

  const newPattern = {
    comment: commentMap[scope] || `Generated from syntax-data.json`,
    name: scope,
    match: buildRegex(keywords),
  };

  // Insert contextual identifiers before the catch-all variable.other.hew
  if (section === 'variables') {
    const catchAllIdx = grammar.repository[section].patterns.findIndex(
      p => p.name === 'variable.other.hew'
    );
    if (catchAllIdx >= 0) {
      grammar.repository[section].patterns.splice(catchAllIdx, 0, newPattern);
    } else {
      grammar.repository[section].patterns.push(newPattern);
    }
  } else {
    grammar.repository[section].patterns.push(newPattern);
  }

  changes.push({
    scope,
    path: `repository.${section}`,
    newMatch: newPattern.match,
    action: 'added',
  });
  handled.add(scope);
}

// ── Write output ───────────────────────────────────────────────────

writeFileSync(grammarPath, JSON.stringify(grammar, null, 2) + '\n');

// ── Report ─────────────────────────────────────────────────────────

console.log(`TextMate grammar updated from syntax-data.json v${syntaxData.version}\n`);

if (changes.length === 0) {
  console.log('No changes needed — grammar already in sync.');
} else {
  console.log(`${changes.length} pattern(s) changed:\n`);
  for (const c of changes) {
    if (c.action === 'added') {
      console.log(`  + ${c.scope} (new pattern in ${c.path})`);
      console.log(`    ${c.newMatch}\n`);
    } else {
      console.log(`  ~ ${c.scope} (${c.path})`);
      console.log(`    old: ${c.oldMatch}`);
      console.log(`    new: ${c.newMatch}\n`);
    }
  }
}

// ── Verify keyword coverage ────────────────────────────────────────

const coveredKeywords = new Set();
for (const keywords of Object.values(keywordGroups)) {
  for (const k of keywords) coveredKeywords.add(k);
}

const missing = syntaxData.all_keywords.filter(k => !coveredKeywords.has(k));
if (missing.length > 0) {
  console.log(`⚠  Keywords in all_keywords not assigned to any grammar scope:`);
  console.log(`   ${missing.join(', ')}\n`);
}

const extras = [...coveredKeywords].filter(k => !syntaxData.all_keywords.includes(k));
if (extras.length > 0) {
  console.log(`⚠  Keywords in grammar scopes but not in all_keywords:`);
  console.log(`   ${extras.join(', ')}\n`);
}

console.log('Done.');
