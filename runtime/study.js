// A study is a folder — study.json pointing at a process and its sources.
// Adding an analysis means adding a folder and a line in studies/index.json.

import { parseBpmn } from '../core/bpmn.js';
import { analyse } from '../core/types.js';

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

  return { study, xml, processes, processId, model: analyse(processes) };
}

export const settingsOf = (study, overrides = {}) => Object.fromEntries(
  study.settings.map(({ name, value }) => [name, overrides[name] ?? value]));
