// Preload exclusivo dos testes. Nenhum provedor externo é chamado durante a suíte.
const http = require('node:http');
const https = require('node:https');
const { syncBuiltinESMExports } = require('node:module');
function blocked() { throw new Error('Rede externa bloqueada nos testes. Injete um transporte de teste.'); }
http.request = blocked; http.get = blocked;
https.request = blocked; https.get = blocked;
globalThis.fetch = blocked;
syncBuiltinESMExports();
