// One run: the engine, the operations and a provider wired together, with
// everything that happened kept where the app can look at it afterwards.

import { Engine } from '../core/engine.js';
import { getOperation, notesFor } from './operations.js';
import { settingsOf } from './study.js';

export class Run {
  constructor({ study, processes, processId, provider, settings, onEvent }) {
    Object.assign(this, { study, processes, processId, provider });
    this.settings = settingsOf(study, settings);
    this.onEvent = onEvent || (() => {});
    this.seen = new Map();
    this.calls = [];
    this.stopped = false;
    this.data = null;
    // Stopping between steps is not stopping when one step is minutes long, so
    // the run carries a signal the provider can be interrupted by.
    this.halt = new AbortController();
  }

  stop() {
    this.stopped = true;
    this.halt.abort();
  }

  /** What a box produced: what its loop collected, or what its last call gave. */
  valueOf(id) {
    const seen = this.seen.get(id);
    if (!seen) return undefined;
    return 'collected' in seen ? seen.collected : seen.gave;
  }

  notesOf(id) {
    const seen = this.seen.get(id);
    return seen?.gave === undefined ? [] : notesFor(seen.name, seen.took, seen.gave);
  }

  services() {
    const record = (id, patch) => this.seen.set(id, { ...this.seen.get(id), ...patch });

    return {
      cancelled: () => this.stopped,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

      call: async (name, params, element) => {
        const gave = await getOperation(name)(params, {
          element,
          study: this.study,
          provider: this.provider,
          settings: this.settings,
          signal: this.halt.signal,
          // A call is logged when it is sent and again when it settles, and it
          // is the same object both times — so it is kept once and the event is
          // what says something changed.
          log: (call) => {
            if (!this.calls.includes(call)) this.calls.push(call);
            this.onEvent({ type: 'call', element, call });
          },
        });
        record(element.id, { name, took: params, gave });
        return gave;
      },

      onEvent: async (event) => {
        // A loop's own value is what it collected, not what its last instance
        // left behind, so it is picked up here rather than in `call`.
        const ref = event.element?.loop?.outputRef;
        if (event.type === 'exit' && ref && event.data) {
          record(event.element.id, { collected: event.data[ref] });
        }
        await this.onEvent(event);
      },
    };
  }

  async start() {
    this.data = await new Engine(this.processes, this.services())
      .run(this.processId, { ...this.settings });
    return this.data;
  }
}
