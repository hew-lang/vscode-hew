import type { ChildProcess, ExecFileException, ExecFileOptionsWithStringEncoding } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const executions = vi.hoisted(() => ({ children: [] as ChildProcess[] }));

// Launch the fixture with Node so these tests use real pipes and processes on
// every platform, without requiring an executable script or a compiler install.
vi.mock('child_process', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process');
    return {
        ...actual,
        execFile: (
            fixture: string,
            args: string[],
            options: ExecFileOptionsWithStringEncoding,
            callback: (error: ExecFileException | null, stdout: string, stderr: string) => void
        ) => {
            const child = actual.execFile(process.execPath, [fixture, ...args], options, callback);
            executions.children.push(child);
            return child;
        },
    };
});

import { formatWithCompiler } from '../src/compiler-formatter';

let fixtureDir: string;
beforeAll(() => { fixtureDir = mkdtempSync(join(tmpdir(), 'hew-formatter-')); });
afterAll(() => { rmSync(fixtureDir, { recursive: true, force: true }); });

function fixture(name: string, script: string): string {
    const file = join(fixtureDir, `${name}.cjs`);
    writeFileSync(file, script);
    return file;
}

const largeBuffer = '// unsaved buffer contents\n'.repeat(32768);

describe('compiler formatting process', () => {
    it('writes the UTF-8 buffer and returns the complete formatted output', async () => {
        const compiler = fixture('normal', `
            process.stdin.setEncoding('utf8');
            let source = '';
            process.stdin.on('data', chunk => { source += chunk; });
            process.stdin.on('end', () => {
                process.stdout.end(source.replace('fn main(){', 'fn main() {\\n    ')
                    .replace(';}', ';\\n}'));
            });
        `);
        const source = 'fn main(){println("buffer café");}\n';
        await expect(formatWithCompiler(compiler, source))
            .resolves.toBe('fn main() {\n    println("buffer café");\n}\n');
        expect(executions.children.at(-1)?.exitCode).toBe(0);
    });

    it('preserves stderr when a compiler fails before reading the buffer', async () => {
        const compiler = fixture('failure', `
            process.stderr.write('compiler rejected input\\n');
            process.stdout.write('partial output');
            process.exit(1);
        `);
        await expect(formatWithCompiler(compiler, largeBuffer))
            .rejects.toThrow('compiler rejected input');
        expect(executions.children.at(-1)?.exitCode).toBe(1);
    });

    it.each(['', 'partial output'])('rejects a zero-exit closed stdin with output %j', async output => {
        const compiler = fixture(`closed-${output.length}`, `
            process.stdin.destroy();
            process.stdout.end(${JSON.stringify(output)}, () => process.exit(0));
        `);
        await expect(formatWithCompiler(compiler, largeBuffer)).rejects.toThrow();
        // A rejected stdin write must outweigh an otherwise successful exit.
        expect(executions.children.at(-1)?.exitCode).toBe(0);
    });

    it('rejects empty successful output even when a tiny input fits in the pipe', async () => {
        const compiler = fixture('empty', 'process.exit(0);');
        await expect(formatWithCompiler(compiler, 'fn main() {}'))
            .rejects.toThrow('hew fmt returned no output for a nonempty buffer');
        expect(executions.children.at(-1)?.exitCode).toBe(0);
    });

    it('allows an empty result for a whitespace-only buffer', async () => {
        const compiler = fixture('whitespace', `
            process.stdin.resume();
            process.stdin.on('end', () => process.exit(0));
        `);
        await expect(formatWithCompiler(compiler, ' \n\t')).resolves.toBe('');
        expect(executions.children.at(-1)?.exitCode).toBe(0);
    });
});
