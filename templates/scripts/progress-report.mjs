#!/usr/bin/env node
// Progress report for the port: titles come from game.config.json, items from the checklist.
// Usage: node scripts/progress-report.mjs [--tests] [--json] [--write]
// Reads docs/progress-checklist.json (rules are stated in that file). Proof files are parsed for their
// ok/failedPhase fields only; no proof or script text is printed.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TITLE = (() => {
  try {
    const title = JSON.parse(readFileSync(join(root, 'game.config.json'), 'utf8'))?.game?.title;
    if (typeof title === 'string' && title.trim() && !/^<.*>$/.test(title.trim())) return title.trim();
  } catch { /* fall through */ }
  return 'web port';
})();
const wantTests = process.argv.includes('--tests');
const asJson = process.argv.includes('--json');
const writeReport = process.argv.includes('--write');

const checklist = JSON.parse(readFileSync(join(root, 'docs/progress-checklist.json'), 'utf8'));
const warnings = [];

function loadLastVerification() {
  const path = join(root, 're/verification/verify.json');
  let proof;
  try { proof = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (!proof || typeof proof.createdAt !== 'string' || !proof.checkpoint || typeof proof.checkpoint !== 'object') {
    warnings.push('ignored invalid re/verification/verify.json summary');
    return null;
  }
  const counts = proof.testCounts;
  const testCounts = counts && ['passed', 'failed', 'skipped', 'total'].every((key) => Number.isInteger(counts[key]))
    ? { passed: counts.passed, failed: counts.failed, skipped: counts.skipped, total: counts.total,
      filesPassed: Number.isInteger(counts.filesPassed) ? counts.filesPassed : null,
      filesFailed: Number.isInteger(counts.filesFailed) ? counts.filesFailed : null }
    : null;
  return {
    createdAt: proof.createdAt,
    checkpoint: { head: typeof proof.checkpoint.head === 'string' ? proof.checkpoint.head : 'unknown', dirty: typeof proof.checkpoint.dirty === 'boolean' ? proof.checkpoint.dirty : null },
    scriptCount: Number.isInteger(proof.scriptCount) ? proof.scriptCount : null,
    testCounts,
    ok: proof.ok === true,
  };
}
const lastVerification = wantTests ? null : loadLastVerification();

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function listFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// Glob: * stays inside one name, ** matches any folders (including none).
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

const proofFiles = listFiles(join(root, 're/verification'))
  .map((abs) => ({ abs, rel: relative(root, abs).split(sep).join('/'), mtime: statSync(abs).mtimeMs }))
  .filter((f) => f.rel.endsWith('.json') && !f.rel.endsWith('.progress.json'));

// The newest candidate whose field is a boolean wins.
function resolveProof(item) {
  const re = globToRegExp(item.auto.proof);
  const field = item.auto.field ?? 'ok';
  const candidates = proofFiles
    .filter((f) => re.test(f.rel))
    .sort((a, b) => b.mtime - a.mtime); // the newest proof reflects the current code
  for (const f of candidates) {
    let data;
    try {
      data = JSON.parse(readFileSync(f.abs, 'utf8'));
    } catch {
      continue;
    }
    if (data && typeof data === 'object' && typeof data[field] === 'boolean') {
      return {
        file: f.rel,
        ok: data[field],
        failedPhase: typeof data.failedPhase === 'string' ? data.failedPhase : null,
      };
    }
  }
  return null;
}

function itemResult(item) {
  if (item.auto) {
    const p = resolveProof(item);
    if (!p) return { status: 'todo', credit: 0, note: 'no proof file' };
    if (p.ok) return { status: 'done', credit: 1, note: p.file };
    // ok:false counts as partial only after the boot phase; a boot failure is todo.
    if (p.failedPhase && !/^boot/i.test(p.failedPhase)) {
      return { status: 'partial', credit: 0.5, note: `${p.file} (failed after boot)` };
    }
    const why = p.failedPhase ? 'failed at boot' : 'failed, no phase recorded';
    return { status: 'todo', credit: 0, note: `${p.file} (${why})` };
  }
  const status = item.status;
  if (!['done', 'partial', 'todo'].includes(status)) warnings.push(`bad status on ${item.id}`);
  const credit = status === 'done' ? 1 : status === 'partial' ? (item.partial ?? 0.5) : 0;
  return { status, credit, note: item.evidence ?? '' };
}

const areas = checklist.areas;
const areaById = Object.fromEntries(areas.map((a) => [a.id, a]));
const results = checklist.items.map((item) => {
  if (!areaById[item.area]) warnings.push(`unknown area on ${item.id}`);
  return { id: item.id, area: item.area, title: item.title, weight: item.weight, ...itemResult(item) };
});

// Weight checks: each area's items must sum to its declared weight, and the total must be 100.
for (const a of areas) {
  const sum = results.filter((r) => r.area === a.id).reduce((s, r) => s + r.weight, 0);
  if (Math.abs(sum - a.weight) > 1e-6) warnings.push(`area ${a.id} items sum ${sum.toFixed(2)}, expected ${a.weight}`);
}
const totalWeight = results.reduce((s, r) => s + r.weight, 0);
if (Math.abs(totalWeight - 100) > 1e-6) warnings.push(`total weight ${totalWeight.toFixed(2)}, expected 100`);

// Every browser harness needs a checklist item (id harness.<name>).
const listedIds = new Set(checklist.items.map((i) => i.id));
for (const f of readdirSync(join(root, 'scripts'))) {
  const m = f.match(/^check-(.+)\.playwright\.js$/);
  if (m && !listedIds.has(`harness.${m[1]}`)) warnings.push(`unlisted harness: ${m[1]}`);
}

const pctOf = (rs) => {
  const w = rs.reduce((s, r) => s + r.weight, 0);
  return w ? (100 * rs.reduce((s, r) => s + r.weight * r.credit, 0)) / w : 0;
};
const overall = pctOf(results);
const excludingMobile = pctOf(results.filter((r) => !areaById[r.area]?.mobile));
const areaRows = areas.map((a) => ({
  id: a.id,
  label: a.label,
  weight: a.weight,
  mobile: !!a.mobile,
  paused: !!a.mobile && a.paused !== false,
  pct: pctOf(results.filter((r) => r.area === a.id)),
}));

function countShortcuts(dir) {
  let n = 0;
  for (const p of listFiles(dir)) {
    if (!/\.(ts|tsx|js|mjs)$/.test(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) if (/\bshortcut:/.test(line)) n++;
  }
  return n;
}
const shortcutCount = countShortcuts(join(root, 'src'));

function runTests() {
  const cli = join(root, 'node_modules/vitest/vitest.mjs');
  if (!statSyncSafe(cli)) return { error: 'local Vitest CLI is missing; install project dependencies first' };
  const r = spawnSync(process.execPath, [cli, 'run'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const raw = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const logDir = join(root, 're/verification');
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, 'progress-tests.log'), raw, 'utf8');
  const text = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const line = text.split(/\r?\n/).reverse().find((l) => /^\s*Tests\s+/.test(l));
  if (!line) return { error: `could not parse Vitest summary (exit ${r.status ?? 'unknown'})` };
  return {
    passed: Number(line.match(/(\d+)\s+passed/)?.[1] ?? 0),
    failed: Number(line.match(/(\d+)\s+failed/)?.[1] ?? 0),
    exit: r.status ?? 1,
  };
}
function statSyncSafe(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}
const tests = wantTests ? runTests() : null;

const head = git('rev-parse', '--short', 'HEAD') || 'unknown';
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || '?';
const workingTreeDirty = Boolean(git('status', '--porcelain'));
const commits = git('log', '--oneline', '-5').split('\n').filter(Boolean);

const top = results
  .map((r) => ({ ...r, left: r.weight * (1 - r.credit) }))
  .filter((r) => r.left > 1e-9)
  .sort((a, b) => b.left - a.left)
  .slice(0, 5);

const r2 = (x) => Math.round(x * 100) / 100;
const fmtPlain = (x) => `${x.toFixed(1)}%`;

function verificationSummary() {
  if (tests) {
    if (tests.error) return `Optional Vitest run: ${tests.error}.`;
    return `Optional Vitest run: ${tests.passed} passed, ${tests.failed} failed (exit ${tests.exit}); raw output is in ignored \`re/verification/progress-tests.log\`.`;
  }
  if (!lastVerification) return 'Vitest not run; no saved verification proof was found (add --tests to run it).';
  const checkpointState = lastVerification.checkpoint.dirty === true ? 'dirty' : lastVerification.checkpoint.dirty === false ? 'clean' : 'dirty state unknown';
  const counts = lastVerification.testCounts
    ? `${lastVerification.testCounts.passed} passed, ${lastVerification.testCounts.failed} failed, ${lastVerification.testCounts.skipped} skipped`
    : 'test counts unavailable';
  const currentWarning = workingTreeDirty ? '; current working tree is dirty, so saved metrics may predate current edits' : '';
  return `Last saved verification: ${lastVerification.createdAt}; checkpoint HEAD ${lastVerification.checkpoint.head} (${checkpointState}); scripts ${lastVerification.scriptCount ?? 'unavailable'}/82; ${counts}; ${lastVerification.ok ? 'PASS' : 'FAIL'}${currentWarning}.`;
}

function generatedReport() {
  const date = new Date().toISOString().slice(0, 10);
  const areaTable = areaRows.map((a) => `| ${a.label}${a.mobile ? (a.paused ? ' (paused)' : ' (active)') : ''} | ${a.weight} | ${fmtPlain(a.pct)} |`).join('\n');
  const mobileArea = areaById.mobile;
  const mobileItems = results.filter((r) => areaById[r.area]?.mobile);
  const mobileEvidence = mobileItems
    .map((r) => `- **${r.title}** (${fmtPlain(r.credit * 100)} checklist credit). ${r.note || 'No device evidence recorded.'}`)
    .join('\n');
  const openItems = results
    .map((r) => ({ ...r, left: r.weight * (1 - r.credit) }))
    .filter((r) => r.left > 1e-9 && !areaById[r.area]?.mobile)
    .sort((a, b) => b.left - a.left)
    .slice(0, 6)
    .map((r) => `- **${r.title}** (${r.left.toFixed(2)} points remain). ${r.note || 'No checklist evidence recorded.'}`)
    .join('\n');
  const testsLine = verificationSummary();
  const current = [
    `# ${TITLE} web port: current progress`,
    '',
    `Generated ${date} from \`docs/progress-checklist.json\` and the newest matching proof files. Source: ${workingTreeDirty ? 'dirty working tree' : 'clean working tree'}, based on HEAD \`${head}\` (${branch}).`,
    '',
    'These are weighted checklist estimates, not a measured compatibility percentage. Only evidence currently recorded in the checklist and proof files counts; this command does not rerun routes or mobile checks.',
    '',
    '## Progress',
    '',
    `- **Overall: ${fmtPlain(overall)}**. **Excluding mobile: ${fmtPlain(excludingMobile)}**.`,
    `- Shortcut comments under src/: ${shortcutCount}.`,
    `- ${testsLine}`,
    `- Mobile work: ${mobileArea?.paused === false ? 'active' : 'paused'}; device evidence and remaining checks are listed below.`,
    '',
    '| Area | Weight | Checklist credit |',
    '|---|---:|---:|',
    areaTable,
    '',
    `Playability item weights were scaled proportionally to the declared 8-point area. Corrected checklist headline: ${fmtPlain(overall)} overall and ${fmtPlain(excludingMobile)} excluding mobile work.`,
    '',
    '## Next work',
    '',
    `The ranked list shows outstanding non-mobile checklist items. Mobile work is ${mobileArea?.paused === false ? 'active in parallel' : 'paused'}.`,
    '',
    openItems || '- No outstanding non-mobile checklist items.',
    '',
    '## Evidence limits',
    '',
    '- Scores inherit the evidence notes below and matching JSON proofs under ignored `re/verification/`; inspect those sources before treating a result as current runtime verification.',
    '- Route coverage is recorded in the checklist; this script reads proofs and checklist status, it does not replay routes.',
    '- Physical-device credit follows the recorded user reports. It does not establish untested scenarios or a complete device pass.',
    '',
    mobileEvidence,
    '',
    '<!-- BEGIN HISTORICAL SNAPSHOT -->',
    '',
    '## Historical report snapshot (superseded)',
    '',
    'The manually maintained report below is retained for its detailed session notes. Its date, scores, test counts, and risks describe that earlier snapshot; use the generated status above for current checklist scores.',
    '',
  ].join('\n');
  const target = join(root, 'docs/PROGRESS_REPORT.md');
  let old = '';
  try { old = readFileSync(target, 'utf8'); } catch {}
  const bodyMarker = '<!-- HISTORICAL BODY -->';
  let historical = '';
  const bodyStart = old.lastIndexOf(bodyMarker);
  if (bodyStart >= 0) {
    historical = old.slice(bodyStart + bodyMarker.length).trim();
  } else {
    const sectionStart = old.indexOf('<!-- BEGIN HISTORICAL SNAPSHOT -->');
    const originalStart = old.indexOf(`# ${TITLE} web port: progress report`, sectionStart >= 0 ? sectionStart : 0);
    historical = (originalStart >= 0 ? old.slice(originalStart) : old).trim();
  }
  return historical
    ? `${current.trimEnd()}\n\n${bodyMarker}\n\n${historical}\n`
    : `${current.trimEnd()}\n`;
}

if (asJson) {
  console.log(JSON.stringify({
    head,
    branch,
    overallPct: r2(overall),
    excludingMobilePct: r2(excludingMobile),
    areas: areaRows.map((a) => ({ ...a, pct: r2(a.pct) })),
    tests,
    lastVerification,
    shortcutCount,
    commits,
    items: results.map((r) => ({ id: r.id, area: r.area, title: r.title, weight: r.weight, status: r.status, credit: r.credit, note: r.note })),
    topRemaining: top.map((r) => ({ id: r.id, title: r.title, remaining: r2(r.left) })),
    warnings,
  }, null, 2));
  process.exit(0);
}

if (writeReport) {
  writeFileSync(join(root, 'docs/PROGRESS_REPORT.md'), generatedReport(), 'utf8');
  console.log(`Updated docs/PROGRESS_REPORT.md: ${fmtPlain(overall)} overall, ${fmtPlain(excludingMobile)} excluding mobile${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`);
  if (warnings.length) for (const w of warnings) console.log(`! ${w}`);
  process.exit(0);
}

const fmt = (x) => `${x.toFixed(1)}%`.padStart(6);
const lines = [];
lines.push(`${TITLE} port progress  HEAD ${head} (${branch})`);
lines.push(`Overall ${fmt(overall)}   excluding mobile ${fmt(excludingMobile)}`);
for (const a of areaRows) {
  lines.push(`  ${a.label.padEnd(26)}${fmt(a.pct)}  of ${a.weight}${a.mobile ? (a.paused ? '  (paused)' : '  (active)') : ''}`);
}
lines.push(verificationSummary());
lines.push(`Shortcut guesses in src: ${shortcutCount}`);
lines.push('Last 5 commits:');
for (const c of commits) lines.push(`  ${c.length > 100 ? `${c.slice(0, 97)}...` : c}`);
lines.push('Top 5 remaining (weight not yet earned):');
top.forEach((r, i) => lines.push(`  ${i + 1}. ${r.title} (${r.left.toFixed(2)})`));
for (const w of warnings) lines.push(`! ${w}`);
console.log(lines.join('\n'));
