// Real packaged-runtime checks: sessions disappear on restart; persisted wallets survive.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const values = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
mkdirSync('.tools', { recursive: true });
const output = createWriteStream('.tools/runtime-smoke.log', { flags: 'a' });
const port = process.env.SMOKE_PORT ?? '18081';
const base = `http://127.0.0.1:${port}`;
let child;
let cookie = '';
async function start(local) {
  child = spawn('java', ['-jar', 'backend/target/nexapay-0.1.0-SNAPSHOT.jar',
    `--server.port=${port}`, '--server.address=127.0.0.1', ...(local ? ['--spring.profiles.active=local'] : [])], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...values, DEBUG: 'false',
      DB_URL: process.env.DB_URL ?? `jdbc:postgresql://127.0.0.1:${values.DB_PORT ?? '5442'}/nexapay` },
  });
  child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
  let failure;
  child.on('error', error => { failure = error; });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (failure) throw failure;
    if (child.exitCode !== null) throw new Error(`Application exited: ${child.exitCode}; see .tools/runtime-smoke.log`);
    try { if ((await fetch(`${base}/actuator/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* booting */ }
    await delay(500);
  }
  throw new Error('Application readiness timeout; see .tools/runtime-smoke.log');
}
async function stop() {
  if (child && child.exitCode === null) {
    const closed = once(child, 'exit'); child.kill('SIGTERM'); await closed;
  }
}
async function request(path, method = 'GET', body, token) {
  const response = await fetch(base + path, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'X-CSRF-TOKEN': token } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
  });
  for (const entry of response.headers.getSetCookie())
    if (entry.startsWith('JSESSIONID=')) cookie = entry.split(';')[0];
  return response;
}
async function mutate(path, body) {
  const csrf = await request('/api/v1/auth/csrf'); assert.equal(csrf.status, 200);
  return request(path, 'POST', body, (await csrf.json()).token);
}
try {
  await start(true);
  const credentials = { email: `restart-${Date.now()}@example.test`, password: 'Demo-wallet-2026!' };
  const created = await mutate('/api/v1/auth/register', { ...credentials, displayName: 'Runtime demo' });
  assert.equal(created.status, 201);
  assert.equal((await mutate('/api/v1/auth/login', credentials)).status, 200);
  const original = await (await request('/api/v1/wallets/me')).json();
  assert.equal(original.availableBalance, '0');
  const missing = await request('/api/v1/unknown'); assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/json/);
  const deepLink = await request('/app/profile'); assert.equal(deepLink.status, 200);
  assert.match(deepLink.headers.get('content-type'), /text\/html/);
  await stop(); await start(true);
  assert.equal((await request('/api/v1/auth/session')).status, 401);
  cookie = '';
  assert.equal((await mutate('/api/v1/auth/login', credentials)).status, 200);
  const restored = await (await request('/api/v1/wallets/me')).json();
  assert.equal(restored.id, original.id); assert.equal(restored.availableBalance, '0');
  await stop(); cookie = ''; await start(false);
  const secure = await request('/api/v1/auth/csrf'); assert.equal(secure.status, 200);
  const header = secure.headers.getSetCookie().find(entry => entry.startsWith('JSESSIONID='));
  assert.match(header, /; Secure/i); assert.match(header, /; HttpOnly/i); assert.match(header, /SameSite=Lax/i);
  console.log('PASS: packaged SPA/API routing, restart invalidation, persisted wallet and default Secure/HttpOnly/Lax cookie');
} finally { await stop(); output.end(); }
