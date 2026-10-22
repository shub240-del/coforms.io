export function createDebouncedSave<T>(
  save: (value: T) => void | Promise<unknown>,
  onError: (error: unknown) => void,
  delayMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingValue: T | undefined;
  let queuedSaves = 0;
  let saveQueue: Promise<void> = Promise.resolve();

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pendingValue === undefined) return;

    const value = pendingValue;
    pendingValue = undefined;
    queuedSaves += 1;
    saveQueue = saveQueue
      .then(() => save(value))
      .then(() => undefined)
      .catch(onError)
      .finally(() => { queuedSaves -= 1; });
  }

  return {
    schedule(value: T) {
      pendingValue = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
    isPending: () => timer !== undefined || pendingValue !== undefined || queuedSaves > 0,
    whenIdle: () => saveQueue,
  };
}
