/** Events written by `hew test --format json`, one JSON object per line. */
export type TestEvent =
    | { event: 'run_started'; tests: number }
    | { event: 'file_compiled'; file: string; ok: boolean; diagnostics: string | null }
    | { event: 'test_started'; identity: string; selector: string }
    | {
        event: 'test_finished';
        identity: string;
        selector: string;
        outcome: 'passed' | 'failed' | 'ignored';
        kind: string | null;
        message: string | null;
        reason: string | null;
        duration_ms: number;
        output: string;
        report: {
            seed?: string | null;
            site_offset?: number | null;
            assertion?: { operator: string; left: string; right: string } | null;
        } | null;
    }
    | { event: 'run_finished'; passed: number; failed: number; ignored: number };

export type FinishedTestEvent = Extract<TestEvent, { event: 'test_finished' }>;

/** Convert the runner's UTF-8 byte site to VS Code's UTF-16 document offset. */
export function utf16OffsetAtUtf8Byte(source: string, offset: number): number {
    const bytes = Buffer.from(source, 'utf8');
    return bytes.subarray(0, Math.max(0, offset)).toString('utf8').length;
}

/** Project one failed runner event onto the editor's source and message. */
export function renderTestFailure(event: FinishedTestEvent, source: string): {
    offset: number | null;
    message: string;
    seed?: string;
} | undefined {
    if (event.outcome !== 'failed') return undefined;
    const byteOffset = event.report?.site_offset;
    const offset = typeof byteOffset === 'number' && Number.isInteger(byteOffset) && byteOffset >= 0
        ? utf16OffsetAtUtf8Byte(source, byteOffset) : null;
    let message = event.message ?? event.kind ?? 'Test failed';
    const assertion = event.report?.assertion;
    if (assertion && !message.includes('left:') && !message.includes('right:')) {
        message += `\nleft: ${assertion.left}\nright: ${assertion.right}`;
    }
    return { offset, message, seed: event.report?.seed ?? undefined };
}

export function parseTestEvent(line: string): TestEvent | undefined {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        return undefined;
    }
    if (!value || typeof value !== 'object' || !('event' in value)) {
        return undefined;
    }
    const event = value as Record<string, unknown>;
    switch (event.event) {
        case 'run_started':
        case 'run_finished':
            return event as TestEvent;
        case 'file_compiled':
            return typeof event.ok === 'boolean' ? event as TestEvent : undefined;
        case 'test_started':
            return typeof event.identity === 'string' ? event as TestEvent : undefined;
        case 'test_finished':
            return typeof event.identity === 'string' &&
                ['passed', 'failed', 'ignored'].includes(String(event.outcome))
                ? event as TestEvent : undefined;
        default:
            return undefined;
    }
}
