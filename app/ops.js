import { defineOp } from './registry.js';
import * as llm from './mockllm.js';

defineOp('corpus.read', {
  summary: 'Read narratives and metadata from a folder.',
  params: { path: 'data folder' },
  async run({ path }, ctx) {
    const index = await (await fetch(`${path}/index.json`)).json();
    const records = [];
    for (const rec of index.records) {
      const text = (await (await fetch(`${path}/${rec.file}`)).text()).trim();
      records.push({ ...rec, text, nWords: text.split(/\s+/).length });
    }
    ctx.log(`read ${records.length} records`);
    return ctx.store.put('corpus', records, {
      n: records.length,
      items: records.map((r) => r.rec_id),
    });
  },
});

defineOp('corpus.filter', {
  summary: 'Keep usable records: all of them, or one per participant.',
  params: { corpus: 'corpus', mode: 'all_valid | first_per_user', min_words: 'minimum length' },
  run({ corpus, mode, min_words }, ctx) {
    const records = ctx.store.get(corpus);
    const long = records.filter((r) => r.nWords >= min_words);
    let kept = long;
    if (mode === 'first_per_user') {
      const seen = new Set();
      kept = long.filter((r) => (seen.has(r.user_id) ? false : seen.add(r.user_id)));
    }
    ctx.log(`filter ${mode}: ${records.length} -> ${kept.length}`);
    return ctx.store.put('corpus', kept, { n: kept.length, items: kept.map((r) => r.rec_id) });
  },
});

defineOp('llm.generate_codebook', {
  summary: 'Read one narrative, name the themes in it, freely.',
  params: { corpus: 'corpus', rec_id: 'record', seed: 'sampling seed' },
  callsLlm: true,
  run({ corpus, rec_id, seed }, ctx) {
    const rec = ctx.store.get(corpus).find((r) => r.rec_id === rec_id);
    const freeform = llm.generateCodebook({ text: rec.text, seed });
    return ctx.store.put('freeform', freeform, { rec_id, seed, preview: freeform.slice(0, 100) });
  },
});

defineOp('llm.structure_codes', {
  summary: 'Reformat that prose into strict JSON.',
  params: { freeform: 'freeform codebook', rec_id: 'record', seed: 'iteration' },
  callsLlm: true,
  run({ freeform, rec_id, seed }, ctx) {
    const { codes } = llm.structureCodes({ freeform: ctx.store.get(freeform) });
    const tagged = codes.map((c) => ({ ...c, rec_id, seed }));
    return ctx.store.put('codes', tagged, { n: tagged.length, rec_id, seed });
  },
});

defineOp('codes.flatten', {
  summary: 'Pool the codes from every narrative and every iteration.',
  params: { codebooks: 'nested code-set references' },
  run({ codebooks }, ctx) {
    const all = codebooks.flat(Infinity).flatMap((ref) => ctx.store.get(ref));
    ctx.log(`pooled ${all.length} codes`);
    return ctx.store.put('codes', all, { n: all.length, items: all.map((_, i) => i) });
  },
});

defineOp('llm.embed', {
  summary: 'Embed one code label into the semantic space.',
  params: { codes: 'pooled codes', index: 'which code' },
  callsLlm: true,
  run({ codes, index }, ctx) {
    const code = ctx.store.get(codes)[index];
    const vector = llm.embed({ text: code.code });
    return ctx.store.put('vector', vector, { dim: vector.length, code: code.code });
  },
});

defineOp('cluster.hierarchical', {
  summary: 'Average-linkage clustering on cosine distance, cut at a threshold.',
  params: {
    codes: 'pooled codes',
    vectors: 'embeddings',
    threshold: 'cut height',
    min_size: 'drop clusters smaller than this',
  },
  run({ codes, vectors, threshold, min_size }, ctx) {
    const codeList = ctx.store.get(codes);
    const vecs = vectors.map((v) => ctx.store.get(v));
    const n = vecs.length;

    const d = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dot = 0;
        for (let k = 0; k < vecs[i].length; k++) dot += vecs[i][k] * vecs[j][k];
        d[i][j] = 1 - dot;
        d[j][i] = d[i][j];
      }
    }

    let groups = vecs.map((_, i) => ({ members: [i] }));
    const sum = new Map();
    const key = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;
    groups.forEach((g, a) => groups.forEach((_, b) => { if (a < b) sum.set(key(a, b), d[a][b]); }));
    let ids = groups.map((_, i) => i);
    const byId = new Map(ids.map((i) => [i, groups[i]]));
    let nextId = n;

    while (byId.size > 1) {
      let best = null;
      for (let x = 0; x < ids.length; x++) {
        for (let y = x + 1; y < ids.length; y++) {
          const a = ids[x]; const b = ids[y];
          const size = byId.get(a).members.length * byId.get(b).members.length;
          const dist = sum.get(key(a, b)) / size;
          if (!best || dist < best.dist) best = { a, b, dist };
        }
      }
      if (best.dist > threshold) break;
      const merged = { members: byId.get(best.a).members.concat(byId.get(best.b).members) };
      const id = nextId++;
      for (const other of ids) {
        if (other === best.a || other === best.b) continue;
        sum.set(key(id, other), sum.get(key(best.a, other)) + sum.get(key(best.b, other)));
      }
      byId.delete(best.a); byId.delete(best.b); byId.set(id, merged);
      ids = [...byId.keys()];
    }

    const kept = [...byId.values()]
      .filter((g) => g.members.length >= min_size)
      .map((g) => ({ members: g.members.map((i) => codeList[i].code), size: g.members.length }))
      .sort((a, b) => b.size - a.size);

    ctx.log(`clustered ${n} codes -> ${byId.size} clusters, ${kept.length} kept`);
    return ctx.store.put('clusters', kept, { n: kept.length, items: kept.map((_, i) => i) });
  },
});

defineOp('llm.name_cluster', {
  summary: 'Pick one representative label for a cluster of similar codes.',
  params: { clusters: 'clusters', index: 'which cluster', seed: 'sampling seed' },
  callsLlm: true,
  run({ clusters, index }, ctx) {
    const cluster = ctx.store.get(clusters)[index];
    const { code } = llm.nameCluster({ labels: cluster.members });
    return { theme: code, size: cluster.size };
  },
});

defineOp('matrix.score_presence', {
  summary: 'Decide, for one narrative, which themes are present in it.',
  params: { corpus: 'corpus', rec_id: 'record', codebook: 'themes', seed: 'sampling seed' },
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
  summary: 'Drop themes that are almost always or almost never present.',
  params: { rows: 'scored rows', min: 'lower bound', max: 'upper bound' },
  run({ rows, min, max }, ctx) {
    const themes = Object.keys(rows[0].presence);
    const prevalence = Object.fromEntries(
      themes.map((t) => [t, rows.reduce((s, r) => s + r.presence[t], 0) / rows.length]),
    );
    const kept = themes.filter((t) => prevalence[t] >= min && prevalence[t] <= max);
    ctx.log(`prevalence [${min}, ${max}]: ${themes.length} -> ${kept.length} themes`);
    const matrix = rows.map((r) => ({
      rec_id: r.rec_id,
      presence: Object.fromEntries(kept.map((t) => [t, r.presence[t]])),
    }));
    return ctx.store.put('matrix', matrix, { n_rows: matrix.length, themes: kept });
  },
});

defineOp('context.load', {
  summary: 'Load the site context used as predictor.',
  params: { path: 'data folder', variable: 'column to use' },
  async run({ path, variable }, ctx) {
    const index = await (await fetch(`${path}/index.json`)).json();
    const table = index.records.map((r) => ({ rec_id: r.rec_id, value: r[variable] }));
    const levels = [...new Set(table.map((r) => r.value))].sort();
    ctx.log(`context ${variable}: ${levels.join(' / ')}`);
    return ctx.store.put('context', table, { n: table.length, variable, levels });
  },
});

function tables(matrix, context, store) {
  const rows = store.get(matrix);
  const table = store.get(context);
  const site = Object.fromEntries(table.map((r) => [r.rec_id, r.value]));
  const levels = [...new Set(table.map((r) => r.value))].sort();
  const out = [];
  for (const theme of Object.keys(rows[0].presence)) {
    for (const level of levels) {
      let a = 0; let b = 0; let c = 0; let e = 0;
      for (const r of rows) {
        const inLevel = site[r.rec_id] === level;
        const present = r.presence[theme] === 1;
        if (inLevel && present) a++;
        else if (inLevel) b++;
        else if (present) c++;
        else e++;
      }
      out.push({ theme, level, a, b, c, d: e, levels });
    }
  }
  return out;
}

function summarise({ theme, level, a, b, c, d }, extra) {
  return {
    theme,
    predictor: level,
    prevalence_in: +(a / (a + b)).toFixed(2),
    prevalence_out: +(c / (c + d)).toFixed(2),
    ...extra,
  };
}

function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196
    + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398
      + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

defineOp('stats.chi_square', {
  summary: "Chi-square test per theme, with Cramer's V.",
  params: { matrix: 'theme matrix', context: 'predictor' },
  run({ matrix, context }, ctx) {
    const results = [];
    for (const t of tables(matrix, context, ctx.store)) {
      const { a, b, c, d } = t;
      const n = a + b + c + d;
      const denom = (a + b) * (c + d) * (a + c) * (b + d);
      if (!denom) continue;
      const chi2 = (n * (a * d - b * c) ** 2) / denom;
      results.push(summarise(t, {
        cramers_v: +Math.sqrt(chi2 / n).toFixed(3),
        p_value: +erfc(Math.sqrt(chi2 / 2)).toFixed(4),
      }));
    }
    return finish(results, ctx, 'chi-square');
  },
});

const logFactorial = (n) => {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
};

defineOp('stats.fisher_exact', {
  summary: "Fisher's exact test per theme. Slower, honest with small samples.",
  params: { matrix: 'theme matrix', context: 'predictor' },
  run({ matrix, context }, ctx) {
    const results = [];
    for (const t of tables(matrix, context, ctx.store)) {
      const { a, b, c, d } = t;
      const n = a + b + c + d;
      if (!((a + b) * (c + d) * (a + c) * (b + d))) continue;
      const p = (x, y, z, w) => Math.exp(
        logFactorial(x + y) + logFactorial(z + w) + logFactorial(x + z) + logFactorial(y + w)
        - logFactorial(n) - logFactorial(x) - logFactorial(y) - logFactorial(z) - logFactorial(w),
      );
      const observed = p(a, b, c, d);
      let total = 0;
      for (let i = 0; i <= Math.min(a + b, a + c); i++) {
        const j = a + b - i; const k = a + c - i; const l = d - a + i;
        if (j < 0 || k < 0 || l < 0) continue;
        const q = p(i, j, k, l);
        if (q <= observed * 1.0000001) total += q;
      }
      results.push(summarise(t, { p_value: +Math.min(1, total).toFixed(4) }));
    }
    return finish(results, ctx, 'fisher');
  },
});

function finish(results, ctx, label) {
  const levels = [...new Set(results.map((r) => r.predictor))];
  const reported = levels.length === 2
    ? results.filter((r) => r.prevalence_in > r.prevalence_out)
    : results;
  reported.sort((x, y) => x.p_value - y.p_value);
  ctx.log(`${label}: ${reported.length} tests`);
  return ctx.store.put('results', reported, { n: reported.length });
}

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
    ctx.log(`FDR q<${alpha}: ${out.filter((r) => r.significant).length}/${m} significant`);
    return ctx.store.put('results', out, { n: out.length });
  },
});

defineOp('report.render', {
  summary: 'Assemble the final table.',
  params: { results: 'corrected results', matrix: 'theme matrix', top_n: 'rows to show' },
  run({ results, matrix, top_n }, ctx) {
    const rows = ctx.store.get(results).slice(0, top_n);
    return ctx.store.put('report', { rows, n_records: ctx.store.get(matrix).length }, {
      n_rows: rows.length,
    });
  },
});
