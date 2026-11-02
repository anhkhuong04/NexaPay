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
async function request(path, method = 'GET', body, token, key) {
  const response = await fetch(base + path, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'X-CSRF-TOKEN': token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
  });
  for (const entry of response.headers.getSetCookie())
    if (entry.startsWith('JSESSIONID=')) cookie = entry.split(';')[0];
  return response;
}
async function mutate(path, body, key) {
  const csrf = await request('/api/v1/auth/csrf'); assert.equal(csrf.status, 200);
  return request(path, 'POST', body, (await csrf.json()).token, key);
}
try {
  await start(true);
  const credentials = { email: `restart-${Date.now()}@example.test`, password: 'Demo-wallet-2026!' };
  const created = await mutate('/api/v1/auth/register', { ...credentials, displayName: 'Runtime demo' });
  assert.equal(created.status, 201);
  assert.equal((await mutate('/api/v1/auth/login', credentials)).status, 200);
  const original = await (await request('/api/v1/wallets/me')).json();
  assert.equal(original.availableBalance, '0');
  const recipient = { email: `restart-recipient-${Date.now()}@example.test`, password: 'Demo-wallet-2026!' };
  assert.equal((await mutate('/api/v1/auth/register', {...recipient, displayName: 'Runtime recipient'})).status, 201);
  assert.equal((await mutate('/api/v1/auth/login', recipient)).status, 200);
  const destination = await (await request('/api/v1/wallets/me')).json();
  assert.equal((await mutate('/api/v1/auth/login', credentials)).status, 200);
  assert.equal((await mutate('/api/v1/demo-fundings', {amount:'100000',currency:'VND'}, crypto.randomUUID())).status, 201);
  const transferKey=crypto.randomUUID();
  const transferBody={destinationWalletId:destination.id,amount:'10000',currency:'VND',note:'Restart recovery'};
  const transferResponse=await mutate('/api/v1/transfers',transferBody,transferKey);
  assert.equal(transferResponse.status,201); const transfer=await transferResponse.json();
  for (const route of ['/business/onboarding','/business/overview','/business/settings','/app/send','/app/transactions',`/app/transactions/TRANSFER/${transfer.resourceId}`]) {
    const response=await request(route); assert.equal(response.status,200); assert.match(response.headers.get('content-type'),/text\/html/);
  }
  const missing = await request('/api/v1/unknown'); assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/json/);
  const deepLink = await request('/app/profile'); assert.equal(deepLink.status, 200);
  assert.match(deepLink.headers.get('content-type'), /text\/html/);
  const merchantResponse=await mutate('/api/v1/merchants',{displayName:'Runtime merchant'});
  assert.equal(merchantResponse.status,201);const merchant=await merchantResponse.json();
  const merchantWallet=await (await request(`/api/v1/merchants/${merchant.id}/wallet`)).json();
  assert.equal(merchantWallet.availableBalance,'0');assert.notEqual(merchantWallet.id,original.id);
  const requestKey=crypto.randomUUID();const requestBody={amount:'5000',currency:'VND',description:'Runtime checkout',expiryMinutes:30};
  const requested=await mutate(`/api/v1/merchants/${merchant.id}/payment-requests`,requestBody,requestKey);assert.equal(requested.status,201);const checkout=await requested.json();
  const repeated=await mutate(`/api/v1/merchants/${merchant.id}/payment-requests`,requestBody,requestKey);assert.equal(repeated.status,201);assert.deepEqual(await repeated.json(),checkout);
  const publicView=await (await request(`/api/v1/checkout/${checkout.publicRef}`)).json();assert.equal(publicView.status,'PENDING');assert.ok(!('payment' in publicView));
  assert.equal((await request(`/pay/${checkout.publicRef}`)).status,200);
  assert.equal((await mutate('/api/v1/auth/login',recipient)).status,200);
  const paymentKey=crypto.randomUUID();const paymentBody={amount:'5000',currency:'VND'};
  const captured=await mutate(`/api/v1/checkout/${checkout.publicRef}/pay`,paymentBody,paymentKey);assert.equal(captured.status,201);const payment=await captured.json();
  assert.equal((await (await request('/api/v1/wallets/me')).json()).availableBalance,'5000');
  assert.equal((await mutate('/api/v1/auth/login',credentials)).status,200);
  const refundKey=crypto.randomUUID();const refundBody={amount:'2000',currency:'VND',note:'Runtime partial refund'};
  const refunded=await mutate(`/api/v1/merchants/${merchant.id}/payments/${payment.result.paymentId}/refunds`,refundBody,refundKey);assert.equal(refunded.status,201);const refund=await refunded.json();
  for(const path of ['/business/refunds',`/business/refunds/${refund.resourceId}`,`/business/payments/${payment.result.paymentId}/refund`]) {const response=await request(path);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);}
  await stop(); await start(true);
  assert.equal((await request('/api/v1/auth/session')).status, 401);
  cookie = '';
  assert.equal((await mutate('/api/v1/auth/login', credentials)).status, 200);
  assert.deepEqual(await (await request('/api/v1/merchants/me')).json(),merchant);
  assert.deepEqual(await (await request(`/api/v1/merchants/${merchant.id}/wallet`)).json(),{...merchantWallet,availableBalance:'3000',totalBalance:'3000'});
  const paidRequest=await (await request(`/api/v1/merchants/${merchant.id}/payment-requests/${checkout.id}`)).json();assert.equal(paidRequest.status,'PAID');assert.equal(paidRequest.payment.id,payment.result.paymentId);assert.equal(paidRequest.payment.refundedAmount,'2000');assert.equal(paidRequest.payment.refundStatus,'PARTIAL');
  assert.deepEqual(await(await request(`/api/v1/commands/REFUND/${refundKey}`)).json(),refund);
  const refundReplay=await mutate(`/api/v1/merchants/${merchant.id}/payments/${payment.result.paymentId}/refunds`,refundBody,refundKey);assert.equal(refundReplay.status,201);assert.deepEqual(await refundReplay.json(),refund);
  const session=await (await request('/api/v1/auth/session')).json();
  assert.equal(session.merchantId,merchant.id);assert.ok(session.roles.includes('MERCHANT'));assert.ok(!session.roles.includes('ADMIN'));
  const restored = await (await request('/api/v1/wallets/me')).json();
  assert.equal(restored.id, original.id); assert.equal(restored.availableBalance, '90000');
  const lookedUp=await request(`/api/v1/commands/TRANSFER/${transferKey}`); assert.equal(lookedUp.status,200); assert.deepEqual(await lookedUp.json(),transfer);
  const replay=await mutate('/api/v1/transfers',transferBody,transferKey); assert.equal(replay.status,201); assert.deepEqual(await replay.json(),transfer);
  assert.equal((await (await request('/api/v1/wallets/me')).json()).availableBalance,'90000');
  const history=await (await request('/api/v1/transactions?type=OUTGOING')).json(); assert.equal(history.items.length,1); assert.equal(history.items[0].id,transfer.resourceId);
  assert.equal((await mutate('/api/v1/auth/login',recipient)).status,200);
  assert.deepEqual(await (await request(`/api/v1/commands/PAYMENT/${paymentKey}`)).json(),payment);
  const paymentReplay=await mutate(`/api/v1/checkout/${checkout.publicRef}/pay`,paymentBody,paymentKey);assert.equal(paymentReplay.status,201);assert.deepEqual(await paymentReplay.json(),payment);
  assert.equal((await (await request('/api/v1/wallets/me')).json()).availableBalance,'7000');
  const incomingRefunds=await(await request('/api/v1/transactions?type=INCOMING')).json();assert.equal(incomingRefunds.items.filter(item=>item.operationType==='REFUND').length,1);
  const refundDetail=await(await request(`/api/v1/transactions/REFUND/${refund.resourceId}`)).json();assert.equal(refundDetail.paymentId,payment.result.paymentId);assert.equal(refundDetail.amount,'2000');
  const payerHistory=await (await request('/api/v1/transactions?type=OUTGOING')).json();assert.equal(payerHistory.items.length,1);assert.equal(payerHistory.items[0].operationType,'PAYMENT');assert.equal(payerHistory.items[0].id,payment.resourceId);
  await stop(); cookie = ''; await start(false);
  const secure = await request('/api/v1/auth/csrf'); assert.equal(secure.status, 200);
  const header = secure.headers.getSetCookie().find(entry => entry.startsWith('JSESSIONID='));
  assert.match(header, /; Secure/i); assert.match(header, /; HttpOnly/i); assert.match(header, /SameSite=Lax/i);
  console.log('PASS: packaged SPA/API routing, restart invalidation, persisted P2P result/replay/history, owned merchant payment/refund capture/lookup/replay/original-payer history/session membership and default Secure/HttpOnly/Lax cookie');
} finally { await stop(); output.end(); }
