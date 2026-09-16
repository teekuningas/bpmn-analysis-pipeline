// A study is a folder — study.json pointing at a process and its sources.
// Adding an analysis means adding a folder and a line in studies/index.json.

import { parseBpmn } from '../core/bpmn.js';
import { analyse } from '../core/types.js';

/** A study names its own types. A name alone is a description; `is` says what
 *  shape a value of it has, and the only shape a study can declare so far is
 *  `text` — writing, with no schema over it. That is what lets a new study ask
 *  a model for something the vocabulary has never heard of without anyone
 *  editing a table in `runtime/`. No `is` means no model makes it: `note` and
 *  `account` come from a source, `row` from Combine, `finding` from Test. */
const asType = (declared) => (typeof declared === 'string'
  ? { about: declared }
  : { about: '', ...declared });

export async function loadStudy(id, read) {
  const study = JSON.parse(await read('study.json'));
  study.id ??= id;

  const xml = await read(study.process || 'process.bpmn');
  const processes = parseBpmn(xml);
  const processId = study.processId || [...processes.keys()][0];
  if (!processes.has(processId)) {
    throw new Error(`"${processId}" is not a process in ${study.process}`);
  }

  study.data = {};
  for (const [name, file] of Object.entries(study.sources || {})) {
    const rows = JSON.parse(await read(file));
    if (!Array.isArray(rows)) throw new Error(`source "${name}" is not a collection`);
    study.data[name] = rows;
  }

  study.scripted = study.scripted ? JSON.parse(await read(study.scripted)) : { lexicon: [] };
  study.settings ||= [];
  study.types = Object.fromEntries(
    Object.entries(study.types || {}).map(([name, declared]) => [name, asType(declared)]));

  return { study, xml, processes, processId, model: analyse(processes) };
}

/** Is this type one a model writes as prose? */
export const isText = (study, type) => study?.types?.[String(type)]?.is === 'text';

export const settingsOf = (study, overrides = {}) => Object.fromEntries(
  study.settings.map(({ name, value }) => [name, overrides[name] ?? value]));

/** What a knob should sit at for the way of answering that was picked.
 *
 *  A run on a model in the tab is minutes a call, so it should compute as
 *  little as the study allows; the stand-in costs nothing, so it should compute
 *  as much as it allows and show the whole analysis. That is the rule, and a
 *  study only writes `by` when it disagrees with it. */
export const defaultFor = (setting, way) => setting.by?.[way]
  ?? (way === 'scripted' ? setting.max : setting.min)
  ?? setting.value;

export const defaultsFor = (study, way) => Object.fromEntries(
  (study?.settings || []).map((one) => [one.name, defaultFor(one, way)]));
