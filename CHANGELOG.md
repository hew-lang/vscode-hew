# Change Log

## [1.5.0] - 2026-07-06

### Added
- `await_restart` added to `keyword.control.hew`
- `LocalPid`, `RemotePid`, and `LambdaPid` added to `storage.type.concurrency.hew`

### Removed
- `wire` removed from `keyword.wire.hew`; legacy `wire type` / `wire enum` declaration pattern removed
- `struct` removed from `keyword.declaration.hew`; legacy `struct` declaration pattern removed
- `ActorRef` removed from `storage.type.concurrency.hew`

### Fixed
- `cooperate` moved from `keyword.control.hew` to `invalid.removed.hew`
- Shift operators now match longest-first so `<<`, `>>`, `<<=`, and `>>=` keep their bitwise/compound-assignment scopes instead of splitting into comparison tokens
- Bare `^` now scopes as `keyword.operator.bitwise.xor.hew`; wrapping arithmetic operators `&+`, `&-`, and `&*` now scope as single `keyword.operator.wrapping.hew` tokens
- Removed regex-match operators `=~` and `!~` now scope as `invalid.removed.hew`
- README and grammar tests updated for `#[wire]` declarations and the v0.6 surface

### Changed
- Grammar synced to the Hew v0.6 surface

## [1.4.0] - 2026-06-10

### Added
- `machine` keyword family fully covered: `entry`, `exit`, `emit` added to `keyword.control.machine.hew` (previously only `event`, `machine`, `on`, `state`, `when`)
- Machine contextual identifiers: `events`, `emits`, `reenter` added to `variable.language.contextual.hew`
- Supervisor contextual identifiers: `intensity`, `within`, `shutdown`, `infinity`, `wired_to` added to `variable.language.contextual.hew`
- `record` and `mut` added to `keyword.declaration.hew` (canonical v0.5 declaration keywords)
- `is` added to `keyword.other.hew`
- `fork` added to `keyword.actor.hew`
- `brutal_kill`, `pool`, `simple_one_for_one` added to `constant.language.strategy.hew`
- New grammar test file `tests/grammar/machine.test.hew` covering `machine`, `state`, `events {}`, `emits {}`, `on ... =>`, `entry`, `exit`, `emit`, `reenter`

### Removed
- `terminate` removed from `keyword.actor.hew` (not a v0.5 keyword)
- `pure` removed from `keyword.other.hew` (not a v0.5 keyword); `pure fn` patterns removed from function-definition capture groups
- `ActorStream` removed from `storage.type.generic.hew` (dropped in v0.5)
- `max_restarts`, `window` removed from `variable.language.contextual.hew` (superseded by `intensity`/`within`)

### Fixed
- Grammar sync (`tools/generate-tmgrammar.mjs`) updated: `terminate` dropped from hardcoded actor map; `fork`, `brutal_kill`, `pool`, `simple_one_for_one` now assigned to scopes so the coverage checker passes cleanly
- `test/fixtures/machines_duration.hew` rewritten to v0.5 syntax: `=>` routing arrow, `events {}` block header
- README keyword table updated to reflect v0.5 surface

### Changed
- Grammar synced to `syntax-data.json v0.10.0-pre`

## [1.3.0] - 2026-05-01

### Added
- `terminate` keyword in actor scope (`keyword.actor.hew`)
- `HashSet` to generic collection types (`storage.type.generic.hew`)
- Logical operators `&&` and `||` (`keyword.operator.logical.hew`)
- Char literal pattern `'x'` (`string.quoted.single.char.hew`)
- Byte string literal pattern `b"..."` (`string.quoted.byte.hew`)

### Fixed
- Generator (`tools/generate-tmgrammar.mjs`) now preserves `terminate` in actor keyword scope
- Removed `list` from wire keywords (dropped from the wire annotation language)

### Changed
- README: removed stale `launch`, `cancel`, `and`, `or` references; updated feature list

## [1.2.0] - 2026-03-16

### Added
- State machine keywords: `machine`, `state`, `event`, `on`, `when` (scope: `keyword.control.machine.hew`)
- `this` keyword in actor scope (`keyword.actor.hew`)
- `indirect` keyword in declaration scope
- `foreign` keyword in reserved scope
- Bundled hew-lsp v0.2.0 for all platforms (linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64)

### Fixed
- Removed stale keywords from grammar: `isolated`, `and`, `or`
- Removed stale keywords from grammar sync tool
- Grammar fully aligned with Hew compiler v0.2.0 syntax-data.json

### Changed
- Grammar sync now uses compiler's `syntax-data.json` v0.9.0 as canonical source

## [1.1.1] - 2026-03-04

### Changed
- Bumped bundled hew-lsp to v0.1.7

## [1.1.0] - 2026-03-04

### Added
- Interactive debugging via Debug Adapter Protocol (DAP) with GDB/LLDB MI backends
- Hew Actors tree view panel in debug sidebar
- "Break on Receive" context menu command for actor debugging
- "Toggle Runtime Frames" command to filter internal frames from call stack
- Debug configuration snippets and auto-launch for `.hew` files
- CI test workflow for PR and push

## [1.0.1] - 2026-02-26

### Added
- Bundled hew-lsp binary in platform-specific extension packages (`tools/package-all.sh`)
- Cross-compile support for linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

### Fixed
- Cross-compile linker configuration for aarch64-linux-gnu

## [1.0.0] - 2026-02-23

### Added
- TextMate grammar generator (`tools/generate-tmgrammar.mjs`) auto-syncs from compiler syntax-data.json
- Inner doc comment (`//!`) highlighting

### Changed
- Grammar updated to match Hew v0.9.0 syntax
- Removed stale `struct` declaration pattern (Hew uses `type` keyword)

## [0.2.1] - 2026-02-20

### Added
- `defer` keyword syntax highlighting

### Changed
- Aligned extension with latest Hew LSP

## [0.2.0] - 2026-02-16

### Fixed
- Grammar now aligned with Hew language spec v0.6.3
- Added missing keywords: `catch`, `package`, `list`
- Removed stale keywords: `isolated`, `children`, `max_restarts`, `window`
- Removed `&&`/`||` operator patterns (removed from language in v0.6.0)
- Moved `await`, `scope`, `launch`, `cancel` to control flow scope
- Removed `Node`, `Sender`, `Receiver` from concurrency types (not in spec)
- Added `AsyncIterator`, `IntoIterator` to built-in trait types
- Added `None` as a language constant
- Reordered grammar patterns so composite rules (`fn name`, `impl Trait for Type`) match correctly
- Split function-definitions and function-calls so keywords like `if(` are not highlighted as function calls
- Fixed `receive fn` pattern ordering (`receive fn name` now matches before `receive name(`)
- Fixed `gen fn` scope from `keyword.actor` to `keyword.declaration`
- Fixed `findServerPath()` to verify `hew-lsp` exists on PATH before using it
- Added error handling for LSP client startup failures
- Status bar now reflects actual server state (running/stopped/error)
- Fixed formatter to read from editor buffer (stdin) instead of disk file
- Fixed cross-platform binary lookup (`where` on Windows, `which` on Unix)
- Unified `findServerPath` and `findHewPath` into consistent `findBinaryPath` helper
- State change listener now registered before LSP client starts

### Added
- Dedicated output channel for LSP debugging
- Support for untitled (unsaved) `.hew` files in LSP
- Document formatting support via `hew fmt`
- Extension icons (light and dark themes)
- esbuild-based minified production builds
- Windows platform support (`.exe` suffix, `where` command)
- `onEnterRules` for auto-indentation after `{`

### Changed
- License changed to Apache-2.0 only (was dual MIT/Apache-2.0)
- Bundled with esbuild for smaller package size (~107KB VSIX)
- Upgraded `@vscode/vsce` to v3.7.1

### Removed
- Unnecessary file system watcher (server does not use `didChangeWatchedFiles`)
- Redundant `vscode-languageserver-protocol` direct dependency
- Redundant `activationEvents` (inferred from `documentSelector`)

## [0.1.0] - 2026-02-12

### Added
- Initial release
- Full syntax highlighting for Hew v0.2
- Actor declarations (`actor`, `isolated actor`, `receive fn`, `init`)
- Supervisor trees (`supervisor`, `child`, `restart`, `budget`, `strategy`)
- Structured concurrency (`scope`, `spawn`, `await`)
- Wire types (`wire struct`, `wire enum`, field tags)
- Traits and generics (`trait`, `impl`, type parameters)
- Pattern matching (`match`, `=>`)
- Closures (`|args| expr`)
- All built-in types and numeric literals
- String variants (regular, raw, interpolated)
- Duration literals
- Comments (line, block, doc)
- Language configuration (brackets, auto-closing, folding, indentation)
