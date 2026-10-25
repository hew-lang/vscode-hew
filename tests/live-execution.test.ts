import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
    commands: new Map<string, () => Promise<void>>(),
    inputs: [] as string[], errors: [] as string[], warnings: [] as string[], output: '',
    documents: [] as any[], trusted: true, spawn: vi.fn(),
    changed: undefined as any, saved: undefined as any, indicator: undefined as any,
    subscriptions: [] as any[],
}));
vi.mock('child_process', () => ({ spawn: host.spawn }));
vi.mock('vscode', () => ({
    StatusBarAlignment: { Left: 1 },
    window: {
        createOutputChannel: () => ({ append: (text: string) => { host.output += text; },
            appendLine: (text: string) => { host.output += text + '\n'; }, show() {}, dispose() {} }),
        createStatusBarItem: () => host.indicator = { text: '', tooltip: '', visible: false,
            show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {} },
        showInputBox: async () => host.inputs.shift(),
        showErrorMessage: (message: string) => { host.errors.push(message); },
        showWarningMessage: (message: string) => { host.warnings.push(message); },
        get activeTextEditor() { return { document: host.documents[0] }; },
    },
    commands: { registerCommand: (name: string, command: () => Promise<void>) => {
        host.commands.set(name, command); return { dispose() {} };
    } },
    workspace: {
        get isTrusted() { return host.trusted; },
        get textDocuments() { return host.documents; },
        workspaceFolders: [{ uri: { fsPath: '/workspace', toString: () => 'file:/workspace' } }],
        getWorkspaceFolder: () => ({ uri: { fsPath: '/workspace', toString: () => 'file:/workspace' } }),
        getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
        onDidChangeTextDocument: (callback: any) => { host.changed = callback; return { dispose() {} }; },
        onDidSaveTextDocument: (callback: any) => { host.saved = callback; return { dispose() {} }; },
    },
}));

import { registerLiveExecution } from '../src/live-execution';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
let requests: any[];
let epoch: number;
let identity: string;
let rejectBuild: boolean;

beforeEach(() => {
    host.commands.clear(); host.inputs = ['127.0.0.1:7000', 'node-id'];
    host.errors = []; host.warnings = []; host.output = ''; host.subscriptions = []; host.trusted = true;
    host.documents = ['router.hew', 'helper.hew'].map(name => ({
        uri: { scheme: 'file', fsPath: `/workspace/${name}` }, languageId: 'hew', isDirty: false,
    }));
    child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    requests = []; epoch = 4; identity = a; rejectBuild = false;
    child.stdin.on('data', chunk => {
        for (const line of chunk.toString().trim().split('\n')) {
            const request = JSON.parse(line);
            requests.push(request);
            let result: unknown;
            if (request.op === 'status') result = { epoch, digest: identity };
            else if (request.op === 'build_prepare') result = { digest: b };
            else if (request.op === 'replace') {
                epoch++; identity = request.digest;
                result = { epoch, digest: identity, accepted: 0 };
            }
            queueMicrotask(() => child.stdout.write(JSON.stringify(rejectBuild && request.op === 'build_prepare'
                ? { id: request.id, ok: false, error: 'helper.hew:3: unknown name' }
                : { id: request.id, ok: true, result }) + '\n'));
        }
    });
    host.spawn.mockReset().mockReturnValue(child);
    registerLiveExecution({ subscriptions: host.subscriptions } as any);
});

afterEach(() => { for (const subscription of host.subscriptions) subscription.dispose(); });

async function run(name: string) { await host.commands.get(`hew.live.${name}`)!(); }
async function saved(document: any) {
    host.saved(document);
    // Flush the real protocol's microtask replies and the save continuation.
    await new Promise(resolve => setImmediate(resolve));
}

it('prepares saved source, invalidates it after an imported edit and activates only on demand', async () => {
    await run('attach');
    expect(host.spawn.mock.calls[0]).toEqual(['hew-live-node',
        ['attach', '--endpoint', '127.0.0.1:7000', '--node', 'node-id'],
        { cwd: '/workspace', stdio: 'pipe', windowsHide: true }]);
    await run('prepare');
    expect(requests.map(request => request.op)).toEqual(['status', 'build_prepare']);
    expect(host.indicator.text).toContain('prepared');
    const helper = host.documents[1];
    helper.isDirty = true;
    host.changed({ document: helper });
    await run('activate');
    expect(host.errors.at(-1)).toContain('Prepare the saved source');
    expect(requests).toHaveLength(2);
    helper.isDirty = false;
    await saved(helper);
    expect(requests.at(-1)).toMatchObject({ op: 'build_prepare', source: '/workspace/router.hew' });
    expect(requests.some(request => request.op === 'replace')).toBe(false);
    await run('activate');
    expect(requests.at(-1)).toMatchObject({ op: 'replace', digest: b, predecessor: 4, within_ms: 5000 });
    expect(host.indicator.text).toContain('epoch 5');
    await run('disconnect');
    expect(child.kill).toHaveBeenCalledOnce();
    expect(host.indicator.visible).toBe(false);
    expect(host.warnings).toHaveLength(0);
});

it('shows source errors while retaining the running epoch and refusing stale activation', async () => {
    await run('attach');
    await run('prepare');
    rejectBuild = true;
    host.changed({ document: host.documents[0] });
    await saved(host.documents[0]);
    expect(host.output).toContain('helper.hew:3: unknown name');
    expect(host.indicator.text).toContain('epoch 4');
    await run('activate');
    expect(requests.some(request => request.op === 'replace')).toBe(false);
});

it('does not start a companion in an untrusted workspace', async () => {
    host.trusted = false;
    await run('attach');
    expect(host.spawn).not.toHaveBeenCalled();
    expect(host.errors.at(-1)).toContain('Trust the workspace');
});

it('refuses preparation while an import is unsaved', async () => {
    await run('attach');
    host.documents[1].isDirty = true;
    await run('prepare');
    expect(requests.map(request => request.op)).toEqual(['status']);
    expect(host.errors.at(-1)).toContain('edited imports');
});
