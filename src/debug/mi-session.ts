/**
 * MI Session — manages communication with a GDB/LLDB MI process.
 *
 * Features:
 * - Token-based command dispatch: each command gets a unique integer token,
 *   and the response is matched by token when the result record arrives.
 * - Buffers incoming stdout, splits by newlines, and parses each line.
 * - Emits events for async notifications (*stopped, *running, etc.).
 */

import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { parseMIOutput, MIRecord, MITuple } from './mi-parser';
import { MIBackend } from './mi-backend';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MIResponse {
    class: string;
    results: MITuple;
}

interface PendingCommand {
    resolve: (response: MIResponse) => void;
    reject: (error: Error) => void;
    command: string;
}

// ---------------------------------------------------------------------------
// MISession
// ---------------------------------------------------------------------------

export class MISession extends EventEmitter {
    private process: ChildProcess | undefined;
    private backend: MIBackend;
    private nextToken = 1;
    private pending = new Map<number, PendingCommand>();
    private buffer = '';
    private disposed = false;

    constructor(backend: MIBackend) {
        super();
        this.backend = backend;
    }

    /** Spawn the debugger process and begin reading output. */
    start(extraArgs?: string[]): void {
        this.process = this.backend.spawn(extraArgs);

        this.process.stdout?.on('data', (data: Buffer) => {
            this.onData(data.toString('utf-8'));
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            this.emit('log', data.toString('utf-8'));
        });

        this.process.on('exit', (code, signal) => {
            this.disposed = true;
            this.rejectAllPending(`Debugger process exited (code=${code}, signal=${signal})`);
            this.emit('exit', code, signal);
        });

        this.process.on('error', (err) => {
            this.disposed = true;
            this.rejectAllPending(`Debugger process error: ${err.message}`);
            this.emit('error', err);
        });
    }

    /**
     * Send an MI command and wait for the result record.
     * Returns the parsed result (class + key-value results).
     * Rejects if the result class is "error".
     */
    sendCommand(command: string): Promise<MIResponse> {
        if (this.disposed || !this.process?.stdin?.writable) {
            return Promise.reject(new Error('MI session is not active'));
        }

        const token = this.nextToken++;

        return new Promise<MIResponse>((resolve, reject) => {
            this.pending.set(token, { resolve, reject, command });
            // Some MI commands are compound (e.g. exec-arguments + exec-run)
            const lines = command.split('\n');
            for (let i = 0; i < lines.length - 1; i++) {
                this.process!.stdin!.write(lines[i] + '\n');
            }
            // Last (or only) line gets the token prefix
            this.process!.stdin!.write(`${token}${lines[lines.length - 1]}\n`);
        });
    }

    /**
     * Send a raw MI command without token tracking (fire-and-forget).
     * Used for commands like -gdb-exit where we don't need to wait.
     */
    sendRaw(command: string): void {
        if (!this.disposed && this.process?.stdin?.writable) {
            this.process.stdin.write(command + '\n');
        }
    }

    /** Kill the debugger process. */
    kill(): void {
        this.disposed = true;
        if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
            // Force-kill after a short timeout
            setTimeout(() => {
                if (this.process && !this.process.killed) {
                    this.process.kill('SIGKILL');
                }
            }, 2000);
        }
        this.rejectAllPending('MI session killed');
    }

    /** Whether the session is still active. */
    get isActive(): boolean {
        return !this.disposed && !!this.process && !this.process.killed;
    }

    // ---------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------

    private onData(chunk: string): void {
        this.buffer += chunk;

        let newlineIdx: number;
        while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.substring(0, newlineIdx).replace(/\r$/, '');
            this.buffer = this.buffer.substring(newlineIdx + 1);
            this.processLine(line);
        }
    }

    private processLine(line: string): void {
        const record = parseMIOutput(line);
        if (!record) return;

        switch (record.type) {
            case 'result':
                this.handleResult(record);
                break;

            case 'exec':
                this.emit('exec', record);
                break;

            case 'notify':
                this.emit('notify', record);
                break;

            case 'status':
                this.emit('status', record);
                break;

            case 'console':
                this.emit('console', record.content ?? '');
                break;

            case 'target':
                this.emit('target', record.content ?? '');
                break;

            case 'log':
                this.emit('log', record.content ?? '');
                break;

            case 'prompt':
                // Ignore GDB prompts
                break;
        }
    }

    private handleResult(record: MIRecord): void {
        const token = record.token;
        if (token === undefined) {
            // Untagged result — emit as a generic event
            this.emit('result', record);
            return;
        }

        const pending = this.pending.get(token);
        if (!pending) {
            // Orphaned result (token doesn't match any pending command)
            this.emit('result', record);
            return;
        }

        this.pending.delete(token);

        const response: MIResponse = {
            class: record.class ?? 'unknown',
            results: record.results ?? {},
        };

        if (record.class === 'error') {
            const msg = (record.results?.['msg'] as string) ?? 'Unknown MI error';
            const err = new Error(msg);
            (err as any).miResponse = response;
            pending.reject(err);
        } else {
            pending.resolve(response);
        }
    }

    private rejectAllPending(reason: string): void {
        for (const [, pending] of this.pending) {
            pending.reject(new Error(reason));
        }
        this.pending.clear();
    }
}
