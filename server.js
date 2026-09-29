require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const wa = require('./whatsapp');
const bot = require('./bot');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (q, s) => s.sendFile(path.join(__dirname, 'public', 'admin.html')));

/* ---------- WhatsApp webhook ---------- */
app.get('/webhook', (q, s) => {
  if (q.query['hub.mode'] === 'subscribe' && q.query['hub.verify_token'] === process.env.VERIFY_TOKEN) return s.send(q.query['hub.challenge']);
  s.sendStatus(403);
});

const seen = new Set();
app.post('/webhook', (q, s) => {
  s.sendStatus(200);
  try {
    const v = q.body.entry?.[0]?.changes?.[0]?.value;
    const m = v?.messages?.[0];
    if (!m || seen.has(m.id)) return;
    seen.add(m.id);
    if (seen.size > 1000) seen.clear();
    m.name = v.contacts?.[0]?.profile?.name;
    bot.handle(m).catch((e) => console.error('[bot]', e));
  } catch (e) {
    console.error('[webhook]', e);
  }
});

/* ---------- Admin API ---------- */
const auth = (q, s, n) => (q.headers['x-admin-password'] === process.env.ADMIN_PASSWORD ? n() : s.status(401).json({ error: 'unauthorized' }));
const A = express.Router();
A.use(auth);
app.use('/api/admin', A);

const STATUSES = ['Order Placed', 'Awaiting Payment', 'Payment Received', 'Admin Confirmed', 'Processing', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'];
const NOTE = {
  'Payment Received': '💰 Payment received for order {no}. Thank you!',
  'Admin Confirmed': '✅ Your order {no} has been confirmed.',
  Processing: '🛠 Your order {no} is being processed.',
  Ready: '📦 Your order {no} is ready.',
  'Out for Delivery': '🚚 Your order {no} is now out for delivery.',
  Delivered: '🎉 Your order {no} has been delivered. Thank you for shopping with RODIA Store!',
  Cancelled: '❌ Your order {no} has been cancelled. Contact admin if you need help.',
};

A.get('/stats', (q, s) => {
  const byStatus = db.prepare('SELECT status, COUNT(*) n FROM orders GROUP BY status').all();
  const sales = db.prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status NOT IN ('Order Placed','Awaiting Payment','Cancelled')").get().t;
  const tally = {};
  db.prepare("SELECT items FROM orders WHERE status!='Cancelled'").all().forEach((o) => JSON.parse(o.items).forEach((i) => (tally[i.name] = (tally[i.name] || 0) + i.qty)));
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const low = db.prepare('SELECT name, stock FROM products WHERE active=1 AND stock<=low_stock ORDER BY stock').all();
  s.json({ byStatus, sales, top, low });
});

A.get('/orders', (q, s) => {
  const st = q.query.status;
  const rows = st ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY id DESC LIMIT 100').all(st) : db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 100').all();
  s.json({ rows, statuses: STATUSES });
});

A.post('/orders/:id/status', (q, s) => {
  const { status } = q.body;
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(q.params.id);
  if (!o || !STATUSES.includes(status)) return s.status(400).json({ error: 'bad request' });
  if (status === 'Cancelled' && o.status !== 'Cancelled') {
    JSON.parse(o.items).forEach((i) => db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(i.qty, i.id));
  }
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, o.id);
  if (NOTE[status]) wa.text(o.phone, NOTE[status].replace('{no}', o.order_no));
  s.json({ ok: 1 });
});

A.get('/products', (q, s) => s.json(db.prepare('SELECT * FROM products ORDER BY category, name').all()));
A.post('/products', (q, s) => {
  const p = q.body;
  const price = Number(p.price), stock = Number(p.stock), low = Number(p.low_stock ?? 10), active = p.active === 0 || p.active === false ? 0 : 1;
  if (!p.name || !p.category || !(price >= 0)) return s.status(400).json({ error: 'name, category and price required' });
  if (p.id) {
    const o = db.prepare('SELECT price FROM products WHERE id=?').get(p.id);
    db.prepare('UPDATE products SET name=?,category=?,description=?,price=?,stock=?,image_url=?,active=?,low_stock=? WHERE id=?')
      .run(p.name, p.category, p.description || '', price, stock || 0, p.image_url || '', active, low, p.id);
    if (o && o.price !== price) db.prepare('INSERT INTO price_history(product_id,old_price,new_price) VALUES(?,?,?)').run(p.id, o.price, price);
  } else {
    db.prepare('INSERT INTO products(name,category,description,price,stock,image_url,active,low_stock) VALUES(?,?,?,?,?,?,?,?)')
      .run(p.name, p.category, p.description || '', price, stock || 0, p.image_url || '', active, low);
  }
  s.json({ ok: 1 });
});

A.get('/zones', (q, s) => s.json(db.prepare('SELECT * FROM zones').all()));
A.post('/zones', (q, s) => {
  db.prepare('INSERT INTO zones(keyword,fee) VALUES(?,?)').run(String(q.body.keyword || '').trim(), Number(q.body.fee) || 0);
  s.json({ ok: 1 });
});
A.delete('/zones/:id', (q, s) => { db.prepare('DELETE FROM zones WHERE id=?').run(q.params.id); s.json({ ok: 1 }); });

A.get('/chats', (q, s) => s.json(db.prepare('SELECT phone, name, human FROM customers WHERE human=1').all()));
A.get('/messages/:phone', (q, s) => s.json(db.prepare('SELECT * FROM messages WHERE phone=? ORDER BY id DESC LIMIT 40').all(q.params.phone).reverse()));
A.post('/reply', (q, s) => {
  const { phone, text, end } = q.body;
  if (text) wa.text(phone, text);
  if (end) {
    db.prepare('UPDATE customers SET human=0 WHERE phone=?').run(phone);
    wa.text(phone, 'Chat with admin ended. Send *menu* to continue shopping 🛒');
  }
  s.json({ ok: 1 });
});

const port = Number(process.env.PORT) || 5000;
app.listen(port, '0.0.0.0', () => console.log('RODIA Store running on port ' + port));
