// The ops themselves: small, boring functions that each do one thing.
//
// Each one mirrors a step that exists today as a chunk of a Jupyter notebook in
// the original analysis. Nothing here knows what runs before or after it --
// the BPMN file decides that.

import { defineOp } from './registry.js';
import * as llm from './mockllm.js';

// ============================================================ corpus =========

defineOp('corpus.read', {
  summary: 'Read the narrative texts and their metadata from a folder.',
  params: { path: 'folder containing index.json + one .txt per record' },
  async run({ path }, ctx) {
    const index = await (await fetch(`${path}/index.json`)).json();
    const records = [];
    for (const rec of index.records) {
      const text = (await (await fetch(`${path}/${rec.file}`)).text()).trim();
      records.push({ ...rec, text, nWords: text.split(/\s+/).length });
    }
    ctx.log(`read ${records.length} records from ${path}`);
    return ctx.store.put('corpus', records, {
      n: records.length,
      items: records.map((r) => r.rec_id),
    });
  },
});

defineOp('corpus.filter', {
  summary: 'Keep only usable records. "first_per_user" keeps one narrative per '
    + 'participant (independent observations); "all_valid" keeps them all.',
  params: {
    corpus: 'corpus reference',
    mode: '"first_per_user" | "all_valid"',
    min_words: 'discard anything shorter',
  },
  run({ corpus, mode, min_words }, ctx) {
    const records = ctx.store.get(corpus);
    const long = records.filter((r) => r.nWords >= min_words);
    let kept = long;
    if (mode === 'first_per_user') {
      const seen = new Set();
      kept = long.filter((r) => (seen.has(r.user_id) ? false : seen.add(r.user_id)));
    }
    ctx.log(`filter (${mode}): ${records.length} -> ${kept.length} records`);
    return ctx.store.put('corpus', kept, { n: kept.length, items: kept.map((r) => r.rec_id) });
  },
});

// ============================================================ codebook =======

defineOp('llm.generate_codebook', {
  summary: 'Ask the model to read one narrative and name the themes it sees, freely.',
  params: { corpus: 'corpus reference', rec_id: 'which record', seed: 'sampling seed' },
  callsLlm: true,
  run({ corpus, rec_id, seed }, ctx) {
    const rec = ctx.store.get(corpus).find((r) => r.rec_id === rec_id);
    const freeform = llm.generateCodebook({ text: rec.text, seed });
    ctx.log(`codebook for ${rec_id} (seed ${seed})`);
    return ctx.store.put('freeform', freeform, { rec_id, preview: freeform.slice(0, 120) });
  },
});

defineOp('llm.structure_codes', {
  summary: 'Second model call: reformat that prose into strict JSON. Splitting '
    + 'reasoning from formatting is what the original notebooks do too.',
  params: { freeform: 'freeform codebook reference', rec_id: 'which record' },
  callsLlm: true,
  run({ freeform, rec_id }, ctx) {
    const { codes } = llm.structureCodes({ freeform: ctx.store.get(freeform) });
    const tagged = codes.map((c) => ({ ...c, rec_id }));
    return ctx.store.put('codes', tagged, { n: tagged.length, rec_id });
  },
});

defineOp('codes.flatten', {
  summary: 'Pool every per-narrative codebook into one long list of codes.',
  params: { codebooks: 'list of code-set references' },
  run({ codebooks }, ctx) {
    const all = codebooks.flatMap((ref) => ctx.store.get(ref));
    ctx.log(`pooled ${all.length} codes from ${codebooks.length} narratives`);
    return ctx.store.put('codes', all, { n: all.length, items: all.map((_, i) => i) });
  },
});

// ============================================================ clustering =====

defineOp('llm.embed', {
  summary: 'Embed one code label into the semantic space.',
  params: { codes: 'pooled codes reference', index: 'which code in the list' },
  callsLlm: true,
  run({ codes, index }, ctx) {
    const code = ctx.store.get(codes)[index];
    const vector = llm.embed({ text: code.code });
    return ctx.store.put('vector', vector, { dim: vector.length, code: code.code });
  },
});

defineOp('cluster.hierarchical', {
  summary: 'Average-linkage agglomerative clustering on cosine distance, cut at '
    + 'a threshold. Small clusters are dropped as unreliable.',
  params: {
    codes: 'pooled codes reference',
    vectors: 'list of vector references',
    threshold: 'cut height (larger = fewer, broader clusters)',
    min_size: 'discard clusters smaller than this',
  },
  run({ codes, vectors, threshold, min_size }, ctx) {
    const codeList = ctx.store.get(codes);
    const vecs = vectors.map((v) => ctx.store.get(v));
    const cos = (a, b) => 1 - a.reduce((s, x, i) => s + x * b[i], 0);

    // Start with singletons, repeatedly merge the closest pair (average linkage).
    let clusters = vecs.map((_, i) => [i]);
    const dist = (A, B) => {
      let s = 0;
      for (const i of A) for (const j of B) s += cos(vecs[i], vecs[j]);
      return s / (A.length * B.length);
    };
    while (clusters.length > 1) {
      let best = null;
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const d = dist(clusters[i], clusters[j]);
          if (!best || d < best.d) best = { i, j, d };
        }
      }
      if (best.d > threshold) break;
      const merged = clusters[best.i].concat(clusters[best.j]);
      clusters = clusters.filter((_, k) => k !== best.i && k !== best.j);
      clusters.push(merged);
    }

    const kept = clusters
      .filter((c) => c.length >= min_size)
      .map((c) => ({ members: c.map((i) => codeList[i].code), size: c.length }))
      .sort((a, b) => b.size - a.size);

    ctx.log(`clustered ${codeList.length} codes -> ${clusters.length} clusters, `
      + `${kept.length} kept (min size ${min_size}, threshold ${threshold})`);
    return ctx.store.put('clusters', kept, { n: kept.length, items: kept.map((_, i) => i) });
  },
});

defineOp('llm.name_cluster', {
  summary: 'Ask the model for one representative label for a cluster of near-duplicate codes.',
  params: { clusters: 'clusters reference', index: 'which cluster', seed: 'sampling seed' },
  callsLlm: true,
  run({ clusters, index, seed }, ctx) {
    const cluster = ctx.store.get(clusters)[index];
    const { code } = llm.nameCluster({ labels: cluster.members, seed });
    return { theme: code, size: cluster.size };
  },
});

// ============================================================ scoring ========

defineOp('matrix.score_presence', {
  summary: 'For one narrative, ask the model whether each theme is present. '
    + 'This is the 98 x 710 grid of calls in the real pipeline.',
  params: {
    corpus: 'filtered corpus reference',
    rec_id: 'which record',
    codebook: 'list of themes',
    seed: 'sampling seed',
  },
  callsLlm: true,
  run({ corpus, rec_id, codebook, seed }, ctx) {
    const rec = ctx.store.get(corpus).find((r) => r.rec_id === rec_id);
    const presence = {};
    for (const { theme } of codebook) {
      presence[theme] = llm.judgeThemePresence({ theme, text: rec.text, recId: rec_id, seed })
        .theme_present ? 1 : 0;
    }
    return { rec_id, presence };
  },
});

defineOp('matrix.filter_prevalence', {
  summary: 'Drop themes that are almost always or almost never present -- there '
    + 'is nothing to associate with a constant.',
  params: { rows: 'scored rows', min: 'lower prevalence bound', max: 'upper bound' },
  run({ rows, min, max }, ctx) {
    const themes = Object.keys(rows[0].presence);
    const prevalence = Object.fromEntries(
      themes.map((t) => [t, rows.reduce((s, r) => s + r.presence[t], 0) / rows.length]),
    );
    const kept = themes.filter((t) => prevalence[t] >= min && prevalence[t] <= max);
    ctx.log(`prevalence filter [${min}, ${max}]: ${themes.length} -> ${kept.length} themes`);
    const matrix = rows.map((r) => ({
      rec_id: r.rec_id,
      presence: Object.fromEntries(kept.map((t) => [t, r.presence[t]])),
    }));
    return ctx.store.put('matrix', matrix, {
      n_rows: matrix.length,
      themes: kept,
      prevalence: Object.fromEntries(kept.map((t) => [t, +prevalence[t].toFixed(2)])),
    });
  },
});

// ============================================================ context ========

defineOp('context.load', {
  summary: 'Load the ecological/spatial context for each record. In the real '
    + 'pipeline this branch is GPS -> ESA WorldCover habitat + birdsong species '
    + 'classification; here it is the site type shipped with the demo corpus.',
  params: { path: 'folder containing index.json', variable: 'which column to use as predictor' },
  async run({ path, variable }, ctx) {
    const index = await (await fetch(`${path}/index.json`)).json();
    const table = index.records.map((r) => ({ rec_id: r.rec_id, value: r[variable] }));
    const levels = [...new Set(table.map((r) => r.value))].sort();
    ctx.log(`context "${variable}": ${levels.join(' / ')}`);
    return ctx.store.put('context', table, { n: table.length, variable, levels });
  },
});

// ============================================================ statistics =====

/** erfc via Abramowitz & Stegun 7.1.26 -- enough for a demo. */
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196
    + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398
      + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Upper tail of chi-square with 1 degree of freedom. */
const chi2SfDf1 = (x) => erfc(Math.sqrt(Math.max(x, 0) / 2));

defineOp('stats.chi_square', {
  summary: 'Chi-square test of independence for every theme x context level, '
    + "with Cramer's V as effect size.",
  params: { matrix: 'theme presence matrix', context: 'predictor table' },
  run({ matrix, context }, ctx) {
    const rows = ctx.store.get(matrix);
    const table = ctx.store.get(context);
    const site = Object.fromEntries(table.map((r) => [r.rec_id, r.value]));
    const levels = [...new Set(table.map((r) => r.value))].sort();
    const themes = Object.keys(rows[0].presence);

    const results = [];
    for (const theme of themes) {
      for (const level of levels) {
        // 2x2: theme present/absent x in this level / not
        let a = 0; let b = 0; let c = 0; let d = 0;
        for (const r of rows) {
          const inLevel = site[r.rec_id] === level;
          const present = r.presence[theme] === 1;
          if (inLevel && present) a++;
          else if (inLevel && !present) b++;
          else if (!inLevel && present) c++;
          else d++;
        }
        const n = a + b + c + d;
        const denom = (a + b) * (c + d) * (a + c) * (b + d);
        if (!denom) continue;
        const chi2 = (n * (a * d - b * c) ** 2) / denom;
        results.push({
          theme,
          predictor: level,
          n_with: a + b,
          prevalence_in: +(a / (a + b)).toFixed(2),
          prevalence_out: +(c / (c + d)).toFixed(2),
          chi2: +chi2.toFixed(3),
          cramers_v: +Math.sqrt(chi2 / n).toFixed(3),
          p_value: +chi2SfDf1(chi2).toFixed(4),
        });
      }
    }

    // With a two-level predictor "rural" and "urban" are the same test mirrored,
    // so keep only the direction in which the theme is enriched.
    const reported = levels.length === 2
      ? results.filter((r) => r.prevalence_in > r.prevalence_out)
      : results;

    reported.sort((x, y) => x.p_value - y.p_value);
    ctx.log(`${reported.length} tests over ${themes.length} themes x ${levels.length} levels`);
    return ctx.store.put('results', reported, { n: reported.length });
  },
});

defineOp('stats.fdr', {
  summary: 'Benjamini-Hochberg correction across all tests.',
  params: { results: 'test results', alpha: 'false discovery rate' },
  run({ results, alpha }, ctx) {
    const rows = [...ctx.store.get(results)].sort((a, b) => a.p_value - b.p_value);
    const m = rows.length;
    let running = 1;
    const out = rows
      .map((r, i) => ({ ...r, p_fdr: Math.min(1, (r.p_value * m) / (i + 1)) }))
      .reverse()
      .map((r) => {
        running = Math.min(running, r.p_fdr);
        return { ...r, p_fdr: +running.toFixed(4) };
      })
      .reverse()
      .map((r) => ({ ...r, significant: r.p_fdr < alpha }));
    const nSig = out.filter((r) => r.significant).length;
    ctx.log(`FDR q<${alpha}: ${nSig}/${m} tests significant`);
    return ctx.store.put('results', out, { n: out.length, n_significant: nSig });
  },
});

defineOp('report.render', {
  summary: 'Render the final table the analyst actually reads.',
  params: { results: 'corrected results', matrix: 'theme presence matrix', top_n: 'rows to show' },
  run({ results, matrix, top_n }, ctx) {
    const rows = ctx.store.get(results).slice(0, top_n);
    const m = ctx.store.get(matrix);
    return ctx.store.put('report', { rows, n_records: m.length }, {
      n_rows: rows.length,
      n_records: m.length,
      headline: rows.length
        ? `${rows[0].theme} x ${rows[0].predictor} (p=${rows[0].p_value}, V=${rows[0].cramers_v})`
        : 'no associations',
    });
  },
});
