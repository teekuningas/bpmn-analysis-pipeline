// Runs every study end to end against the scripted provider and prints what
// came out. No browser, no model, no network — so it can be a check rather
// than a demo.
//
//     node tools/smoke.mjs [study-id]

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from './xmldom.mjs';

globalThis.DOMParser = DOMParser;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { loadStudy, defaultsFor } = await import('../runtime/study.js');
const { Run } = await import('../runtime/run.js');
const { scriptedProvider } = await import('../runtime/providers.js');

const pct = (x) => `${String(Math.round(x * 100)).padStart(3)}%`;

async function one(id) {
  const loaded = await loadStudy(id, (file) => readFile(join(root, 'studies', id, file), 'utf8'));
  const { study, processes, processId, model } = loaded;

  console.log(`\n[1m${study.title}[0m  (${id})`);
  console.log(`  ${study.question}`);

  if (model.problems.length) {
    console.log('\n  TYPE PROBLEMS');
    model.problems.forEach((p) => console.log(`    ${p}`));
    return false;
  }
  console.log(`  types check · ${model.info.size} boxes · sources ${Object
    .entries(study.data).map(([k, v]) => `${k}=${v.length}`).join(' ')}`);

  // Consolidation goes round until a round merges nothing, so the number of
  // rounds and the pairs asked about are the things worth printing.
  let rounds = 0;
  let asked = 0;
  const run = new Run({
    study,
    processes,
    processId,
    provider: scriptedProvider(study),
    // What the page will be sitting on when a colleague opens it and presses
    // Run without touching anything: the stand-in's own defaults.
    settings: defaultsFor(study, 'scripted'),
    onEvent: ({ type, element }) => {
      if (type === 'enter' && element.id === 'PerPair') rounds += 1;
      if (type === 'enter' && element.id === 'Judge') asked += 1;
    },
  });

  const started = Date.now();
  await run.start();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const result = run.data[study.result || study.chart?.of] || [];
  const findings = study.chart ? result : [];
  const themes = run.data.themes || [];
  const joined = run.data.joined || [];
  console.log(`  ran in ${seconds}s · ${run.calls.length} calls`
    + (rounds ? ` · ${run.valueOf('Pool')?.length ?? 0} raw labels → ${themes.length} agreed`
      + ` in ${rounds} round${rounds === 1 ? '' : 's'} (${asked} pairs asked about)`
      + ` · ${joined.length} of ${run.data.rows?.length ?? 0} rows joined` : ''));

  // A study with no chart still has a result, and the point of the check is that
  // something came out of it.
  if (!study.chart) {
    console.log(`\n  ${study.result} · ${result.length}`);
    result.forEach((one, at) => console.log(`  ${String(at + 1).padStart(3)}. ${String(one).slice(0, 96)}`));
    return true;
  }

  const groups = findings[0]?.groups.map((g) => g.name) || [];
  console.log(`\n  ${'theme'.padEnd(40)} ${groups.map((g) => g.padStart(6)).join(' ')}     q`);
  for (const f of findings) {
    console.log(`  ${f.theme.slice(0, 39).padEnd(40)} `
      + `${f.groups.map((g) => pct(g.rate)).join('  ')}  ${f.q.toFixed(3)}`
      + `${f.significant ? '  *' : ''}`);
  }

  const survived = findings.filter((f) => f.significant);
  console.log(`\n  ${survived.length} of ${findings.length} survive correction`);
  return true;
}

const wanted = process.argv[2];
const studies = JSON.parse(await readFile(join(root, 'studies/index.json'), 'utf8'));
let ok = true;
for (const { id } of studies) {
  if (wanted && id !== wanted) continue;
  ok = (await one(id)) && ok;
}
process.exit(ok ? 0 : 1);
