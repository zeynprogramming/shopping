const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { db, DATA_DIR } = require('./index');
const { runMigrations } = require('./migrate');

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

async function generatePlaceholderImage(filename, bgHex, label) {
  const svgLarge = `<svg width="800" height="800" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="800" fill="${bgHex}"/>
    <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="36" fill="#ffffff" text-anchor="middle" dy=".3em">${label}</text>
  </svg>`;
  const largePath = path.join(UPLOADS_DIR, `${filename}_large.webp`);
  const thumbPath = path.join(UPLOADS_DIR, `${filename}_thumb.webp`);

  await sharp(Buffer.from(svgLarge)).resize(800, 800).webp({ quality: 80 }).toFile(largePath);
  await sharp(Buffer.from(svgLarge)).resize(300, 300).webp({ quality: 75 }).toFile(thumbPath);
  return `/uploads/${filename}_large.webp`;
}

async function seed() {
  runMigrations();

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const existingUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (existingUsers > 0) {
    console.log('Database already seeded. Skipping.');
    return;
  }

  const now = new Date().toISOString();
  const hash = await bcrypt.hash('Password123!', 10);

  const categories = [
    { name: 'Electronics', slug: 'electronics' },
    { name: 'Home & Kitchen', slug: 'home-kitchen' },
    { name: 'Clothing & Shoes', slug: 'clothing-shoes' },
    { name: 'Books & Stationery', slug: 'books-stationery' },
    { name: 'Sports & Outdoors', slug: 'sports-outdoors' },
    { name: 'Handmade in Armenia', slug: 'handmade-armenia' }
  ];

  const insertCat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)');
  const catIds = categories.map(c => Number(insertCat.run(c.name, c.slug).lastInsertRowid));

  const insertUser = db.prepare(
    'INSERT INTO users (email, password_hash, name, phone, store_name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  // 3 Sellers
  const sellers = [
    { email: 'seller1@shuka.am', name: 'Armen Petrosyan', phone: '+37491000001', store: 'Yerevan Tech Hub' },
    { email: 'seller2@shuka.am', name: 'Anahit Sargsyan', phone: '+37491000002', store: 'Ararat Home Goods' },
    { email: 'seller3@shuka.am', name: 'Davit Grigoryan', phone: '+37491000003', store: 'Gyumri Craft & Gear' }
  ];
  const sellerIds = sellers.map(s => Number(insertUser.run(s.email, hash, s.name, s.phone, s.store, now).lastInsertRowid));

  // 2 Demo Buyers
  insertUser.run('buyer1@shuka.am', hash, 'Nare Hakobyan', '+37493000001', null, now);
  insertUser.run('buyer2@shuka.am', hash, 'Tigran Vardanyan', '+37493000002', null, now);

  // 42 Products across categories & sellers
  const colors = ['#1e3a8a', '#065f46', '#7c2d12', '#4c1d95', '#831843', '#1f2937'];
  const insertProduct = db.prepare(`
    INSERT INTO products (seller_id, category_id, title, description, price_amd, stock, is_published, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const insertImg = db.prepare('INSERT INTO product_images (product_id, file_path, position) VALUES (?, ?, ?)');

  for (let i = 1; i <= 42; i++) {
    const sellerId = sellerIds[(i - 1) % sellerIds.length];
    const catIdx = (i - 1) % catIds.length;
    const catId = catIds[catIdx];
    const catName = categories[catIdx].name;
    const title = `${catName} Item #${i}`;
    const desc = `High quality ${catName.toLowerCase()} product #${i} available for fast cash-on-delivery across Yerevan and all marzer of Armenia.`;
    const priceAmd = (i * 1500) + 2000;
    const stock = (i % 7) + 2; // 2 to 8 units
    const createdAt = new Date(Date.now() - (42 - i) * 3600 * 1000).toISOString();

    const prodId = Number(insertProduct.run(sellerId, catId, title, desc, priceAmd, stock, createdAt, createdAt).lastInsertRowid);
    const imgPath = await generatePlaceholderImage(`seed_prod_${prodId}_1`, colors[catIdx], `Product #${i}`);
    insertImg.run(prodId, imgPath, 1);
  }

  console.log('Seeded 6 categories, 3 sellers, 2 buyers, and 42 products with images.');
}

if (require.main === module) {
  seed().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seed };
