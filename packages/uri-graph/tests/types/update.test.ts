import { describe, expectTypeOf, it } from "vitest";
import type { ReadOnlyView, Status, Update } from "../../src/types/update.js";

describe("Update", () => {
  it("requires uri, stamp, status", () => {
    expectTypeOf<Update>().toHaveProperty("uri").toEqualTypeOf<string>();
    expectTypeOf<Update>().toHaveProperty("stamp").toEqualTypeOf<number>();
    expectTypeOf<Update>().toHaveProperty("status").toEqualTypeOf<Status>();
  });

  it("Status is the three-value union", () => {
    expectTypeOf<Status>().toEqualTypeOf<"added" | "updated" | "removed">();
  });

  it("hash, scope, role, attributes are optional", () => {
    const minimal: Update = { uri: "u", stamp: 1, status: "added" };
    expectTypeOf(minimal).toMatchTypeOf<Update>();
    const full: Update = {
      uri: "u",
      stamp: 1,
      status: "updated",
      hash: "h",
      scope: "s",
      role: "r",
      attributes: { k: 1 },
    };
    expectTypeOf(full).toMatchTypeOf<Update>();
  });
});

describe("ReadOnlyView", () => {
  it("has uri, stamp, status, optional hash and attributes", () => {
    const view: ReadOnlyView = { uri: "u", stamp: 1, status: "added" };
    expectTypeOf(view).toMatchTypeOf<ReadOnlyView>();
    const view2: ReadOnlyView = {
      uri: "u",
      stamp: 1,
      status: "removed",
      hash: "h",
      attributes: { x: true },
    };
    expectTypeOf(view2).toMatchTypeOf<ReadOnlyView>();
  });

  it("does not carry scope or role", () => {
    type ROVKeys = keyof ReadOnlyView;
    expectTypeOf<"scope" extends ROVKeys ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<"role" extends ROVKeys ? true : false>().toEqualTypeOf<false>();
  });
});
