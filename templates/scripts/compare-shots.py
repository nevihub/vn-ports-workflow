#!/usr/bin/env python3
"""Deterministic native-vs-port screenshot comparison (stdlib only; pixels only, never text).

  python -I scripts/compare-shots.py <nativeDir> <portDir> [--pairs "1:2,2:3"] [--auto-align]
         [--json out.json] [--debug-dir re/<subdir>] [--ink-threshold 225] [--min-line-width 8]

Measures the dialogue text box (x 20..780, y 50..550, half-open) in 800x600 space; port frames
are box-filtered down to 800x600 first. Only numbers are printed.
"""
import argparse, json, os, re, statistics, struct, sys, zlib

W, H = 800, 600
BOX = (20, 50, 780, 550)            # x0, y0, x1, y1 (half-open)
BG_BOTTOM = (0, 552, 800, 598)      # background samples outside the box
BG_LEFT = (0, 0, 18, 600)
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PAIRS = [(n, n + 1) for n in range(1, 9)] + [(n, n - 1) for n in range(11, 31)]


def read_png(path):
    """Decode a non-interlaced 8-bit gray/RGB/gray+alpha/RGBA PNG to (w, h, RGB bytes)."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")
    pos, idat = 8, []
    while pos < len(data):
        length, ctype = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if ctype == b"IHDR":
            w, h, bd, ct, _, _, il = struct.unpack(">IIBBBBB", body)
        elif ctype == b"IDAT":
            idat.append(body)
        pos += 12 + length
    if bd != 8 or il != 0 or ct not in (0, 2, 4, 6):
        raise ValueError(f"{path}: unsupported PNG (depth {bd}, colour {ct}, interlace {il})")
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(b"".join(idat))
    stride = w * bpp
    out, prev = bytearray(h * stride), bytearray(stride)
    for y in range(h):
        ft = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        # one loop per filter type keeps the pure-Python decode as fast as it can be
        if ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b, c = prev[i], (prev[i - bpp] if i >= bpp else 0)
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else (b if pb <= pc else c))) & 255
        elif ft != 0:
            raise ValueError(f"{path}: bad filter type {ft}")
        out[y * stride:(y + 1) * stride] = line
        prev = line
    rgb = bytearray(w * h * 3)
    for c, src in enumerate((0, 1, 2) if ct in (2, 6) else (0, 0, 0)):   # alpha dropped
        rgb[c::3] = out[src::bpp]
    return w, h, bytes(rgb)


def resize_box(rgb, sw, sh, dw, dh):
    """Box filter (area average): horizontal pass per source row, then vertical."""
    def span(i, n, d):
        a = int(i * n / d)
        return a, max(int((i + 1) * n / d), a + 1)
    xs = [span(x, sw, dw) for x in range(dw)]
    hor = []
    for sy in range(sh):
        row, o = rgb[sy * sw * 3:(sy + 1) * sw * 3], bytearray(dw * 3)
        for x, (a, b) in enumerate(xs):
            for c in range(3):
                o[3 * x + c] = sum(row[a * 3 + c:b * 3:3]) // (b - a)
        hor.append(o)
    out = bytearray()
    for y in range(dh):
        a, b = span(y, sh, dh)
        out += hor[a] if b - a == 1 else bytes(sum(v) // (b - a) for v in zip(*hor[a:b]))
    return bytes(out)


def load(path, cache):
    if path not in cache:
        w, h, rgb = read_png(path)
        cache[path] = rgb if (w, h) == (W, H) else resize_box(rgb, w, h, W, H)
    return cache[path]


def thumb(frame, thr):
    """80x60 ink-mask thumbnail (10x10 block means), used only for auto-alignment: text, not background."""
    out = []
    for ty in range(60):
        rows = []
        for y in range(ty * 10, ty * 10 + 10):
            row = frame[y * W * 3:(y + 1) * W * 3]
            rows.append([255 if r >= thr and g >= thr and b >= thr else 0 for r, g, b in zip(row[0::3], row[1::3], row[2::3])])
        cols = [sum(c) for c in zip(*rows)]
        out += [sum(cols[tx * 10:tx * 10 + 10]) // 100 for tx in range(80)]
    return out


def text_lines(frame, thr, min_row_ink, min_width):
    """Ink rows -> lines (gaps <= 3 rows merge). Returns (lines, total ink pixels in box)."""
    x0, y0, x1, y1 = BOX
    lines, ink = [], 0
    for y in range(y0, y1):
        seg = frame[y * W * 3 + 3 * x0:y * W * 3 + 3 * x1]
        hits = [i for i, (r, g, b) in enumerate(zip(seg[0::3], seg[1::3], seg[2::3]))
                if r >= thr and g >= thr and b >= thr]
        ink += len(hits)
        if len(hits) < min_row_ink:
            continue
        left, right = x0 + hits[0], x0 + hits[-1]
        if lines and y - lines[-1]["bottom"] - 1 <= 3:
            ln = lines[-1]
            ln["bottom"], ln["left"], ln["right"] = y, min(ln["left"], left), max(ln["right"], right)
        else:
            lines.append({"top": y, "bottom": y, "left": left, "right": right})
    # shortcut: min width drops 1px rules and stray header fragments; a bright background
    # inside the box can still merge rows into one tall line (see ink_frac), upgrade if seen
    lines = [dict(ln, width=ln["right"] - ln["left"] + 1) for ln in lines]
    return [ln for ln in lines if ln["width"] >= min_width], ink


def find_icon(frame, last):
    """Largest saturated, bright blob 1..40 px right of the last line, within its vertical band."""
    x0, x1 = last["right"] + 1, min(W - 1, last["right"] + 40)
    hits = set()
    for y in range(last["top"], last["bottom"] + 1):
        for x in range(x0, x1 + 1):
            i = y * W * 3 + 3 * x
            r, g, b = frame[i], frame[i + 1], frame[i + 2]
            if max(r, g, b) - min(r, g, b) >= 60 and (r + g + b) // 3 >= 100:
                hits.add((x, y))
    seen, best = set(), None
    for start in sorted(hits):          # sorted: deterministic tie-breaking
        if start in seen:
            continue
        comp, stack = [], [start]
        seen.add(start)
        while stack:
            x, y = stack.pop()
            comp.append((x, y))
            for nb in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if nb in hits and nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        xs, ys = [c[0] for c in comp], [c[1] for c in comp]
        if len(comp) >= 4 and max(xs) - min(xs) < 32 and max(ys) - min(ys) < 32:
            if best is None or len(comp) > best[0]:
                best = (len(comp), [min(xs), min(ys), max(xs), max(ys)])
    return None if best is None else {"bbox": best[1], "pixels": best[0], "gap": best[1][0] - last["right"]}


def mean_rgb(frame, band):
    x0, y0, x1, y1 = band
    rows = [frame[y * W * 3 + 3 * x0:y * W * 3 + 3 * x1] for y in range(y0, y1)]
    n = (x1 - x0) * (y1 - y0)
    return [round(sum(sum(r[c::3]) for r in rows) / n, 2) for c in range(3)]


def measure(frame, a):
    lines, ink = text_lines(frame, a.ink_threshold, a.min_row_ink, a.min_line_width)
    tops = [ln["top"] for ln in lines]
    return {
        "n_lines": len(lines), "lines": lines,
        "first_top": tops[0] if lines else None,
        "pitch": statistics.median(c - b for b, c in zip(tops, tops[1:])) if len(lines) > 1 else None,
        "first_left": lines[0]["left"] if lines else None,
        "max_width": max((ln["width"] for ln in lines), default=None),
        "icon": find_icon(frame, lines[-1]) if lines else None,
        "ink_frac": round(ink / ((BOX[2] - BOX[0]) * (BOX[3] - BOX[1])), 4),
        "bg_bottom": mean_rgb(frame, BG_BOTTOM), "bg_left": mean_rgb(frame, BG_LEFT),
    }


def deltas(n, p):
    d = {"line_count": p["n_lines"] - n["n_lines"]}
    if n["n_lines"] and p["n_lines"]:
        d["first_top"] = p["first_top"] - n["first_top"]
        d["first_left"] = p["first_left"] - n["first_left"]
        d["width_ratio"] = round(p["max_width"] / n["max_width"], 4)
        d["line_width_ratio"] = [round(pl["width"] / nl["width"], 4) for pl, nl in zip(p["lines"], n["lines"])]
    if n["pitch"] is not None and p["pitch"] is not None:
        d["pitch"] = p["pitch"] - n["pitch"]
    d["icon_present"] = [n["icon"] is not None, p["icon"] is not None]
    if n["icon"] and p["icon"]:
        d["icon_gap"] = p["icon"]["gap"] - n["icon"]["gap"]
    d["bg_bottom"] = [round(x - y, 2) for x, y in zip(p["bg_bottom"], n["bg_bottom"])]
    d["bg_left"] = [round(x - y, 2) for x, y in zip(p["bg_left"], n["bg_left"])]
    return d


def med(v):
    return round(statistics.median(v), 4) if v else None


def summarise(rows):
    bg = [max(abs(x) for x in r["deltas"]["bg_bottom"] + r["deltas"]["bg_left"]) for r in rows]
    return {
        "pairs": len(rows),
        "median_width_ratio": med([r["deltas"]["width_ratio"] for r in rows if "width_ratio" in r["deltas"]]),
        "median_line_width_ratio": med([x for r in rows for x in r["deltas"].get("line_width_ratio", [])]),
        "median_pitch_delta": med([r["deltas"]["pitch"] for r in rows if "pitch" in r["deltas"]]),
        "line_count_mismatches": [[r["native"], r["port"], r["native_metrics"]["n_lines"],
                                   r["port_metrics"]["n_lines"]] for r in rows if r["deltas"]["line_count"]],
        "icon_mismatches": [[r["native"], r["port"]] for r in rows
                            if r["deltas"]["icon_present"][0] != r["deltas"]["icon_present"][1]],
        "median_icon_gap_delta": med([r["deltas"]["icon_gap"] for r in rows if "icon_gap" in r["deltas"]]),
        "median_bg_max_abs_delta": med(bg),
        # ink touching the box's top edge means a bright band was read as text: first_top is unreliable
        "box_top_edge_pairs": [[r["native"], r["port"]] for r in rows
                               if min(r["native_metrics"]["first_top"] or BOX[1] + 99,
                                      r["port_metrics"]["first_top"] or BOX[1] + 99) <= BOX[1] + 3],
    }


def auto_align(nat, prt, cache, thr):
    """For each native image, the port image within +-3 index with the lowest thumbnail MAD."""
    pairs, scores = [], {}
    for n in sorted(nat):
        tn, best = thumb(load(nat[n], cache), thr), None
        for p in range(n - 3, n + 4):
            if p in prt:
                tp = thumb(load(prt[p], cache), thr)
                mad = sum(abs(x - y) for x, y in zip(tn, tp)) / len(tn)
                if best is None or mad < best[1]:
                    best = (p, mad)
        if best:
            pairs.append((n, best[0]))
            scores[n] = round(best[1], 3)
    return pairs, scores


def index_map(d):
    """{image number: path} for names like native-012.png (bg1.png and friends are ignored)."""
    out = {}
    for name in os.listdir(d):
        m = re.match(r"^[A-Za-z]+-(\d+)\.png$", name)
        if m:
            out[int(m.group(1))] = os.path.join(d, name)
    return out


def write_mask(path, frame, thr):
    """Debug only: binary ink mask of the text box (pixels, not text)."""
    x0, y0, x1, y1 = BOX
    raw = bytearray()
    for y in range(y0, y1):
        seg = frame[y * W * 3 + 3 * x0:y * W * 3 + 3 * x1]
        raw += b"\x00" + bytes(255 if r >= thr and g >= thr and b >= thr else 0
                               for r, g, b in zip(seg[0::3], seg[1::3], seg[2::3]))

    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", x1 - x0, y1 - y0, 8, 0, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(raw))) + chunk(b"IEND", b""))


def fmt(v, nd=0):
    if v is None:
        return "-"
    return f"{v:.{nd}f}" if isinstance(v, float) else str(v)


def print_table(rows):
    head = (f"{'pair':>7} {'lines':>7} {'top n/p':>9} {'pitch n/p':>11} {'left n/p':>10} {'width n/p':>11} "
            f"{'wRatio':>6} {'icon':>5} {'gap n/p':>9} {'bgMax':>6} {'ink%':>10}  line width ratios")
    print(head)
    print("-" * len(head))
    for r in rows:
        nm, pm, d = r["native_metrics"], r["port_metrics"], r["deltas"]
        icon = "{}/{}".format(int(nm["icon"] is not None), int(pm["icon"] is not None))
        gap = "{}/{}".format(fmt(nm["icon"] and nm["icon"]["gap"]), fmt(pm["icon"] and pm["icon"]["gap"]))
        bgmax = max(abs(x) for x in d["bg_bottom"] + d["bg_left"])
        lr = d.get("line_width_ratio", [])
        lr_s = " ".join(f"{x:.2f}" for x in lr[:6]) + (f" +{len(lr) - 6}" if len(lr) > 6 else "")
        print(f"{r['native']:>3}>{r['port']:<3} {nm['n_lines']:>3}/{pm['n_lines']:<3} "
              f"{fmt(nm['first_top']):>4}/{fmt(pm['first_top']):<4} "
              f"{fmt(nm['pitch'], 1):>5}/{fmt(pm['pitch'], 1):<5} "
              f"{fmt(nm['first_left']):>4}/{fmt(pm['first_left']):<4} "
              f"{fmt(nm['max_width']):>5}/{fmt(pm['max_width']):<5} "
              f"{fmt(d.get('width_ratio'), 2):>6} {icon:>5} {gap:>9} {bgmax:>6.1f} "
              f"{nm['ink_frac'] * 100:>4.1f}/{pm['ink_frac'] * 100:<4.1f}  {lr_s}")


def main():
    ap = argparse.ArgumentParser(description="Compare native vs port screenshot text-box metrics.")
    ap.add_argument("native_dir")
    ap.add_argument("port_dir")
    grp = ap.add_mutually_exclusive_group()
    grp.add_argument("--pairs", help='native:port image numbers, e.g. "1:2,2:3"')
    grp.add_argument("--auto-align", action="store_true", help="pick port within +-3 by ink-thumbnail MAD")
    ap.add_argument("--json", help="write full results here")
    ap.add_argument("--debug-dir", help="write ink-mask PNGs here (must be under <repo>/re/)")
    ap.add_argument("--ink-threshold", type=int, default=225)
    ap.add_argument("--min-row-ink", type=int, default=1, help="ink pixels a row needs to count")
    ap.add_argument("--min-line-width", type=int, default=8, help="drop lines narrower than this")
    a = ap.parse_args()

    dbg = None
    if a.debug_dir:
        dbg = os.path.abspath(a.debug_dir)
        reroot = os.path.join(REPO, "re")
        if os.path.commonpath([dbg, reroot]) != reroot:
            sys.exit("--debug-dir must be under <repo>/re/")
        os.makedirs(dbg, exist_ok=True)

    nat, prt = index_map(a.native_dir), index_map(a.port_dir)
    cache, mode, scores = {}, "default", None
    if a.auto_align:
        pairs, scores = auto_align(nat, prt, cache, a.ink_threshold)
        mode = "auto"
        print("auto-align (native->port, MAD):", "  ".join(f"{n}->{p}({scores[n]})" for n, p in pairs))
    elif a.pairs:
        pairs = [tuple(int(x) for x in s.split(":")) for s in a.pairs.split(",") if s.strip()]
        mode = "custom"
    else:
        pairs = DEFAULT_PAIRS

    rows = []
    for n, p in pairs:
        if n not in nat or p not in prt:
            sys.exit(f"missing image: native {n} or port {p}")
        fn, fp = load(nat[n], cache), load(prt[p], cache)
        nm, pm = measure(fn, a), measure(fp, a)
        if dbg:
            write_mask(os.path.join(dbg, f"native-{n:03d}-ink.png"), fn, a.ink_threshold)
            write_mask(os.path.join(dbg, f"port-{p:03d}-ink.png"), fp, a.ink_threshold)
        rows.append({"native": n, "port": p, "native_metrics": nm, "port_metrics": pm, "deltas": deltas(nm, pm)})

    print_table(rows)
    summary = summarise(rows)
    print("\nsummary:")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    if a.json:
        out = {"alignment": mode, "settings": {"ink_threshold": a.ink_threshold, "min_row_ink": a.min_row_ink,
               "min_line_width": a.min_line_width}, "auto_scores": scores, "pairs": rows, "summary": summary}
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
