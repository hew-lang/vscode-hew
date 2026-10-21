import { spawn, execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { describe, expect, it } from 'vitest';
import { discoverBinaryPath } from '../src/binary-discovery';
import { createLspWiring } from '../src/lsp-wiring';
import { formatWithCompiler } from '../src/compiler-formatter';

// Opt in with a staged release SDK; ordinary unit checks need no compiler install.
const sdk = process.env.HEW_TEST_SDK;
describe.skipIf(!sdk)('staged release SDK consumer', () => {
    it('discovers, formats, builds and serves diagnostics with the same executable', async () => {
        const extension = resolve(sdk!, '..');
        const executable = discoverBinaryPath({
            binaryName: 'hew', extensionPath: extension, isWorkspaceTrusted: false,
            allowUntrustedWorkspaceBinaries: false, fileExists: existsSync,
            findOnPath: () => undefined,
        }).path;
        expect(executable).toBe(join(sdk!, 'bin', process.platform === 'win32' ? 'hew.exe' : 'hew'));
        const work = mkdtempSync(join(tmpdir(), 'hew-sdk-consumer-'));
        try {
            const source = 'import std.math;\nfn main(){println(math.abs(-42));}\n';
            expect(await formatWithCompiler(executable!, source)).toContain('fn main() {');
            const program = join(work, 'main.hew');
            const binary = join(work, process.platform === 'win32' ? 'answer.exe' : 'answer');
            writeFileSync(program, source);
            execFileSync(executable!, ['build', '--debug', program, '-o', binary], { cwd: work, timeout: 30000 });
            expect(execFileSync(binary, { encoding: 'utf8', timeout: 10000 }).trim()).toBe('42');

            const pkgPath = join(work, 'packages');
            const { serverOptions } = createLspWiring(executable!, undefined, { pkgPath });
            const options = serverOptions as { command: string; args: string[] };
            const child = spawn(options.command, options.args, { cwd: work, stdio: 'pipe' });
            let stderr = '';
            child.stderr.on('data', chunk => { stderr += chunk; });
            const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
            let timer: NodeJS.Timeout | undefined;
            try {
                const uri = pathToFileURL(program).toString();
                const deadline = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`LSP session timed out: ${stderr}`)), 10000);
                });
                const diagnostics = new Promise<any[]>(resolveDiagnostics => {
                    connection.onNotification('textDocument/publishDiagnostics', (params: any) => {
                        if (params.uri === uri && params.diagnostics.some((diagnostic: any) => diagnostic.severity === 1)) {
                            resolveDiagnostics(params.diagnostics);
                        }
                    });
                });
                connection.listen();
                const session = async () => {
                    const init = await connection.sendRequest<any>('initialize', {
                        processId: null, capabilities: {}, rootUri: pathToFileURL(work).toString(),
                    });
                    expect(init.capabilities.definitionProvider).toBeTruthy();
                    await connection.sendNotification('initialized', {});
                    await connection.sendNotification('textDocument/didOpen', {
                        textDocument: { uri, languageId: 'hew', version: 1, text: 'import std.math;\nfn main() { let value: i32 = "wrong"; }\n' },
                    });
                    expect((await diagnostics).some(diagnostic => diagnostic.severity === 1 && diagnostic.range.start.line === 1)).toBe(true);
                    await connection.sendRequest('shutdown');
                    await connection.sendNotification('exit');
                };
                await Promise.race([session(), deadline]);
            } finally {
                if (timer) clearTimeout(timer);
                connection.dispose();
                child.kill();
            }
        } finally {
            rmSync(work, { recursive: true, force: true });
        }
    }, 45000);
});
