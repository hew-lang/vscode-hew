import type { ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface, Interface } from 'readline';

interface Pending {
    operation: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
}

/** Local framing only; the SDK owns authentication, compilation and activation. */
export class LiveConnection {
    private readonly lines: Interface;
    private readonly pending = new Map<number, Pending>();
    private nextId = 1;
    private failure?: Error;

    constructor(
        private readonly child: ChildProcessWithoutNullStreams,
        output: (text: string) => void,
        private readonly closed: (error: Error) => void = () => {},
    ) {
        this.lines = createInterface({ input: child.stdout });
        this.lines.on('line', line => this.receive(line));
        this.lines.on('close', () => this.fail(new Error('Live SDK output closed.')));
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', output);
        child.on('error', error => this.fail(error));
        child.on('close', (code, signal) => this.fail(
            new Error(`Live SDK exited (${signal ?? code ?? 'unknown status'}).`),
        ));
        child.stdin.on('error', error => this.fail(error));
    }

    request(operation: string, arguments_: Record<string, unknown> = {}): Promise<unknown> {
        if (this.failure) return Promise.reject(this.failure);
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { operation, resolve, reject });
            this.child.stdin.write(JSON.stringify({ ...arguments_, id, op: operation }) + '\n', error => {
                if (error) this.fail(error);
            });
        });
    }

    dispose(): void {
        this.fail(new Error('Live session disconnected.'));
    }

    private receive(line: string): void {
        try {
            const reply: unknown = JSON.parse(line);
            if (!isRecord(reply) || !Number.isSafeInteger(reply.id) || typeof reply.ok !== 'boolean') {
                throw new Error('Malformed live SDK reply.');
            }
            const pending = this.pending.get(reply.id as number);
            if (!pending) throw new Error('Live SDK replied to an unknown request.');
            if (!reply.ok && typeof reply.error !== 'string') {
                throw new Error('Malformed live SDK error.');
            }
            if (reply.ok && !Object.prototype.hasOwnProperty.call(reply, 'result')) {
                throw new Error('Live SDK reply has no result.');
            }
            this.pending.delete(reply.id as number);
            if (reply.ok) pending.resolve(reply.result);
            else pending.reject(new Error(reply.error as string));
        } catch (error) {
            this.fail(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private fail(error: Error): void {
        if (this.failure) return;
        this.failure = error;
        for (const pending of this.pending.values()) {
            pending.reject(pending.operation === 'replace'
                ? new Error(`${error.message} Activation outcome is unknown; reconnect and refresh status before continuing.`)
                : error);
        }
        this.pending.clear();
        this.lines.close();
        this.child.kill();
        this.closed(error);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function digest(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
        throw new Error('Live SDK returned an invalid component digest.');
    }
    return value;
}

export interface LiveStatus { epoch: number; digest: string }
export interface PreparedSource { source: string; digest: string }

function status(value: unknown): LiveStatus {
    if (!isRecord(value) || !Number.isSafeInteger(value.epoch) || (value.epoch as number) < 0) {
        throw new Error('Live SDK returned an invalid activation epoch.');
    }
    return { epoch: value.epoch as number, digest: digest(value.digest) };
}

/** An editor view of SDK receipts, never a separate activation authority. */
export class LiveSession {
    active?: LiveStatus;
    prepared?: PreparedSource;
    source?: string;
    private revision = 0;

    constructor(private readonly connection: Pick<LiveConnection, 'request'>) {}

    async refresh(): Promise<LiveStatus> {
        this.active = status(await this.connection.request('status'));
        return this.active;
    }

    invalidate(source: string): void {
        if (this.source !== source) return;
        this.revision++;
        this.prepared = undefined;
    }

    async prepare(source: string): Promise<boolean> {
        this.source = source;
        this.prepared = undefined;
        const revision = ++this.revision;
        const result = await this.connection.request('build_prepare', { source });
        if (!isRecord(result)) throw new Error('Live SDK returned an invalid preparation receipt.');
        const identity = digest(result.digest);
        if (revision !== this.revision) return false;
        this.prepared = { source, digest: identity };
        return true;
    }

    async activate(withinMs: number): Promise<LiveStatus> {
        if (!this.active) throw new Error('Refresh live status before activating.');
        if (!this.prepared) throw new Error('Prepare the saved source before activating.');
        const prepared = this.prepared;
        const predecessor = this.active.epoch;
        this.prepared = undefined;
        try {
            const result = status(await this.connection.request('replace', {
                digest: prepared.digest, predecessor, within_ms: withinMs,
            }));
            if (result.digest !== prepared.digest || result.epoch <= predecessor) {
                throw new Error('Live SDK activation receipt does not match the prepared component.');
            }
            this.active = result;
            return result;
        } catch (error) {
            this.active = undefined;
            throw error;
        }
    }
}
