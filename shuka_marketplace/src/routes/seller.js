const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { AppError } = require('../utils/errors');
const { requireAuth, requireSeller } = require('../middleware/auth');
const { upload, processAndSaveImage, UPLOADS_DIR } = require('../middleware/upload');

const router = express.Router();

const ALLOWED_SELLER_TRANSITIONS = {
  placed: new Set(['confirmed', 'cancelled']),
  confirmed: new Set(['shipped', 'cancelled']),
  shipped: new Set(['delivered']),
  delivered: new Set(),
  cancelled: new Set()
};

// Become a seller
router.post('/seller/activate', requireAuth, (req, res, next) => {
  try {
    const { store_name, phone } = req.body || {};
    if (!store_name || !String(store_name).trim()) {
      throw new AppError(400, 'INVALID_STORE_NAME', 'Store name is required.');
    }
    if (!phone || !String(phone).trim()) {
      throw new AppError(400, 'INVALID_PHONE', 'Phone number is required.');
    }

    const cleanStore = String(store_name).trim();
    const conflict = db.prepare('SELECT id FROM users WHERE store_name = ? AND id != ?').get(cleanStore, req.user.id);
    if (conflict) {
      throw new AppError(409, 'STORE_NAME_TAKEN', 'This store name is already in use.');
    }

    db.prepare('UPDATE users SET store_name = ?, phone = ? WHERE id = ?')
      .run(cleanStore, String(phone).trim(), req.user.id);

    const user = db.prepare('SELECT id, email, name, phone, store_name, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// Seller overview stats (plain SQL as required)
router.get('/seller/overview', requireSeller, (req, res) => {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const counts = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'placed' THEN 1 ELSE 0 END), 0) as to_confirm,
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) as to_ship,
      COALESCE(SUM(CASE WHEN status = 'delivered' AND updated_at >= ? THEN subtotal_amd ELSE 0 END), 0) as revenue_30d_amd
    FROM seller_orders
    WHERE seller_id = ?
  `).get(since30d, req.user.id);

  res.json(counts);
});

// List seller's own products
router.get('/seller/products', requireSeller, (req, res) => {
  const products = db.prepare(`
    SELECT
      p.*, c.name as category_name,
      (SELECT file_path FROM product_images WHERE product_id = p.id ORDER BY position ASC LIMIT 1) as main_image,
      COALESCE((
        SELECT SUM(oi.quantity)
        FROM order_items oi
        JOIN seller_orders so ON so.id = oi.seller_order_id
        WHERE oi.product_id = p.id AND so.status != 'cancelled'
      ), 0) as units_sold
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE p.seller_id = ?
    ORDER BY p.created_at DESC, p.id DESC
  `).all(req.user.id);

  res.json({ products });
});

// Get single seller product (for editing)
router.get('/seller/products/:id', requireSeller, (req, res, next) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND seller_id = ?').get(Number(req.params.id), req.user.id);
    if (!product) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    }
    const images = db.prepare('SELECT id, file_path, position FROM product_images WHERE product_id = ? ORDER BY position ASC').all(product.id);
    res.json({ product, images });
  } catch (err) {
    next(err);
  }
});

// Create product
router.post('/seller/products', requireSeller, (req, res, next) => {
  try {
    const { title, category_id, description, price_amd, stock, is_published = 1 } = req.body || {};
    if (!title || !String(title).trim()) throw new AppError(400, 'INVALID_TITLE', 'Title is required.');
    if (!description || !String(description).trim()) throw new AppError(400, 'INVALID_DESCRIPTION', 'Description is required.');

    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(category_id));
    if (!cat) throw new AppError(400, 'INVALID_CATEGORY', 'Valid category is required.');

    const price = Number(price_amd);
    if (!Number.isInteger(price) || price <= 0) throw new AppError(400, 'INVALID_PRICE', 'Price must be a positive integer in AMD.');

    const stk = Number(stock);
    if (!Number.isInteger(stk) || stk < 0) throw new AppError(400, 'INVALID_STOCK', 'Stock must be 0 or greater.');

    const pub = is_published ? 1 : 0;
    const now = new Date().toISOString();

    const info = db.prepare(`
      INSERT INTO products (seller_id, category_id, title, description, price_amd, stock, is_published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, cat.id, String(title).trim(), String(description).trim(), price, stk, pub, now, now);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
});

// Edit / unpublish product
router.patch('/seller/products/:id', requireSeller, (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id = ? AND seller_id = ?').get(productId, req.user.id);
    if (!existing) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    }

    const { title, category_id, description, price_amd, stock, is_published } = req.body || {};
    const nextTitle = title !== undefined ? String(title).trim() : existing.title;
    const nextDesc = description !== undefined ? String(description).trim() : existing.description;
    const nextCatId = category_id !== undefined ? Number(category_id) : existing.category_id;
    const nextPrice = price_amd !== undefined ? Number(price_amd) : existing.price_amd;
    const nextStock = stock !== undefined ? Number(stock) : existing.stock;
    const nextPub = is_published !== undefined ? (is_published ? 1 : 0) : existing.is_published;

    if (!nextTitle) throw new AppError(400, 'INVALID_TITLE', 'Title cannot be empty.');
    if (!nextDesc) throw new AppError(400, 'INVALID_DESCRIPTION', 'Description cannot be empty.');
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(nextCatId);
    if (!cat) throw new AppError(400, 'INVALID_CATEGORY', 'Valid category is required.');
    if (!Number.isInteger(nextPrice) || nextPrice <= 0) throw new AppError(400, 'INVALID_PRICE', 'Price must be a positive integer.');
    if (!Number.isInteger(nextStock) || nextStock < 0) throw new AppError(400, 'INVALID_STOCK', 'Stock must be >= 0.');

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE products
      SET title = ?, category_id = ?, description = ?, price_amd = ?, stock = ?, is_published = ?, updated_at = ?
      WHERE id = ? AND seller_id = ?
    `).run(nextTitle, nextCatId, nextDesc, nextPrice, nextStock, nextPub, now, productId, req.user.id);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

// Upload product images (1 to 5 max per product)
router.post('/seller/products/:id/images', requireSeller, upload.array('images', 5), async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND seller_id = ?').get(productId, req.user.id);
    if (!product) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    }

    const files = req.files || [];
    if (files.length === 0) {
      throw new AppError(400, 'NO_FILES', 'Please select at least one image.');
    }

    const currentImages = db.prepare('SELECT position FROM product_images WHERE product_id = ? ORDER BY position ASC').all(productId);
    if (currentImages.length + files.length > 5) {
      throw new AppError(400, 'TOO_MANY_IMAGES', 'A product can have at most 5 images.');
    }

    let nextPos = currentImages.length > 0 ? Math.max(...currentImages.map(i => i.position)) + 1 : 1;
    const savedPaths = [];

    // Process images outside DB transaction
    for (const file of files) {
      const filePath = await processAndSaveImage(file.buffer);
      savedPaths.push({ filePath, position: nextPos++ });
    }

    const insertImg = db.prepare('INSERT INTO product_images (product_id, file_path, position) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
      for (const sp of savedPaths) {
        insertImg.run(productId, sp.filePath, sp.position);
      }
    });
    tx();

    const images = db.prepare('SELECT id, file_path, position FROM product_images WHERE product_id = ? ORDER BY position ASC').all(productId);
    res.status(201).json({ images });
  } catch (err) {
    next(err);
  }
});

// Delete a product image
router.delete('/seller/products/:id/images/:imageId', requireSeller, (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const imageId = Number(req.params.imageId);
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND seller_id = ?').get(productId, req.user.id);
    if (!product) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    }

    const img = db.prepare('SELECT id, file_path FROM product_images WHERE id = ? AND product_id = ?').get(imageId, productId);
    if (!img) {
      throw new AppError(404, 'IMAGE_NOT_FOUND', 'Image not found.');
    }

    db.prepare('DELETE FROM product_images WHERE id = ?').run(imageId);

    // Best effort file cleanup
    try {
      const largeAbs = path.join(UPLOADS_DIR, path.basename(img.file_path));
      const thumbAbs = largeAbs.replace('_large.webp', '_thumb.webp');
      if (fs.existsSync(largeAbs)) fs.unlinkSync(largeAbs);
      if (fs.existsSync(thumbAbs)) fs.unlinkSync(thumbAbs);
    } catch (_) {}

    const images = db.prepare('SELECT id, file_path, position FROM product_images WHERE product_id = ? ORDER BY position ASC').all(productId);
    res.json({ images });
  } catch (err) {
    next(err);
  }
});

// List seller's incoming orders
router.get('/seller/orders', requireSeller, (req, res) => {
  const { status = '' } = req.query;
  const params = [req.user.id];
  let statusFilter = '';
  if (status && ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(String(status))) {
    statusFilter = 'AND so.status = ?';
    params.push(String(status));
  }

  const orders = db.prepare(`
    SELECT so.*, o.recipient, o.phone, o.region, o.city, o.street, o.apartment, o.note, o.created_at as order_created_at
    FROM seller_orders so
    JOIN orders o ON o.id = so.order_id
    WHERE so.seller_id = ? ${statusFilter}
    ORDER BY o.created_at DESC, so.id DESC
  `).all(...params);

  const tabCounts = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM seller_orders
    WHERE seller_id = ?
    GROUP BY status
  `).all(req.user.id);

  res.json({ orders, tabCounts });
});

// Seller order detail (strictly scoped to seller_id)
router.get('/seller/orders/:id', requireSeller, (req, res, next) => {
  try {
    const soId = Number(req.params.id);
    const order = db.prepare(`
      SELECT so.*, o.recipient, o.phone, o.region, o.city, o.street, o.apartment, o.note, o.created_at as order_created_at
      FROM seller_orders so
      JOIN orders o ON o.id = so.order_id
      WHERE so.id = ? AND so.seller_id = ?
    `).get(soId, req.user.id);

    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }

    order.items = db.prepare('SELECT * FROM order_items WHERE seller_order_id = ?').all(soId);
    order.history = db.prepare(`
      SELECT sh.*, u.name as changed_by_name
      FROM status_history sh
      JOIN users u ON u.id = sh.changed_by
      WHERE sh.seller_order_id = ?
      ORDER BY sh.id ASC
    `).all(soId);

    res.json({ order });
  } catch (err) {
    next(err);
  }
});

// Seller status transition endpoint
router.post('/seller/orders/:id/status', requireSeller, (req, res, next) => {
  try {
    const soId = Number(req.params.id);
    const toStatus = req.body && req.body.to;

    if (!toStatus || typeof toStatus !== 'string') {
      throw new AppError(400, 'INVALID_STATUS', 'Target status "to" is required.');
    }

    const transitionTx = db.transaction(() => {
      const so = db.prepare('SELECT * FROM seller_orders WHERE id = ? AND seller_id = ?').get(soId, req.user.id);
      if (!so) {
        throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      }

      const allowed = ALLOWED_SELLER_TRANSITIONS[so.status] || new Set();
      if (!allowed.has(toStatus)) {
        throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Cannot transition order from "${so.status}" to "${toStatus}".`);
      }

      const now = new Date().toISOString();
      db.prepare('UPDATE seller_orders SET status = ?, updated_at = ? WHERE id = ?').run(toStatus, now, so.id);
      db.prepare('INSERT INTO status_history (seller_order_id, from_status, to_status, changed_by, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(so.id, so.status, toStatus, req.user.id, now);

      // If seller cancels before shipping, restore stock in same transaction
      if (toStatus === 'cancelled') {
        const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE seller_order_id = ?').all(so.id);
        const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
        for (const it of items) {
          restoreStock.run(it.quantity, it.product_id);
        }
      }
    });

    transitionTx.immediate();

    const updated = db.prepare(`
      SELECT so.*, o.recipient, o.phone, o.region, o.city, o.street, o.apartment, o.note, o.created_at as order_created_at
      FROM seller_orders so
      JOIN orders o ON o.id = so.order_id
      WHERE so.id = ? AND so.seller_id = ?
    `).get(soId, req.user.id);
    updated.items = db.prepare('SELECT * FROM order_items WHERE seller_order_id = ?').all(soId);
    updated.history = db.prepare(`
      SELECT sh.*, u.name as changed_by_name
      FROM status_history sh
      JOIN users u ON u.id = sh.changed_by
      WHERE sh.seller_order_id = ?
      ORDER BY sh.id ASC
    `).all(soId);

    res.json({ order: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
