const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH || 'rodia.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, name TEXT, category TEXT, description TEXT DEFAULT '',
  price INTEGER, stock INTEGER DEFAULT 0, image_url TEXT DEFAULT '', active INTEGER DEFAULT 1, low_stock INTEGER DEFAULT 10);
CREATE TABLE IF NOT EXISTS price_history(
  id INTEGER PRIMARY KEY, product_id INTEGER, old_price INTEGER, new_price INTEGER, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS customers(
  phone TEXT PRIMARY KEY, name TEXT DEFAULT '', addresses TEXT DEFAULT '[]', state TEXT DEFAULT 'idle',
  ctx TEXT DEFAULT '{}', cart TEXT DEFAULT '[]', human INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, order_no TEXT UNIQUE, phone TEXT, items TEXT, subtotal INTEGER, delivery_type TEXT,
  address TEXT, delivery_fee INTEGER DEFAULT 0, total INTEGER, status TEXT, pay_ref TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS zones(id INTEGER PRIMARY KEY, keyword TEXT, fee INTEGER);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, phone TEXT, direction TEXT, body TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

if (!db.prepare('SELECT COUNT(*) n FROM products').get().n) {
  const ins = db.prepare('INSERT INTO products(name,category,description,price,stock) VALUES(?,?,?,?,?)');
  [
    ['Indomie Chicken 70g', 'Provisions', 'Instant noodles, 70g', 400, 100],
    ['Peak Milk 400g', 'Provisions', 'Powdered milk tin', 2500, 30],
    ['Rice 5kg', 'Foodstuff', 'Local long grain', 9500, 20],
    ['Detergent 500g', 'Household', 'Washing powder', 1500, 40],
  ].forEach((p) => ins.run(...p));
}
if (!db.prepare('SELECT COUNT(*) n FROM zones').get().n) {
  db.prepare('INSERT INTO zones(keyword,fee) VALUES(?,?)').run('calabar', 1000);
}

module.exports = db;
