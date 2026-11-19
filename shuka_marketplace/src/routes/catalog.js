const express = require('express');
const { db } = require('../db');
const { AppError } = require('../utils/errors');

const router = express.Router();

router.get('/categories', (req, res) => {
  const categories = db.prepare('SELECT id, name, slug FROM categories ORDER BY id ASC').all();
  res.json({ categories });
});

router.get('/products', (req, res) => {
  const { q = '', category = '', minPrice = '', maxPrice = '', sort = 'newest', page = '1' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limit = 12;
  const offset = (pageNum - 1) * limit;

  const where = ['p.is_published = 1'];
  const params = [];

  if (q && String(q).trim()) {
    where.push('(p.title LIKE ? OR p.description LIKE ?)');
    const term = `%${String(q).trim()}%`;
    params.push(term, term);
  }

  if (category && String(category).trim()) {
    where.push('(c.slug = ? OR c.id = ?)');
    params.push(String(category).trim(), Number(category) || -1);
  }

  if (minPrice !== '' && !Number.isNaN(Number(minPrice))) {
    where.push('p.price_amd >= ?');
    params.push(Number(minPrice));
  }

  if (maxPrice !== '' && !Number.isNaN(Number(maxPrice))) {
    where.push('p.price_amd <= ?');
    params.push(Number(maxPrice));
  }

  let orderBy = 'p.created_at DESC, p.id DESC';
  if (sort === 'price_asc') orderBy = 'p.price_amd ASC, p.id DESC';
  else if (sort === 'price_desc') orderBy = 'p.price_amd DESC, p.id DESC';
  else if (sort === 'rating') orderBy = 'p.rating_avg DESC, p.rating_count DESC, p.id DESC';

  const whereSql = where.join(' AND ');
  const countRow = db.prepare(`
    SELECT COUNT(*) as total
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE ${whereSql}
  `).get(...params);

  const items = db.prepare(`
    SELECT
      p.id, p.title, p.price_amd, p.stock, p.rating_avg, p.rating_count, p.created_at,
      c.name as category_name, c.slug as category_slug,
      u.store_name as seller_store_name,
      (SELECT file_path FROM product_images WHERE product_id = p.id ORDER BY position ASC LIMIT 1) as main_image
    FROM products p
    JOIN categories c ON c.id = p.category_id
    JOIN users u ON u.id = p.seller_id
    WHERE ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({
    items,
    total: countRow.total,
    page: pageNum,
    totalPages: Math.max(1, Math.ceil(countRow.total / limit))
  });
});

router.get('/products/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = db.prepare(`
      SELECT
        p.*, c.name as category_name, c.slug as category_slug,
        u.store_name as seller_store_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN users u ON u.id = p.seller_id
      WHERE p.id = ? AND p.is_published = 1
    `).get(id);

    if (!product) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    }

    const images = db.prepare('SELECT id, file_path, position FROM product_images WHERE product_id = ? ORDER BY position ASC').all(id);
    const reviews = db.prepare(`
      SELECT r.id, r.rating, r.body, r.created_at, u.name as buyer_name
      FROM reviews r
      JOIN users u ON u.id = r.buyer_id
      WHERE r.product_id = ?
      ORDER BY r.created_at DESC
    `).all(id);

    res.json({ product, images, reviews });
  } catch (err) {
    next(err);
  }
});

router.get('/products/:id/reviews', (req, res) => {
  const id = Number(req.params.id);
  const reviews = db.prepare(`
    SELECT r.id, r.rating, r.body, r.created_at, u.name as buyer_name
    FROM reviews r
    JOIN users u ON u.id = r.buyer_id
    WHERE r.product_id = ?
    ORDER BY r.created_at DESC
  `).all(id);
  res.json({ reviews });
});

module.exports = router;
