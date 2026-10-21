"""Fast read-only x86 PE disassembly queries (capstone linear sweep), for native-fidelity RE of 32-bit engines.

Seconds per query instead of minutes per Ghidra decompile; use REA/Ghidra (`npm run native-query`) to cross-check
anything a fix depends on. Requires capstone + pefile; no install needed with uv:
  uv run --with capstone --with pefile python -I tools/x86dis.py EXE CMD ...
Commands:
  dis ADDR [END|+N]   disassemble a range (default 256 bytes) or N instructions
  func ADDR           the containing function (bounds: padding/ret heuristics; check the first line)
  xref ADDR...        instructions whose operand names ADDR exactly (absolute refs only; indexed bases need `grep`)
  grep REGEX          instructions whose text matches REGEX
  calls ADDR          direct call/jmp sites of ADDR
  read ADDR:T...      constants; T = d (double) f (float) i (int32) s (C string, cp932)
  find TEXT...        every occurrence of a string (cp932) with the instructions that reference its address
  keywords            names spelled by inline `cmp byte ptr [reg+k], imm` chains and the handler each one calls
Disassembly is annotated with import names and with stack strings built by `mov [esp/ebp+n], imm` runs.
"""
import bisect, hashlib, os, pickle, re, struct, sys

import capstone, pefile


def load(exe, cache_dir):
    data = open(exe, 'rb').read()
    digest = hashlib.sha256(data).hexdigest()
    pe = pefile.PE(data=data)
    base = pe.OPTIONAL_HEADER.ImageBase
    imports = {imp.address: imp.name.decode() for d in getattr(pe, 'DIRECTORY_ENTRY_IMPORT', []) for imp in d.imports if imp.name}
    cache = os.path.join(cache_dir, f'{digest[:16]}.sweep.pkl')
    if os.path.exists(cache):
        rows = pickle.load(open(cache, 'rb'))
    else:
        md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
        md.skipdata = True
        rows = []
        for s in pe.sections:
            if s.Characteristics & 0x20000000:
                rows += [(i.address, i.mnemonic, i.op_str) for i in md.disasm(s.get_data(), base + s.VirtualAddress)]
        os.makedirs(cache_dir, exist_ok=True)
        pickle.dump(rows, open(cache, 'wb'))
    return pe, base, imports, rows


def annotate(rows, imports):
    out, buf = [], {}

    def flush():
        # every NUL-separated printable run in the stack buffer, in offset order
        run, start = bytearray(), None
        for off in sorted(buf) + [None]:
            b = buf.get(off) if off is not None else None
            if b and (start is None or off == start + len(run)):
                if start is None:
                    start = off
                run.append(b)
                continue
            if len(run) >= 4:
                out.append(f'          ; str [{start:#x}] "{bytes(run).decode("cp932", "replace")}"')
            run, start = (bytearray([b]), off) if b else (bytearray(), None)
        buf.clear()
    for addr, mn, ops in rows:
        m = re.fullmatch(r'(dword|word|byte) ptr \[(?:esp|ebp)(?: ([+-]) (0x[0-9a-f]+|\d+))?\], (0x[0-9a-f]+|\d+)', ops) if mn == 'mov' else None
        if m:
            size = {'dword': 4, 'word': 2, 'byte': 1}[m.group(1)]
            off = int(m.group(3), 0) * (-1 if m.group(2) == '-' else 1) if m.group(3) else 0
            for k in range(size):
                buf[off + k] = (int(m.group(4), 0) >> (8 * k)) & 0xff
        elif mn == 'call':
            flush()
        line = f'{addr:08x}  {mn:<7} {ops}'
        for a, n in imports.items():
            if f'0x{a:x}' in ops:
                line += f'   ; {n}'
        out.append(line)
    flush()
    return out


def main(argv):
    if len(argv) < 2 or argv[1] in ('-h', '--help') or (len(argv) < 3 and argv[1] != 'keywords'):
        print(__doc__); return 0
    sys.stdout.reconfigure(encoding='utf-8')  # -I ignores PYTHONIOENCODING; Windows consoles default to cp932/cp1252
    exe, cmd, args = argv[0], argv[1], argv[2:]
    cache_dir = os.environ.get('X86DIS_CACHE', os.path.join('re', 'scratch', 'x86dis'))
    pe, base, imports, rows = load(exe, cache_dir)
    addrs = [r[0] for r in rows]
    show = lambda rs: print('\n'.join(annotate(rs, imports)))
    if cmd == 'dis':
        start = int(args[0], 16); i = bisect.bisect_left(addrs, start)
        if len(args) > 1 and args[1].startswith('+'):
            show(rows[i:i + int(args[1][1:])])
        else:
            end = int(args[1], 16) if len(args) > 1 else start + 0x100
            j = bisect.bisect_left(addrs, end)
            show(rows[i:j])
    elif cmd == 'func':
        i = bisect.bisect_right(addrs, int(args[0], 16)) - 1
        s = i
        while s > 0 and not (rows[s - 1][1] in ('int3', 'ret', 'nop') and rows[s][1] not in ('int3', 'nop')):
            s -= 1
        e = i
        while e < len(rows) - 1 and not (rows[e][1] == 'int3' or (rows[e][1] == 'ret' and rows[e + 1][1] in ('int3', 'nop'))):
            e += 1
        show(rows[s:e + 1])
    elif cmd in ('xref', 'calls'):
        keys = {f'0x{int(a, 16):x}' for a in args}
        for r in rows:
            toks = set(re.split(r'[\s,\[\]]+', r[2]))
            if (cmd == 'calls' and r[1] in ('call', 'jmp') and r[2] in keys) or (cmd == 'xref' and toks & keys):
                print(f'{r[0]:08x}  {r[1]:<7} {r[2]}')
    elif cmd == 'grep':
        pat = re.compile(args[0])
        for r in rows:
            line = f'{r[0]:08x}  {r[1]:<7} {r[2]}'
            if pat.search(line):
                print(line)
    elif cmd == 'read':
        for spec in args:
            a, t = spec.split(':')
            raw = pe.get_data(int(a, 16) - base, {'d': 8, 'f': 4, 'i': 4, 's': 256}[t])
            v = {'d': lambda: struct.unpack('<d', raw)[0], 'f': lambda: struct.unpack('<f', raw)[0],
                 'i': lambda: struct.unpack('<i', raw)[0], 's': lambda: raw.split(b'\0')[0].decode('cp932', 'replace')}[t]()
            print(f'{a} {t} {v!r}')
    elif cmd == 'find':
        data = pe.__data__
        for text in args:
            needle, i = text.encode('cp932'), -1
            while (i := data.find(needle, i + 1)) >= 0:
                try:
                    va = pe.get_rva_from_offset(i) + base
                except Exception:
                    continue
                key = f'0x{va:x}'
                refs = [f'{r[0]:08x} {r[1]} {r[2]}' for r in rows if key in re.split(r'[\s,\[\]]+', r[2])]
                print(f'{text!r} @ {key}: ' + ('; '.join(refs) if refs else 'no direct refs'))
    elif cmd == 'keywords':
        # inline `cmp byte ptr [reg + k], imm` chains (k = 0, 1, 2 …) spell a keyword; the first direct call after
        # the chain's terminator checks is its handler
        cmp = re.compile(r'byte ptr \[(\w+)(?: \+ (0x[0-9a-f]+|\d+))?\], (0x[0-9a-f]+|\d+)$')
        name, reg, start, i, first = '', None, 0, 0, 0
        while i < len(rows):
            addr, mn, ops = rows[i]
            m = cmp.match(ops) if mn == 'cmp' else None
            r8 = re.fullmatch(r'([abcd]l), (0x[0-9a-f]+|\d+)', ops) if mn == 'cmp' else None
            if r8:  # first character compared from a register loaded with byte [reg]
                first = int(r8.group(2), 0)
            if m:
                k, ch = int(m.group(2) or '0', 0), int(m.group(3), 0)
                if k == 1 and m.group(1) != reg or k == 1 and len(name) != 1:
                    name, reg, start = (chr(first) if 0x20 < first < 0x7f else ''), m.group(1), addr
                if k == 0:
                    name, reg, start = chr(ch) if 0x20 < ch < 0x7f else '', m.group(1), addr
                elif m.group(1) == reg and k == len(name) and 0x20 < ch < 0x7f:
                    name += chr(ch)
            elif mn == 'call' and len(name) >= 3:
                if ops.startswith('0x'):
                    print(f'{start:08x}  {name:<28} -> {ops}')
                name = ''
            i += 1
    else:
        print(f'unknown command {cmd}\n{__doc__}'); return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
