import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const git = require("../modules/git.cjs");

const { parseNumStat, mapGitStatus, parseGitCommitFiles } = git;

describe("parseNumStat", () => {
  it("parses additions and deletions", () => {
    const output = "10\t5\tfile.ts\n3\t1\tother.ts";
    expect(parseNumStat(output)).toEqual({ additions: 13, deletions: 6 });
  });

  it("handles empty output", () => {
    expect(parseNumStat("")).toEqual({ additions: 0, deletions: 0 });
  });

  it("handles binary files (- values)", () => {
    const output = "-\t-\timage.png\n2\t1\tfile.ts";
    expect(parseNumStat(output)).toEqual({ additions: 2, deletions: 1 });
  });

  it("handles whitespace-only input", () => {
    expect(parseNumStat("   \n   ")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("mapGitStatus", () => {
  it("maps A to added", () => {
    expect(mapGitStatus("A")).toBe("added");
  });

  it("maps D to deleted", () => {
    expect(mapGitStatus("D")).toBe("deleted");
  });

  it("maps R to renamed", () => {
    expect(mapGitStatus("R")).toBe("renamed");
  });

  it("maps M and others to modified", () => {
    expect(mapGitStatus("M")).toBe("modified");
    expect(mapGitStatus("C")).toBe("modified");
    expect(mapGitStatus("")).toBe("modified");
  });

  it("handles lowercase", () => {
    expect(mapGitStatus("a")).toBe("added");
    expect(mapGitStatus("d")).toBe("deleted");
  });
});

describe("parseGitCommitFiles", () => {
  it("parses name-status lines", () => {
    const raw = "A\tnew-file.ts\nM\tchanged-file.ts";
    const result = parseGitCommitFiles(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ path: "new-file.ts", status: "added" });
    expect(result[1]).toMatchObject({ path: "changed-file.ts", status: "modified" });
  });

  it("parses numstat lines", () => {
    const raw = "10\t5\tfile.ts";
    const result = parseGitCommitFiles(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: "file.ts",
      additions: 10,
      deletions: 5
    });
  });

  it("merges name-status and numstat for same file", () => {
    const raw = "A\tfile.ts\n10\t5\tfile.ts";
    const result = parseGitCommitFiles(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: "file.ts",
      status: "added",
      additions: 10,
      deletions: 5
    });
  });

  it("handles empty input", () => {
    expect(parseGitCommitFiles("")).toEqual([]);
  });

  it("handles renamed files", () => {
    const raw = "R100\told.ts\tnew.ts";
    const result = parseGitCommitFiles(raw);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("renamed");
    expect(result[0].path).toBe("new.ts");
  });
});
