const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateAssignment, saveAssignments, loadAssignments, inferFolder, suggestPort, stopEligibility } = require('./lib');

test('saved assignments retain project folders and replace cleanly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portkeeper-'));
  try {
    const file = path.join(dir, 'assignments.json');
    const item = validateAssignment({ port: '3000', project: 'Frontend', folder: 'C:\\Projects\\site', note: 'Dev' });
    saveAssignments([item], file);
    assert.deepEqual(loadAssignments(file), [item]);
    assert.throws(() => validateAssignment({ port: 70000, project: 'Bad' }), /Port/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('suggestion skips active and assigned ports and checks binding', async () => {
  const checked = [];
  const result = await suggestPort(3000, 3004, [{ port: 3000 }], [{ port: 3001 }], async port => {
    checked.push(port);
    return port !== 3002;
  });
  assert.equal(result, 3003);
  assert.deepEqual(checked, [3002, 3003]);
});

test('project folder comes from an explicit script path', () => {
  assert.equal(inferFolder('"C:\\Program Files\\nodejs\\node.exe" "C:\\Projects\\My App\\server.js"'), 'C:\\Projects\\My App');
  assert.equal(inferFolder('"C:\\Program Files\\nodejs\\node.exe"'), '');
});

test('stop is limited to a verified project process and all its ports', () => {
  const owner = { port: 3000, pid: 99999, processName: 'node.exe', folder: 'C:\\Projects\\site\\src', startedAt: '2026-10-21T10:00:00.0000000Z', isService: false };
  const assignments = [{ port: 3000, project: 'Site', folder: 'C:\\Projects\\site' }];
  assert.equal(stopEligibility(3000, 99999, [owner], assignments, 123).allowed, true);
  assert.equal(stopEligibility(3000, 99999, [{ ...owner, isService: true }], assignments, 123).allowed, false);
  assert.equal(stopEligibility(3000, 99999, [owner], [], 123).allowed, false);
  assert.equal(stopEligibility(3000, 99999, [owner, { ...owner, port: 3001 }], assignments, 123).allowed, false);
  assert.equal(stopEligibility(3000, 99999, [owner], assignments, 99999).allowed, false);
});
