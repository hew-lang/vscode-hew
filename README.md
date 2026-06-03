# Hew Language Support for VS Code

Syntax highlighting and language support for the [Hew programming language](https://github.com/hew-lang/hew) — a high-performance, network-native, actor-based language.

## Features

- **Full syntax highlighting** for Hew language constructs
- **Language Server Protocol** — completion, hover, definition, document symbols, semantic tokens, diagnostics (requires `hew-lsp`)
- **Document formatting** — format on save via `hew fmt` (requires `hew` CLI)
- **Actor declarations** — `actor`, `receive fn`, `receive`, `init`, `terminate`
- **Supervisor trees** — `supervisor`, `child`, `restart`, `budget`, `strategy`
- **Structured concurrency** — `scope`, `spawn`, `await`, `select`, `join`
- **Generators** — `gen fn`, `async gen fn`, `yield`, `cooperate`
- **Wire types** — `wire type`, `wire enum`, field tags with `@`
- **Traits and generics** — `trait`, `impl ... for`, type parameters `[T: Send]`
- **Pattern matching** — `match`, `=>`, guards, destructuring
- **All built-in types** — `i8`–`i64`, `u8`–`u64`, `f32`, `f64`, `bool`, `char`, `string`
- **String variants** — regular `"..."`, raw `r"..."`, byte `b"..."`, interpolated `f"...{expr}..."`, char `'x'`
- **Duration literals** — `100ms`, `5s`, `1h`
- **Comments** — `//`, `/* */`, `///` (doc comments)
- **Auto-closing pairs** for brackets, braces, parentheses, strings
- **Code folding** and **bracket matching**

## Example

```hew
actor Counter {
    var count: i32 = 0;

    receive fn increment() {
        self.count = self.count + 1;
    }

    receive fn get() -> i32 {
        self.count
    }
}

supervisor CounterSupervisor {
    child counter: Counter
        restart(permanent)
        budget(5, 30s)
        strategy(one_for_one);
}

fn fibonacci(n: i32) -> i32 {
    if n <= 1 {
        n
    } else {
        fibonacci(n - 1) + fibonacci(n - 2)
    }
}

fn main() -> i32 {
    let result = fibonacci(10);
    println(result);
    0
}
```

## Installation

### From VSIX (local install)

1. In the extension directory, run:
   ```bash
   npm run package
   ```
2. In VS Code, open the command palette (`Ctrl+Shift+P`) and run:
   **Extensions: Install from VSIX...**
3. Select the generated `.vsix` file

### From source (development)

1. Clone this repository
2. Run `npm install && npm run build:dev`
3. Open this folder in VS Code and press `F5` to launch the Extension Development Host

## Configuration

| Setting | Default | Description |
|---|---|---|
| `hew.lsp.serverPath` | `""` | Path to `hew-lsp` binary. If empty, searches trusted workspace `target/`, `PATH`, and bundled binaries. |
| `hew.formatterPath` | `""` | Path to `hew` binary for formatting. If empty, searches trusted workspace `target/`, `PATH`, and bundled binaries. |
| `hew.debugger.hewPath` | `""` | Path to the `hew` compiler used for debug builds. If empty, uses the same trusted search as `hew.formatterPath`. |
| `hew.allowUntrustedWorkspaceBinaries` | `false` | Allows auto-detecting workspace `target/release` and `target/debug` binaries even in Restricted Mode. Set this in user settings only when you explicitly trust those workspace binaries. |

Workspace-built `hew` and `hew-lsp` binaries are only auto-selected in trusted workspaces by default. In Restricted Mode, trust the workspace or set `hew.allowUntrustedWorkspaceBinaries` in user settings to opt in.

## Debugging

Before launching a Hew debug session:

- If `program` points to a `.hew` source file, make sure `hew.debugger.hewPath` is set or `hew` is on `PATH` so the extension can run `hew build --debug`.
- Make sure the selected backend executable is on `PATH`:
  - `debuggerBackend: "auto"` picks `lldb-mi` on macOS and `gdb` elsewhere.
  - `debuggerBackend: "lldb"` requires `lldb-mi`.
  - `debuggerBackend: "gdb"` requires `gdb`.

Example `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "hew",
      "request": "launch",
      "name": "Debug Hew Program",
      "program": "${workspaceFolder}/main.hew",
      "debuggerBackend": "auto"
    }
  ]
}
```

If preflight reports that a backend is unavailable, either install the required tool or switch `debuggerBackend` to a backend that is already installed on your system.

## Supported Token Scopes

| Hew Construct | TextMate Scope |
|---|---|
| `fn`, `let`, `var`, `const`, `mut`, `record`, `struct`, `enum`, `trait`, `impl`, `gen` | `keyword.declaration` |
| `if`, `else`, `match`, `loop`, `for`, `while`, `return`, `await`, `scope` | `keyword.control` |
| `actor`, `receive`, `spawn`, `init`, `fork`, `this` | `keyword.actor` |
| `supervisor`, `child`, `restart`, `budget`, `strategy` | `keyword.supervisor` |
| `machine`, `state`, `event`, `on`, `when`, `entry`, `exit`, `emit` | `keyword.control.machine` |
| `wire`, `reserved`, `optional`, `deprecated`, `default` | `keyword.wire` |
| `dyn`, `is`, `unsafe` | `keyword.other` |
| `&&`, `\|\|` | `keyword.operator.logical` |
| `one_for_one`, `pool`, `brutal_kill`, `permanent`, `true`, `false`, `None` | `constant.language` |
| `events`, `emits`, `reenter`, `intensity`, `within`, `shutdown`, `infinity`, `wired_to` | `variable.language.contextual` |
| `i32`, `u64`, `f64`, `bool`, `string` | `storage.type` |
| `Result`, `Option`, `Send`, `Frozen`, `HashSet`, `ActorRef` | `storage.type` |
| PascalCase identifiers | `entity.name.type` |
| Function names in definitions | `entity.name.function` |
| Function calls | `entity.name.function.call` |
| `self` | `variable.language.self` |
| `"string"`, `r"raw"`, `b"bytes"`, `f"interpolated {x}"`, `'c'` | `string.quoted` |
| `42`, `0xFF`, `0b1010`, `3.14`, `100ms` | `constant.numeric` |
| `//`, `/* */`, `///` | `comment` |

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
