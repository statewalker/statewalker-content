import type { Worker } from "./types.js";

export function topoLayers(workers: Worker[]): Worker[][] {
  const upstreamsOf = new Map<string, Set<string>>();
  for (const w of workers) {
    const upstreams = new Set<string>();
    if (w.selects !== "") {
      for (const u of workers) {
        if (u.name === w.name) continue;
        if (u.emits === "") continue;
        if (u.emits.startsWith(w.selects) || w.selects.startsWith(u.emits)) {
          upstreams.add(u.name);
        }
      }
    }
    upstreamsOf.set(w.name, upstreams);
  }

  const layers: Worker[][] = [];
  const placed = new Set<string>();
  while (placed.size < workers.length) {
    const layer: Worker[] = [];
    for (const w of workers) {
      if (placed.has(w.name)) continue;
      const upstreams = upstreamsOf.get(w.name);
      if (!upstreams) continue;
      let ready = true;
      for (const u of upstreams) {
        if (!placed.has(u)) {
          ready = false;
          break;
        }
      }
      if (ready) layer.push(w);
    }
    if (layer.length === 0) {
      const remaining = workers.filter((w) => !placed.has(w.name)).map((w) => w.name);
      throw new Error(`cycle detected among workers: ${remaining.join(", ")}`);
    }
    layer.sort((a, b) => a.name.localeCompare(b.name));
    for (const w of layer) placed.add(w.name);
    layers.push(layer);
  }
  return layers;
}
