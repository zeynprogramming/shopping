const express = require('express');
const { db } = require('../db');
const { AppError } = require('../utils/errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function buildCartResponse(userId) {
  const rows = db.prepare(`
    SELECT
      ci.product_id, ci.quantity, ci.price_when_added,
      p.title, p.price_amd as current_price_amd, p.stock, p.is_published, p.seller_id,
      u.store_name as seller_store_name,
      (SELECT file_path FROM product_images WHERE product_id = p.id ORDER BY position ASC LIMIT 1) as main_image
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    JOIN users u ON u.id = p.seller_id
    WHERE ci.user_id = ?
    ORDER BY p.seller_id ASC, p.id ASC
  `).all(userId);

  const groupsMap = new Map();
  let grandTotalAmd = 0;
  let totalItemsCount = 0;

  for (const r of rows) {
    const priceChanged = r.price_when_added !== r.current_price_amd;
    const outOfStock = !r.is_published || r.stock <= 0;
    const exceedsStock = r.quantity > r.stock;
    const lineTotal = r.current_price_amd * r.quantity;

    if (!outOfStock) {
      grandTotalAmd += lineTotal;
    }
    totalItemsCount += r.quantity;

    if (!groupsMap.has(r.seller_id)) {
      groupsMap.set(r.seller_id, {
        seller_id: r.seller_id,
        seller_store_name: r.seller_store_name,
        subtotal_amd: 0,
        items: []
      });
    }
    const group = groupsMap.get(r.seller_id);
    if (!outOfStock) {
      group.subtotal_amd += lineTotal;
    }
    group.items.push({
      ...r,
      line_total_amd: lineTotal,
      price_changed: priceChanged,
      out_of_stock: outOfStock,
      exceeds_stock: exceedsStock
    });
  }

  return {
    groups: Array.from(groupsMap.values()),
    grand_total_amd: grandTotalAmd,
    total_items_count: totalItemsCount
  };
}

router.get('/cart', requireAuth, (req, res) => {
  res.json(buildCartResponse(req.user.id));
});

router.put('/cart/items/:productId', requireAuth, (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    const quantity = Number(req.body && req.body.quantity);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be a positive integer.');
    }

    const product = db.prepare('SELECT id, seller_id, price_amd, stock, is_published FROM products WHERE id = ?').get(productId);
    if (!product || !product.is_published) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found or unavailable.');
    }
    if (product.seller_id === req.user.id) {
      throw new AppError(403, 'SELF_PURCHASE_FORBIDDEN', 'You cannot buy your own products.');
    }
    if (quantity > product.stock) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${product.stock} unit(s) available in stock.`);
    }

    db.prepare(`
      INSERT INTO cart_items (user_id, product_id, quantity, price_when_added)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, product_id) DO UPDATE SET
        quantity = excluded.quantity,
        price_when_added = excluded.price_when_added
    `).run(req.user.id, productId, quantity, product.price_amd);

    res.json(buildCartResponse(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.delete('/cart/items/:productId', requireAuth, (req, res) => {
  const productId = Number(req.params.productId);
  db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, productId);
  res.json(buildCartResponse(req.user.id));
});

module.exports = router;
