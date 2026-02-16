# Change Log

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
- Fixed `findServerPath()` to verify `hew-lsp` exists on PATH before using it
- Added error handling for LSP client startup failures
- Status bar now reflects actual server state (running/stopped/error)

### Added
- Dedicated output channel for LSP debugging
- Support for untitled (unsaved) `.hew` files in LSP

### Removed
- Unnecessary file system watcher (server does not use `didChangeWatchedFiles`)

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
