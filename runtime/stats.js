// The arithmetic behind Test: chi2_contingency, Cramér's V and
// Benjamini–Hochberg, the same three the original study takes from scipy.

/** log Γ(x), Lanczos. */
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) ser += c[j] / (y += 1);
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/** Regularised lower incomplete gamma P(a, x), series and continued fraction. */
function lowerGamma(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 500; n += 1) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // Continued fraction for the upper tail, then complement it.
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** P(X² ≥ value) for the given degrees of freedom. */
function chiSquaredTail(value, df) {
  if (!(value > 0) || df <= 0) return 1;
  return 1 - lowerGamma(df / 2, value / 2);
}

/** Pearson's chi-squared on a table of counts, or null when there is nothing
 *  to compare. `thin` marks an expected count too small to lean on. */
export function chiSquared(table) {
  const rows = table.length;
  const cols = table[0]?.length || 0;
  if (rows < 2 || cols < 2) return null;

  const rowSums = table.map((row) => row.reduce((a, b) => a + b, 0));
  const colSums = table[0].map((_, j) => table.reduce((a, row) => a + row[j], 0));
  const n = rowSums.reduce((a, b) => a + b, 0);
  if (!n) return null;
  if (rowSums.some((s) => s === 0) || colSums.some((s) => s === 0)) return null;

  let stat = 0;
  let smallest = Infinity;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const expected = (rowSums[i] * colSums[j]) / n;
      smallest = Math.min(smallest, expected);
      stat += ((table[i][j] - expected) ** 2) / expected;
    }
  }

  const df = (rows - 1) * (cols - 1);
  return {
    chi2: stat,
    df,
    n,
    p: chiSquaredTail(stat, df),
    v: Math.sqrt(stat / (n * Math.min(rows - 1, cols - 1))),
    thin: smallest < 5,
  };
}

/** Benjamini–Hochberg: p-values in, q-values out, in the same order. */
export function benjaminiHochberg(pValues) {
  const valid = pValues
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => Number.isFinite(p))
    .sort((a, b) => a.p - b.p);

  const m = valid.length;
  const q = pValues.map(() => NaN);
  let running = 1;
  for (let k = m - 1; k >= 0; k -= 1) {
    running = Math.min(running, (valid[k].p * m) / (k + 1));
    q[valid[k].i] = Math.min(1, running);
  }
  return q;
}
