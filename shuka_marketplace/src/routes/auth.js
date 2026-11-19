const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../db');
const { AppError } = require('../utils/errors');
const { signUserId, requireAuth } = require('../middleware/auth');

const router = express.Router();

function setSessionCookie(res, userId) {
  res.cookie('shuka_sid', signUserId(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

router.post('/auth/register', async (req, res, next) => {
  try {
    const { email, password, name, phone } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new AppError(400, 'INVALID_EMAIL', 'Valid email is required.');
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new AppError(400, 'INVALID_PASSWORD', 'Password must be at least 6 characters.');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new AppError(400, 'INVALID_NAME', 'Name is required.');
    }
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      throw new AppError(400, 'INVALID_PHONE', 'Phone number is required.');
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
    if (existing) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    const hash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const info = db.prepare(
      'INSERT INTO users (email, password_hash, name, phone, store_name, created_at) VALUES (?, ?, ?, ?, NULL, ?)'
    ).run(email.trim(), hash, name.trim(), phone.trim(), now);

    const user = db.prepare('SELECT id, email, name, phone, store_name, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
    setSessionCookie(res, user.id);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new AppError(400, 'MISSING_CREDENTIALS', 'Email and password are required.');
    }
    const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());
    if (!userRow) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    const ok = await bcrypt.compare(String(password), userRow.password_hash);
    if (!ok) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    setSessionCookie(res, userRow.id);
    const { password_hash, ...user } = userRow;
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('shuka_sid');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

router.patch('/me', requireAuth, (req, res, next) => {
  try {
    const { name, phone } = req.body || {};
    const nextName = name !== undefined ? String(name).trim() : req.user.name;
    const nextPhone = phone !== undefined ? String(phone).trim() : req.user.phone;
    if (!nextName || !nextPhone) {
      throw new AppError(400, 'INVALID_INPUT', 'Name and phone cannot be empty.');
    }
    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(nextName, nextPhone, req.user.id);
    const user = db.prepare('SELECT id, email, name, phone, store_name, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
