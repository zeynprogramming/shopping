require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { runMigrations } = require('./db/migrate');
const { attachUser } = require('./middleware/auth');
const { UPLOADS_DIR } = require('./middleware/upload');
const { errorHandler, AppError } = require('./utils/errors');

const authRoutes = require('./routes/auth');
const catalogRoutes = require('./routes/catalog');
const cartRoutes = require('./routes/cart');
const ordersRoutes = require('./routes/orders');
const sellerRoutes = require('./routes/seller');

runMigrations();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(attachUser);

// Serve uploaded images
app.use('/uploads', express.static(UPLOADS_DIR));

// REST JSON API
app.use('/api', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api', cartRoutes);
app.use('/api', ordersRoutes);
app.use('/api', sellerRoutes);

app.use('/api/*', (req, res, next) => {
  next(new AppError(404, 'API_NOT_FOUND', 'API endpoint not found.'));
});

// Serve responsive frontend SPA
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Shuka Marketplace running at http://localhost:${PORT}`);
  });
}

module.exports = app;
