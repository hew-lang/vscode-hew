# Hew Language Support for VS Code

Syntax highlighting and language support for the [Hew programming language](https://github.com/hew-lang/hew) — a high-performance, network-native, actor-based language.

## Features

- **Full syntax highlighting** for all Hew v0.2 constructs
- **Actor declarations** — `actor`, `isolated actor`, `receive fn`, `init`
- **Supervisor trees** — `supervisor`, `child`, `restart`, `budget`, `strategy`
- **Structured concurrency** — `scope`, `spawn`, `await`
- **Wire types** — `wire struct`, `wire enum`, field tags with `@`
- **Traits and generics** — `trait`, `impl ... for`, type parameters `[T: Send]`
- **Pattern matching** — `match`, `=>`, guards, destructuring
- **Closures** — `|args| expr`, `move |args| { ... }`
- **All built-in types** — `i8`–`i64`, `u8`–`u64`, `f32`, `f64`, `bool`, `char`, `string`
- **String variants** — regular `"..."`, raw `r"..."`, interpolated `f"...{expr}..."`
- **Duration literals** — `100ms`, `5s`, `1h`
- **Comments** — `//`, `/* */`, `///` (doc comments)
- **Auto-closing pairs** for brackets, braces, parentheses, strings, pipes
- **Code folding** support
- **Bracket matching**

## Example

```hew
isolated actor Counter {
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
   npx @vscode/vsce package
   ```
2. In VS Code, open the command palette (`Ctrl+Shift+P`) and run:
   **Extensions: Install from VSIX...**
3. Select the generated `.vsix` file

### From source (development)

1. Copy or symlink the `editors/vscode-hew` directory to `~/.vscode/extensions/hew-lang`
2. Reload VS Code

## Supported Token Scopes

| Hew Construct | TextMate Scope |
|---|---|
| `fn`, `let`, `var`, `struct`, `enum`, `trait`, `impl` | `keyword.declaration` |
| `if`, `else`, `match`, `loop`, `for`, `while`, `return` | `keyword.control` |
| `actor`, `isolated`, `receive`, `spawn`, `scope`, `await` | `keyword.actor` |
| `supervisor`, `child`, `restart`, `budget`, `strategy` | `keyword.supervisor` |
| `wire`, `reserved`, `optional`, `deprecated` | `keyword.wire` |
| `one_for_one`, `permanent`, `true`, `false` | `constant.language` |
| `i32`, `u64`, `f64`, `bool`, `string` | `storage.type` |
| `Result`, `Option`, `Send`, `Frozen` | `storage.type.generic` |
| PascalCase identifiers | `entity.name.type` |
| Function names in definitions | `entity.name.function` |
| Function calls | `entity.name.function.call` |
| `self` | `variable.language.self` |
| `"string"`, `r"raw"`, `f"interpolated {x}"` | `string.quoted` |
| `42`, `0xFF`, `0b1010`, `3.14`, `100ms` | `constant.numeric` |
| `//`, `/* */`, `///` | `comment` |

## License

MIT
