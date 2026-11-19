const express = require('express');
const { db } = require('../db');
const { AppError } = require('../utils/errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const ARMENIA_REGIONS = new Set([
  'Yerevan', 'Aragatsotn', 'Ararat', 'Armavir', 'Gegharkunik',
  'Kotayk', 'Lori', 'Shirak', 'Syunik', 'Tavush', 'Vayots Dzor'
]);

function getOrderDetails(orderId, buyerId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?').get(orderId, buyerId);
  if (!order) return null;

  const sellerOrders = db.prepare(`
    SELECT so.*, u.store_name as seller_store_name
    FROM seller_orders so
    JOIN users u ON u.id = so.seller_id
    WHERE so.order_id = ?
    ORDER BY so.id ASC
  `).all(orderId);

  for (const so of sellerOrders) {
    so.items = db.prepare(`
      SELECT oi.*,
        EXISTS(SELECT 1 FROM reviews r WHERE r.product_id = oi.product_id AND r.buyer_id = ?) as has_reviewed
      FROM order_items oi
      WHERE oi.seller_order_id = ?
    `).all(buyerId, so.id);

    so.history = db.prepare(`
      SELECT sh.*, u.name as changed_by_name
      FROM status_history sh
      JOIN users u ON u.id = sh.changed_by
      WHERE sh.seller_order_id = ?
      ORDER BY sh.id ASC
    `).all(so.id);
  }

  return { ...order, seller_orders: sellerOrders };
}

// Get buyer's last used address for pre-filling checkout
router.get('/orders/last-address', requireAuth, (req, res) => {
  const last = db.prepare(`
    SELECT recipient, phone, region, city, street, apartment, note
    FROM orders
    WHERE buyer_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(req.user.id);
  res.json({ address: last || null });
});

// Checkout in one BEGIN IMMEDIATE transaction
router.post('/orders', requireAuth, (req, res, next) => {
  try {
    const { recipient, phone, region, city, street, apartment = '', note = '', request_key } = req.body || {};

    if (!request_key || typeof request_key !== 'string') {
      throw new AppError(400, 'MISSING_REQUEST_KEY', 'request_key is required.');
    }
    if (!recipient || !String(recipient).trim()) throw new AppError(400, 'INVALID_RECIPIENT', 'Recipient name is required.');
    if (!phone || !String(phone).trim()) throw new AppError(400, 'INVALID_PHONE', 'Phone is required.');
    if (!region || !ARMENIA_REGIONS.has(String(region))) throw new AppError(400, 'INVALID_REGION', 'Valid Armenian region is required.');
    if (!city || !String(city).trim()) throw new AppError(400, 'INVALID_CITY', 'City or village is required.');
    if (!street || !String(street).trim()) throw new AppError(400, 'INVALID_STREET', 'Street and building are required.');

    // Idempotency check before starting write lock
    const existingOrder = db.prepare('SELECT id, buyer_id FROM orders WHERE request_key = ?').get(request_key);
    if (existingOrder) {
      if (existingOrder.buyer_id !== req.user.id) {
        throw new AppError(409, 'DUPLICATE_REQUEST_KEY', 'Request key conflict.');
      }
      return res.status(200).json({ order: getOrderDetails(existingOrder.id, req.user.id) });
    }

    const checkoutTx = db.transaction(() => {
      // Re-check idempotency inside IMMEDIATE transaction
      const dup = db.prepare('SELECT id, buyer_id FROM orders WHERE request_key = ?').get(request_key);
      if (dup) {
        if (dup.buyer_id !== req.user.id) {
          throw new AppError(409, 'DUPLICATE_REQUEST_KEY', 'Request key conflict.');
        }
        return dup.id;
      }

      const cartRows = db.prepare(`
        SELECT ci.product_id, ci.quantity, ci.price_when_added,
               p.title, p.price_amd, p.stock, p.is_published, p.seller_id
        FROM cart_items ci
        JOIN products p ON p.id = ci.product_id
        WHERE ci.user_id = ?
        ORDER BY p.seller_id ASC, p.id ASC
      `).all(req.user.id);

      if (cartRows.length === 0) {
        throw new AppError(400, 'EMPTY_CART', 'Your cart is empty.');
      }

      let grandTotal = 0;
      const bySeller = new Map();

      for (const item of cartRows) {
        if (item.seller_id === req.user.id) {
          throw new AppError(403, 'SELF_PURCHASE_FORBIDDEN', `Cannot purchase own product: ${item.title}`);
        }
        if (!item.is_published) {
          throw new AppError(409, 'PRODUCT_UNAVAILABLE', `"${item.title}" is no longer available.`);
        }
        if (item.price_when_added !== item.price_amd) {
          throw new AppError(409, 'PRICE_CHANGED', `Price changed for "${item.title}". New price: ${item.price_amd} AMD.`);
        }

        // Atomic conditional stock decrement
        const upd = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?')
          .run(item.quantity, item.product_id, item.quantity);

        if (upd.changes === 0) {
          throw new AppError(409, 'INSUFFICIENT_STOCK', `Insufficient stock for "${item.title}".`);
        }

        const lineTotal = item.price_amd * item.quantity;
        grandTotal += lineTotal;

        if (!bySeller.has(item.seller_id)) {
          bySeller.set(item.seller_id, { subtotal: 0, items: [] });
        }
        const grp = bySeller.get(item.seller_id);
        grp.subtotal += lineTotal;
        grp.items.push(item);
      }

      const now = new Date().toISOString();
      const orderInfo = db.prepare(`
        INSERT INTO orders (buyer_id, recipient, phone, region, city, street, apartment, note, total_amd, request_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.id,
        String(recipient).trim(),
        String(phone).trim(),
        String(region),
        String(city).trim(),
        String(street).trim(),
        String(apartment || '').trim(),
        String(note || '').trim(),
        grandTotal,
        request_key,
        now
      );
      const orderId = Number(orderInfo.lastInsertRowid);

      const insertSellerOrder = db.prepare(`
        INSERT INTO seller_orders (order_id, seller_id, status, subtotal_amd, updated_at)
        VALUES (?, ?, 'placed', ?, ?)
      `);
      const insertOrderItem = db.prepare(`
        INSERT INTO order_items (seller_order_id, product_id, title, unit_price_amd, quantity)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertHistory = db.prepare(`
        INSERT INTO status_history (seller_order_id, from_status, to_status, changed_by, created_at)
        VALUES (?, NULL, 'placed', ?, ?)
      `);

      for (const [sellerId, grp] of bySeller.entries()) {
        const soInfo = insertSellerOrder.run(orderId, sellerId, grp.subtotal, now);
        const soId = Number(soInfo.lastInsertRowid);
        insertHistory.run(soId, req.user.id, now);

        for (const it of grp.items) {
          insertOrderItem.run(soId, it.product_id, it.title, it.price_amd, it.quantity);
        }
      }

      db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
      return orderId;
    });

    // Execute with BEGIN IMMEDIATE
    const orderId = checkoutTx.immediate();
    res.status(201).json({ order: getOrderDetails(orderId, req.user.id) });
  } catch (err) {
    next(err);
  }
});

// List buyer's orders
router.get('/orders', requireAuth, (req, res) => {
  const orders = db.prepare(`
    SELECT id, total_amd, created_at, recipient, city, region
    FROM orders
    WHERE buyer_id = ?
    ORDER BY id DESC
  `).all(req.user.id);

  const getParts = db.prepare(`
    SELECT so.id, so.status, so.subtotal_amd, u.store_name as seller_store_name
    FROM seller_orders so
    JOIN users u ON u.id = so.seller_id
    WHERE so.order_id = ?
    ORDER BY so.id ASC
  `);

  for (const o of orders) {
    o.seller_orders = getParts.all(o.id);
  }

  res.json({ orders });
});

// Buyer order detail
router.get('/orders/:id', requireAuth, (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const details = getOrderDetails(orderId, req.user.id);
    if (!details) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    res.json({ order: details });
  } catch (err) {
    next(err);
  }
});

// Buyer cancels a seller_order (only while placed or confirmed)
router.post('/orders/:id/sellers/:sellerOrderId/cancel', requireAuth, (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const sellerOrderId = Number(req.params.sellerOrderId);

    const cancelTx = db.transaction(() => {
      const so = db.prepare(`
        SELECT so.*
        FROM seller_orders so
        JOIN orders o ON o.id = so.order_id
        WHERE so.id = ? AND so.order_id = ? AND o.buyer_id = ?
      `).get(sellerOrderId, orderId, req.user.id);

      if (!so) {
        throw new AppError(404, 'ORDER_NOT_FOUND', 'Order part not found.');
      }
      if (so.status !== 'placed' && so.status !== 'confirmed') {
        throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Cannot cancel order in "${so.status}" status.`);
      }

      const now = new Date().toISOString();
      db.prepare('UPDATE seller_orders SET status = ?, updated_at = ? WHERE id = ?')
        .run('cancelled', now, so.id);
      db.prepare('INSERT INTO status_history (seller_order_id, from_status, to_status, changed_by, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(so.id, so.status, 'cancelled', req.user.id, now);

      // Restore stock in same transaction
      const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE seller_order_id = ?').all(so.id);
      const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
      for (const it of items) {
        restoreStock.run(it.quantity, it.product_id);
      }
    });

    cancelTx.immediate();
    res.json({ order: getOrderDetails(orderId, req.user.id) });
  } catch (err) {
    next(err);
  }
});

// Leave review on delivered product
router.post('/products/:id/reviews', requireAuth, (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const rating = Number(req.body && req.body.rating);
    const body = String((req.body && req.body.body) || '').trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new AppError(400, 'INVALID_RATING', 'Rating must be an integer between 1 and 5.');
    }

    const reviewTx = db.transaction(() => {
      // Check buyer has a delivered order item for this product
      const delivered = db.prepare(`
        SELECT 1
        FROM order_items oi
        JOIN seller_orders so ON so.id = oi.seller_order_id
        JOIN orders o ON o.id = so.order_id
        WHERE o.buyer_id = ? AND oi.product_id = ? AND so.status = 'delivered'
        LIMIT 1
      `).get(req.user.id, productId);

      if (!delivered) {
        throw new AppError(403, 'REVIEW_NOT_ALLOWED', 'You can only review products from your delivered orders.');
      }

      const existing = db.prepare('SELECT id FROM reviews WHERE product_id = ? AND buyer_id = ?')
        .get(productId, req.user.id);
      if (existing) {
        throw new AppError(409, 'ALREADY_REVIEWED', 'You have already reviewed this product.');
      }

      const now = new Date().toISOString();
      db.prepare('INSERT INTO reviews (product_id, buyer_id, rating, body, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(productId, req.user.id, rating, body, now);

      const stats = db.prepare('SELECT COUNT(*) as cnt, AVG(rating) as avg_r FROM reviews WHERE product_id = ?').get(productId);
      db.prepare('UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?')
        .run(Number(stats.avg_r.toFixed(2)), stats.cnt, productId);
    });

    reviewTx.immediate();
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
