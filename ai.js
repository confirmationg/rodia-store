const db = require('./db');

const providers = () => [
  {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },
  {
    name: 'nvidia',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    key: process.env.NVIDIA_API_KEY,
    model: process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct',
  },
];

// Tries Groq first, then NVIDIA. Returns null if both fail (bot falls back to keyword rules).
async function chat(messages) {
  for (const p of providers()) {
    if (!p.key) continue;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(p.url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: p.model, messages, temperature: 0.2, max_tokens: 400 }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const out = d.choices?.[0]?.message?.content;
      if (out) return out;
    } catch (e) {
      console.error(`[ai] ${p.name} failed: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function understand(text) {
  const names = db.prepare('SELECT name FROM products WHERE active=1 AND stock>0 LIMIT 150').all().map((x) => x.name).join(', ');
  const out = await chat([
    {
      role: 'system',
      content:
        `You are the assistant for RODIA Store, a WhatsApp shop in Nigeria. Classify the customer's message. ` +
        `Reply with ONLY JSON: {"intent":"greeting|shop|search|add|cart|checkout|orders|admin|other","query":"","items":[{"name":"","qty":1}],"reply":""}. ` +
        `Use "add" when they want to buy items (match names to the catalogue). Use "search" when looking for a product. ` +
        `Use "other" for general questions and put a short friendly answer (max 2 sentences, never invent prices or stock) in "reply". ` +
        `Catalogue: ${names}`,
    },
    { role: 'user', content: text },
  ]);
  if (!out) return null;
  try {
    return JSON.parse(out.match(/\{[\s\S]*\}/)[0]);
  } catch {
    return null;
  }
}

module.exports = { chat, understand };
