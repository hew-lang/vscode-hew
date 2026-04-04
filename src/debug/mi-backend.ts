/**
 * MI (Machine Interface) backend abstraction for GDB and LLDB.
 *
 * Provides a unified interface for spawning and communicating with
 * GDB (via --interpreter=mi3) and LLDB (via lldb-mi).
 */

import { ChildProcess, execFileSync, spawn } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type DebuggerBackendPreference = 'gdb' | 'lldb' | 'auto';

export interface MIBackend {
    /** Human-readable name ("gdb" or "lldb"). */
    name: string;
    /** Command name expected on PATH. */
    command: string;
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
    abstract command: string;
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
    command = 'gdb';

    spawn(extraArgs: string[] = []): ChildProcess {
        return spawn(this.command, ['--interpreter=mi3', '--quiet', ...extraArgs], {
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
    command = 'lldb-mi';

    spawn(extraArgs: string[] = []): ChildProcess {
        return spawn(this.command, [...extraArgs], {
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
export function detectBackend(
    preference: DebuggerBackendPreference | string,
    platform: NodeJS.Platform = os.platform()
): MIBackend {
    if (preference === 'lldb') return new LLDBBackend();
    if (preference === 'gdb') return new GDBBackend();

    // Auto: macOS → LLDB, Linux/Windows → GDB
    if (platform === 'darwin') {
        return new LLDBBackend();
    }
    return new GDBBackend();
}

export interface BackendAvailabilityOptions {
    platform?: NodeJS.Platform;
    findOnPath?: (candidateName: string) => string | undefined;
}

export interface BackendAvailabilityResult {
    backend: MIBackend;
    resolvedPath?: string;
    message?: string;
}

export function checkBackendAvailability(
    preference: DebuggerBackendPreference | string,
    options: BackendAvailabilityOptions = {}
): BackendAvailabilityResult {
    const platform = options.platform ?? os.platform();
    const backend = detectBackend(preference, platform);
    const findOnPath = options.findOnPath
        ?? ((candidateName: string) => findCommandOnPath(candidateName, platform));
    const resolvedPath = findOnPath(backend.command);

    if (resolvedPath) {
        return { backend, resolvedPath };
    }

    return {
        backend,
        message: getBackendUnavailableMessage(preference, backend, platform),
    };
}

function findCommandOnPath(
    candidateName: string,
    platform: NodeJS.Platform
): string | undefined {
    const whichCmd = platform === 'win32' ? 'where' : 'which';

    try {
        const stdout = execFileSync(whichCmd, [candidateName], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return stdout.trim().split(/\r?\n/)[0];
    } catch {
        return undefined;
    }
}

function getBackendUnavailableMessage(
    preference: DebuggerBackendPreference | string,
    backend: MIBackend,
    platform: NodeJS.Platform
): string {
    const backendLabel = backend.name === 'lldb' ? 'LLDB' : 'GDB';
    const alternatePreference = backend.name === 'lldb' ? 'gdb' : 'lldb';
    const alternateCommand = alternatePreference === 'gdb' ? 'gdb' : 'lldb-mi';
    const selectionMessage = preference === 'auto'
        ? `"debuggerBackend": "auto" selected the ${backendLabel} backend on ${platformLabel(platform)}.`
        : `"debuggerBackend": "${preference}" requires the ${backendLabel} backend.`;

    return `Cannot start Hew debugging: ${selectionMessage} ` +
        `The "${backend.command}" command was not found on PATH. Install it or switch ` +
        `launch.json to "debuggerBackend": "${alternatePreference}" if "${alternateCommand}" is installed.`;
}

function platformLabel(platform: NodeJS.Platform): string {
    switch (platform) {
        case 'darwin':
            return 'macOS';
        case 'win32':
            return 'Windows';
        default:
            return platform;
    }
}
