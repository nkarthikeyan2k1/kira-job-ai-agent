import { describe, expect, it } from "vitest";
import { MigrationError, parseMigrationFilename, planMigrations, type MigrationFile } from "./migrate-plan.ts";

function file(version: number, checksum = `sum-${version}`): MigrationFile {
  return { version, name: `m${version}`, checksum, sql: "select 1" };
}
const applied = (version: number, checksum = `sum-${version}`) => ({ version, name: `m${version}`, checksum });

describe("parseMigrationFilename", () => {
  it("parses NNNN_name.sql", () => {
    expect(parseMigrationFilename("0001_init.sql")).toEqual({ version: 1, name: "init" });
    expect(parseMigrationFilename("0012_add_repost_links.sql")).toEqual({ version: 12, name: "add_repost_links" });
  });

  it("rejects names outside the convention", () => {
    for (const name of ["1_init.sql", "0001-init.sql", "0001_Init.sql", "0001_init.txt", "README.md"]) {
      expect(parseMigrationFilename(name)).toBeNull();
    }
  });
});

describe("planMigrations", () => {
  it("returns every file, in order, on an empty database", () => {
    const pending = planMigrations([file(2), file(1), file(3)], []);
    expect(pending.map((f) => f.version)).toEqual([1, 2, 3]);
  });

  it("returns only the files not applied yet", () => {
    const pending = planMigrations([file(1), file(2), file(3)], [applied(1), applied(2)]);
    expect(pending.map((f) => f.version)).toEqual([3]);
  });

  it("returns nothing when the database is up to date", () => {
    expect(planMigrations([file(1), file(2)], [applied(1), applied(2)])).toEqual([]);
  });

  it("rejects an applied migration whose file was edited", () => {
    expect(() => planMigrations([file(1, "changed")], [applied(1)])).toThrow(/edited after it was applied/);
  });

  it("rejects an applied migration whose file is gone", () => {
    expect(() => planMigrations([file(1)], [applied(1), applied(2)])).toThrow(/file is missing/);
  });

  it("rejects gaps and duplicates in file versions", () => {
    expect(() => planMigrations([file(1), file(3)], [])).toThrow(MigrationError);
    expect(() => planMigrations([file(1), file(1)], [])).toThrow(MigrationError);
    expect(() => planMigrations([file(2)], [])).toThrow(MigrationError);
  });

  it("rejects a pending migration older than an applied one", () => {
    expect(() => planMigrations([file(1), file(2), file(3)], [applied(1), applied(3)])).toThrow(/later one is already applied/);
  });
});
