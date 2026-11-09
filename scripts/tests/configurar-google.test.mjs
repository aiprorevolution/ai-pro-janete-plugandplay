import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configure, makePlan, mergeBinding, publicFirebaseConfig, installIndexes, main } from '../configurar-google.mjs';

const config = { projectId: 'janete-test-only', firestoreDatabaseId: 'app-copy-one', apiKey: 'public-test-only', appId: 'test-only' };
const options = { region: 'us-east1', service: 'janete-copy-one' };
const specification = { indexes: [{ collectionGroup: 'mensagens', queryScope: 'COLLECTION', fields: [
  { fieldPath: 'conversa_id', order: 'ASCENDING' }, { fieldPath: 'momento', order: 'DESCENDING' },
] }], fieldOverrides: [] };

test('plano usa o banco nomeado e isola recursos entre cópias', () => {
  const first = makePlan(config, options);
  const other = makePlan({ ...config, firestoreDatabaseId: 'app-copy-two' }, options);
  assert.notEqual(first.queue, other.queue);
  assert.notEqual(first.serviceAccount, other.serviceAccount);
  assert.notEqual(first.bucket, other.bucket);
  assert.equal(first.databaseId, config.firestoreDatabaseId);
  assert.throws(() => makePlan({ ...config, firestoreDatabaseId: '' }), /Ative o Firebase/);
});

test('IAM é aditivo, conserva etag/condições e não duplica permissão', () => {
  const initial = { etag: 'etag-preserved', bindings: [{ role: 'roles/viewer', members: ['user:original@example.test'] }] };
  const once = mergeBinding(initial, 'roles/datastore.user', 'serviceAccount:ours', { title: 'one', expression: 'resource.name=="db"' });
  const twice = mergeBinding(once, 'roles/datastore.user', 'serviceAccount:ours', { title: 'one', expression: 'resource.name=="db"' });
  assert.deepEqual(twice, once);
  assert.equal(twice.etag, initial.etag);
  assert.deepEqual(twice.bindings[0], initial.bindings[0]);
  assert.equal(initial.bindings.length, 1);
});

function scenario({ foreignBucket = false, failure = false } = {}) {
  const plan = makePlan(config, options);
  const calls = [];
  const service = { name: `projects/${plan.projectId}/locations/${plan.region}/services/${plan.service}`,
    uri: 'https://janete-copy-one-test.us-east1.run.app', etag: 'preserve-me',
    template: { containers: [{ image: 'original-image', env: [{ name: 'UNRELATED_SETTING', value: 'preserved' }] }] } };
  const api = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (failure) throw Object.assign(new Error('permission'), { status: 403 });
    if (url.includes(':getIamPolicy') || url.includes('/iam?')) return { etag: 'etag', bindings: [{ role: 'roles/viewer', members: ['user:original@example.test'] }] };
    if (url.includes('/collectionGroups/')) return { indexes: [{ ...specification.indexes[0], density: 'SPARSE_ANY',
      name: `projects/${plan.projectId}/databases/${plan.databaseId}/collectionGroups/mensagens/indexes/test-index`, state: 'READY' }] };
    if (url.includes('/databases/')) return { type: 'FIRESTORE_NATIVE', databaseEdition: 'ENTERPRISE', locationId: 'us-east1' };
    if (url.includes('/operations/')) return { done: true };
    if (url.includes('run.googleapis.com') && !options.method && !url.includes(':')) return service;
    if (url === `https://run.googleapis.com/v2/${service.name}` && !options.method) return service;
    if (options.allow404) return foreignBucket && url.includes('/storage/v1/b/') ? { labels: { installation: 'someone-else' } } : null;
    return { done: true };
  };
  return { plan, calls, service, api };
}

test('instalação mockada preserva imagem/env e usa serviço próprio com OIDC', async () => {
  const s = scenario();
  let saved;
  const receipt = await configure(s.plan, config, { api: s.api, log() {}, indexSpecification: specification, saveConfig: async value => { saved = value; } });
  assert.equal(receipt.edition, 'ENTERPRISE');
  assert.equal(saved.publicUrl, s.service.uri);
  assert.equal(saved.storageBucket, s.plan.bucket);
  const patch = s.calls.find(c => c.url.includes('run.googleapis.com') && c.method === 'PATCH');
  assert.equal(patch.body.template.containers[0].image, 'original-image');
  assert.ok(patch.body.template.containers[0].env.some(v => v.name === 'UNRELATED_SETTING' && v.value === 'preserved'));
  assert.equal(patch.body.template.serviceAccount, s.plan.serviceAccount);
  assert.equal(patch.body.template.timeout, '120s');
  const runtime = JSON.parse(patch.body.template.containers[0].env.find(v => v.name === 'JANETE_FIREBASE_CONFIG').value);
  assert.equal(runtime.firestoreDatabaseId, config.firestoreDatabaseId);
  assert.equal(runtime.projectId, config.projectId);
  assert.equal(runtime.storageBucket, s.plan.bucket);
  assert.equal(runtime.authDomain, `${config.projectId}.firebaseapp.com`);
  assert.equal(receipt.indexes.ready, 1);
  const projectPolicy = s.calls.find(c => c.url.includes('cloudresourcemanager.googleapis.com') && c.url.endsWith(':setIamPolicy'));
  const databaseBinding = projectPolicy.body.policy.bindings.find(b => b.role === 'roles/datastore.user');
  assert.equal(databaseBinding.condition.expression, `resource.name=="projects/${config.projectId}/databases/${config.firestoreDatabaseId}"`);
  const queueRead = s.calls.find(c => c.url.includes('cloudtasks.googleapis.com') && c.url.endsWith(':getIamPolicy'));
  assert.equal(queueRead.method, 'POST');
  assert.equal(queueRead.body.options.requestedPolicyVersion, 3);
  const serviceAccountRead = s.calls.find(c => c.url.startsWith('https://iam.googleapis.com/') && c.url.includes(':getIamPolicy'));
  assert.equal(serviceAccountRead.method, 'POST');
  assert.equal(new URL(serviceAccountRead.url).searchParams.get('options.requestedPolicyVersion'), '3');
  assert.equal(serviceAccountRead.body, undefined);
  const runPolicyRead = s.calls.find(c => c.url.startsWith('https://run.googleapis.com/') && c.url.includes(':getIamPolicy'));
  assert.equal(runPolicyRead.method || 'GET', 'GET');
  const bucketPolicyRead = s.calls.find(c => c.url.startsWith('https://storage.googleapis.com/') && c.url.includes('/iam?'));
  assert.equal(bucketPolicyRead.method || 'GET', 'GET');
  const bucketPolicyWrite = s.calls.find(c => c.url.startsWith('https://storage.googleapis.com/') && c.url.endsWith('/iam'));
  assert.equal(bucketPolicyWrite.method, 'PUT');
  const job = s.calls.find(c => c.url.startsWith('https://cloudscheduler.googleapis.com/') && c.method === 'POST');
  assert.equal(job.body.httpTarget.oidcToken.email, undefined);
  assert.equal(job.body.httpTarget.oidcToken.serviceAccountEmail, s.plan.serviceAccount);
  assert.equal(job.body.schedule, '*/5 * * * *');
  assert.equal(s.calls.some(c => c.url.includes('/keys')), false);
  assert.equal(s.calls.some(c => /evolution|openai|anthropic|generativelanguage/.test(c.url)), false);
});

test('bucket preexistente de outra instalação não é alterado', async () => {
  const s = scenario({ foreignBucket: true });
  await assert.rejects(configure(s.plan, config, { api: s.api, log() {}, indexSpecification: specification }), /Bucket preexistente/);
  assert.equal(s.calls.some(c => c.url.includes('/storage/v1/b/') && c.method === 'PATCH'), false);
});

test('falta de permissão não produz recibo de sucesso', async () => {
  const s = scenario({ failure: true });
  let saved = false;
  await assert.rejects(configure(s.plan, config, { api: s.api, log() {}, indexSpecification: specification, saveConfig: async () => { saved = true; } }), /permission/);
  assert.equal(saved, false);
});

test('configuração de runtime exporta apenas campos públicos e conserva banco nomeado', () => {
  const plan = makePlan(config, options);
  const result = publicFirebaseConfig(plan, { firebaseConfig: { ...config, private_key: 'never-copy', token: 'never-copy' } }, 'https://published.example.test');
  assert.deepEqual(Object.keys(result).sort(), ['apiKey', 'appId', 'authDomain', 'firestoreDatabaseId', 'projectId', 'publicUrl', 'storageBucket'].sort());
  assert.equal(result.firestoreDatabaseId, config.firestoreDatabaseId);
  assert.equal(JSON.stringify(result).includes('never-copy'), false);
  assert.throws(() => publicFirebaseConfig(plan, { ...config, apiKey: '' }, 'https://published.example.test'), /incompleta/);
});

test('índices: cria no banco nomeado e aguarda a operação e o estado READY', async () => {
  const plan = makePlan(config, options);
  const base = `projects/${plan.projectId}/databases/${plan.databaseId}`;
  const indexName = `${base}/collectionGroups/mensagens/indexes/new-one`;
  const calls = [];
  let created = false;
  let polls = 0;
  const api = async (url, request = {}) => {
    calls.push({ url, ...request });
    if (request.method === 'POST') { created = true; return { name: `${base}/operations/build-index` }; }
    if (url.includes('/operations/')) return { done: true };
    if (url.endsWith('/new-one')) return { ...specification.indexes[0], name: indexName, state: ++polls > 1 ? 'READY' : 'CREATING' };
    return { indexes: created ? [{ ...specification.indexes[0], name: indexName, state: 'CREATING' }] : [] };
  };
  assert.deepEqual(await installIndexes(plan, specification, 'ENTERPRISE', api, { pause: async () => {} }), { required: 1, ready: 1 });
  const creation = calls.find(c => c.method === 'POST');
  assert.equal(creation.body.density, 'SPARSE_ANY');
  assert.equal(creation.body.apiScope, 'ANY_API');
  assert.equal(polls, 2);
  assert.ok(calls.every(c => c.url.includes(`/databases/${plan.databaseId}/`)));
  assert.equal(calls.some(c => c.method === 'DELETE'), false);
});

test('índices: paginação e __name__ automático não criam duplicatas nem apagam índices alheios', async () => {
  const plan = makePlan(config, options);
  const calls = [];
  const ready = { ...specification.indexes[0], name: `projects/${plan.projectId}/databases/${plan.databaseId}/collectionGroups/mensagens/indexes/existing`,
    fields: [...specification.indexes[0].fields, { fieldPath: '__name__', order: 'DESCENDING' }], state: 'READY', density: 'SPARSE_ALL' };
  const api = async (url, options = {}) => {
    calls.push({ url, ...options });
    return url.includes('pageToken=second') ? { indexes: [ready] }
      : { indexes: [{ ...ready, fields: [{ fieldPath: 'another', order: 'ASCENDING' }, { fieldPath: 'field', order: 'ASCENDING' }] }], nextPageToken: 'second' };
  };
  assert.deepEqual(await installIndexes(plan, specification, 'STANDARD', api), { required: 1, ready: 1 });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => !c.method));
});

test('índices: NEEDS_REPAIR e prazo esgotado não são apresentados como sucesso', async () => {
  const plan = makePlan(config, options);
  const index = { ...specification.indexes[0], name: `projects/${plan.projectId}/databases/${plan.databaseId}/collectionGroups/mensagens/indexes/broken`, state: 'NEEDS_REPAIR' };
  await assert.rejects(installIndexes(plan, specification, 'STANDARD', async () => ({ indexes: [index] })), /reparo/);
  index.state = 'CREATING';
  await assert.rejects(installIndexes(plan, specification, 'STANDARD', async () => ({ indexes: [index] }), { maxPolls: 0 }), /aguardar READY/);
});

test('manifesto real do repositório é aceito e conferido por completo no banco nomeado', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'));
  const plan = makePlan(config, options);
  const api = async url => {
    const group = /collectionGroups\/([^/]+)\/indexes/.exec(url)?.[1];
    return { indexes: manifest.indexes.filter(index => index.collectionGroup === group).map((index, i) => ({
      ...index, density: 'SPARSE_ANY', state: 'READY',
      name: `projects/${plan.projectId}/databases/${plan.databaseId}/collectionGroups/${group}/indexes/fixture-${i}`,
    })) };
  };
  const status = await installIndexes(plan, manifest, 'ENTERPRISE', api);
  assert.ok(status.required > 0);
  assert.equal(status.ready, manifest.indexes.length);
});

test('sem --apply o plano não chama rede nem cria credenciais', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'janete-install-test-'));
  const filename = path.join(directory, 'firebase-applet-config.json');
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  let output = '';
  await writeFile(filename, JSON.stringify(config));
  try {
    globalThis.fetch = async () => { throw new Error('network forbidden'); };
    console.log = text => { output += text; };
    await main(['--config', filename, '--region', options.region, '--service', options.service]);
    assert.equal(JSON.parse(output).mode, 'plan');
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    await unlink(filename);
    await rmdir(directory);
  }
});
