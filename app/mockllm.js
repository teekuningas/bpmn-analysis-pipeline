// Deterministic stand-in for the LLM. Same input, same output, no network.
// Swap this file for a real client; nothing else changes.

const CONCEPTS = [
  {
    id: 'linnut',
    labels: ['Lintujen tarkkailu', 'Lintuhavainnot', 'Lintujen seuraaminen'],
    keywords: ['lintu', 'tiais', 'rastas', 'lokki', 'lokit', 'lokkeja', 'varpus', 'harak',
      'kurki', 'kurkien', 'kuikan', 'pääsky', 'tikan', 'tikka', 'närhi', 'punatulk',
      'västäräkki', 'töyhtöhyyppä', 'sorsia', 'vesilintu', 'kiuru', 'rantasipi', 'pulut'],
    reason: 'kertoja kuvaa lintujen havainnointia',
  },
  {
    id: 'linnunlaulu',
    labels: ['Lintujen laulu', 'Linnunlaulu', 'Lintujen äänet'],
    keywords: ['laulu', 'laula', 'huuto', 'huutaa', 'laulavan', 'lauluun'],
    reason: 'lintujen laulu tai ääntely mainitaan',
  },
  {
    id: 'hiljaisuus',
    labels: ['Hiljaisuus', 'Hiljaisuuden kokemus', 'Rauha ja hiljaisuus'],
    keywords: ['hiljaisuus', 'hiljaisuutta', 'hiljene', 'hiljaa', 'rauha', 'rauhalli', 'rauhassa'],
    reason: 'hiljaisuus ja rauha nousevat esiin',
  },
  {
    id: 'kaupunkiaanet',
    labels: ['Kaupungin äänimaisema', 'Liikenteen melu', 'Kaupungin äänet'],
    keywords: ['liikenne', 'liikenteen', 'melu', 'humina', 'humise', 'kolise', 'hälin',
      'juna', 'kuulutus', 'ilmastointi', 'kehätie', 'bussi', 'työmaa', 'raitiovaunu'],
    reason: 'rakennetun ympäristön äänet',
  },
  {
    id: 'kaupunki',
    labels: ['Kaupunkiympäristö', 'Rakennettu ympäristö'],
    keywords: ['kaupun', 'keskusta', 'kerrostalo', 'lähiö', 'katu', 'kadun', 'asema',
      'parvek', 'betoni', 'tori', 'parkkipaik'],
    reason: 'kokemus sijoittuu kaupunkiin',
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
    reason: 'kokemus liittyy muistoihin',
  },
  {
    id: 'rauhoittuminen',
    labels: ['Rauhoittuminen', 'Arjesta palautuminen'],
    keywords: ['rauhoitu', 'nautin', 'arvosta', 'viihdy', 'ilo', 'lohdulli', 'hyvää'],
    reason: 'kokemus kuvataan palauttavana',
  },
  {
    id: 'puisto',
    labels: ['Puistot ja viheralueet', 'Kaupungin viheralueet'],
    keywords: ['puisto'],
    reason: 'puistot mainitaan kokemuksen paikkana',
  },
  {
    id: 'metsa',
    labels: ['Metsässä liikkuminen', 'Metsä'],
    keywords: ['metsä', 'puiden', 'puissa', 'koivu', 'lehmuks', 'oksa', 'marjassa', 'sienessä'],
    reason: 'metsä on kokemuksen ympäristö',
  },
];

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

export function generateCodebook({ text, seed = 0, maxCodes = 6 }) {
  const rand = rng(`codebook:${seed}:${text.slice(0, 40)}`);
  const found = CONCEPTS
    .map((c) => ({ concept: c, n: hits(text, c) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  // Different seeds give slightly different answers, as a real model would.
  const kept = found.filter((x, i) => !(i === found.length - 1 && found.length > 3 && rand() < 0.4));

  const lines = kept.slice(0, maxCodes).map((x) => {
    const variant = x.concept.labels[Math.floor(rand() * x.concept.labels.length)];
    return `- ${variant}: ${x.concept.reason}.`;
  });
  return `Tekstistä nousee esiin seuraavat teemat:\n${lines.join('\n')}`;
}

export function structureCodes({ freeform }) {
  const codes = [];
  for (const line of freeform.split('\n')) {
    const m = line.match(/^-\s*(.+?):\s*(.+?)\.?$/);
    if (m) codes.push({ code: m[1].trim(), explanation: m[2].trim() });
  }
  return { codes };
}

export function embed({ text, dim = 64 }) {
  const s = ` ${text.toLowerCase().replace(/[^a-zåäö ]/g, '')} `;
  const v = new Array(dim).fill(0);
  for (let i = 0; i < s.length - 2; i++) v[hashString(s.slice(i, i + 3)) % dim] += 1;
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

export function judgeThemePresence({ theme, text, recId, seed = 0 }) {
  const concept = CONCEPTS.find((c) => c.labels.includes(theme))
    || CONCEPTS.find((c) => theme.toLowerCase().includes(c.id));
  if (!concept) return { theme_present: false, reason: 'teemaa ei tunnistettu' };

  let present = hits(text, concept) > 0;
  if (rng(`judge:${seed}:${recId}:${theme}`)() < 0.07) present = !present;

  return {
    theme_present: present,
    reason: present ? concept.reason : 'teema ei esiinny tekstissä',
  };
}

export function nameCluster({ labels }) {
  const counts = new Map();
  for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  return { code: sorted[0][0] };
}
