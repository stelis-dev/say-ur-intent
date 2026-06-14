import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, SERVER_VERSION } from "../src/mcp/serverInfo.js";

type PackageJson = {
  private?: boolean;
  version: string;
  license?: string;
  publishConfig?: {
    access?: string;
    tag?: string;
  };
  files: string[];
  scripts: Record<string, string>;
};

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;

describe("npm release metadata", () => {
  it("is configured for public latest-tag publishing", () => {
    expect(packageJson.private).toBeUndefined();
    // Validate the semver shape, not an exact value — pinning the version drifts every release.
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(PACKAGE_NAME).toBe("@stelis/say-ur-intent");
    expect(SERVER_VERSION).toBe(packageJson.version);
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.publishConfig).toEqual({ access: "public", tag: "latest" });
    expect(packageJson.scripts.prepublishOnly).toBe("npm run release:check");
  });

  it("allowlists only product protocol notes", () => {
    expect(packageJson.files).toContain("protocols/deepbook-v3.md");
    expect(packageJson.files).toContain("protocols/deepbook-margin.md");
    expect(packageJson.files).not.toContain("protocols/");
  });
});
