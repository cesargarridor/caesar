import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

const RULES = process.env.RULES_FILE || '../firestore.paid.rules';
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-caesar',
    firestore: { rules: readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8089 },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/billing1/billing/status'), { active: true });
    await setDoc(doc(db, 'users/wl1'), { isWhitelistMember: true });
    await setDoc(doc(db, 'users/free1'), { name: 'x' });
    await setDoc(doc(db, 'users/inactive1/billing/status'), { active: false });
    await setDoc(doc(db, 'users/free1/sync/main'), { blob: 'a', updatedAt: 1, schema: 3 });
  });
});

const db = (uid) => env.authenticatedContext(uid).firestore();
const good = { blob: 'abc', updatedAt: 1, schema: 3 };
const meta = { masterDeviceId: 'd', keyCheck: 'k', updatedAt: 1 };
const team = { blob: 'abc', updatedAt: 1, owner: '' };

for (const uid of ['billing1', 'wl1']) {
  test(`pro (${uid}) escribe sync/main, sync/meta, teams`, async () => {
    await assertSucceeds(setDoc(doc(db(uid), `users/${uid}/sync/main`), good));
    await assertSucceeds(setDoc(doc(db(uid), `users/${uid}/sync/meta`), meta));
    await assertSucceeds(setDoc(doc(db(uid), 'teams/t1'), { ...team, owner: uid }));
  });
}

for (const uid of ['free1', 'inactive1', 'nodoc1']) {
  test(`no-pro (${uid}) bloqueado`, async () => {
    await assertFails(setDoc(doc(db(uid), `users/${uid}/sync/main`), good));
    await assertFails(setDoc(doc(db(uid), `users/${uid}/sync/meta`), meta));
    await assertFails(setDoc(doc(db(uid), 'teams/t1'), { ...team, owner: uid }));
  });
}

test('no-pro puede leer y borrar lo suyo', async () => {
  await assertSucceeds(getDoc(doc(db('free1'), 'users/free1/sync/main')));
  await assertSucceeds(deleteDoc(doc(db('free1'), 'users/free1/sync/main')));
});

test('schema ausente o != 3 rechazado', async () => {
  const d = doc(db('wl1'), 'users/wl1/sync/main');
  await assertFails(setDoc(d, { blob: 'a', updatedAt: 1 }));
  await assertFails(setDoc(d, { blob: 'a', updatedAt: 1, schema: 2 }));
  await assertFails(setDoc(d, { blob: 'a', updatedAt: 1, schema: 4 }));
  await assertFails(setDoc(d, { blob: 'a', updatedAt: 1, schema: '3' }));
});

test('keys extra rechazadas y blob demasiado grande', async () => {
  const d = doc(db('wl1'), 'users/wl1/sync/main');
  await assertFails(setDoc(d, { ...good, extra: 1 }));
  await assertFails(setDoc(d, { ...good, blob: 'x'.repeat(900000) }));
  await assertFails(setDoc(doc(db('wl1'), 'users/wl1/sync/meta'), { ...meta, extra: 1 }));
});

test('usuario no puede escribir su propio users/{uid} (sin auto-whitelist)', async () => {
  await assertFails(setDoc(doc(db('free1'), 'users/free1'), { isWhitelistMember: true }));
  await assertFails(setDoc(doc(db('nodoc1'), 'users/nodoc1'), { isWhitelistMember: true }));
  await assertFails(setDoc(doc(db('wl1'), 'users/wl1'), { isWhitelistMember: false }));
  await assertFails(deleteDoc(doc(db('wl1'), 'users/wl1')));
});

test('billing/status: cliente no escribe, owner lee y borra', async () => {
  await assertFails(setDoc(doc(db('free1'), 'users/free1/billing/status'), { active: true }));
  await assertSucceeds(getDoc(doc(db('billing1'), 'users/billing1/billing/status')));
  await assertSucceeds(deleteDoc(doc(db('billing1'), 'users/billing1/billing/status')));
});

test('no leer datos de otro uid; users/{uid} solo owner', async () => {
  await assertFails(getDoc(doc(db('billing1'), 'users/free1/sync/main')));
  await assertFails(getDoc(doc(db('billing1'), 'users/free1')));
  await assertFails(getDoc(doc(db('billing1'), 'users/wl1/billing/status')));
  await assertSucceeds(getDoc(doc(db('free1'), 'users/free1')));
  await assertFails(setDoc(doc(db('billing1'), 'users/free1/sync/main'), good));
});

test('sin auth no lee ni escribe', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, 'users/free1')));
  await assertFails(setDoc(doc(anon, 'users/wl1/sync/main'), good));
});
