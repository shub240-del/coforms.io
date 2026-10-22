import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedSave } from "./debouncedSave";

afterEach(() => vi.useRealTimers());

describe("debounced form saves", () => {
  it("coalesces edits and flushes the latest value immediately", async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const onError = vi.fn();
    const scheduler = createDebouncedSave(save, onError, 650);

    scheduler.schedule("first");
    scheduler.schedule("latest");
    expect(scheduler.isPending()).toBe(true);
    scheduler.flush();
    await scheduler.whenIdle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("latest");
    expect(scheduler.isPending()).toBe(false);
  });

  it("waits for an in-flight save before saving a newer edit", async () => {
    vi.useFakeTimers();
    let resolveFirst!: () => void;
    const save = vi.fn()
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValue(undefined);
    const scheduler = createDebouncedSave(save, vi.fn(), 650);

    scheduler.schedule("first");
    scheduler.flush();
    await Promise.resolve();
    scheduler.schedule("second");
    scheduler.flush();
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst();
    await scheduler.whenIdle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("second");
  });
});
