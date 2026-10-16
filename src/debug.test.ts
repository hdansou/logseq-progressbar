import { afterEach, describe, expect, it, vi } from "vitest";
import { debug, setDebug } from "./debug";

describe("debug", () => {
  afterEach(() => {
    setDebug(false);
    delete (globalThis as Record<string, unknown>).window;
    vi.restoreAllMocks();
  });

  it("is silent by default and logs once enabled", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    debug("quiet");
    expect(log).not.toHaveBeenCalled();
    setDebug(true);
    debug("loud", 1);
    expect(log).toHaveBeenCalledWith("[progress-bar]", "loud", 1);
  });

  it("honours the window flag for one-off troubleshooting", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    (globalThis as Record<string, unknown>).window = { __LOGSEQ_PROGRESSBAR_DEBUG__: true };
    debug("flag");
    expect(log).toHaveBeenCalledTimes(1);
  });
});
