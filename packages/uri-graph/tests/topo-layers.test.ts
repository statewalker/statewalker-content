import { describe, expect, it } from "vitest";
import { topoLayers } from "../src/index.js";

describe("topoLayers", () => {
  it("groups independent workers into the same layer", async () => {
    const layers = topoLayers([
      { name: "a", selects: "x://", emits: "y://" },
      { name: "b", selects: "p://", emits: "q://" },
    ]);
    expect(layers.length).toBe(1);
    expect(layers[0]?.map((w) => w.name).sort()).toEqual(["a", "b"]);
  });

  it("orders dependents after their producers", async () => {
    const layers = topoLayers([
      { name: "scanner", selects: "", emits: "file://" },
      { name: "extractor", selects: "file://", emits: "text://" },
      { name: "indexer", selects: "text://", emits: "db://" },
    ]);
    expect(layers.map((l) => l.map((w) => w.name))).toEqual([
      ["scanner"],
      ["extractor"],
      ["indexer"],
    ]);
  });

  it("places fan-in dependents in a layer after all upstreams", async () => {
    const layers = topoLayers([
      { name: "a", selects: "", emits: "alpha://" },
      { name: "b", selects: "", emits: "beta://" },
      { name: "join", selects: "alpha://", emits: "gamma://" },
    ]);
    expect(layers[0]?.map((w) => w.name).sort()).toEqual(["a", "b"]);
    expect(layers[1]?.map((w) => w.name)).toEqual(["join"]);
  });

  it("throws on cycles", async () => {
    expect(() =>
      topoLayers([
        { name: "a", selects: "x://", emits: "y://" },
        { name: "b", selects: "y://", emits: "x://" },
      ]),
    ).toThrow(/cycle/);
  });
});
