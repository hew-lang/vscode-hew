import { describe, expect, it } from 'vitest';
import { checkBackendAvailability } from '../src/debug/mi-backend';

describe('MI backend preflight', () => {
    it('reports missing lldb-mi clearly when auto selects LLDB on macOS', () => {
        const result = checkBackendAvailability('auto', {
            platform: 'darwin',
            findOnPath: () => undefined,
        });

        expect(result.backend.name).toBe('lldb');
        expect(result.resolvedPath).toBeUndefined();
        expect(result.message).toContain('"debuggerBackend": "auto" selected the LLDB backend on macOS.');
        expect(result.message).toContain('"lldb-mi"');
        expect(result.message).toContain('"debuggerBackend": "gdb"');
    });

    it('returns the resolved debugger path when GDB is available', () => {
        const result = checkBackendAvailability('auto', {
            platform: 'linux',
            findOnPath: candidateName => candidateName === 'gdb' ? '/usr/bin/gdb' : undefined,
        });

        expect(result.backend.name).toBe('gdb');
        expect(result.resolvedPath).toBe('/usr/bin/gdb');
        expect(result.message).toBeUndefined();
    });

    it('reports explicit GDB selection with a clear fallback hint', () => {
        const result = checkBackendAvailability('gdb', {
            platform: 'linux',
            findOnPath: () => undefined,
        });

        expect(result.backend.name).toBe('gdb');
        expect(result.message).toContain('"debuggerBackend": "gdb" requires the GDB backend.');
        expect(result.message).toContain('"gdb"');
        expect(result.message).toContain('"debuggerBackend": "lldb"');
        expect(result.message).toContain('"lldb-mi"');
    });
});
