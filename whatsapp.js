const db = require('./db');

const url = () => `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

async function send(body) {
  try {
    const r = await fetch(url(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
    if (!r.ok) console.error('[wa] send failed', await r.text());
  } catch (e) {
    console.error('[wa] error', e.message);
  }
}

const log = (to, body) => db.prepare("INSERT INTO messages(phone,direction,body) VALUES(?,'out',?)").run(to, body);

const text = (to, body) => {
  log(to, body);
  return send({ to, type: 'text', text: { body } });
};

// buttons: max 3, title <= 20 chars
const buttons = (to, body, btns) => {
  log(to, body);
  return send({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body.slice(0, 1000) },
      action: { buttons: btns.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
    },
  });
};

// list: max 10 rows, title <= 24 chars, description <= 72 chars
const list = (to, body, button, rows) => {
  log(to, body);
  return send({
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body.slice(0, 1000) },
      action: {
        button: button.slice(0, 20),
        sections: [
          {
            title: 'Options',
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  });
};

const image = (to, link, caption) => send({ to, type: 'image', image: { link, caption: (caption || '').slice(0, 1000) } });

module.exports = { text, buttons, list, image };
