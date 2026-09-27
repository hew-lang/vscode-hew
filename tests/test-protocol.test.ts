import { describe, expect, it } from 'vitest';
import { parseTestEvent } from '../src/test-protocol';

describe('Hew test stream', () => {
    it('keeps a decimal u64 seed and failure message intact', () => {
        const line = JSON.stringify({
            event: 'test_finished',
            identity: 'tests/math.hew::fails',
            selector: '/workspace/tests/math.hew::fails',
            outcome: 'failed',
            kind: 'assertion',
            message: 'assertion failed: 1 == 2\n  left: 1\n right: 2',
            reason: null,
            duration_ms: 3,
            output: '',
            report: {
                seed: '18446744073709551615',
                assertion: { operator: '==', left: '1', right: '2' },
            },
        });

        const event = parseTestEvent(line);
        expect(event?.event).toBe('test_finished');
        if (event?.event === 'test_finished') {
            expect(event.report?.seed).toBe('18446744073709551615');
            expect(event.report?.assertion).toEqual({ operator: '==', left: '1', right: '2' });
            expect(event.message).toContain('right: 2');
        }
    });

    it('ignores non-protocol output without losing the next event', () => {
        expect(parseTestEvent('compiling...')).toBeUndefined();
        expect(parseTestEvent('{"event":"test_started","identity":"tests/math.hew::works","selector":"/workspace/tests/math.hew::works"}'))
            .toEqual({ event: 'test_started', identity: 'tests/math.hew::works', selector: '/workspace/tests/math.hew::works' });
    });
});
