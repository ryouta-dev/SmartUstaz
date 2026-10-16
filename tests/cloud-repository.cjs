const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'cloud-repository.js'), 'utf8');

async function main() {
  const calls = [];
  let response = { data: [], error: null };
  const query = {
    select() { calls.push(['select']); return this; },
    order(...args) { calls.push(['order', ...args]); return this; },
    limit(...args) { calls.push(['limit', ...args]); return Promise.resolve(response); },
    insert(values) { calls.push(['insert', values]); return this; },
    single() { return Promise.resolve(response); },
    update(values) { calls.push(['update', values]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    maybeSingle() { return Promise.resolve(response); },
    delete() { calls.push(['delete']); return this; },
    then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
  };
  const client = {
    auth: { async getSession() { return { data: { session: { user: { id: 'user-1' } } }, error: null }; } },
    from(table) { calls.push(['from', table]); return query; },
  };
  const window = { SmartAuth: { isConfigured: () => true, getClient: () => client } };
  vm.runInNewContext(source, { window });

  response = { data: [{ id: 'doc-1' }], error: null };
  assert.equal((await window.SmartCloud.listDocuments())[0].id, 'doc-1');
  assert.equal(calls[0][0], 'from');
  assert.equal(calls[0][1], 'documents');
  assert.equal(calls[1][0], 'select');
  assert.equal(calls[2][0], 'order');
  assert.equal(calls[2][1], 'updated_at');
  assert.equal(calls[2][2].ascending, false);

  response = { data: { id: 'new-doc' }, error: null };
  const created = await window.SmartCloud.createDocument({ local_id: 'local-1', content: { ok: true } });
  assert.equal(created.id, 'new-doc');
  assert.equal(calls.find((call) => call[0] === 'insert')[1].user_id, 'user-1');
  await assert.rejects(window.SmartCloud.createTemplate({ local_id: '', content: {} }), /invalid_cloud_record/);
  await assert.rejects(window.SmartCloud.createTemplate({ local_id: 'x', content: [] }), /invalid_cloud_record/);

  response = { data: null, error: null };
  await assert.rejects(window.SmartCloud.updateDocument('doc-1', 1, { content: { ok: true } }), /cloud_conflict/);
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'version' && call[2] === 1));

  response = { data: [], error: null };
  assert.deepEqual(await window.SmartCloud.listTemplates(), []);
  await window.SmartCloud.deleteDocument('doc-1');
  assert.ok(calls.some((call) => call[0] === 'delete'));

  console.log('Cloud repository tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
