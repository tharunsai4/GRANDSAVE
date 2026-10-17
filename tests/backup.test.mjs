import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import { exampleState, projectRoot } from "./fixture.mjs";

// Compile the same pure TypeScript modules used by the browser and API without
// adding a runtime dependency or changing the application's import paths.
async function loadPureModule(relativePath, dependencies = {}) {
  const source = await readFile(join(projectRoot, relativePath), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relativePath,
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency in pure test module: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

const validation = await loadPureModule("lib/desk-state-validation.ts");
const { parseBackup } = await loadPureModule("lib/backup.ts", { "./desk-state-validation": validation });

describe("Backup import", () => {
  it("preserves every record type from the export envelope and the original raw-state format", () => {
    const state = exampleState("Imported product £10");
    assert.deepEqual(parseBackup(JSON.stringify({ exportedAt: "2026-10-17T10:00:00.000Z", state })), state);
    assert.deepEqual(parseBackup(JSON.stringify(state)), state);
  });

  it("rejects invalid JSON and incomplete or invalid desk records", () => {
    assert.throws(() => parseBackup("{invalid"), /valid GrandSave JSON backup/);
    assert.throws(() => parseBackup(JSON.stringify({ state: { products: [] } })), /valid GrandSave order desk backup/);
    const state = exampleState();
    state.orders[0].items[0].quantity = 0.5;
    assert.throws(() => parseBackup(JSON.stringify({ state })), /valid GrandSave order desk backup/);
  });

  it("measures the import limit in bytes, including non-ASCII text", () => {
    const state = exampleState();
    state.settings.businessName = "£".repeat(510000);
    const text = JSON.stringify({ state });
    assert.ok(text.length < 1_000_000);
    assert.ok(Buffer.byteLength(text, "utf8") > 1_000_000);
    assert.throws(() => parseBackup(text), /saved-data limit of 1 MB/);
  });

  it("accepts a formatted exported backup larger than the compact save limit", () => {
    const state = exampleState();
    state.products = Array.from({ length: 3600 }, (_, index) => ({
      ...state.products[0], id: `product-${index}`, name: "Test product", code: `TEST-${index}`,
    }));
    const text = JSON.stringify({ exportedAt: "2026-10-17T10:00:00.000Z", state }, null, 2);
    assert.ok(Buffer.byteLength(text) > 1_000_000);
    assert.ok(Buffer.byteLength(JSON.stringify({ state, version: 2147483647 })) < 1_000_000);
    assert.deepEqual(parseBackup(text), state);
  });

  it("rejects oversized input files before parsing", () => {
    assert.throws(() => parseBackup(" ".repeat(5_000_001)), /smaller than 5 MB/);
  });
});
