import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveConnection, LiveSession } from '../src/live-session';

const connections: LiveConnection[] = [];
afterEach(() => { for (const connection of connections.splice(0)) connection.dispose(); });

function pipes() {
    const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    const output: string[] = [];
    const closed = vi.fn();
    const connection = new LiveConnection(child as unknown as ChildProcessWithoutNullStreams,
        text => output.push(text), closed);
    connections.push(connection);
    return { child, connection, output, closed };
}

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);

describe('SDK JSONL connection', () => {
    it('joins fragmented UTF-8 replies, matches IDs and separates diagnostics', async () => {
        const { child, connection, output } = pipes();
        const first = connection.request('status');
        const second = connection.request('build_prepare', { source: '/café.hew' });
        expect(child.stdin.read().toString()).toBe(
            '{"id":1,"op":"status"}\n{"source":"/café.hew","id":2,"op":"build_prepare"}\n');
        child.stderr.write('compiler diagnostic\n');
        const replies = Buffer.from('{"id":2,"ok":true,"result":{"name":"café"}}\n'
            + '{"id":1,"ok":true,"result":{"epoch":3}}\n');
        const boundary = replies.indexOf(Buffer.from('é')) + 1;
        child.stdout.write(replies.subarray(0, boundary));
        child.stdout.write(replies.subarray(boundary));
        await expect(first).resolves.toEqual({ epoch: 3 });
        await expect(second).resolves.toEqual({ name: 'café' });
        expect(output.join('')).toBe('compiler diagnostic\n');
    });

    it('keeps a rejected preparation separate from a broken connection', async () => {
        const { child, connection } = pipes();
        const refused = connection.request('build_prepare');
        const assertion = expect(refused).rejects.toThrow('source.hew:2: unknown name');
        child.stdout.write('{"id":1,"ok":false,"error":"source.hew:2: unknown name"}\n');
        await assertion;
        const next = connection.request('status');
        child.stdout.write('{"id":2,"ok":true,"result":{"epoch":7}}\n');
        await expect(next).resolves.toEqual({ epoch: 7 });
    });

    it.each(['guest output\n', '{"id":9,"ok":true,"result":{}}\n', '{"id":1,"ok":true}\n'])(
        'closes on invalid or uncorrelated protocol output %j without retrying', async reply => {
            const { child, connection, closed } = pipes();
            const pending = connection.request('replace', { digest: a, predecessor: 1, within_ms: 5000 });
            const assertion = expect(pending).rejects.toThrow('Activation outcome is unknown');
            const request = child.stdin.read().toString();
            child.stdout.write(reply);
            await assertion;
            expect(closed).toHaveBeenCalledOnce();
            expect(child.kill).toHaveBeenCalledOnce();
            expect(request.split('\n').filter(Boolean)).toHaveLength(1);
            expect(child.stdin.read()).toBeNull();
            await expect(connection.request('status')).rejects.toThrow();
        });

    it('reports an unacknowledged activation when the companion exits', async () => {
        const { child, connection } = pipes();
        const pending = connection.request('replace');
        const assertion = expect(pending).rejects.toThrow('reconnect and refresh status');
        child.emit('close', 1, null);
        await assertion;
    });

    it('exchanges requests over real child-process pipes and closes its owned process', async () => {
        const child = spawn(process.execPath, ['-e', `
            const lines = require('readline').createInterface({ input: process.stdin });
            lines.on('line', line => {
                const request = JSON.parse(line);
                process.stderr.write('attached\\n');
                process.stdout.write(JSON.stringify({ id: request.id, ok: true,
                    result: { epoch: 4, digest: '${a}' } }) + '\\n');
            });
        `], { stdio: 'pipe' });
        const exit = new Promise(resolve => child.once('close', resolve));
        const connection = new LiveConnection(child, () => {});
        connections.push(connection);
        await expect(new LiveSession(connection).refresh()).resolves.toEqual({ epoch: 4, digest: a });
        connection.dispose();
        await exit;
    });
});

describe('source preparation and activation', () => {
    it('uses the observed predecessor and only publishes the matching receipt', async () => {
        const request = vi.fn().mockResolvedValueOnce({ epoch: 7, digest: a })
            .mockResolvedValueOnce({ digest: b }).mockResolvedValueOnce({ epoch: 8, digest: b, accepted: 3 });
        const session = new LiveSession({ request });
        await session.refresh();
        await session.prepare('/router.hew');
        expect(session.active).toEqual({ epoch: 7, digest: a });
        await expect(session.activate(5000)).resolves.toEqual({ epoch: 8, digest: b });
        expect(request.mock.calls).toEqual([
            ['status'], ['build_prepare', { source: '/router.hew' }],
            ['replace', { digest: b, predecessor: 7, within_ms: 5000 }],
        ]);
        await expect(session.activate(5000)).rejects.toThrow('Prepare the saved source');
        expect(request).toHaveBeenCalledTimes(3);
    });

    it('preserves the active version after a compilation error and clears the old preparation', async () => {
        const request = vi.fn().mockResolvedValueOnce({ epoch: 2, digest: a })
            .mockResolvedValueOnce({ digest: b }).mockRejectedValueOnce(new Error('invalid source'));
        const session = new LiveSession({ request });
        await session.refresh();
        await session.prepare('/router.hew');
        await expect(session.prepare('/router.hew')).rejects.toThrow('invalid source');
        expect(session.active).toEqual({ epoch: 2, digest: a });
        expect(session.prepared).toBeUndefined();
    });

    it('discards a build completed after another edit', async () => {
        let finish!: (value: unknown) => void;
        const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        const session = new LiveSession({ request });
        const preparation = session.prepare('/router.hew');
        session.invalidate('/router.hew');
        finish({ digest: b });
        await expect(preparation).resolves.toBe(false);
        expect(session.prepared).toBeUndefined();
    });

    it.each([{ epoch: 8, digest: a }, { epoch: 7, digest: b }, { epoch: -1, digest: b }])(
        'requires a fresh status after an invalid activation receipt %j', async receipt => {
            const request = vi.fn().mockResolvedValueOnce({ epoch: 7, digest: a })
                .mockResolvedValueOnce({ digest: b }).mockResolvedValueOnce(receipt);
            const session = new LiveSession({ request });
            await session.refresh();
            await session.prepare('/router.hew');
            await expect(session.activate(5000)).rejects.toThrow();
            expect(session.active).toBeUndefined();
            expect(session.prepared).toBeUndefined();
            await expect(session.activate(5000)).rejects.toThrow('Refresh live status');
            expect(request).toHaveBeenCalledTimes(3);
        });
});
