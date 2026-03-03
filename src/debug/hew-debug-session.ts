/**
 * Hew Debug Session — translates VS Code Debug Adapter Protocol (DAP)
 * into GDB/LLDB Machine Interface (MI) commands.
 *
 * Features:
 * - Auto-compiles .hew files with `hew build --debug`
 * - Spawns gdb/lldb via MI abstraction
 * - Breakpoints, stepping, call stack, variables
 * - Runtime frame filtering (hew_runtime_*, __pthread, __libc, etc.)
 * - Custom DAP requests for actor-specific debugging
 */

import {
    DebugSession,
    InitializedEvent,
    StoppedEvent,
    TerminatedEvent,
    OutputEvent,
    Thread,
    StackFrame,
    Scope,
    Source,
    Variable,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { MISession, MIResponse } from './mi-session';
import { MIRecord, MITuple, MIList } from './mi-parser';
import { detectBackend, MIBackend } from './mi-backend';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Launch configuration
// ---------------------------------------------------------------------------

interface HewLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program: string;
    args?: string[];
    cwd?: string;
    stopOnEntry?: boolean;
    debuggerBackend?: 'gdb' | 'lldb' | 'auto';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Patterns for runtime frames that should be filtered from the call stack. */
const RUNTIME_FRAME_PATTERNS = [
    /^hew_runtime_/,
    /^hew_rt_/,
    /^__pthread/,
    /^__libc/,
    /^_start$/,
    /^__GI_/,
    /^clone$/,
    /^start_thread$/,
    /^__clone/,
    /^_dl_/,
    /^__do_global/,
    /^__cxa_/,
    /^_IO_/,
];

/** Variable reference base for scopes (locals). */
const LOCALS_SCOPE_REF = 1000;

// ---------------------------------------------------------------------------
// HewDebugSession
// ---------------------------------------------------------------------------

export class HewDebugSession extends DebugSession {
    private mi: MISession | undefined;
    private backend: MIBackend | undefined;
    private launchArgs: HewLaunchRequestArguments | undefined;
    private showRuntimeFrames = false;

    /** Map from DAP variable reference → { threadId, frameId }. */
    private variableRefs = new Map<number, { threadId: number; frameId: number }>();
    private nextVarRef = LOCALS_SCOPE_REF;

    constructor() {
        super();

        // DAP uses 1-based IDs
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    // -----------------------------------------------------------------------
    // DAP: Initialize
    // -----------------------------------------------------------------------

    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        _args: DebugProtocol.InitializeRequestArguments
    ): void {
        response.body = response.body ?? {};

        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsFunctionBreakpoints = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsSteppingGranularity = false;
        response.body.supportsTerminateRequest = true;

        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    // -----------------------------------------------------------------------
    // DAP: Configuration done
    // -----------------------------------------------------------------------

    protected configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        _args: DebugProtocol.ConfigurationDoneArguments
    ): void {
        this.sendResponse(response);
    }

    // -----------------------------------------------------------------------
    // DAP: Launch
    // -----------------------------------------------------------------------

    protected async launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: HewLaunchRequestArguments
    ): Promise<void> {
        this.launchArgs = args;

        try {
            // Step 1: Determine executable path
            const executable = await this.resolveExecutable(args);

            // Step 2: Set up debugger backend
            this.backend = detectBackend(args.debuggerBackend ?? 'auto');
            this.log(`Using debugger backend: ${this.backend.name}`);

            // Step 3: Create MI session and spawn debugger
            this.mi = new MISession(this.backend);
            this.setupMIEventHandlers();
            this.mi.start();

            // Step 4: Load helper scripts if available
            const helperScript = this.backend.loadHelperScript();
            if (helperScript) {
                try {
                    await this.mi.sendCommand(`-interpreter-exec console "${helperScript}"`);
                } catch {
                    this.log('Helper script not loaded (this is OK)');
                }
            }

            // Step 5: Load executable
            await this.mi.sendCommand(this.backend.execAndSymbolsCmd(executable));
            this.log(`Loaded executable: ${executable}`);

            // Step 6: Set working directory if specified
            if (args.cwd) {
                await this.mi.sendCommand(`-environment-cd "${args.cwd}"`);
            }

            // Step 7: Run the program
            if (args.stopOnEntry) {
                // Insert a temporary breakpoint at main, then run
                await this.mi.sendCommand('-break-insert -t main');
            }

            const runCmd = this.backend.execRunCmd(args.args ?? []);
            // execRunCmd may return multiple commands separated by \n
            await this.mi.sendCommand(runCmd);

            this.sendResponse(response);
        } catch (err: any) {
            this.sendErrorResponse(response, 1, err.message ?? 'Launch failed');
        }
    }

    // -----------------------------------------------------------------------
    // DAP: Set Breakpoints
    // -----------------------------------------------------------------------

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): Promise<void> {
        const source = args.source;
        const filePath = source.path ?? '';
        const requestedLines = args.breakpoints ?? [];

        // First, clear all existing breakpoints for this file.
        // GDB doesn't have a per-file clear, so we delete individually.
        // For simplicity, we'll just insert new ones; GDB handles duplicates.
        // A more robust approach would track breakpoint numbers.

        if (!this.mi) {
            response.body = { breakpoints: requestedLines.map(bp => ({ verified: false, line: bp.line })) };
            this.sendResponse(response);
            return;
        }

        const results = await Promise.allSettled(
            requestedLines.map(bp =>
                this.mi!.sendCommand(this.backend!.breakInsertCmd(filePath, bp.line))
                    .then(result => {
                        const bkpt = result.results['bkpt'] as MITuple | undefined;
                        const line = bkpt ? parseInt(bkpt['line'] as string, 10) : bp.line;
                        return {
                            verified: true,
                            line,
                            id: bkpt ? parseInt(bkpt['number'] as string, 10) : undefined,
                        } as DebugProtocol.Breakpoint;
                    })
                    .catch((err: any) => ({
                        verified: false,
                        line: bp.line,
                        message: err.message,
                    } as DebugProtocol.Breakpoint))
            )
        );

        const breakpoints = results.map(r =>
            r.status === 'fulfilled' ? r.value : { verified: false } as DebugProtocol.Breakpoint
        );

        response.body = { breakpoints };
        this.sendResponse(response);
    }

    // -----------------------------------------------------------------------
    // DAP: Threads
    // -----------------------------------------------------------------------

    protected async threadsRequest(
        response: DebugProtocol.ThreadsResponse
    ): Promise<void> {
        if (!this.mi) {
            response.body = { threads: [] };
            this.sendResponse(response);
            return;
        }

        try {
            const result = await this.mi.sendCommand(this.backend!.threadInfoCmd());
            const threadList = result.results['threads'] as MIList | undefined;
            const threads: Thread[] = [];

            if (threadList) {
                for (const t of threadList) {
                    const thread = t as MITuple;
                    const id = parseInt(thread['id'] as string, 10);
                    const name = (thread['name'] as string) ?? (thread['target-id'] as string) ?? `Thread ${id}`;
                    threads.push(new Thread(id, name));
                }
            }

            response.body = { threads };
            this.sendResponse(response);
        } catch (err: any) {
            response.body = { threads: [new Thread(1, 'main')] };
            this.sendResponse(response);
        }
    }

    // -----------------------------------------------------------------------
    // DAP: Stack Trace
    // -----------------------------------------------------------------------

    protected async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ): Promise<void> {
        if (!this.mi) {
            response.body = { stackFrames: [], totalFrames: 0 };
            this.sendResponse(response);
            return;
        }

        try {
            const result = await this.mi.sendCommand(
                this.backend!.stackListFramesCmd(args.threadId)
            );

            const stackList = result.results['stack'] as MIList | undefined;
            const frames: StackFrame[] = [];

            if (stackList) {
                for (const entry of stackList) {
                    const wrapper = entry as MITuple;
                    // stack=[frame={...},frame={...}] → each entry is {frame: {...}}
                    const frame = (wrapper['frame'] as MITuple) ?? wrapper;

                    const func = frame['func'] as string ?? '<unknown>';
                    const file = frame['file'] as string;
                    const fullname = frame['fullname'] as string;
                    const line = parseInt(frame['line'] as string ?? '0', 10);
                    const level = parseInt(frame['level'] as string ?? '0', 10);

                    // Apply runtime frame filter
                    if (!this.showRuntimeFrames && this.isRuntimeFrame(func)) {
                        continue;
                    }

                    const source = file
                        ? new Source(path.basename(file), fullname ?? file)
                        : undefined;

                    frames.push(new StackFrame(
                        this.encodeFrameId(args.threadId, level),
                        func,
                        source,
                        line
                    ));
                }
            }

            response.body = {
                stackFrames: frames,
                totalFrames: frames.length,
            };
            this.sendResponse(response);
        } catch (err: any) {
            response.body = { stackFrames: [], totalFrames: 0 };
            this.sendResponse(response);
        }
    }

    // -----------------------------------------------------------------------
    // DAP: Scopes
    // -----------------------------------------------------------------------

    protected scopesRequest(
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments
    ): void {
        const { threadId, frameLevel } = this.decodeFrameId(args.frameId);
        const ref = this.nextVarRef++;
        this.variableRefs.set(ref, { threadId, frameId: frameLevel });

        const scopes: Scope[] = [
            new Scope('Locals', ref, false),
        ];

        response.body = { scopes };
        this.sendResponse(response);
    }

    // -----------------------------------------------------------------------
    // DAP: Variables
    // -----------------------------------------------------------------------

    protected async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ): Promise<void> {
        const ctx = this.variableRefs.get(args.variablesReference);
        if (!ctx || !this.mi) {
            response.body = { variables: [] };
            this.sendResponse(response);
            return;
        }

        try {
            const result = await this.mi.sendCommand(
                this.backend!.stackListVariablesCmd(ctx.threadId, ctx.frameId)
            );

            const varList = result.results['variables'] as MIList | undefined;
            const variables: Variable[] = [];

            if (varList) {
                for (const v of varList) {
                    const variable = v as MITuple;
                    const name = variable['name'] as string ?? '?';
                    const value = variable['value'] as string ?? '';
                    variables.push(new Variable(name, value));
                }
            }

            response.body = { variables };
            this.sendResponse(response);
        } catch (err: any) {
            response.body = { variables: [] };
            this.sendResponse(response);
        }
    }

    // -----------------------------------------------------------------------
    // DAP: Continue
    // -----------------------------------------------------------------------

    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        args: DebugProtocol.ContinueArguments
    ): Promise<void> {
        if (!this.mi) {
            this.sendResponse(response);
            return;
        }

        try {
            await this.mi.sendCommand(this.backend!.continueCmd(args.threadId));
        } catch {
            // Continue may not return a result record before the program runs
        }

        response.body = { allThreadsContinued: true };
        this.sendResponse(response);
    }

    // -----------------------------------------------------------------------
    // DAP: Next (step over)
    // -----------------------------------------------------------------------

    protected async nextRequest(
        response: DebugProtocol.NextResponse,
        args: DebugProtocol.NextArguments
    ): Promise<void> {
        if (this.mi) {
            try {
                await this.mi.sendCommand(this.backend!.nextCmd(args.threadId));
            } catch {
                // Stepping may cause immediate stop event
            }
        }
        this.sendResponse(response);
    }

    // -----------------------------------------------------------------------
    // DAP: Step In
    // -----------------------------------------------------------------------

    protected async stepInRequest(
        response: DebugProtocol.StepInResponse,
        args: DebugProtocol.StepInArguments
    ): Promise<void> {
        if (this.mi) {
            try {
                await this.mi.sendCommand(this.backend!.stepCmd(args.threadId));
            } catch {
                // Stepping may cause immediate stop event
            }
        }
        this.sendResponse(response);
    }

    // -----------------------------------------------------------------------
    // DAP: Step Out
    // -----------------------------------------------------------------------

    protected async stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        args: DebugProtocol.StepOutArguments
    ): Promise<void> {
        if (this.mi) {
            try {
                await this.mi.sendCommand(this.backend!.finishCmd(args.threadId));
            } catch {
                // Stepping may cause immediate stop event
            }
        }
        this.sendResponse(response);
    }

    // -----------------------------------------------------------------------
    // DAP: Evaluate
    // -----------------------------------------------------------------------

    protected async evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments
    ): Promise<void> {
        if (!this.mi) {
            this.sendErrorResponse(response, 1, 'No active debug session');
            return;
        }

        try {
            const result = await this.mi.sendCommand(
                this.backend!.evalCmd(args.expression)
            );
            const value = result.results['value'] as string ?? '';
            response.body = {
                result: value,
                variablesReference: 0,
            };
            this.sendResponse(response);
        } catch (err: any) {
            this.sendErrorResponse(response, 1, err.message);
        }
    }

    // -----------------------------------------------------------------------
    // DAP: Terminate
    // -----------------------------------------------------------------------

    protected async terminateRequest(
        response: DebugProtocol.TerminateResponse,
        _args: DebugProtocol.TerminateArguments
    ): Promise<void> {
        await this.shutdownDebugger();
        this.sendResponse(response);
    }

    // -----------------------------------------------------------------------
    // DAP: Disconnect
    // -----------------------------------------------------------------------

    protected async disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        _args: DebugProtocol.DisconnectArguments
    ): Promise<void> {
        await this.shutdownDebugger();
        this.sendResponse(response);
    }

    // -----------------------------------------------------------------------
    // Custom DAP requests for actor debugging
    // -----------------------------------------------------------------------

    protected customRequest(
        command: string,
        response: DebugProtocol.Response,
        args: any
    ): void {
        switch (command) {
            case 'hew/listActors':
                this.handleListActors(response).catch(() => {
                    this.sendErrorResponse(response, 1, 'Failed to list actors');
                });
                break;

            case 'hew/breakOnReceive':
                this.handleBreakOnReceive(response, args).catch(() => {
                    this.sendErrorResponse(response, 1, 'Failed to set receive breakpoint');
                });
                break;

            case 'hew/toggleRuntimeFrames':
                this.showRuntimeFrames = !this.showRuntimeFrames;
                response.body = { showRuntimeFrames: this.showRuntimeFrames };
                this.sendResponse(response);
                break;

            default:
                super.customRequest(command, response, args);
                break;
        }
    }

    // -----------------------------------------------------------------------
    // Actor debugging helpers
    // -----------------------------------------------------------------------

    private async handleListActors(
        response: DebugProtocol.Response
    ): Promise<void> {
        if (!this.mi) {
            this.sendErrorResponse(response, 1, 'No active debug session');
            return;
        }

        try {
            const result = await this.mi.sendCommand(
                '-interpreter-exec console "hew-actors"'
            );
            // The output comes through the console stream, not the result
            response.body = { actors: result.results };
            this.sendResponse(response);
        } catch (err: any) {
            this.sendErrorResponse(response, 1, err.message);
        }
    }

    private async handleBreakOnReceive(
        response: DebugProtocol.Response,
        args: { actor?: string; method?: string }
    ): Promise<void> {
        if (!this.mi) {
            this.sendErrorResponse(response, 1, 'No active debug session');
            return;
        }

        try {
            const cmd = args.method
                ? `hew-break-receive ${args.actor} ${args.method}`
                : `hew-break-receive ${args.actor}`;
            await this.mi.sendCommand(`-interpreter-exec console "${cmd}"`);
            this.sendResponse(response);
        } catch (err: any) {
            this.sendErrorResponse(response, 1, err.message);
        }
    }

    // -----------------------------------------------------------------------
    // MI event handlers
    // -----------------------------------------------------------------------

    private setupMIEventHandlers(): void {
        if (!this.mi) return;

        this.mi.on('exec', (record: MIRecord) => {
            this.handleExecAsync(record);
        });

        this.mi.on('notify', (record: MIRecord) => {
            this.handleNotify(record);
        });

        this.mi.on('console', (text: string) => {
            this.sendEvent(new OutputEvent(text, 'stdout'));
        });

        this.mi.on('target', (text: string) => {
            this.sendEvent(new OutputEvent(text, 'stdout'));
        });

        this.mi.on('log', (text: string) => {
            this.sendEvent(new OutputEvent(text, 'console'));
        });

        this.mi.on('exit', () => {
            this.sendEvent(new TerminatedEvent());
        });

        this.mi.on('error', (err: Error) => {
            this.log(`Debugger error: ${err.message}`);
        });
    }

    private handleExecAsync(record: MIRecord): void {
        const cls = record.class;
        const results = record.results ?? {};
        const reason = results['reason'] as string | undefined;
        const threadIdStr = results['thread-id'] as string | undefined;
        const threadId = threadIdStr ? parseInt(threadIdStr, 10) : 1;

        if (cls === 'stopped') {
            // Clear stale variable references from previous stop
            this.variableRefs.clear();
            this.nextVarRef = LOCALS_SCOPE_REF;

            if (!reason || reason.startsWith('exited')) {
                this.sendEvent(new TerminatedEvent());
                return;
            }

            switch (reason) {
                case 'breakpoint-hit':
                    this.sendEvent(new StoppedEvent('breakpoint', threadId));
                    break;

                case 'end-stepping-range':
                case 'function-finished':
                    this.sendEvent(new StoppedEvent('step', threadId));
                    break;

                case 'signal-received':
                    this.sendEvent(new StoppedEvent('exception', threadId));
                    break;

                case 'watchpoint-trigger':
                    this.sendEvent(new StoppedEvent('data breakpoint', threadId));
                    break;

                default:
                    this.sendEvent(new StoppedEvent('pause', threadId));
                    break;
            }
        } else if (cls === 'running') {
            // Could emit ContinuedEvent here if needed
        }
    }

    private handleNotify(_record: MIRecord): void {
        // No-op — =breakpoint-modified, =thread-group-exited etc. are ignored for now
    }

    // -----------------------------------------------------------------------
    // Compilation & executable resolution
    // -----------------------------------------------------------------------

    private async resolveExecutable(args: HewLaunchRequestArguments): Promise<string> {
        const program = args.program;

        if (program.endsWith('.hew')) {
            // Compile the .hew file with --debug
            return this.compileHew(program, args.cwd);
        }

        // Assume it's already a compiled binary
        if (!fs.existsSync(program)) {
            throw new Error(`Program not found: ${program}`);
        }

        return program;
    }

    private async compileHew(sourceFile: string, cwd?: string): Promise<string> {
        const hewPath = await this.findHewBinary();
        if (!hewPath) {
            throw new Error(
                'hew compiler not found. Set hew.debugger.hewPath in settings, ' +
                'or ensure hew is on PATH.'
            );
        }

        // Determine output path
        const baseName = path.basename(sourceFile, '.hew');
        const outDir = cwd ?? path.dirname(sourceFile);
        const outputPath = path.join(outDir, baseName + '-debug');

        this.log(`Compiling ${sourceFile} with --debug...`);

        try {
            const { stdout } = await execFileAsync(hewPath, ['build', '--debug', sourceFile, '-o', outputPath], {
                cwd: cwd ?? path.dirname(sourceFile),
                timeout: 60000,
                encoding: 'utf-8',
            });

            if (stdout) {
                this.log(stdout);
            }
        } catch (err: any) {
            const stderr = err.stderr ?? '';
            const stdout = err.stdout ?? '';
            this.log(`Compilation failed:\n${stdout}\n${stderr}`);
            throw new Error(`Compilation failed: ${stderr || stdout || err.message}`);
        }

        if (!fs.existsSync(outputPath)) {
            throw new Error(`Compiled binary not found at ${outputPath}`);
        }

        this.log(`Compiled successfully: ${outputPath}`);
        return outputPath;
    }

    /**
     * Find the hew compiler binary.
     * Uses the same search order as the extension's findBinaryPath:
     * config → workspace target/ → PATH → bundled.
     */
    private async findHewBinary(): Promise<string | undefined> {
        // The debug session runs in the debug adapter process, which may not
        // have access to vscode API. We rely on launch config or PATH.

        // Check environment variable (set by the extension before spawning)
        const envPath = process.env['HEW_COMPILER_PATH'];
        if (envPath && fs.existsSync(envPath)) return envPath;

        // Check PATH
        const ext = process.platform === 'win32' ? '.exe' : '';
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
        try {
            const { stdout } = await execFileAsync(whichCmd, [`hew${ext}`], {
                encoding: 'utf-8',
            });
            const found = stdout.trim().split('\n')[0];
            if (found && fs.existsSync(found)) return found;
            return `hew${ext}`;
        } catch {
            // Not on PATH
        }

        return undefined;
    }

    // -----------------------------------------------------------------------
    // Frame ID encoding/decoding
    // -----------------------------------------------------------------------
    // We encode threadId and frameLevel into a single integer for DAP.
    // Layout: upper 16 bits = threadId, lower 16 bits = frameLevel.

    private encodeFrameId(threadId: number, frameLevel: number): number {
        return (threadId << 16) | (frameLevel & 0xFFFF);
    }

    private decodeFrameId(frameId: number): { threadId: number; frameLevel: number } {
        return {
            threadId: (frameId >> 16) & 0xFFFF,
            frameLevel: frameId & 0xFFFF,
        };
    }

    // -----------------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------------

    private isRuntimeFrame(funcName: string): boolean {
        return RUNTIME_FRAME_PATTERNS.some(pattern => pattern.test(funcName));
    }

    private log(message: string): void {
        this.sendEvent(new OutputEvent(message + '\n', 'console'));
    }

    private async shutdownDebugger(): Promise<void> {
        if (this.mi && this.mi.isActive) {
            try {
                this.mi.sendRaw(this.backend!.exitCmd());
            } catch {
                // Ignore errors during shutdown
            }
            // Give GDB a moment to exit cleanly, then force kill
            await new Promise<void>(resolve => {
                setTimeout(() => {
                    if (this.mi?.isActive) {
                        this.mi.kill();
                    }
                    resolve();
                }, 500);
            });
        }
    }
}
