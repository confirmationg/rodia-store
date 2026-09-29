const db = require('./db');
const wa = require('./whatsapp');
const ai = require('./ai');

const ADMIN = process.env.ADMIN_PHONE;
const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };
const notifyAdmin = (t) => (ADMIN ? wa.text(ADMIN, t) : null);
const log = (phone, body) => db.prepare("INSERT INTO messages(phone,direction,body) VALUES(?,'in',?)").run(phone, body);

const get = (phone) => db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);
function customer(phone, name) {
  if (!get(phone)) db.prepare('INSERT INTO customers(phone,name) VALUES(?,?)').run(phone, name || '');
  return get(phone);
}
function save(phone, f) {
  const k = Object.keys(f);
  db.prepare(`UPDATE customers SET ${k.map((x) => x + '=?').join(',')} WHERE phone=?`)
    .run(...k.map((x) => (typeof f[x] === 'object' ? JSON.stringify(f[x]) : f[x])), phone);
}

// Cart lines always use the latest approved price and current stock
function lines(c) {
  const out = [];
  for (const i of J(c.cart) || []) {
    const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(i.id);
    if (p && p.stock > 0) out.push({ id: p.id, name: p.name, price: p.price, qty: Math.min(i.qty, p.stock) });
  }
  return out;
}
const summary = (ls) => ls.map((l) => `${l.name} × ${l.qty} = ${naira(l.price * l.qty)}`).join('\n');
const sub = (ls) => ls.reduce((s, l) => s + l.price * l.qty, 0);
const fee = (addr) => {
  const z = db.prepare('SELECT * FROM zones').all().find((z) => addr.toLowerCase().includes(z.keyword.toLowerCase()));
  return z ? z.fee : +process.env.DEFAULT_DELIVERY_FEE || 0;
};

/* ---------- screens ---------- */
const menu = (to, name) =>
  wa.list(to, `Welcome to RODIA Store 🛒${name ? ', ' + name : ''}\nTip: type "search rice" to find a product.`, 'Open menu', [
    { id: 'm:shop', title: '🛍 Shop Products' },
    { id: 'm:cart', title: '🧺 My Cart' },
    { id: 'm:orders', title: '📦 My Orders / Track' },
    { id: 'm:admin', title: '👤 Talk to RODIA Admin' },
  ]);

function categories(to) {
  const r = db.prepare('SELECT category, COUNT(*) n FROM products WHERE active=1 AND stock>0 GROUP BY category LIMIT 10').all();
  if (!r.length) return wa.text(to, 'No products are available right now.');
  return wa.list(to, 'Choose a category', 'Categories', r.map((x) => ({ id: `c:${x.category}:0`, title: x.category, description: `${x.n} items` })));
}

function products(to, cat, page = 0) {
  const rows = db.prepare('SELECT * FROM products WHERE active=1 AND stock>0 AND category=? ORDER BY name LIMIT 10 OFFSET ?').all(cat, page * 9);
  if (!rows.length) return wa.text(to, 'No items in this category.');
  const items = rows.slice(0, 9).map((p) => ({ id: 'p:' + p.id, title: p.name, description: `${naira(p.price)} · ${p.description || ''}` }));
  if (rows.length > 9) items.push({ id: `c:${cat}:${page + 1}`, title: 'More items ➡️' });
  return wa.list(to, `*${cat}*`, 'View items', items);
}

async function product(to, id) {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!p || !p.active || p.stock < 1) return wa.text(to, 'Sorry, that item is unavailable.');
  const cap = `*${p.name}*\n${p.description || ''}\nPrice: ${naira(p.price)}\nIn stock: ${p.stock}`;
  if (p.image_url) await wa.image(to, p.image_url, cap);
  save(to, { state: 'qty', ctx: { pid: id } });
  return wa.buttons(to, (p.image_url ? '' : cap + '\n\n') + 'How many? (or type a number)', [
    { id: `a:${id}:1`, title: 'Add 1' }, { id: `a:${id}:2`, title: 'Add 2' }, { id: `a:${id}:5`, title: 'Add 5' },
  ]);
}

async function add(phone, id, qty) {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!p || !p.active || p.stock < 1) return wa.text(phone, 'Sorry, that item is out of stock.');
  const cart = J(get(phone).cart) || [];
  const ex = cart.find((x) => x.id === id);
  const total = (ex ? ex.qty : 0) + qty;
  if (qty < 1 || total > p.stock) return wa.text(phone, `Only ${p.stock} available for ${p.name}.`);
  if (ex) ex.qty = total; else cart.push({ id, qty });
  save(phone, { cart, state: 'idle' });
  await wa.text(phone, `✅ Added ${qty} × ${p.name}`);
  return showCart(phone);
}

async function showCart(phone) {
  const ls = lines(get(phone));
  if (!ls.length) return wa.buttons(phone, 'Your cart is empty 🧺', [{ id: 'm:shop', title: 'Shop products' }]);
  return wa.buttons(phone, `🧺 *Your cart*\n${summary(ls)}\n\nSubtotal = ${naira(sub(ls))}\n\nTo remove an item, type: remove <item name>`, [
    { id: 'k:out', title: 'Checkout' }, { id: 'm:shop', title: 'Add more' }, { id: 'k:clear', title: 'Clear cart' },
  ]);
}

function removeItem(phone, name) {
  const cart = (J(get(phone).cart) || []).filter((i) => {
    const p = db.prepare('SELECT name FROM products WHERE id=?').get(i.id);
    return !(p && p.name.toLowerCase().includes(name.toLowerCase()));
  });
  save(phone, { cart });
  return showCart(phone);
}

function search(to, q) {
  const like = `%${q.toLowerCase()}%`;
  const rows = db.prepare('SELECT * FROM products WHERE active=1 AND stock>0 AND (lower(name) LIKE ? OR lower(category) LIKE ? OR lower(description) LIKE ?) LIMIT 10').all(like, like, like);
  if (!rows.length) return wa.buttons(to, `No available product matches "${q}".`, [{ id: 'm:shop', title: 'Browse shop' }, { id: 'm:admin', title: 'Ask admin' }]);
  return wa.list(to, `Results for "${q}"`, 'View results', rows.map((p) => ({ id: 'p:' + p.id, title: p.name, description: naira(p.price) })));
}

function addByName(phone, name, qty = 1) {
  const q = name.toLowerCase();
  const p =
    db.prepare('SELECT * FROM products WHERE active=1 AND stock>0 AND lower(name) LIKE ? LIMIT 1').get(`%${q}%`) ||
    db.prepare('SELECT * FROM products WHERE active=1 AND stock>0 AND lower(name) LIKE ? LIMIT 1').get(`%${q.split(' ')[0]}%`);
  if (!p) return false;
  const cart = J(get(phone).cart) || [];
  const ex = cart.find((x) => x.id === p.id);
  const total = Math.min((ex ? ex.qty : 0) + Math.max(1, +qty || 1), p.stock);
  if (ex) ex.qty = total; else cart.push({ id: p.id, qty: total });
  save(phone, { cart });
  return true;
}

/* ---------- checkout ---------- */
async function checkout(phone) {
  const ls = lines(get(phone));
  if (!ls.length) return showCart(phone);
  const min = +process.env.MIN_ORDER || 0;
  if (sub(ls) < min) return wa.text(phone, `Minimum order is ${naira(min)}. Your subtotal is ${naira(sub(ls))}.`);
  return wa.buttons(phone, 'How would you like to receive your order?', [
    { id: 'd:pickup', title: 'Pickup' }, { id: 'd:home', title: 'Home delivery' }, { id: 'd:other', title: 'Other location' },
  ]);
}

function confirm(phone, type, address, f) {
  const ls = lines(get(phone));
  const s = sub(ls);
  save(phone, { state: 'confirm', ctx: { type, address, fee: f } });
  return wa.buttons(phone,
    `🧾 *Order summary*\n${summary(ls)}\n\nProducts = ${naira(s)}\nDelivery (${type}) = ${naira(f)}\n*Total = ${naira(s + f)}*` +
    (type !== 'Pickup' ? `\n📍 ${address}` : ''),
    [{ id: 'o:place', title: 'Place order' }, { id: 'k:cancel', title: 'Cancel' }]);
}

function setAddress(phone, type, addr) {
  const saved = (J(get(phone).addresses) || []).filter((a) => a !== addr);
  saved.unshift(addr);
  save(phone, { addresses: saved.slice(0, 3) });
  return confirm(phone, type, addr, fee(addr));
}

const placeTx = db.transaction((phone, ls, ctx) => {
  for (const l of ls) {
    const r = db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').run(l.qty, l.id, l.qty);
    if (!r.changes) throw new Error(`${l.name} is no longer available in that quantity`);
  }
  const s = sub(ls);
  const n = db.prepare('SELECT COUNT(*) n FROM orders').get().n + 1;
  const no = `RODIA-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
  db.prepare('INSERT INTO orders(order_no,phone,items,subtotal,delivery_type,address,delivery_fee,total,status) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(no, phone, JSON.stringify(ls), s, ctx.type, ctx.address, ctx.fee, s + ctx.fee, 'Awaiting Payment');
  return { no, total: s + ctx.fee };
});

async function place(phone) {
  const c = get(phone);
  const ctx = J(c.ctx) || {};
  const ls = lines(c);
  if (!ls.length || !ctx.type) return menu(phone);
  let o;
  try { o = placeTx(phone, ls, ctx); } catch (e) {
    return wa.text(phone, `⚠️ ${e.message}. Please review your cart.`).then(() => showCart(phone));
  }
  save(phone, { cart: [], state: 'idle', ctx: {} });
  await wa.buttons(phone,
    `✅ Order *${o.no}* placed.\nTotal: *${naira(o.total)}*\n\nPay by bank transfer to:\nBank: ${process.env.BANK_NAME}\nAccount: ${process.env.ACCOUNT_NUMBER}\nName: ${process.env.ACCOUNT_NAME}\n\nUse *${o.no}* as your payment reference, then tap "I've paid". Your order stays *Awaiting Payment* until we confirm.`,
    [{ id: 'paid:' + o.no, title: "I've paid" }, { id: 'm:menu', title: 'Main menu' }]);
  notifyAdmin(`🆕 New order ${o.no}\nCustomer: ${phone}\n${summary(ls)}\n${ctx.type}${ctx.type !== 'Pickup' ? ' - ' + ctx.address : ''}\nTotal: ${naira(o.total)}`);
  const low = ls.map((l) => db.prepare('SELECT * FROM products WHERE id=?').get(l.id)).filter((p) => p.stock <= p.low_stock);
  low.forEach((p) => notifyAdmin(`⚠️ ${p.name} is down to ${p.stock} left.`));
}

function payRef(phone, ref, no) {
  no = no || db.prepare("SELECT order_no FROM orders WHERE phone=? AND status='Awaiting Payment' ORDER BY id DESC").get(phone)?.order_no;
  if (!no) return false;
  db.prepare('UPDATE orders SET pay_ref=? WHERE order_no=?').run(ref, no);
  save(phone, { state: 'idle', ctx: {} });
  wa.text(phone, `Thanks! We've received your payment details for ${no}. Admin will verify and confirm shortly.`);
  notifyAdmin(`💳 Payment reported for ${no} by ${phone}\nRef: ${ref}`);
  return true;
}

/* ---------- orders ---------- */
function orders(phone) {
  const r = db.prepare('SELECT * FROM orders WHERE phone=? ORDER BY id DESC LIMIT 10').all(phone);
  if (!r.length) return wa.buttons(phone, 'You have no orders yet.', [{ id: 'm:shop', title: 'Shop products' }]);
  return wa.list(phone, 'Your recent orders', 'View orders', r.map((o) => ({ id: 'r:' + o.order_no, title: o.order_no, description: `${o.status} · ${naira(o.total)}` })));
}
function orderDetail(phone, no) {
  const o = db.prepare('SELECT * FROM orders WHERE order_no=? AND phone=?').get(no, phone);
  if (!o) return orders(phone);
  return wa.buttons(phone, `*${o.order_no}*\nStatus: ${o.status}\n${summary(J(o.items))}\nDelivery = ${naira(o.delivery_fee)}\nTotal = ${naira(o.total)}`,
    [{ id: 'ro:' + no, title: 'Order again' }, { id: 'm:menu', title: 'Main menu' }]);
}
async function reorder(phone, no) {
  const o = db.prepare('SELECT * FROM orders WHERE order_no=? AND phone=?').get(no, phone);
  if (!o) return orders(phone);
  let skipped = 0;
  for (const i of J(o.items)) {
    const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1 AND stock>0').get(i.id);
    if (!p) { skipped++; continue; }
    addByName(phone, p.name, i.qty);
  }
  if (skipped) await wa.text(phone, `${skipped} item(s) from that order are currently unavailable.`);
  return showCart(phone);
}

function talk(phone) {
  save(phone, { human: 1, state: 'idle' });
  notifyAdmin(`👤 ${phone} wants to talk to admin. Reply from the dashboard (Chats tab).`);
  return wa.text(phone, "You're now connected to RODIA Admin 👤. Type your message and we'll reply here. Send *menu* to go back to the shop.");
}

/* ---------- routing ---------- */
async function route(phone, id) {
  const [k, a, b] = id.split(':');
  const c = get(phone);
  switch (k) {
    case 'm':
      if (a === 'shop') return categories(phone);
      if (a === 'cart') return showCart(phone);
      if (a === 'orders') return orders(phone);
      if (a === 'admin') return talk(phone);
      return menu(phone, c.name);
    case 'c': return products(phone, a, +b);
    case 'p': return product(phone, +a);
    case 'a': return add(phone, +a, +b);
    case 'k':
      if (a === 'out') return checkout(phone);
      if (a === 'clear') { save(phone, { cart: [], state: 'idle' }); return wa.text(phone, 'Cart cleared.'); }
      save(phone, { state: 'idle', ctx: {} });
      return menu(phone, c.name);
    case 'd': {
      if (a === 'pickup') return confirm(phone, 'Pickup', 'Pickup', 0);
      const type = a === 'home' ? 'Home delivery' : 'Other location';
      const saved = J(c.addresses) || [];
      if (a === 'home' && saved.length) {
        save(phone, { state: 'delivery', ctx: { type } });
        return wa.buttons(phone, `Deliver to your saved address?\n📍 ${saved[0]}`, [{ id: 'u:use', title: 'Use this address' }, { id: 'u:new', title: 'New address' }]);
      }
      save(phone, { state: 'addr', ctx: { type } });
      return wa.text(phone, 'Send your delivery address (add a landmark and phone number if possible).');
    }
    case 'u': {
      const ctx = J(c.ctx) || {};
      const saved = J(c.addresses) || [];
      if (a === 'use' && saved.length) return setAddress(phone, ctx.type || 'Home delivery', saved[0]);
      save(phone, { state: 'addr', ctx: { type: ctx.type || 'Home delivery' } });
      return wa.text(phone, 'Send your new delivery address (add a landmark and phone number if possible).');
    }
    case 'o': return place(phone);
    case 'paid':
      save(phone, { state: 'payref', ctx: { no: a } });
      return wa.text(phone, `Please send your transfer reference or a screenshot of the receipt for ${a}.`);
    case 'r': return orderDetail(phone, id.slice(2));
    case 'ro': return reorder(phone, id.slice(3));
    default: return menu(phone, c.name);
  }
}

function rules(t) {
  const l = t.toLowerCase();
  let m;
  if (/^(hi|hello|hey|start|good (morning|afternoon|evening))/.test(l)) return { intent: 'greeting' };
  if ((m = l.match(/^(search|find)\s+(.+)/))) return { intent: 'search', query: m[2] };
  if (/cart/.test(l)) return { intent: 'cart' };
  if (/checkout/.test(l)) return { intent: 'checkout' };
  if (/order|track/.test(l)) return { intent: 'orders' };
  if (/admin|human|agent|help/.test(l)) return { intent: 'admin' };
  if (/shop|product|catalog/.test(l)) return { intent: 'shop' };
  return { intent: 'search', query: t };
}

async function handle(m) {
  const phone = m.from;
  const c = customer(phone, m.name);

  if (m.type === 'interactive') {
    const i = m.interactive;
    const id = (i.button_reply || i.list_reply).id;
    log(phone, id);
    return route(phone, id);
  }
  if (m.type === 'image' || m.type === 'document') {
    log(phone, '[media]');
    if (c.human) return notifyAdmin(`📎 ${phone} sent a media file.`);
    const ref = 'screenshot:' + (m.image || m.document).id;
    const no = c.state === 'payref' ? (J(c.ctx) || {}).no : null;
    if (!payRef(phone, ref, no)) wa.text(phone, 'Thanks! Send *menu* to see options.');
    return;
  }
  if (m.type !== 'text') return;

  const t = m.text.body.trim();
  const l = t.toLowerCase();
  log(phone, t);
  if (l === 'menu') { save(phone, { human: 0, state: 'idle', ctx: {} }); return menu(phone, c.name); }
  if (c.human) return notifyAdmin(`📩 ${phone}${c.name ? ' (' + c.name + ')' : ''}: ${t}`);

  const ctx = J(c.ctx) || {};
  if (c.state === 'qty' && /^\d{1,3}$/.test(t)) return add(phone, ctx.pid, +t);
  if (c.state === 'addr') return setAddress(phone, ctx.type, t);
  if (c.state === 'payref') { payRef(phone, t, ctx.no); return; }
  if (/^paid\b/i.test(t) && payRef(phone, t)) return;
  let r;
  if ((r = l.match(/^remove\s+(.+)/))) return removeItem(phone, r[1]);

  const u = (await ai.understand(t)) || rules(t);
  switch (u.intent) {
    case 'greeting': return menu(phone, c.name);
    case 'shop': return categories(phone);
    case 'cart': return showCart(phone);
    case 'checkout': return checkout(phone);
    case 'orders': return orders(phone);
    case 'admin': return talk(phone);
    case 'add': {
      const missed = [];
      for (const it of u.items || []) if (!addByName(phone, it.name, it.qty)) missed.push(it.name);
      if (missed.length) await wa.text(phone, `I couldn't find: ${missed.join(', ')}.`);
      return showCart(phone);
    }
    case 'search': return search(phone, u.query || t);
    default:
      if (u.reply) await wa.text(phone, u.reply);
      return menu(phone, c.name);
  }
}

module.exports = { handle };
