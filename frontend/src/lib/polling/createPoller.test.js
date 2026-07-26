import createPoller, { formatElapsedLabel } from "./createPoller";

// Flush the microtask queue so an async task settles before timers advance.
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("createPoller", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("polls until the task reports done", async () => {
    const task = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const poller = createPoller({ task, intervalMs: 1000 });
    poller.start();

    jest.advanceTimersByTime(1000);
    await flush();
    jest.advanceTimersByTime(1000);
    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    expect(task).toHaveBeenCalledTimes(3);
    expect(poller.isActive()).toBe(false);
    jest.advanceTimersByTime(5000);
    await flush();
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("runs immediately when immediate is true", async () => {
    const task = jest.fn().mockResolvedValue(true);
    const poller = createPoller({ task, intervalMs: 1000, immediate: true });
    poller.start();
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("stops with reason attempts after maxAttempts", async () => {
    const task = jest.fn().mockResolvedValue(false);
    const onExhausted = jest.fn();
    const poller = createPoller({ task, intervalMs: 1000, maxAttempts: 3, onExhausted });
    poller.start();

    for (let i = 0; i < 5; i += 1) {
      jest.advanceTimersByTime(1000);
      await flush();
    }

    expect(task).toHaveBeenCalledTimes(3);
    expect(onExhausted).toHaveBeenCalledWith("attempts", null);
    expect(poller.isActive()).toBe(false);
  });

  it("stops with reason errors after maxConsecutiveErrors", async () => {
    const failure = new Error("boom");
    const task = jest.fn().mockRejectedValue(failure);
    const onExhausted = jest.fn();
    const poller = createPoller({
      task,
      intervalMs: 1000,
      maxConsecutiveErrors: 2,
      onExhausted,
    });
    poller.start();

    jest.advanceTimersByTime(1000);
    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    expect(task).toHaveBeenCalledTimes(2);
    expect(onExhausted).toHaveBeenCalledWith("errors", failure);
  });

  it("resets the consecutive error count on a successful run", async () => {
    const task = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(true);
    const onExhausted = jest.fn();
    const poller = createPoller({
      task,
      intervalMs: 1000,
      maxConsecutiveErrors: 2,
      onExhausted,
    });
    poller.start();

    for (let i = 0; i < 4; i += 1) {
      jest.advanceTimersByTime(1000);
      await flush();
    }

    expect(task).toHaveBeenCalledTimes(4);
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("stop() cancels a pending tick", async () => {
    const task = jest.fn().mockResolvedValue(false);
    const poller = createPoller({ task, intervalMs: 1000 });
    poller.start();
    poller.stop();

    jest.advanceTimersByTime(5000);
    await flush();

    expect(task).not.toHaveBeenCalled();
    expect(poller.isActive()).toBe(false);
  });

  it("tracks elapsed time from start", () => {
    const poller = createPoller({ task: jest.fn().mockResolvedValue(false), intervalMs: 1000 });
    expect(poller.getElapsedMs()).toBe(0);
    poller.start();
    jest.advanceTimersByTime(4500);
    expect(poller.getElapsedMs()).toBeGreaterThanOrEqual(4500);
  });
});

describe("formatElapsedLabel", () => {
  it("formats seconds and minutes", () => {
    expect(formatElapsedLabel(0)).toBe("0s");
    expect(formatElapsedLabel(38000)).toBe("38s");
    expect(formatElapsedLabel(125000)).toBe("2m 05s");
  });
});
