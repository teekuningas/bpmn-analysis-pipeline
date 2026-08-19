// A deterministic stand-in for the LLM calls.
//
// In the real pipeline these functions are HTTP calls to a model (llama3.3 /
// mistral via Ollama, or an API). Here they are pure functions of (input, seed),
// so the demo gives the same answer every time and needs no network, no API key
// and no money.
//
// The point is NOT that this is a good LLM. The point is that the workflow above
// it does not know or care: `llm.generate_codebook` is a name in the task
// registry, and swapping this file for a real client changes nothing else.

// ---------------------------------------------------------------- concepts --
// A tiny keyword lexicon standing in for "what the model would notice".
// Each concept has several label variants, so different narratives produce
// slightly different wordings for the same idea -- which is exactly what gives
// the embedding + clustering step downstream something real to do.
const CONCEPTS = [
  {
    id: 'linnut',
    labels: ['Lintujen tarkkailu', 'Lintuhavainnot', 'Lintujen seuraaminen'],
    keywords: ['lintu', 'tiais', 'rastas', 'lokki', 'lokit', 'lokkeja', 'varpus', 'harak',
      'kurki', 'kurkien', 'kuikan', 'pääsky', 'tikan', 'tikka', 'närhi', 'punatulk',
      'västäräkki', 'töyhtöhyyppä', 'sorsia', 'vesilintu', 'kiuru', 'rantasipi', 'pulut'],
    reason: 'kertoja kuvaa lintujen havainnointia ja tunnistamista',
  },
  {
    id: 'linnunlaulu',
    labels: ['Lintujen laulu', 'Linnunlaulu', 'Lintujen äänet'],
    keywords: ['laulu', 'laula', 'huuto', 'huutaa', 'laulavan', 'lauluun'],
    reason: 'tekstissä mainitaan lintujen laulu tai ääntely',
  },
  {
    id: 'hiljaisuus',
    labels: ['Hiljaisuus', 'Hiljaisuuden kokemus', 'Rauha ja hiljaisuus'],
    keywords: ['hiljaisuus', 'hiljaisuutta', 'hiljene', 'hiljaa', 'rauha', 'rauhalli', 'rauhassa'],
    reason: 'hiljaisuus ja rauha nousevat esiin kokemuksen kuvauksessa',
  },
  {
    id: 'kaupunkiaanet',
    labels: ['Kaupungin äänimaisema', 'Liikenteen melu', 'Kaupungin äänet'],
    keywords: ['liikenne', 'liikenteen', 'melu', 'humina', 'humise', 'kolise', 'hälin',
      'juna', 'kuulutus', 'ilmastointi', 'kehätie', 'bussi', 'työmaa', 'raitiovaunu'],
    reason: 'kertoja kuvaa rakennetun ympäristön ääniä',
  },
  {
    id: 'kaupunki',
    labels: ['Kaupunkiympäristö', 'Rakennettu ympäristö'],
    keywords: ['kaupun', 'keskusta', 'kerrostalo', 'lähiö', 'katu', 'kadun', 'asema',
      'parvek', 'betoni', 'tori', 'parkkipaik'],
    reason: 'kokemus sijoittuu kaupunkiympäristöön',
  },
  {
    id: 'maaseutu',
    labels: ['Maaseutuympäristö', 'Maalla asuminen'],
    keywords: ['maalla', 'maaseu', 'pelto', 'traktori', 'maatila', 'kylä', 'mökki', 'navetta'],
    reason: 'kokemus sijoittuu maaseudulle',
  },
  {
    id: 'luontoyhteys',
    labels: ['Luontoyhteys', 'Yhteys luontoon', 'Luonnon läheisyys'],
    keywords: ['luonto', 'luonn'],
    reason: 'kertoja kuvaa suhdettaan luontoon',
  },
  {
    id: 'vuodenajat',
    labels: ['Vuodenaikojen vaihtelu', 'Kevään merkit'],
    keywords: ['kevä', 'talvi', 'talvella', 'kesä', 'syksy', 'lumi', 'vuosi', 'vuodelle'],
    reason: 'vuodenaikojen vaihtelu jäsentää kokemusta',
  },
  {
    id: 'muistot',
    labels: ['Muistot ja jatkuvuus', 'Lapsuuden muistot'],
    keywords: ['muist', 'lapsuu'],
    reason: 'kertoja liittää kokemuksen muistoihin',
  },
  {
    id: 'rauhoittuminen',
    labels: ['Rauhoittuminen', 'Arjesta palautuminen'],
    keywords: ['rauhoitu', 'nautin', 'arvosta', 'viihdy', 'ilo', 'lohdulli', 'hyvää'],
    reason: 'luontokokemus kuvataan palauttavana ja hyvinvointia tuottavana',
  },
  {
    id: 'puisto',
    labels: ['Puistot ja viheralueet', 'Kaupungin viheralueet'],
    keywords: ['puisto'],
    reason: 'puistot mainitaan luontokokemuksen paikkana',
  },
  {
    id: 'metsa',
    labels: ['Metsässä liikkuminen', 'Metsä'],
    keywords: ['metsä', 'puiden', 'puissa', 'koivu', 'lehmuks', 'oksa', 'marjassa', 'sienessä'],
    reason: 'metsä on keskeinen kokemuksen ympäristö',
  },
];

// ------------------------------------------------------------------- utils --
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
function rng(seedStr) {
  let a = hashString(String(seedStr));
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hits(text, concept) {
  const lower = text.toLowerCase();
  return concept.keywords.filter((k) => lower.includes(k)).length;
}

// ------------------------------------------------------------------ the API --

/**
 * Stands in for: "read this narrative and write a codebook, freely".
 * Returns prose, exactly like a real model would -- the structuring happens in
 * a second call, mirroring the two-step trick in the original notebooks.
 */
export function generateCodebook({ text, seed = 0, maxCodes = 6 }) {
  const rand = rng(`codebook:${seed}:${text.slice(0, 40)}`);
  const found = CONCEPTS
    .map((c) => ({ concept: c, n: hits(text, c) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  // A real model is not perfectly consistent between runs: with some seeds it
  // drops the weakest observation. That variance is why the original pipeline
  // runs several iterations and clusters the results.
  const kept = found.filter((x, i) => !(i === found.length - 1 && found.length > 3 && rand() < 0.4));

  const lines = kept.slice(0, maxCodes).map((x) => {
    const variant = x.concept.labels[Math.floor(rand() * x.concept.labels.length)];
    return `- ${variant}: ${x.concept.reason}.`;
  });

  return `Tekstistä nousee esiin seuraavat teemat:\n${lines.join('\n')}`;
}

/**
 * Stands in for: "reformat that prose into the requested JSON schema".
 * A formatting model, not a reasoning one.
 */
export function structureCodes({ freeform }) {
  const codes = [];
  for (const line of freeform.split('\n')) {
    const m = line.match(/^-\s*(.+?):\s*(.+?)\.?$/);
    if (m) codes.push({ code: m[1].trim(), explanation: m[2].trim() });
  }
  return { codes };
}

/**
 * Stands in for an embedding model. Hashed character trigrams, L2-normalised.
 * Crude, but it has the property that matters here: near-synonymous labels
 * ("Lintujen laulu" / "Linnunlaulu") land close together in cosine distance.
 */
export function embed({ text, dim = 64 }) {
  const s = ` ${text.toLowerCase().replace(/[^a-zåäö ]/g, '')} `;
  const v = new Array(dim).fill(0);
  for (let i = 0; i < s.length - 2; i++) {
    const tri = s.slice(i, i + 3);
    v[hashString(tri) % dim] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * Stands in for: "does this theme appear in this text? answer true/false with a
 * short justification" -- the 98 x 710 grid of calls in the real pipeline.
 */
export function judgeThemePresence({ theme, text, recId, seed = 0 }) {
  const concept = CONCEPTS.find((c) => c.labels.includes(theme))
    || CONCEPTS.find((c) => theme.toLowerCase().includes(c.id));
  if (!concept) return { theme_present: false, reason: 'teemaa ei tunnistettu' };

  const n = hits(text, concept);
  let present = n > 0;

  // Real models are not perfectly consistent. A small deterministic error rate
  // keeps the resulting matrix from being suspiciously clean.
  const rand = rng(`judge:${seed}:${recId}:${theme}`);
  if (rand() < 0.07) present = !present;

  return {
    theme_present: present,
    reason: present ? concept.reason : 'teema ei esiinny tekstissä',
  };
}

/** Stands in for: "pick the best representative label for this cluster". */
export function nameCluster({ labels }) {
  const counts = new Map();
  for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  return { code: sorted[0][0] };
}

export const _internals = { CONCEPTS, rng, hashString };
