/**
 * GDB Machine Interface (MI) output parser.
 *
 * MI output grammar (simplified):
 *   output       → out-of-band-record* result-record? "(gdb)" nl
 *   result-record → [token] "^" result-class ("," result)*
 *   exec-async   → [token] "*" async-class ("," result)*
 *   status-async → [token] "+" async-class ("," result)*
 *   notify-async → [token] "=" async-class ("," result)*
 *   console-out  → "~" c-string
 *   target-out   → "@" c-string
 *   log-out      → "&" c-string
 *
 *   result       → variable "=" value
 *   value        → c-string | tuple | list
 *   tuple        → "{}" | "{" result ("," result)* "}"
 *   list         → "[]" | "[" value ("," value)* "]" | "[" result ("," result)* "]"
 *   c-string     → '"' (escaped-char | char)* '"'
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MIValue = string | MITuple | MIList;
export type MITuple = { [key: string]: MIValue };
export type MIList = MIValue[];

export type MIRecordType =
    | 'result'
    | 'exec'
    | 'status'
    | 'notify'
    | 'console'
    | 'target'
    | 'log'
    | 'prompt';

export interface MIRecord {
    type: MIRecordType;
    token?: number;
    class?: string;       // e.g. "done", "running", "stopped", "error"
    results?: MITuple;    // key-value results for result/async records
    content?: string;     // text content for console/target/log records
}

// ---------------------------------------------------------------------------
// C-string unescaping
// ---------------------------------------------------------------------------

function unescapeCString(s: string): string {
    let out = '';
    let i = 0;
    while (i < s.length) {
        if (s[i] === '\\' && i + 1 < s.length) {
            i++;
            switch (s[i]) {
                case 'n': out += '\n'; break;
                case 't': out += '\t'; break;
                case 'r': out += '\r'; break;
                case '\\': out += '\\'; break;
                case '"': out += '"'; break;
                case 'a': out += '\x07'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'v': out += '\v'; break;
                case '0': out += '\0'; break;
                default: out += '\\' + s[i]; break;
            }
        } else {
            out += s[i];
        }
        i++;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Recursive descent parser for MI values
// ---------------------------------------------------------------------------

class MIValueParser {
    private pos: number;

    constructor(private readonly input: string, startPos: number) {
        this.pos = startPos;
    }

    getPos(): number {
        return this.pos;
    }

    private peek(): string {
        return this.input[this.pos] ?? '';
    }

    private advance(): string {
        return this.input[this.pos++] ?? '';
    }

    private skipWhitespace(): void {
        while (this.pos < this.input.length && (this.input[this.pos] === ' ' || this.input[this.pos] === '\t')) {
            this.pos++;
        }
    }

    /** Parse a C-string: "..." with escape handling. */
    parseCString(): string {
        if (this.peek() !== '"') {
            throw new Error(`Expected '"' at position ${this.pos}, got '${this.peek()}'`);
        }
        this.advance(); // skip opening "
        let content = '';
        while (this.pos < this.input.length && this.input[this.pos] !== '"') {
            if (this.input[this.pos] === '\\' && this.pos + 1 < this.input.length) {
                content += this.input[this.pos];
                this.pos++;
                content += this.input[this.pos];
                this.pos++;
            } else {
                content += this.input[this.pos];
                this.pos++;
            }
        }
        if (this.peek() === '"') {
            this.advance(); // skip closing "
        }
        return unescapeCString(content);
    }

    /** Parse a value: c-string | tuple | list. */
    parseValue(): MIValue {
        this.skipWhitespace();
        const ch = this.peek();
        if (ch === '"') {
            return this.parseCString();
        } else if (ch === '{') {
            return this.parseTuple();
        } else if (ch === '[') {
            return this.parseList();
        }
        throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
    }

    /** Parse a tuple: { result, result, ... } */
    parseTuple(): MITuple {
        this.advance(); // skip {
        this.skipWhitespace();
        const result: MITuple = {};
        if (this.peek() === '}') {
            this.advance();
            return result;
        }
        this.parseResultInto(result);
        while (this.peek() === ',') {
            this.advance(); // skip ,
            this.skipWhitespace();
            if (this.peek() === '}') break;
            this.parseResultInto(result);
        }
        if (this.peek() === '}') {
            this.advance();
        }
        return result;
    }

    /** Parse a list: [ value, value, ... ] or [ result, result, ... ] */
    parseList(): MIList {
        this.advance(); // skip [
        this.skipWhitespace();
        const list: MIList = [];
        if (this.peek() === ']') {
            this.advance();
            return list;
        }
        // Determine if this is a list of values or a list of results.
        // A result starts with variable=, a value starts with " or { or [.
        // We peek ahead to decide.
        if (this.isResultStart()) {
            // List of results → convert to list of tuples
            const tuple: MITuple = {};
            this.parseResultInto(tuple);
            list.push(tuple);
            while (this.peek() === ',') {
                this.advance();
                this.skipWhitespace();
                if (this.peek() === ']') break;
                if (this.isResultStart()) {
                    const t: MITuple = {};
                    this.parseResultInto(t);
                    list.push(t);
                } else {
                    list.push(this.parseValue());
                }
            }
        } else {
            list.push(this.parseValue());
            while (this.peek() === ',') {
                this.advance();
                this.skipWhitespace();
                if (this.peek() === ']') break;
                list.push(this.parseValue());
            }
        }
        if (this.peek() === ']') {
            this.advance();
        }
        return list;
    }

    /** Parse "variable=value" and add to the given tuple. */
    parseResultInto(tuple: MITuple): void {
        this.skipWhitespace();
        const name = this.parseVariable();
        if (this.peek() !== '=') {
            throw new Error(`Expected '=' after variable '${name}' at position ${this.pos}`);
        }
        this.advance(); // skip =
        tuple[name] = this.parseValue();
    }

    /** Parse a variable name (letters, digits, -, _). */
    private parseVariable(): string {
        let name = '';
        while (this.pos < this.input.length && /[a-zA-Z0-9_-]/.test(this.input[this.pos])) {
            name += this.input[this.pos];
            this.pos++;
        }
        return name;
    }

    /** Check if the current position starts a result (variable=...) rather than a value. */
    private isResultStart(): boolean {
        const ch = this.peek();
        if (ch === '"' || ch === '{' || ch === '[') return false;
        // Look ahead for variable=
        let ahead = this.pos;
        while (ahead < this.input.length && /[a-zA-Z0-9_-]/.test(this.input[ahead])) {
            ahead++;
        }
        return ahead > this.pos && this.input[ahead] === '=';
    }

    /** Parse remaining results as a MITuple. */
    parseResults(): MITuple {
        const results: MITuple = {};
        this.skipWhitespace();
        if (this.pos >= this.input.length) return results;
        this.parseResultInto(results);
        while (this.peek() === ',') {
            this.advance();
            this.skipWhitespace();
            if (this.pos >= this.input.length) break;
            this.parseResultInto(results);
        }
        return results;
    }
}

// ---------------------------------------------------------------------------
// Top-level line parser
// ---------------------------------------------------------------------------

const asyncPrefixMap: Record<string, MIRecordType> = {
    '*': 'exec',
    '+': 'status',
    '=': 'notify',
};

const streamPrefixMap: Record<string, MIRecordType> = {
    '~': 'console',
    '@': 'target',
    '&': 'log',
};

/**
 * Parse a single line of MI output into an MIRecord.
 * Returns undefined for blank lines or the "(gdb)" prompt.
 */
export function parseMIOutput(line: string): MIRecord | undefined {
    if (!line || line.trim() === '') return undefined;

    // GDB prompt
    if (line.trim() === '(gdb)' || line.trim() === '(gdb) ') {
        return { type: 'prompt' };
    }

    let pos = 0;

    // Parse optional token (leading digits)
    let token: number | undefined;
    let tokenStr = '';
    while (pos < line.length && /\d/.test(line[pos])) {
        tokenStr += line[pos];
        pos++;
    }
    if (tokenStr.length > 0) {
        token = parseInt(tokenStr, 10);
    }

    if (pos >= line.length) return undefined;

    const prefix = line[pos];

    // Result record: ^class,results
    if (prefix === '^') {
        pos++;
        let className = '';
        while (pos < line.length && /[a-zA-Z_-]/.test(line[pos])) {
            className += line[pos];
            pos++;
        }
        let results: MITuple = {};
        if (line[pos] === ',') {
            pos++;
            const parser = new MIValueParser(line, pos);
            results = parser.parseResults();
        }
        return { type: 'result', token, class: className, results };
    }

    // Async records: *, +, =
    if (prefix in asyncPrefixMap) {
        const type = asyncPrefixMap[prefix];
        pos++;
        let className = '';
        while (pos < line.length && /[a-zA-Z_-]/.test(line[pos])) {
            className += line[pos];
            pos++;
        }
        let results: MITuple = {};
        if (line[pos] === ',') {
            pos++;
            const parser = new MIValueParser(line, pos);
            results = parser.parseResults();
        }
        return { type, token, class: className, results };
    }

    // Stream records: ~, @, &
    if (prefix in streamPrefixMap) {
        const type = streamPrefixMap[prefix];
        pos++;
        const parser = new MIValueParser(line, pos);
        const content = parser.parseCString();
        return { type, content };
    }

    // Unknown — return as console output
    return { type: 'console', content: line };
}
