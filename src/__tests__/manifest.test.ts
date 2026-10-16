import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

const semver = (v: string) => v.split(".").map(Number) as [number, number, number];

describe("plugin manifest", () => {
  const pkg = readJson("package.json");
  const manifest = pkg.logseq;

  it("declares an @logseq/libs range on the 0.3.x (`next`) line", () => {
    expect(pkg.dependencies?.["@logseq/libs"]).toMatch(/^(\^|~)?0\.3(\.\d+)?$/);
  });

  it("installs an SDK at or above minSDKVersion on the same minor", () => {
    const installed = readJson("node_modules/@logseq/libs/package.json").version;
    const [iMaj, iMin, iPatch] = semver(installed);
    const [mMaj, mMin, mPatch] = semver(manifest.minSDKVersion);
    expect([iMaj, iMin]).toEqual([mMaj, mMin]);
    expect(iPatch).toBeGreaterThanOrEqual(mPatch);
  });

  it("pins the SDK floor at 0.3.4 (matches src/__sdk_guard__.ts)", () => {
    expect(manifest.minSDKVersion).toBe("0.3.4");
  });

  it("keeps every host flag inside logseq{} — the host ignores top-level flags", () => {
    expect(manifest).toMatchObject({ web: true, effect: false, supportsDB: true, supportsDBOnly: true });
    for (const flag of ["web", "effect", "supportsDB", "supportsDBOnly", "minSDKVersion"]) {
      expect(pkg, `top-level ${flag}`).not.toHaveProperty(flag);
    }
  });

  it("names id, title, icon and main", () => {
    expect(manifest).toMatchObject({
      id: "logseq-progressbar",
      title: expect.any(String),
      icon: "./icon.svg",
      main: "dist/index.html",
    });
  });

  it("requires Node 24 (engines, .nvmrc) and pnpm", () => {
    expect(pkg.engines?.node).toBe(">=24");
    expect(readFileSync(resolve(root, ".nvmrc"), "utf8").trim()).toBe("24");
    expect(pkg.packageManager).toMatch(/^pnpm@/);
  });
});
