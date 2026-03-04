/**
 * MI (Machine Interface) backend abstraction for GDB and LLDB.
 *
 * Provides a unified interface for spawning and communicating with
 * GDB (via --interpreter=mi3) and LLDB (via lldb-mi).
 */

import { ChildProcess, spawn } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface MIBackend {
    /** Human-readable name ("gdb" or "lldb"). */
    name: string;
    /** Spawn the debugger process with optional extra arguments. */
    spawn(extraArgs?: string[]): ChildProcess;
    /** MI command to load an executable and its symbols. */
    execAndSymbolsCmd(executable: string): string;
    /** MI command to run the program with given arguments. */
    execRunCmd(args: string[]): string;
    /** MI command to insert a breakpoint at file:line. */
    breakInsertCmd(file: string, line: number): string;
    /** MI command to get thread info. */
    threadInfoCmd(): string;
    /** MI command to list stack frames for a thread. */
    stackListFramesCmd(threadId: number): string;
    /** MI command to list local variables for a thread/frame. */
    stackListVariablesCmd(threadId: number, frameId: number): string;
    /** MI command to continue execution. */
    continueCmd(threadId?: number): string;
    /** MI command to step over (next line). */
    nextCmd(threadId?: number): string;
    /** MI command to step into. */
    stepCmd(threadId?: number): string;
    /** MI command to step out (finish current function). */
    finishCmd(threadId?: number): string;
    /** MI command to evaluate an expression. */
    evalCmd(expr: string): string;
    /** MI command to exit the debugger. */
    exitCmd(): string;
    /** Optional helper script to source on startup (e.g. pretty printers). */
    loadHelperScript(): string | undefined;
}

// ---------------------------------------------------------------------------
// Base MI Backend (shared command formatting)
// ---------------------------------------------------------------------------

abstract class BaseMIBackend implements MIBackend {
    abstract name: string;
    abstract spawn(extraArgs?: string[]): ChildProcess;
    abstract loadHelperScript(): string | undefined;

    execAndSymbolsCmd(executable: string): string {
        return `-file-exec-and-symbols "${executable}"`;
    }

    execRunCmd(args: string[]): string {
        if (args.length > 0) {
            return `-exec-arguments ${args.join(' ')}\n-exec-run`;
        }
        return '-exec-run';
    }

    breakInsertCmd(file: string, line: number): string {
        return `-break-insert ${file}:${line}`;
    }

    threadInfoCmd(): string {
        return '-thread-info';
    }

    stackListFramesCmd(threadId: number): string {
        return `-stack-list-frames --thread ${threadId}`;
    }

    stackListVariablesCmd(threadId: number, frameId: number): string {
        return `-stack-list-variables --thread ${threadId} --frame ${frameId} --all-values`;
    }

    continueCmd(threadId?: number): string {
        return threadId !== undefined ? `-exec-continue --thread ${threadId}` : '-exec-continue';
    }

    nextCmd(threadId?: number): string {
        return threadId !== undefined ? `-exec-next --thread ${threadId}` : '-exec-next';
    }

    stepCmd(threadId?: number): string {
        return threadId !== undefined ? `-exec-step --thread ${threadId}` : '-exec-step';
    }

    finishCmd(threadId?: number): string {
        return threadId !== undefined ? `-exec-finish --thread ${threadId}` : '-exec-finish';
    }

    evalCmd(expr: string): string {
        return `-data-evaluate-expression "${expr.replace(/"/g, '\\"')}"`;
    }

    exitCmd(): string {
        return '-gdb-exit';
    }
}

// ---------------------------------------------------------------------------
// GDB Backend
// ---------------------------------------------------------------------------

export class GDBBackend extends BaseMIBackend {
    name = 'gdb';

    spawn(extraArgs: string[] = []): ChildProcess {
        return spawn('gdb', ['--interpreter=mi3', '--quiet', ...extraArgs], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    }

    loadHelperScript(): string | undefined {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// LLDB Backend
// ---------------------------------------------------------------------------

export class LLDBBackend extends BaseMIBackend {
    name = 'lldb';

    spawn(extraArgs: string[] = []): ChildProcess {
        return spawn('lldb-mi', [...extraArgs], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    }

    loadHelperScript(): string | undefined {
        // Look for hew-lldb-helpers.py adjacent to the extension
        const candidates = [
            `${__dirname}/../../scripts/hew-lldb-helpers.py`,
            `${__dirname}/../scripts/hew-lldb-helpers.py`,
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                return `command script import "${p}"`;
            }
        }
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Auto-detection
// ---------------------------------------------------------------------------

/**
 * Detect the appropriate debugger backend.
 * - 'gdb' → GDBBackend
 * - 'lldb' → LLDBBackend
 * - 'auto' → LLDB on macOS, GDB elsewhere
 */
export function detectBackend(preference: string): MIBackend {
    if (preference === 'lldb') return new LLDBBackend();
    if (preference === 'gdb') return new GDBBackend();

    // Auto: macOS → LLDB, Linux/Windows → GDB
    if (os.platform() === 'darwin') {
        return new LLDBBackend();
    }
    return new GDBBackend();
}
