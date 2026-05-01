import type { ResourceProcessor } from "./types.js";

export function topoLayers(processors: ResourceProcessor[]): ResourceProcessor[][] {
  const upstreamsOf = new Map<string, Set<string>>();
  for (const p of processors) {
    const upstreams = new Set<string>();
    if (p.selects !== "") {
      for (const u of processors) {
        if (u.name === p.name) continue;
        if (u.emits === "") continue;
        if (u.emits.startsWith(p.selects) || p.selects.startsWith(u.emits)) {
          upstreams.add(u.name);
        }
      }
    }
    upstreamsOf.set(p.name, upstreams);
  }

  const layers: ResourceProcessor[][] = [];
  const placed = new Set<string>();
  while (placed.size < processors.length) {
    const layer: ResourceProcessor[] = [];
    for (const p of processors) {
      if (placed.has(p.name)) continue;
      const upstreams = upstreamsOf.get(p.name);
      if (!upstreams) continue;
      let ready = true;
      for (const u of upstreams) {
        if (!placed.has(u)) {
          ready = false;
          break;
        }
      }
      if (ready) layer.push(p);
    }
    if (layer.length === 0) {
      const remaining = processors.filter((p) => !placed.has(p.name)).map((p) => p.name);
      throw new Error(`cycle detected among processors: ${remaining.join(", ")}`);
    }
    layer.sort((a, b) => a.name.localeCompare(b.name));
    for (const p of layer) placed.add(p.name);
    layers.push(layer);
  }
  return layers;
}
