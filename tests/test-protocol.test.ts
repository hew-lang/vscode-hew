import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseTestEvent, renderTestFailure, utf16OffsetAtUtf8Byte } from '../src/test-protocol';

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

    it('maps a UTF-8 fault site after a non-ASCII character', () => {
        const source = '// café\n#[test] fn fails() { assert(false); }';
        const site = Buffer.from(source.slice(0, source.indexOf('assert')), 'utf8').length;
        expect(utf16OffsetAtUtf8Byte(source, site)).toBe(source.indexOf('assert'));
    });

    (process.env.HEW_TEST_COMPILER ? it : it.skip)('maps an executed Hew assertion to the editor', () => {
        const root = mkdtempSync(join(tmpdir(), 'hew-vscode-test-'));
        try {
            const source = '// café\n#[test]\nfn fails() { assert(1 == 2); }\n';
            const file = join(root, 'main.hew');
            writeFileSync(file, source);
            const run = spawnSync(process.env.HEW_TEST_COMPILER!,
                ['test', `${file}::fails`, '--format', 'json', '--color', 'never'],
                { encoding: 'utf8', cwd: root, timeout: 30_000 });
            expect(run.status, run.stderr).toBe(1);
            const finished = run.stdout.split('\n').map(parseTestEvent)
                .find(event => event?.event === 'test_finished');
            expect(finished?.event).toBe('test_finished');
            if (finished?.event !== 'test_finished') return;
            const diagnostic = renderTestFailure(finished, source);
            expect(diagnostic?.offset).toBe(source.indexOf('assert'));
            expect(diagnostic?.message).toContain('left: 1');
            expect(diagnostic?.message).toContain('right: 2');
            expect(diagnostic?.seed).toMatch(/^\d+$/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 30_000);
});
