import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const workspace = require("../modules/workspace.cjs");

const { shouldSkipTreeEntry, extensionForMediaType, sanitizeFileName, normalizeContextFiles } = workspace;

describe("shouldSkipTreeEntry", () => {
  it("skips known directories", () => {
    expect(shouldSkipTreeEntry(".git")).toBe(true);
    expect(shouldSkipTreeEntry("node_modules")).toBe(true);
    expect(shouldSkipTreeEntry(".DS_Store")).toBe(true);
    expect(shouldSkipTreeEntry("dist")).toBe(true);
    expect(shouldSkipTreeEntry("build")).toBe(true);
    expect(shouldSkipTreeEntry("out")).toBe(true);
  });

  it("does not skip other entries", () => {
    expect(shouldSkipTreeEntry("src")).toBe(false);
    expect(shouldSkipTreeEntry("package.json")).toBe(false);
    expect(shouldSkipTreeEntry("README.md")).toBe(false);
  });
});

describe("extensionForMediaType", () => {
  it("maps image types correctly", () => {
    expect(extensionForMediaType("image/png")).toBe(".png");
    expect(extensionForMediaType("image/jpeg")).toBe(".jpg");
    expect(extensionForMediaType("image/webp")).toBe(".webp");
    expect(extensionForMediaType("image/gif")).toBe(".gif");
    expect(extensionForMediaType("image/bmp")).toBe(".bmp");
  });

  it("returns .bin for unknown types", () => {
    expect(extensionForMediaType("application/json")).toBe(".bin");
    expect(extensionForMediaType("")).toBe(".bin");
    expect(extensionForMediaType(undefined)).toBe(".bin");
  });

  it("is case-insensitive", () => {
    expect(extensionForMediaType("IMAGE/PNG")).toBe(".png");
    expect(extensionForMediaType("Image/Jpeg")).toBe(".jpg");
  });
});

describe("sanitizeFileName", () => {
  it("replaces special characters", () => {
    expect(sanitizeFileName("my file (1).png")).toBe("my_file__1_.png");
  });

  it("returns default for empty input", () => {
    expect(sanitizeFileName("")).toBe("pasted-image");
    expect(sanitizeFileName("   ")).toBe("pasted-image");
    expect(sanitizeFileName(null as unknown as string)).toBe("pasted-image");
  });

  it("truncates to 80 chars", () => {
    const long = "a".repeat(100);
    expect(sanitizeFileName(long).length).toBe(80);
  });

  it("keeps allowed characters", () => {
    expect(sanitizeFileName("valid-name_123.png")).toBe("valid-name_123.png");
  });
});

describe("normalizeContextFiles", () => {
  it("normalizes valid context files", () => {
    const input = [
      {
        absolutePath: "/foo/bar.ts",
        relativePath: "bar.ts",
        mediaType: "text/plain",
        previewDataUrl: "",
        isImage: false
      }
    ];
    const result = normalizeContextFiles(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      absolutePath: "/foo/bar.ts",
      relativePath: "bar.ts",
      mediaType: "text/plain",
      previewDataUrl: "",
      isImage: false
    });
  });

  it("returns empty array for non-array input", () => {
    expect(normalizeContextFiles(null)).toEqual([]);
    expect(normalizeContextFiles(undefined)).toEqual([]);
    expect(normalizeContextFiles("string")).toEqual([]);
  });

  it("filters out items without absolutePath", () => {
    const input = [
      { absolutePath: "", relativePath: "bar.ts" },
      { absolutePath: "/valid", relativePath: "valid" }
    ];
    const result = normalizeContextFiles(input);
    expect(result).toHaveLength(1);
    expect(result[0].absolutePath).toBe("/valid");
  });

  it("filters out non-objects", () => {
    const input = [null, undefined, "string", 123, { absolutePath: "/ok", relativePath: "ok" }];
    const result = normalizeContextFiles(input);
    expect(result).toHaveLength(1);
  });

  it("trims string fields", () => {
    const input = [
      {
        absolutePath: "  /foo  ",
        relativePath: "  foo  ",
        mediaType: "  text/plain  ",
        previewDataUrl: "  data:x  ",
        isImage: 1
      }
    ];
    const result = normalizeContextFiles(input);
    expect(result[0].absolutePath).toBe("/foo");
    expect(result[0].relativePath).toBe("foo");
    expect(result[0].mediaType).toBe("text/plain");
    expect(result[0].previewDataUrl).toBe("data:x");
    expect(result[0].isImage).toBe(true);
  });
});
