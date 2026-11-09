/** Executado pelo agente do AI Studio após a publicação, com autorização do dono.
 * Sem --apply apenas apresenta o plano local, sem rede. Nunca cria credenciais JSON.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { GoogleAuth } from 'google-auth-library';

const scopes = ['https://www.googleapis.com/auth/cloud-platform'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const enc = encodeURIComponent;

export function makePlan(config, options = {}) {
  const c = config.firebaseConfig || config;
  const projectId = c.projectId;
  const databaseId = config.firestoreDatabaseId || c.firestoreDatabaseId || config.databaseId;
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId || '') || !databaseId)
    throw new Error('Ative o Firebase nativo e mantenha projectId e firestoreDatabaseId em firebase-applet-config.json.');
  if (!/^(\(default\)|[a-zA-Z0-9_-]{1,100})$/.test(databaseId)) throw new Error('Banco nomeado inválido.');
  const suffix = createHash('sha256').update(databaseId).digest('hex').slice(0, 10);
  const region = options.region || config.cloudRunRegion || '';
  const service = options.service || config.cloudRunService || '';
  if (region && !/^[a-z]+-[a-z]+\d+$/.test(region)) throw new Error('Região inválida.');
  if (service && !/^[a-z][a-z0-9-]{0,62}$/.test(service)) throw new Error('Serviço inválido.');
  const accountId = `janete-${suffix}`;
  return { projectId, databaseId, suffix, region, service, accountId,
    serviceAccount: `${accountId}@${projectId}.iam.gserviceaccount.com`,
    queue: `janete-${suffix}`, bucket: `${projectId}-janete-${suffix}`,
    job: `janete-recuperacao-${suffix}`, interval: '*/5 * * * *',
    apis: ['run.googleapis.com', 'firestore.googleapis.com', 'storage.googleapis.com',
      'cloudtasks.googleapis.com', 'cloudscheduler.googleapis.com', 'iam.googleapis.com',
      'iamcredentials.googleapis.com'],
  };
}

export function mergeBinding(policy, role, member, condition) {
  const out = structuredClone(policy || {});
  out.version = 3;
  out.bindings ||= [];
  let binding = out.bindings.find(b => b.role === role &&
    JSON.stringify(b.condition || null) === JSON.stringify(condition || null));
  if (!binding) { binding = { role, members: [], ...(condition ? { condition } : {}) }; out.bindings.push(binding); }
  if (!binding.members.includes(member)) binding.members.push(member);
  return out;
}

export function publicFirebaseConfig(plan, config, publicUrl) {
  const source = config.firebaseConfig || config;
  const result = { projectId: plan.projectId, apiKey: source.apiKey, appId: source.appId,
    authDomain: source.authDomain || `${plan.projectId}.firebaseapp.com`,
    firestoreDatabaseId: plan.databaseId, storageBucket: plan.bucket, publicUrl };
  if (typeof result.apiKey !== 'string' || !result.apiKey || typeof result.appId !== 'string' || !result.appId)
    throw new Error('Configuração pública Firebase incompleta; preserve o arquivo gerado pelo AI Studio.');
  // Allowlist: nunca copiar credenciais ou outras propriedades arbitrárias para o ambiente.
  return result;
}

function indexBody(index, edition) {
  if (!index || !/^[a-zA-Z0-9_-]+$/.test(index.collectionGroup || '') ||
      !['COLLECTION', 'COLLECTION_GROUP'].includes(index.queryScope) ||
      !Array.isArray(index.fields) || index.fields.length < 2 || index.fields.length > 100)
    throw new Error('Definição de índice inválida em firestore.indexes.json.');
  if (index.apiScope && index.apiScope !== 'ANY_API') throw new Error('Índices precisam usar a API Firestore Native.');
  const fields = index.fields.map(field => {
    if (!field || typeof field.fieldPath !== 'string' || !field.fieldPath ||
        Object.keys(field).some(key => !['fieldPath', 'order', 'arrayConfig'].includes(key)) ||
        Number(Boolean(field.order)) + Number(Boolean(field.arrayConfig)) !== 1 ||
        (field.order && !['ASCENDING', 'DESCENDING'].includes(field.order)) ||
        (field.arrayConfig && field.arrayConfig !== 'CONTAINS'))
      throw new Error('Campo de índice inválido ou não suportado pelo instalador.');
    return { fieldPath: field.fieldPath, ...(field.order ? { order: field.order } : { arrayConfig: field.arrayConfig }) };
  });
  const density = index.density || (edition === 'ENTERPRISE' ? 'SPARSE_ANY' : 'SPARSE_ALL');
  if (!(edition === 'ENTERPRISE' ? ['SPARSE_ANY', 'DENSE'] : ['SPARSE_ALL']).includes(density))
    throw new Error('Densidade de índice incompatível com a edição real do banco.');
  return { queryScope: index.queryScope, apiScope: 'ANY_API', density, fields };
}

function indexKey(index, edition) {
  const body = indexBody({ ...index, collectionGroup: 'comparison' }, edition);
  if (body.fields.at(-1).fieldPath !== '__name__')
    body.fields.push({ fieldPath: '__name__', order: body.fields.at(-1).order || 'ASCENDING' });
  return JSON.stringify(body);
}

/** Cria só o que falta, preserva índices alheios e só termina com todos em READY. */
export async function installIndexes(plan, specification, edition, api, { pause = sleep, maxPolls = 90 } = {}) {
  if (!Array.isArray(specification?.indexes) || !specification.indexes.length || (specification.fieldOverrides || []).length)
    throw new Error('Arquivo de índices inválido ou fieldOverrides não suportado; nenhuma alteração de campos foi aplicada.');
  // Validar o arquivo inteiro antes da primeira escrita.
  const expected = specification.indexes.map(index => ({ group: index.collectionGroup, body: indexBody(index, edition) }));
  const database = `projects/${plan.projectId}/databases/${enc(plan.databaseId)}`;
  const list = async group => {
    const indexes = [];
    let next = '';
    do {
      const result = await api(`https://firestore.googleapis.com/v1/${database}/collectionGroups/${enc(group)}/indexes?pageSize=100${next ? `&pageToken=${enc(next)}` : ''}`);
      indexes.push(...(result.indexes || []));
      next = result.nextPageToken || '';
    } while (next);
    return indexes;
  };
  const byGroup = new Map();
  let ready = 0;
  for (const index of expected) {
    if (!byGroup.has(index.group)) byGroup.set(index.group, await list(index.group));
    const find = () => byGroup.get(index.group).find(candidate => {
      try { return indexKey(candidate, edition) === indexKey(index.body, edition); } catch { return false; }
    });
    let existing = find();
    if (!existing) {
      try {
        const operation = await api(`https://firestore.googleapis.com/v1/${database}/collectionGroups/${enc(index.group)}/indexes`, {
          method: 'POST', body: index.body,
        });
        if (operation.name) await waitOperation(`https://firestore.googleapis.com/v1/${operation.name}`, api, pause, maxPolls);
        else if (operation.error) throw new Error('O Google recusou a criação de um índice.');
      } catch (error) { if (error.status !== 409) throw error; }
      byGroup.set(index.group, await list(index.group));
      existing = find();
    }
    if (!existing?.name || !existing.name.startsWith(`${database}/collectionGroups/${index.group}/indexes/`))
      throw new Error(`Índice de ${index.group} ainda não encontrado. Execute o instalador novamente para retomar.`);
    for (let attempt = 0; existing.state !== 'READY'; attempt++) {
      if (existing.state === 'NEEDS_REPAIR') throw new Error(`Índice de ${index.group} precisa de reparo no Google Cloud.`);
      if (attempt >= maxPolls) throw new Error(`Índice de ${index.group} ainda está sendo criado. Execute novamente para aguardar READY.`);
      await pause(2_000);
      existing = await api(`https://firestore.googleapis.com/v1/${existing.name}`);
    }
    ready++;
  }
  return { required: expected.length, ready };
}

export async function configure(plan, config, { api, log = console.log, saveConfig = async () => {},
  indexSpecification, pause = sleep, maxPolls = 90 }) {
  if (!plan.region || !plan.service) throw new Error('O agente deve informar --region e --service da publicação nativa, no mesmo projeto Firebase.');
  const project = `projects/${plan.projectId}`;
  // Identificar a edição real é parte da instalação; nunca provisionar outro banco silenciosamente.
  const db = await api(`https://firestore.googleapis.com/v1/${project}/databases/${enc(plan.databaseId)}`);
  if (db.type && db.type !== 'FIRESTORE_NATIVE') throw new Error('Este app requer Firestore Native (operações Core), não Datastore/MongoDB.');
  log(`Banco confirmado: ${plan.databaseId}; edição: ${db.databaseEdition || 'STANDARD'}; região: ${db.locationId}.`);
  const serviceName = `${project}/locations/${plan.region}/services/${plan.service}`;
  const runUrl = `https://run.googleapis.com/v2/${serviceName}`;
  let service = await api(runUrl);
  const publicUrl = service.uri;
  if (!/^https:\/\/[a-z0-9.-]+\.run\.app$/.test(publicUrl || '')) throw new Error('URL estável da publicação Cloud Run não encontrada.');
  if (/\/\/ais-dev-/.test(publicUrl)) throw new Error('A prévia não é uma publicação. Use Share > Publish antes desta etapa.');
  if (service.name !== serviceName) throw new Error('Serviço pertence a outra instalação/projeto.');
  const runtimeConfig = publicFirebaseConfig(plan, config, publicUrl);
  log('Ativando APIs necessárias no projeto selecionado.');
  for (const name of plan.apis) {
    const operation = await api(`https://serviceusage.googleapis.com/v1/${project}/services/${name}:enable`, { method: 'POST', body: {} });
    if (operation.name && !operation.done) await waitOperation(`https://serviceusage.googleapis.com/v1/${operation.name}`, api);
  }
  const specification = indexSpecification || JSON.parse(await readFile(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  const indexStatus = await installIndexes(plan, specification, db.databaseEdition || 'STANDARD', api, { pause, maxPolls });
  log(`Índices confirmados READY: ${indexStatus.ready}/${indexStatus.required}.`);

  const account = `${project}/serviceAccounts/${enc(plan.serviceAccount)}`;
  const accountUrl = `https://iam.googleapis.com/v1/${account}`;
  if (!(await api(accountUrl, { allow404: true }))) {
    await api(`https://iam.googleapis.com/v1/${project}/serviceAccounts`, { method: 'POST', body: {
      accountId: plan.accountId, serviceAccount: { displayName: 'AI PRO Janete — servidor da instalação' },
    } });
  }
  const member = `serviceAccount:${plan.serviceAccount}`;
  const rmUrl = `https://cloudresourcemanager.googleapis.com/v1/${project}`;
  await updatePolicy(
    () => api(`${rmUrl}:getIamPolicy`, { method: 'POST', body: { options: { requestedPolicyVersion: 3 } } }),
    policy => api(`${rmUrl}:setIamPolicy`, { method: 'POST', body: { policy } }),
    policy => mergeBinding(policy, 'roles/datastore.user', member, {
      title: `janete-${plan.suffix}`, expression: `resource.name=="${project}/databases/${plan.databaseId}"`,
    }),
  );
  // O serviço pode assinar URLs de mídia e usar a própria identidade nos pedidos da fila.
  await updatePolicy(
    // IAM Service Accounts usa POST, mas recebe options na query e exige corpo vazio.
    () => api(`${accountUrl}:getIamPolicy?options.requestedPolicyVersion=3`, { method: 'POST' }),
    policy => api(`${accountUrl}:setIamPolicy`, { method: 'POST', body: { policy } }),
    policy => mergeBinding(mergeBinding(policy, 'roles/iam.serviceAccountTokenCreator', member),
      'roles/iam.serviceAccountUser', member),
  );

  const bucketUrl = `https://storage.googleapis.com/storage/v1/b/${enc(plan.bucket)}`;
  const existingBucket = await api(bucketUrl, { allow404: true });
  if (!existingBucket) {
    await api(`https://storage.googleapis.com/storage/v1/b?project=${enc(plan.projectId)}`, { method: 'POST', body: {
      name: plan.bucket, location: plan.region, storageClass: 'STANDARD',
      labels: { application: 'ai-pro-janete', installation: plan.suffix },
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' },
    } });
  } else {
    if (existingBucket.labels?.installation !== plan.suffix) throw new Error('Bucket preexistente sem a identificação desta instalação; não alterar.');
    await api(bucketUrl, { method: 'PATCH', body: {
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' },
    } });
  }
  await updatePolicy(
    () => api(`${bucketUrl}/iam?optionsRequestedPolicyVersion=3`),
    policy => api(`${bucketUrl}/iam`, { method: 'PUT', body: policy }),
    policy => mergeBinding(mergeBinding(policy, 'roles/storage.objectAdmin', member), 'roles/storage.legacyBucketReader', member),
  );

  const parent = `${project}/locations/${plan.region}`;
  const queueName = `${parent}/queues/${plan.queue}`;
  const queueUrl = `https://cloudtasks.googleapis.com/v2/${queueName}`;
  const queueSettings = { name: queueName,
    rateLimits: { maxDispatchesPerSecond: 1, maxConcurrentDispatches: 1 },
    retryConfig: { maxAttempts: 20, maxRetryDuration: '86400s', minBackoff: '5s', maxBackoff: '300s', maxDoublings: 5 },
  };
  if (await api(queueUrl, { allow404: true })) {
    await api(`${queueUrl}?updateMask=rateLimits,retryConfig`, { method: 'PATCH', body: queueSettings });
  } else await api(`https://cloudtasks.googleapis.com/v2/${parent}/queues`, { method: 'POST', body: queueSettings });
  await updatePolicy(
    () => api(`${queueUrl}:getIamPolicy`, { method: 'POST', body: { options: { requestedPolicyVersion: 3 } } }),
    policy => api(`${queueUrl}:setIamPolicy`, { method: 'POST', body: { policy } }),
    policy => mergeBinding(policy, 'roles/cloudtasks.enqueuer', member),
  );
  await updatePolicy(
    () => api(`${runUrl}:getIamPolicy?options.requestedPolicyVersion=3`),
    policy => api(`${runUrl}:setIamPolicy`, { method: 'POST', body: { policy } }),
    policy => mergeBinding(policy, 'roles/run.invoker', member),
  );

  // Preserva imagem, variáveis, volumes e ajustes de publicação existentes.
  service = await api(runUrl);
  if (service.template?.containers?.length !== 1) throw new Error('Configuração de contêineres inesperada; não alterar automaticamente.');
  const container = structuredClone(service.template.containers[0]);
  const variables = {
    JANETE_PUBLIC_URL: publicUrl, JANETE_TASKS_LOCATION: plan.region, JANETE_TASKS_QUEUE: plan.queue,
    JANETE_TASKS_SERVICE_ACCOUNT: plan.serviceAccount, JANETE_RUNTIME_SERVICE_ACCOUNT: plan.serviceAccount,
    JANETE_STORAGE_BUCKET: plan.bucket,
    JANETE_FIREBASE_CONFIG: JSON.stringify(runtimeConfig),
  };
  container.env = (container.env || []).filter(v => !(v.name in variables));
  container.env.push(...Object.entries(variables).map(([name, value]) => ({ name, value })));
  const operation = await api(`${runUrl}?updateMask=template.containers,template.serviceAccount,template.timeout,template.scaling`, {
    method: 'PATCH', body: { name: serviceName, etag: service.etag,
      template: { containers: [container], serviceAccount: plan.serviceAccount, timeout: '120s',
        scaling: { minInstanceCount: 0, maxInstanceCount: 2 } },
    },
  });
  if (operation.name) await waitOperation(`https://run.googleapis.com/v2/${operation.name}`, api);

  const jobName = `${parent}/jobs/${plan.job}`;
  const jobUrl = `https://cloudscheduler.googleapis.com/v1/${jobName}`;
  const job = { name: jobName, description: 'Recuperação de tarefas persistidas da AI PRO Janete',
    schedule: plan.interval, timeZone: 'Etc/UTC', attemptDeadline: '120s',
    httpTarget: { uri: `${publicUrl}/api/public/cron/mensageria`, httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: Buffer.from('{"version":1,"recovery":true}').toString('base64'),
      oidcToken: { serviceAccountEmail: plan.serviceAccount, audience: publicUrl },
    },
    retryConfig: { retryCount: 3, minBackoffDuration: '10s', maxBackoffDuration: '60s' },
  };
  if (await api(jobUrl, { allow404: true })) {
    await api(`${jobUrl}?updateMask=schedule,timeZone,httpTarget,attemptDeadline,retryConfig,description`, { method: 'PATCH', body: job });
  } else await api(`https://cloudscheduler.googleapis.com/v1/${parent}/jobs`, { method: 'POST', body: job });
  const updated = structuredClone(config);
  (updated.firebaseConfig || updated).storageBucket = plan.bucket;
  updated.publicUrl = publicUrl;
  updated.cloudRunRegion = plan.region;
  updated.cloudRunService = plan.service;
  await saveConfig(updated);
  log('Infraestrutura configurada. Faça o checklist de atendimento; nenhuma mensagem de teste foi enviada pelo instalador.');
  return { publicUrl, projectId: plan.projectId, databaseId: plan.databaseId,
    edition: db.databaseEdition || 'STANDARD', indexes: indexStatus, queue: queueName, bucket: plan.bucket, job: jobName };
}

async function waitOperation(url, api, pause = sleep, maxPolls = 90) {
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const operation = await api(url);
    if (operation.error) throw new Error('O Google não concluiu o provisionamento. Confira a operação no console do projeto.');
    if (operation.done) return operation;
    await pause(2_000);
  }
  throw new Error('Provisionamento ainda em andamento. Execute novamente para retomar com segurança.');
}
async function updatePolicy(read, write, merge) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await write(merge(await read())); }
    catch (error) { if (![409, 412].includes(error.status) || attempt === 2) throw error; }
  }
}
export async function main(args = process.argv.slice(2)) {
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const filename = option('--config') || 'firebase-applet-config.json';
  const config = JSON.parse(await readFile(filename, 'utf8'));
  const plan = makePlan(config, { region: option('--region'), service: option('--service') });
  if (!args.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'plan', ...plan,
      notice: 'Nenhuma mudança executada. O agente deve confirmar projeto, publicação e autorização de cobrança antes de --apply.' }, null, 2));
    return;
  }
  const auth = new GoogleAuth({ scopes });
  const api = async (url, options = {}) => {
    let token;
    try { token = await auth.getAccessToken(); }
    catch { throw new Error('Este ambiente não forneceu credenciais Google ADC para infraestrutura. A integração Firebase não garante essa permissão. Execute somente em ambiente do proprietário com ADC autorizado; não crie credencial JSON nem conceda acesso a uma identidade compartilhada.'); }
    if (!token) throw new Error('Identidade Google ausente no ambiente.');
    const response = await fetch(url, {
      method: options.method || 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 && options.allow404) return null;
    if (!response.ok) throw Object.assign(new Error(`Google HTTP ${response.status} em ${new URL(url).hostname}${new URL(url).pathname}. Verifique autorização do projeto e cobrança; não use chaves manuais.`), { status: response.status });
    return response.status === 204 ? {} : response.json();
  };
  const receipt = await configure(plan, config, { api, saveConfig: updated => writeFile(filename, JSON.stringify(updated, null, 2) + '\n') });
  await writeFile('google-installation-receipt.json', JSON.stringify({ ...receipt, verifiedAt: new Date().toISOString(), liveMessagingTested: false }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
