# Hew Language Support for VS Code

Syntax highlighting and language support for the [Hew programming language](https://github.com/hew-lang/hew) — a high-performance, network-native, actor-based language.

## Features

- **Full syntax highlighting** for Hew v0.6 constructs
- **Language Server Protocol** — completion, hover, definition, document symbols, semantic tokens, diagnostics (requires `hew-lsp`)
- **Document formatting** — format on save via `hew fmt` (requires `hew` CLI)
- **Actor declarations** — `actor`, `receive fn`, `receive`, `init`
- **Supervisor trees** — `supervisor`, `child`, `restart`, `budget`, `strategy`
- **Structured concurrency** — `scope`, `launch`, `cancel`, `spawn`, `await`
- **Generators** — `gen fn`, `async gen fn`, `yield`, `cooperate`
- **Wire types** — `wire type`, `wire enum`, field tags with `@`
- **Traits and generics** — `trait`, `impl ... for`, type parameters `[T: Send]`
- **Pattern matching** — `match`, `=>`, guards, destructuring
- **All built-in types** — `i8`–`i64`, `u8`–`u64`, `f32`, `f64`, `bool`, `char`, `string`
- **String variants** — regular `"..."`, raw `r"..."`, interpolated `f"...{expr}..."`
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
| `hew.lsp.serverPath` | `""` | Path to `hew-lsp` binary. If empty, searches workspace `target/` and `PATH`. |
| `hew.formatterPath` | `""` | Path to `hew` binary for formatting. If empty, searches workspace `target/` and `PATH`. |

## Supported Token Scopes

| Hew Construct | TextMate Scope |
|---|---|
| `fn`, `let`, `var`, `struct`, `enum`, `trait`, `impl`, `gen` | `keyword.declaration` |
| `if`, `else`, `match`, `loop`, `for`, `while`, `return`, `await`, `scope`, `launch`, `cancel` | `keyword.control` |
| `actor`, `receive`, `spawn`, `init`, `async`, `mailbox`, `overflow` | `keyword.actor` |
| `supervisor`, `child`, `restart`, `budget`, `strategy` | `keyword.supervisor` |
| `wire`, `reserved`, `optional`, `deprecated`, `default`, `list` | `keyword.wire` |
| `and`, `or` | `keyword.operator.logical` |
| `one_for_one`, `permanent`, `true`, `false`, `None` | `constant.language` |
| `i32`, `u64`, `f64`, `bool`, `string` | `storage.type` |
| `Result`, `Option`, `Send`, `Frozen`, `Actor`, `ActorRef` | `storage.type` |
| PascalCase identifiers | `entity.name.type` |
| Function names in definitions | `entity.name.function` |
| Function calls | `entity.name.function.call` |
| `self` | `variable.language.self` |
| `"string"`, `r"raw"`, `f"interpolated {x}"` | `string.quoted` |
| `42`, `0xFF`, `0b1010`, `3.14`, `100ms` | `constant.numeric` |
| `//`, `/* */`, `///` | `comment` |

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
