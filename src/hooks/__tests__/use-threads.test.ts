import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock crypto.randomUUID and localStorage before importing the hook
const mockUUID = vi.fn(() => "test-uuid-1234");
Object.defineProperty(globalThis, "crypto", {
  value: { randomUUID: mockUUID },
  writable: true
});

const storageMap = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storageMap.set(key, value)),
    removeItem: vi.fn((key: string) => storageMap.delete(key)),
    clear: vi.fn(() => storageMap.clear())
  },
  writable: true
});

// Dynamic import after mocks are set up
const { useThreads } = await import("../use-threads");

describe("useThreads", () => {
  beforeEach(() => {
    storageMap.clear();
    mockUUID.mockReturnValue("test-uuid-1234");
  });

  it("initializes with default thread", () => {
    const { result } = renderHook(() => useThreads());
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].title).toBe("New thread");
    expect(result.current.threads[0].messages).toHaveLength(1);
    expect(result.current.threads[0].messages[0].role).toBe("assistant");
  });

  it("makeMessage creates a message with correct shape", () => {
    const { result } = renderHook(() => useThreads());
    const msg = result.current.makeMessage("user", "hello");
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("hello");
    expect(msg.id).toBe("test-uuid-1234");
  });

  it("makeMessage supports attachments", () => {
    const { result } = renderHook(() => useThreads());
    const attachments = [
      {
        absolutePath: "/foo/bar.ts",
        relativePath: "bar.ts",
        mediaType: "text/plain",
        previewDataUrl: "",
        isImage: false
      }
    ];
    const msg = result.current.makeMessage("user", "with files", attachments);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0].absolutePath).toBe("/foo/bar.ts");
  });

  it("deriveThreadTitle uses first user message", () => {
    const { result } = renderHook(() => useThreads());
    const messages = [
      { id: "1", role: "assistant" as const, content: "ready" },
      { id: "2", role: "user" as const, content: "Build me a dashboard" }
    ];
    expect(result.current.deriveThreadTitle(messages)).toBe("Build me a dashboard");
  });

  it("deriveThreadTitle truncates long messages", () => {
    const { result } = renderHook(() => useThreads());
    const long = "a".repeat(60);
    const messages = [{ id: "1", role: "user" as const, content: long }];
    const title = result.current.deriveThreadTitle(messages);
    expect(title.length).toBe(47); // 44 + "..."
    expect(title.endsWith("...")).toBe(true);
  });

  it("deriveThreadTitle returns fallback when no user messages", () => {
    const { result } = renderHook(() => useThreads());
    const messages = [{ id: "1", role: "assistant" as const, content: "hi" }];
    expect(result.current.deriveThreadTitle(messages)).toBe("New thread");
    expect(result.current.deriveThreadTitle(messages, "Custom")).toBe("Custom");
  });

  it("loads threads from localStorage", () => {
    const threads = [
      {
        id: "stored-1",
        title: "Stored thread",
        updatedAt: 1000,
        messages: [{ id: "m1", role: "user", content: "saved msg" }]
      }
    ];
    storageMap.set("claude-desktop-threads-v1", JSON.stringify(threads));

    const { result } = renderHook(() => useThreads());
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].id).toBe("stored-1");
    expect(result.current.threads[0].title).toBe("Stored thread");
  });

  it("persists threads to localStorage on change", () => {
    const { result } = renderHook(() => useThreads());

    act(() => {
      result.current.setThreads((prev) => [
        ...prev,
        {
          id: "new-thread",
          title: "Added",
          updatedAt: Date.now(),
          messages: [{ id: "m1", role: "user" as const, content: "test" }]
        }
      ]);
    });

    const stored = storageMap.get("claude-desktop-threads-v1");
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(2);
  });
});
