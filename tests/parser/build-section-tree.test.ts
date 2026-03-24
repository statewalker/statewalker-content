import { describe, expect, it } from "vitest";
import { buildBlockTree } from "../../src/parser/build-section-tree.js";
import { at } from "../helpers.js";

describe("buildBlockTree", () => {
  it("parses a single header with content", () => {
    const tree = buildBlockTree("# Title\n\nSome content here.");
    expect(tree.title).toBeUndefined();
    expect(tree.content).toBe("");
    expect(tree.children).toHaveLength(1);
    expect(at(tree.children, 0).title).toBe("Title");
    expect(at(tree.children, 0).content).toBe("Some content here.");
  });

  it("builds nested header hierarchy", () => {
    const md = [
      "# H1",
      "H1 content",
      "## H2",
      "H2 content",
      "### H3",
      "H3 content",
    ].join("\n");

    const tree = buildBlockTree(md);
    expect(tree.children).toHaveLength(1);

    const h1 = at(tree.children, 0);
    expect(h1.title).toBe("H1");
    expect(h1.content).toBe("H1 content");
    expect(h1.children).toHaveLength(1);

    const h2 = at(h1.children, 0);
    expect(h2.title).toBe("H2");
    expect(h2.content).toBe("H2 content");
    expect(h2.children).toHaveLength(1);

    const h3 = at(h2.children, 0);
    expect(h3.title).toBe("H3");
    expect(h3.content).toBe("H3 content");
    expect(h3.children).toHaveLength(0);
  });

  it("puts content before first header into root block", () => {
    const md = "Preamble text\n\n# First Header\nBody";
    const tree = buildBlockTree(md);
    expect(tree.content).toBe("Preamble text");
    expect(tree.children).toHaveLength(1);
    expect(at(tree.children, 0).title).toBe("First Header");
    expect(at(tree.children, 0).content).toBe("Body");
  });

  it("handles multiple same-level headers as siblings", () => {
    const md = "# A\nContent A\n# B\nContent B\n# C\nContent C";
    const tree = buildBlockTree(md);
    expect(tree.children).toHaveLength(3);
    expect(at(tree.children, 0).title).toBe("A");
    expect(at(tree.children, 1).title).toBe("B");
    expect(at(tree.children, 2).title).toBe("C");
  });

  it("handles empty blocks (header only, no content)", () => {
    const md = "# Empty\n## Also Empty";
    const tree = buildBlockTree(md);
    expect(tree.children).toHaveLength(1);
    const h1 = at(tree.children, 0);
    expect(h1.title).toBe("Empty");
    expect(h1.content).toBe("");
    expect(h1.children).toHaveLength(1);
    expect(at(h1.children, 0).title).toBe("Also Empty");
    expect(at(h1.children, 0).content).toBe("");
  });

  it("returns single root block when no headers", () => {
    const md = "Just some text\nwith multiple lines\nand no headers.";
    const tree = buildBlockTree(md);
    expect(tree.title).toBeUndefined();
    expect(tree.content).toBe(
      "Just some text\nwith multiple lines\nand no headers.",
    );
    expect(tree.children).toHaveLength(0);
  });

  it("handles h2 after h3 (ascending back up)", () => {
    const md = [
      "# Top",
      "## Sub",
      "### Deep",
      "Deep content",
      "## Another Sub",
      "Another content",
    ].join("\n");

    const tree = buildBlockTree(md);
    const top = at(tree.children, 0);
    expect(top.children).toHaveLength(2);
    expect(at(top.children, 0).title).toBe("Sub");
    expect(at(at(top.children, 0).children, 0).title).toBe("Deep");
    expect(at(top.children, 1).title).toBe("Another Sub");
    expect(at(top.children, 1).content).toBe("Another content");
  });

  it("handles empty markdown", () => {
    const tree = buildBlockTree("");
    expect(tree.title).toBeUndefined();
    expect(tree.content).toBe("");
    expect(tree.children).toHaveLength(0);
  });
});
