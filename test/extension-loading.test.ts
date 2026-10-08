import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

test("Pi discovers the package and can reload its TypeScript extension", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-custom-claude-loader-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: join(directory, "agent"),
    settingsManager: SettingsManager.inMemory(),
    additionalExtensionPaths: [fileURLToPath(new URL("../", import.meta.url))],
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });

  for (let load = 0; load < 2; load++) {
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    assert.equal(result.extensions.length, 1);
  }
});
