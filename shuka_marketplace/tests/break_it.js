const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');
const app = require('../src/server');

async function startTestServer() {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }
  async req(method, urlPath, body, isFormData = false) {
    const headers = {};
    if (this.cookie) headers['Cookie'] = this.cookie;
    if (body && !isFormData) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${this.baseUrl}${urlPath}`, {
      method,
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
}

async function runTests() {
  const { server, baseUrl } = await startTestServer();
  console.log('Running Shuka Break-It Acceptance Tests on', baseUrl);

  try {
    // Setup Seller A, Seller B, Buyer A, Buyer B
    const sellerA = new Client(baseUrl);
    await sellerA.req('POST', '/api/auth/register', { email: `sa_${Date.now()}@test.am`, password: 'Password123!', name: 'Seller A', phone: '+37491111111' });
    await sellerA.req('POST', '/api/seller/activate', { store_name: `StoreA_${Date.now()}`, phone: '+37491111111' });

    const sellerB = new Client(baseUrl);
    await sellerB.req('POST', '/api/auth/register', { email: `sb_${Date.now()}@test.am`, password: 'Password123!', name: 'Seller B', phone: '+37491222222' });
    await sellerB.req('POST', '/api/seller/activate', { store_name: `StoreB_${Date.now()}`, phone: '+37491222222' });

    const catId = db.prepare('SELECT id FROM categories LIMIT 1').get().id;
    const prodRes = await sellerA.req('POST', '/api/seller/products', {
      title: 'Limited Laptop',
      category_id: catId,
      description: 'Only 3 in stock',
      price_amd: 250000,
      stock: 3
    });
    const limitedProdId = prodRes.data.product.id;

    // TEST 1: Last units (30 concurrent checkouts for 1 unit each when stock = 3)
    const buyers = [];
    for (let i = 0; i < 30; i++) {
      const b = new Client(baseUrl);
      await b.req('POST', '/api/auth/register', { email: `race_${i}_${Date.now()}@test.am`, password: 'Password123!', name: `Buyer ${i}`, phone: '+37493000000' });
      await b.req('PUT', `/api/cart/items/${limitedProdId}`, { quantity: 1 });
      buyers.push(b);
    }

    const raceResults = await Promise.all(
      buyers.map(b => b.req('POST', '/api/orders', {
        recipient: 'Test Buyer', phone: '+37493000000', region: 'Yerevan', city: 'Yerevan', street: 'Abovyan 1',
        request_key: crypto.randomUUID()
      }))
    );
    const okCount = raceResults.filter(r => r.status === 201).length;
    const conflictCount = raceResults.filter(r => r.status === 409).length;
    const finalStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(limitedProdId).stock;
    assert.strictEqual(okCount, 3, 'Expected exactly 3 orders');
    assert.strictEqual(conflictCount, 27, 'Expected 27 responses of 409');
    assert.strictEqual(finalStock, 0, 'Expected final stock to be 0');
    console.log('✓ Test 1 passed: Last units concurrency (3 succeeded, 27 returned 409, stock = 0)');

    // TEST 2: Double click (same request_key twice)
    const p2 = (await sellerA.req('POST', '/api/seller/products', {
      title: 'Keyboard', category_id: catId, description: 'Mech', price_amd: 30000, stock: 10
    })).data.product.id;
    const buyer1 = new Client(baseUrl);
    await buyer1.req('POST', '/api/auth/register', { email: `b1_${Date.now()}@test.am`, password: 'Password123!', name: 'Buyer One', phone: '+37493111111' });
    await buyer1.req('PUT', `/api/cart/items/${p2}`, { quantity: 2 });
    const dupKey = crypto.randomUUID();
    const c1 = await buyer1.req('POST', '/api/orders', { recipient: 'B1', phone: '123', region: 'Yerevan', city: 'Yerevan', street: 'St 1', request_key: dupKey });
    const c2 = await buyer1.req('POST', '/api/orders', { recipient: 'B1', phone: '123', region: 'Yerevan', city: 'Yerevan', street: 'St 1', request_key: dupKey });
    assert.strictEqual(c1.data.order.id, c2.data.order.id, 'Duplicate request_key must return same order');
    assert.strictEqual(db.prepare('SELECT stock FROM products WHERE id = ?').get(p2).stock, 8, 'Stock must only decrement once');
    console.log('✓ Test 2 passed: Double click idempotency');

    // TEST 3 & 4: Price changed before checkout & Old order preserved after product edit
    await buyer1.req('PUT', `/api/cart/items/${p2}`, { quantity: 1 });
    await sellerA.req('PATCH', `/api/seller/products/${p2}`, { price_amd: 35000, title: 'Keyboard Pro' });
    const priceChangedRes = await buyer1.req('POST', '/api/orders', { recipient: 'B1', phone: '123', region: 'Yerevan', city: 'Yerevan', street: 'St 1', request_key: crypto.randomUUID() });
    assert.strictEqual(priceChangedRes.status, 409, 'Checkout must stop with 409 when price changes');

    const oldOrderDetail = await buyer1.req('GET', `/api/orders/${c1.data.order.id}`);
    assert.strictEqual(oldOrderDetail.data.order.seller_orders[0].items[0].title, 'Keyboard');
    assert.strictEqual(oldOrderDetail.data.order.seller_orders[0].items[0].unit_price_amd, 30000);
    console.log('✓ Test 3 & 4 passed: Price change stops checkout; old order preserves snapshot');

    // TEST 5: Someone else's order (403/404)
    const sellerOrderId = c1.data.order.seller_orders[0].id;
    const breachSeller = await sellerB.req('GET', `/api/seller/orders/${sellerOrderId}`);
    assert.ok(breachSeller.status === 403 || breachSeller.status === 404);
    const buyer2 = new Client(baseUrl);
    await buyer2.req('POST', '/api/auth/register', { email: `b2_${Date.now()}@test.am`, password: 'Password123!', name: 'Buyer Two', phone: '+37493222222' });
    const breachBuyer = await buyer2.req('GET', `/api/orders/${c1.data.order.id}`);
    assert.ok(breachBuyer.status === 403 || breachBuyer.status === 404);
    console.log('✓ Test 5 passed: Cross-user order access blocked');

    // TEST 6: Move not allowed (Placed -> Delivered returns 409)
    const badMove = await sellerA.req('POST', `/api/seller/orders/${sellerOrderId}/status`, { to: 'delivered' });
    assert.strictEqual(badMove.status, 409);
    console.log('✓ Test 6 passed: Invalid status transition returns 409');

    // TEST 7: Cancel returns stock
    const cancelRes = await buyer1.req('POST', `/api/orders/${c1.data.order.id}/sellers/${sellerOrderId}/cancel`);
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(db.prepare('SELECT stock FROM products WHERE id = ?').get(p2).stock, 10, 'Stock must be restored to 10');
    console.log('✓ Test 7 passed: Cancelling restores stock');

    // TEST 8: Foreign keys enforced by SQLite
    let fkFailed = false;
    try {
      db.prepare('INSERT INTO order_items (seller_order_id, product_id, title, unit_price_amd, quantity) VALUES (?, 99999999, ?, 1000, 1)')
        .run(sellerOrderId, 'Ghost');
    } catch (e) {
      fkFailed = true;
    }
    assert.strictEqual(fkFailed, true, 'SQLite must reject invalid product_id foreign key');
    console.log('✓ Test 8 passed: Foreign keys enforced by SQLite');

    // TEST 9: Bad upload (30MB file and renamed .exe)
    const fdExe = new FormData();
    fdExe.append('images', new Blob([Buffer.from('MZ fake exe content')], { type: 'image/png' }), 'malware.exe.png');
    const badExeRes = await sellerA.req('POST', `/api/seller/products/${p2}/images`, fdExe, true);
    assert.strictEqual(badExeRes.status, 400);

    const bigBuf = Buffer.alloc(6 * 1024 * 1024, 1); // Exceeds 5MB limit
    const fdBig = new FormData();
    fdBig.append('images', new Blob([bigBuf], { type: 'image/jpeg' }), 'huge.jpg');
    const badBigRes = await sellerA.req('POST', `/api/seller/products/${p2}/images`, fdBig, true);
    assert.strictEqual(badBigRes.status, 400);
    console.log('✓ Test 9 passed: Bad and oversized uploads rejected');

    console.log('\nALL 9 BREAK-IT TESTS PASSED!');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
