# Prints a script with prose masked (keeps code, tags, braces). Usage: python -I masked-view.py FILE START END
import re, sys
sys.stdout.reconfigure(encoding='utf-8')
with open(sys.argv[1], 'rb') as source:
    data = source.read()
try:
    script = data.decode('utf-8-sig')
except UnicodeDecodeError:
    script = data.decode('cp932')
# Comments can contain copied dialogue or choice labels too; keep line numbers without exposing their prose.
def mask_comment(match):
    value = match.group(0)
    if value.startswith('"'):
        return value
    return '// ~' if value.startswith('//') else '/* ~' + '\n' * value.count('\n') + ' */'
script = re.sub(r'"(?:\\.|[^"\\])*"|//[^\r\n]*|/\*[\s\S]*?\*/', mask_comment, script)
lines = script.split('\n')
s, e = int(sys.argv[2]), int(sys.argv[3])
def mask(seg):
    return re.sub(r"[A-Za-z0-9'぀-ヿ一-鿿＀-￯,.!?\-]+(?:\s+[A-Za-z0-9'぀-ヿ一-鿿＀-￯,.!?\-]+)*", '~', seg)
def mask_literal(match):
    value = match.group(0)[1:-1]
    # These first arguments are object handles/globs, not dialogue. Keep them for lifetime/fade analysis.
    if re.search(r'\b(?:Delete|Fade)\(\s*$', match.string[:match.start()]) and re.fullmatch(r'[\w@*?/.\-]+', value):
        return match.group(0)
    # Keep paths and indirect variable references, never literal dialogue/UI prose in code.
    if (re.match(r'^[$#][^\s"]+$', value) or re.match(r'^(?:cg|nss|sound|voice)[/\\]', value, re.I)
            or re.fullmatch(r'[\w-]+\.nss', value, re.I)):
        return match.group(0)
    return '"~"'
pre_lines = set()
in_pre = False
for i, l in enumerate(lines):
    if re.match(r'^\s*<PRE\s', l, re.I):
        in_pre = True
    if in_pre:
        pre_lines.add(i)
    if re.match(r'^\s*</PRE>', l, re.I):
        in_pre = False
for i in range(s - 1, min(e, len(lines))):
    l = lines[i].rstrip('\r')
    code = re.match(r'^\s*(//|[$#@]|[A-Za-z_]\w*\s*\(|if\b|else\b|\}\s*else\b|while\b|select\b|case\b|call_|scene\b|chapter\b|function\b|return\b|break\b|[{}]\s*$|\[text)', l)
    if not code or i in pre_lines:
        # keep tags and {code} spans, mask the rest
        parts = re.split(r'(<[^>]*>|\{[^}]*\})', l)
        l = ''.join(p if p.startswith('<') else re.sub(r'"(?:\\.|[^"\\])*"', mask_literal, p) if p.startswith('{') else mask(p) for p in parts)
    else:
        l = re.sub(r'"(?:\\.|[^"\\])*"', mask_literal, l)
    print(f'{i+1:5}: {l}')
