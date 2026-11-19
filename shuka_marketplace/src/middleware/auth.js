const crypto = require('crypto');
const { db } = require('../db');
const { AppError } = require('../utils/errors');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-shuka-secret-change-in-prod';

function signUserId(userId) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(String(userId)).digest('hex');
  return `${userId}.${sig}`;
}

function verifySessionCookie(cookieVal) {
  if (!cookieVal || typeof cookieVal !== 'string') return null;
  const parts = cookieVal.split('.');
  if (parts.length !== 2) return null;
  const [userIdStr, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(userIdStr).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const id = Number(userIdStr);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function attachUser(req, res, next) {
  const raw = req.cookies && req.cookies.shuka_sid;
  const userId = verifySessionCookie(raw);
  if (userId) {
    const user = db.prepare('SELECT id, email, name, phone, store_name, created_at FROM users WHERE id = ?').get(userId);
    if (user) req.user = user;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required.'));
  }
  next();
}

function requireSeller(req, res, next) {
  if (!req.user) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required.'));
  }
  if (!req.user.store_name) {
    return next(new AppError(403, 'NOT_A_SELLER', 'You must activate a seller store first.'));
  }
  next();
}

module.exports = { signUserId, attachUser, requireAuth, requireSeller };
