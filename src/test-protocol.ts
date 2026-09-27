/** Events written by `hew test --format json`, one JSON object per line. */
export type TestEvent =
    | { event: 'run_started'; tests: number }
    | { event: 'file_compiled'; file: string; ok: boolean; diagnostics: string | null }
    | { event: 'test_started'; identity: string }
    | {
        event: 'test_finished';
        identity: string;
        outcome: 'passed' | 'failed' | 'ignored';
        kind: string | null;
        message: string | null;
        reason: string | null;
        duration_ms: number;
        output: string;
        report: { seed?: string | null } | null;
    }
    | { event: 'run_finished'; passed: number; failed: number; ignored: number };

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
