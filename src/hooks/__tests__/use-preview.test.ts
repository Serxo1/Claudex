import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePreview } from "../use-preview";

describe("usePreview", () => {
  it("initializes with default URL", () => {
    const { result } = renderHook(() => usePreview());
    expect(result.current.previewUrl).toBe("http://localhost:5173");
    expect(result.current.previewHistory).toEqual(["http://localhost:5173"]);
    expect(result.current.previewHistoryIndex).toBe(0);
    expect(result.current.previewKey).toBe(0);
  });

  it("navigates to a new URL", () => {
    const { result } = renderHook(() => usePreview());

    act(() => {
      result.current.onPreviewNavigate("http://localhost:3000");
    });

    expect(result.current.previewUrl).toBe("http://localhost:3000");
    expect(result.current.previewHistory).toHaveLength(2);
    expect(result.current.previewHistoryIndex).toBe(1);
  });

  it("adds http:// when missing protocol", () => {
    const { result } = renderHook(() => usePreview());

    act(() => {
      result.current.onPreviewNavigate("example.com");
    });

    expect(result.current.previewUrl).toBe("http://example.com");
  });

  it("ignores empty URL", () => {
    const { result } = renderHook(() => usePreview());

    act(() => {
      result.current.onPreviewNavigate("");
    });

    expect(result.current.previewUrl).toBe("http://localhost:5173");
    expect(result.current.previewHistory).toHaveLength(1);
  });

  it("goes back in history", () => {
    const { result } = renderHook(() => usePreview());

    act(() => {
      result.current.onPreviewNavigate("http://second.com");
    });

    act(() => {
      result.current.onPreviewBack();
    });

    expect(result.current.previewUrl).toBe("http://localhost:5173");
    expect(result.current.previewHistoryIndex).toBe(0);
  });

  it("does not go back past beginning", () => {
    const { result } = renderHook(() => usePreview());

    act(() => {
      result.current.onPreviewBack();
    });

    expect(result.current.previewHistoryIndex).toBe(0);
    expect(result.current.previewUrl).toBe("http://localhost:5173");
  });

  it("goes forward in history", () => {
    const { result } = renderHook(() => usePreview());

    act(() => {
      result.current.onPreviewNavigate("http://second.com");
    });

    act(() => {
      result.current.onPreviewBack();
    });

    act(() => {
      result.current.onPreviewForward();
    });

    expect(result.current.previewUrl).toBe("http://second.com");
    expect(result.current.previewHistoryIndex).toBe(1);
  });

  it("does not go forward past end", () => {
    const { result } = renderHook(() => usePreview());

    act(() => {
      result.current.onPreviewForward();
    });

    expect(result.current.previewHistoryIndex).toBe(0);
  });

  it("reload increments previewKey", () => {
    const { result } = renderHook(() => usePreview());

    act(() => {
      result.current.onPreviewReload();
    });

    expect(result.current.previewKey).toBe(1);

    act(() => {
      result.current.onPreviewReload();
    });

    expect(result.current.previewKey).toBe(2);
  });
});
