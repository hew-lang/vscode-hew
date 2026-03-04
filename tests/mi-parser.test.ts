import { describe, it, expect } from 'vitest';
import { parseMIOutput, MIRecord, MITuple, MIList } from '../src/debug/mi-parser';

describe('MI parser', () => {
    describe('result records', () => {
        it('parses ^done with no results', () => {
            const r = parseMIOutput('^done');
            expect(r).toEqual({
                type: 'result',
                token: undefined,
                class: 'done',
                results: {},
            });
        });

        it('parses ^done with simple key=value', () => {
            const r = parseMIOutput('^done,bkpt={number="1",type="breakpoint",disp="keep",enabled="y",addr="0x0000000000401234",func="main",file="main.hew",fullname="/home/user/main.hew",line="5",times="0"}');
            expect(r?.type).toBe('result');
            expect(r?.class).toBe('done');
            const bkpt = r?.results?.['bkpt'] as MITuple;
            expect(bkpt['number']).toBe('1');
            expect(bkpt['type']).toBe('breakpoint');
            expect(bkpt['file']).toBe('main.hew');
            expect(bkpt['line']).toBe('5');
            expect(bkpt['fullname']).toBe('/home/user/main.hew');
        });

        it('parses ^error with msg', () => {
            const r = parseMIOutput('^error,msg="No symbol table is loaded.  Use the \\"file\\" command."');
            expect(r?.type).toBe('result');
            expect(r?.class).toBe('error');
            expect(r?.results?.['msg']).toBe('No symbol table is loaded.  Use the "file" command.');
        });

        it('parses token-prefixed result record', () => {
            const r = parseMIOutput('42^done,value="123"');
            expect(r?.type).toBe('result');
            expect(r?.token).toBe(42);
            expect(r?.class).toBe('done');
            expect(r?.results?.['value']).toBe('123');
        });

        it('parses nested tuple values', () => {
            const r = parseMIOutput('^done,frame={level="0",addr="0x4015a0",func="main",args=[{name="argc",value="1"},{name="argv",value="0x7ffe123"}],file="main.hew",line="10"}');
            expect(r?.type).toBe('result');
            const frame = r?.results?.['frame'] as MITuple;
            expect(frame['func']).toBe('main');
            expect(frame['level']).toBe('0');
            const args = frame['args'] as MIList;
            expect(args).toHaveLength(2);
            const arg0 = args[0] as MITuple;
            expect(arg0['name']).toBe('argc');
            expect(arg0['value']).toBe('1');
        });
    });

    describe('exec async records', () => {
        it('parses *stopped with breakpoint-hit', () => {
            const r = parseMIOutput('*stopped,reason="breakpoint-hit",disp="keep",bkptno="1",frame={addr="0x401234",func="main",args=[],file="main.hew",fullname="/home/user/main.hew",line="5"},thread-id="1",stopped-threads="all"');
            expect(r?.type).toBe('exec');
            expect(r?.class).toBe('stopped');
            expect(r?.results?.['reason']).toBe('breakpoint-hit');
            expect(r?.results?.['bkptno']).toBe('1');
            const frame = r?.results?.['frame'] as MITuple;
            expect(frame['func']).toBe('main');
            expect(frame['line']).toBe('5');
            expect(r?.results?.['thread-id']).toBe('1');
        });

        it('parses *stopped with end-stepping-range', () => {
            const r = parseMIOutput('*stopped,reason="end-stepping-range",frame={addr="0x401240",func="main",args=[],file="main.hew",fullname="/home/user/main.hew",line="6"},thread-id="1",stopped-threads="all"');
            expect(r?.type).toBe('exec');
            expect(r?.class).toBe('stopped');
            expect(r?.results?.['reason']).toBe('end-stepping-range');
        });

        it('parses *stopped with signal-received', () => {
            const r = parseMIOutput('*stopped,reason="signal-received",signal-name="SIGSEGV",signal-meaning="Segmentation fault",frame={addr="0x401240",func="main",args=[],file="main.hew",line="6"},thread-id="1",stopped-threads="all"');
            expect(r?.type).toBe('exec');
            expect(r?.results?.['reason']).toBe('signal-received');
            expect(r?.results?.['signal-name']).toBe('SIGSEGV');
        });

        it('parses *running', () => {
            const r = parseMIOutput('*running,thread-id="1"');
            expect(r?.type).toBe('exec');
            expect(r?.class).toBe('running');
            expect(r?.results?.['thread-id']).toBe('1');
        });
    });

    describe('thread info with list values', () => {
        it('parses thread-info result with thread list', () => {
            const r = parseMIOutput('^done,threads=[{id="1",target-id="Thread 0x7f1234 (LWP 12345)",name="main",frame={level="0",addr="0x401234",func="main",args=[],file="main.hew",line="5"},state="stopped"},{id="2",target-id="Thread 0x7f5678 (LWP 12346)",name="worker",frame={level="0",addr="0x401300",func="hew_actor_run",args=[],file="runtime.rs",line="100"},state="stopped"}],current-thread-id="1"');
            expect(r?.type).toBe('result');
            expect(r?.class).toBe('done');
            const threads = r?.results?.['threads'] as MIList;
            expect(threads).toHaveLength(2);
            const t1 = threads[0] as MITuple;
            expect(t1['id']).toBe('1');
            expect(t1['name']).toBe('main');
            const t2 = threads[1] as MITuple;
            expect(t2['id']).toBe('2');
            expect(t2['name']).toBe('worker');
            expect(r?.results?.['current-thread-id']).toBe('1');
        });
    });

    describe('notify records', () => {
        it('parses =breakpoint-modified', () => {
            const r = parseMIOutput('=breakpoint-modified,bkpt={number="1",type="breakpoint",disp="keep",enabled="y",addr="0x401234",func="main",file="main.hew",line="5",times="1"}');
            expect(r?.type).toBe('notify');
            expect(r?.class).toBe('breakpoint-modified');
            const bkpt = r?.results?.['bkpt'] as MITuple;
            expect(bkpt['number']).toBe('1');
            expect(bkpt['times']).toBe('1');
        });

        it('parses =thread-group-added', () => {
            const r = parseMIOutput('=thread-group-added,id="i1"');
            expect(r?.type).toBe('notify');
            expect(r?.class).toBe('thread-group-added');
            expect(r?.results?.['id']).toBe('i1');
        });
    });

    describe('stream records', () => {
        it('parses console output with unescaping', () => {
            const r = parseMIOutput('~"GNU gdb (GDB) 14.1\\n"');
            expect(r?.type).toBe('console');
            expect(r?.content).toBe('GNU gdb (GDB) 14.1\n');
        });

        it('parses target output', () => {
            const r = parseMIOutput('@"Hello, world!\\n"');
            expect(r?.type).toBe('target');
            expect(r?.content).toBe('Hello, world!\n');
        });

        it('parses log output', () => {
            const r = parseMIOutput('&"warning: no loadable sections found in added symbol-file\\n"');
            expect(r?.type).toBe('log');
            expect(r?.content).toBe('warning: no loadable sections found in added symbol-file\n');
        });

        it('unescapes embedded quotes', () => {
            const r = parseMIOutput('~"value is \\"hello\\"\\n"');
            expect(r?.type).toBe('console');
            expect(r?.content).toBe('value is "hello"\n');
        });

        it('unescapes tabs and special chars', () => {
            const r = parseMIOutput('~"col1\\tcol2\\r\\n"');
            expect(r?.type).toBe('console');
            expect(r?.content).toBe('col1\tcol2\r\n');
        });
    });

    describe('prompt and edge cases', () => {
        it('parses (gdb) prompt', () => {
            const r = parseMIOutput('(gdb)');
            expect(r?.type).toBe('prompt');
        });

        it('parses (gdb) prompt with trailing space', () => {
            const r = parseMIOutput('(gdb) ');
            expect(r?.type).toBe('prompt');
        });

        it('returns undefined for empty line', () => {
            expect(parseMIOutput('')).toBeUndefined();
        });

        it('returns undefined for whitespace-only line', () => {
            expect(parseMIOutput('   ')).toBeUndefined();
        });

        it('handles empty tuple {}', () => {
            const r = parseMIOutput('^done,value={}');
            const val = r?.results?.['value'] as MITuple;
            expect(val).toEqual({});
        });

        it('handles empty list []', () => {
            const r = parseMIOutput('^done,value=[]');
            const val = r?.results?.['value'] as MIList;
            expect(val).toEqual([]);
        });
    });

    describe('token-prefixed records', () => {
        it('parses token on result record', () => {
            const r = parseMIOutput('100^done,bkpt={number="1"}');
            expect(r?.token).toBe(100);
            expect(r?.type).toBe('result');
            expect(r?.class).toBe('done');
        });

        it('parses token on exec record', () => {
            const r = parseMIOutput('5*stopped,reason="breakpoint-hit"');
            expect(r?.token).toBe(5);
            expect(r?.type).toBe('exec');
            expect(r?.class).toBe('stopped');
        });

        it('parses large token number', () => {
            const r = parseMIOutput('999999^done');
            expect(r?.token).toBe(999999);
            expect(r?.type).toBe('result');
        });
    });

    describe('stack list variables', () => {
        it('parses stack variables response', () => {
            const r = parseMIOutput('^done,variables=[{name="x",value="42"},{name="msg",value="0x7fff123 \\"hello\\""},{name="flag",value="true"}]');
            expect(r?.type).toBe('result');
            const vars = r?.results?.['variables'] as MIList;
            expect(vars).toHaveLength(3);
            const v0 = vars[0] as MITuple;
            expect(v0['name']).toBe('x');
            expect(v0['value']).toBe('42');
            const v1 = vars[1] as MITuple;
            expect(v1['name']).toBe('msg');
            expect(v1['value']).toBe('0x7fff123 "hello"');
        });
    });

    describe('stack list frames', () => {
        it('parses multi-frame stack', () => {
            // GDB MI format: stack=[frame={...},frame={...}] — list of results
            // Each element in the list is a tuple like {frame: {...}}
            const r = parseMIOutput('^done,stack=[frame={level="0",addr="0x401234",func="handle_message",file="actor.hew",fullname="/home/user/actor.hew",line="15"},frame={level="1",addr="0x401300",func="main",file="main.hew",fullname="/home/user/main.hew",line="8"}]');
            expect(r?.type).toBe('result');
            const stack = r?.results?.['stack'] as MIList;
            expect(stack).toHaveLength(2);
            // Each list element is a result tuple with key "frame"
            const entry0 = stack[0] as MITuple;
            const f0 = entry0['frame'] as MITuple;
            expect(f0['func']).toBe('handle_message');
            expect(f0['line']).toBe('15');
            const entry1 = stack[1] as MITuple;
            const f1 = entry1['frame'] as MITuple;
            expect(f1['func']).toBe('main');
        });
    });
});
