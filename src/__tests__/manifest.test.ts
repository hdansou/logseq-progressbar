import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

function readJson(path: string): any {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

describe("plugin manifest", () => {
  const pkg = readJson("package.json");

  describe("@logseq/libs dependency", () => {
    it("declares a range that admits 0.3.2", () => {
      const range = pkg.dependencies?.["@logseq/libs"];
      expect(range, "package.json#dependencies['@logseq/libs'] missing").toBeTruthy();
      // npm caret on 0.3.x only admits <0.4.0; a range that starts with ^0.3
      // or ~0.3.2 / 0.3.2 all satisfy "admits 0.3.2 but not newer major".
      expect(range).toMatch(/^(\^|~)?0\.3(\.\d+)?$/);
    });

    it("resolves installed SDK to a 0.3.x patch ≥ minSDKVersion", () => {
      const installed = readJson("node_modules/@logseq/libs/package.json");
      const min = pkg.logseq?.minSDKVersion ?? "0.3.2";
      const [iMaj, iMin, iPatch] = installed.version.split(".").map(Number);
      const [mMaj, mMin, mPatch] = min.split(".").map(Number);
      expect(iMaj).toBe(mMaj);
      expect(iMin).toBe(mMin);
      expect(iPatch).toBeGreaterThanOrEqual(mPatch);
    });
  });

  describe("logseq block (DB graph signalling)", () => {
    const ls = pkg.logseq ?? {};

    it("declares supportsDB = true", () => {
      expect(ls.supportsDB).toBe(true);
    });

    it("declares supportsDBOnly = true", () => {
      expect(ls.supportsDBOnly).toBe(true);
    });

    it("declares minSDKVersion = 0.3.2", () => {
      expect(ls.minSDKVersion).toBe("0.3.2");
    });
  });
});
