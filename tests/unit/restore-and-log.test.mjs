import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupFile, restoreFile, restorePending } from '../../utils/guardrails/safe-restore.mjs';
import { OUTCOME, readHealingLog, recordHealing } from '../../utils/healing/record-healing.mjs';
import { readJson } from '../../utils/io/read-json.mjs';
import { writeJsonAtomic } from '../../utils/io/write-json-atomic.mjs';

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'qa-harness-'));
  await mkdir(join(root, 'tests', 'pages'), { recursive: true });
  return root;
}

test('an unsuccessful repair restores only the affected file and preserves unrelated changes', async () => {
  const root = await workspace();
  try {
    const target = join(root, 'tests', 'pages', 'login-page.js');
    const unrelated = join(root, 'tests', 'pages', 'cart-page.js');
    // CRLF + BOM content must survive byte-for-byte.
    const original = "﻿export class LoginPage {\r\n  constructor(page) { this.submit = page.getByRole('button', { name: 'Log in' }); }\r\n}\r\n";
    await writeFile(target, original);
    await writeFile(unrelated, 'export const cart = 1;\n');
    const backupDir = join(root, 'artifacts', 'backups', 'itm_1');

    const record = await backupFile({ root, file: 'tests/pages/login-page.js', backupDir });
    assert.equal(record.file, 'tests/pages/login-page.js');
    assert.ok(existsSync(join(backupDir, 'journal.json')), 'pending restore is journaled');

    // A failed healing edit plus an unrelated user edit made meanwhile.
    await writeFile(target, original.replace('Log in', 'Sign in'));
    await writeFile(unrelated, 'export const cart = 2; // user work in progress\n');

    await restoreFile({ root, record, backupDir });
    assert.deepEqual(await readFile(target), Buffer.from(original));
    assert.equal(await readFile(unrelated, 'utf8'), 'export const cart = 2; // user work in progress\n');
    assert.equal(existsSync(join(backupDir, 'journal.json')), false, 'journal cleared after restore');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('crash recovery restores journaled files', async () => {
  const root = await workspace();
  try {
    const target = join(root, 'tests', 'pages', 'home-page.js');
    await writeFile(target, 'export const a = 1;\n');
    const backupDir = join(root, 'b');
    await backupFile({ root, file: 'tests/pages/home-page.js', backupDir });
    await writeFile(target, 'export const a = 2;\n');
    const restored = await restorePending({ root, backupDir });
    assert.deepEqual(restored.map((r) => r.file), ['tests/pages/home-page.js']);
    assert.equal(await readFile(target, 'utf8'), 'export const a = 1;\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses to back up files outside the project root', async () => {
  const root = await workspace();
  try {
    await assert.rejects(backupFile({ root, file: '../outside.js', backupDir: join(root, 'b') }), /outside the project root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('healing results are persisted accurately and appended per run', async () => {
  const root = await workspace();
  try {
    const logDir = join(root, 'healing-log');
    const base = {
      runId: '20261013-120000-abcdef12',
      testIds: ['chromium::tests/specs/login.spec.js::logs in'],
      originalStatus: 'failed',
      category: 'LOCATOR',
      subtype: 'NOT_FOUND',
      originalLocator: "page.getByRole('button', { name: 'Sign in' })",
      replacementLocator: "page.getByRole('button', { name: 'Log in' })",
      filesChanged: ['tests/pages/login-page.js'],
      diagnosis: 'Button label changed from "Sign in" to "Log in".',
      verification: { stage: 'complete', rerunReports: ['artifacts/runs/x/reruns/itm_1/targeted.json'] },
      evidence: { screenshot: ['test-results/a/test-failed-1.png'] },
    };
    await recordHealing(logDir, { ...base, itemId: 'itm_1', outcome: OUTCOME.HEALED });
    await recordHealing(logDir, { ...base, itemId: 'itm_2', outcome: OUTCOME.FAILED_RERUN, filesChanged: [] });

    const records = await readHealingLog(logDir, base.runId);
    assert.equal(records.length, 2);
    assert.equal(records[0].outcome, 'HEALED');
    assert.equal(records[0].originalLocator, base.originalLocator);
    assert.equal(records[0].replacementLocator, base.replacementLocator);
    assert.deepEqual(records[0].filesChanged, ['tests/pages/login-page.js']);
    assert.equal(records[1].outcome, 'FAILED_RERUN');
    assert.ok(records.every((r) => !Number.isNaN(Date.parse(r.recordedAt))));

    await assert.rejects(recordHealing(logDir, { ...base, itemId: 'x', outcome: 'PASSED' }), /Unknown healing outcome/);
    await assert.rejects(recordHealing(logDir, { runId: base.runId }), /missing required fields/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('atomic JSON writes round-trip and reject undefined', async () => {
  const root = await workspace();
  try {
    const path = join(root, 'nested', 'state.json');
    await writeJsonAtomic(path, { a: 1, list: [1, 2] });
    assert.deepEqual(await readJson(path), { a: 1, list: [1, 2] });
    await assert.rejects(writeJsonAtomic(path, undefined), /Refusing to write undefined/);
    assert.equal(await readJson(join(root, 'missing.json'), { optional: true }), undefined);
    await writeFile(join(root, 'bad.json'), '{ nope');
    await assert.rejects(readJson(join(root, 'bad.json')), /Malformed JSON in .*bad\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
