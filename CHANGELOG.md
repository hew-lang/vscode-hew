# Change Log

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
