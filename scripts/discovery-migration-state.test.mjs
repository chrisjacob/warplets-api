import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localMigrationsCurrent } from "./discovery-migration-state.mjs";

test("only a complete single local migration ledger takes the read-only fast path", () => {
  const root=mkdtempSync(path.join(os.tmpdir(),"tenx-migration-")),persist=path.join(root,"state"),directory=path.join(persist,"v3/d1/miniflare-D1DatabaseObject");
  try {
    mkdirSync(path.join(root,"migrations"));writeFileSync(path.join(root,"migrations/0001.sql"),"CREATE TABLE evidence(id TEXT);");
    assert.equal(localMigrationsCurrent(root,persist),false);
    mkdirSync(directory,{recursive:true});const file=path.join(directory,"a".repeat(64)+".sqlite"),db=new DatabaseSync(file);
    db.exec("CREATE TABLE d1_migrations(name TEXT); CREATE TABLE evidence(id TEXT); INSERT INTO evidence VALUES('preserved');");
    assert.equal(localMigrationsCurrent(root,persist),false);
    db.exec("INSERT INTO d1_migrations VALUES('0001.sql')");db.close();
    writeFileSync(path.join(directory,"metadata.sqlite"),"runtime metadata; not a D1 store");
    const before=readFileSync(file);assert.equal(localMigrationsCurrent(root,persist),true);assert.deepEqual(readFileSync(file),before);
    writeFileSync(path.join(root,"migrations/0002.sql"),"ALTER TABLE evidence ADD COLUMN hash TEXT;");
    assert.equal(localMigrationsCurrent(root,persist),false);
    const migrated=new DatabaseSync(file);migrated.exec("INSERT INTO d1_migrations VALUES('0002.sql')");migrated.close();
    assert.equal(localMigrationsCurrent(root,persist),true);
    writeFileSync(path.join(directory,"b".repeat(64)+".sqlite"),"unrelated");assert.equal(localMigrationsCurrent(root,persist),false);
  } finally {
    const cleanup=path.resolve(root),temporaryRoot=path.resolve(os.tmpdir());
    assert.ok(cleanup.startsWith(temporaryRoot+path.sep)&&path.basename(cleanup).startsWith("tenx-migration-"));
    rmSync(cleanup,{recursive:true,force:true});
  }
});
