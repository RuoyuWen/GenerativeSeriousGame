import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NODE_DIR = path.join(ROOT, 'NodeStructure');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(cors({ origin: true }));

function normalizeV1Base(input) {
  if (!input || typeof input !== 'string') return 'https://api.openai.com/v1';
  let u = input.trim().replace(/\/+$/, '');
  if (u.endsWith('/v1/chat/completions')) u = u.slice(0, -'/chat/completions'.length);
  if (u.endsWith('/chat/completions')) u = u.slice(0, -'/chat/completions'.length);
  if (!u.endsWith('/v1')) u = `${u}/v1`;
  return u;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/node-structures', (_req, res) => {
  try {
    const files = ['1.txt', '2.txt', '3.txt', '4.txt', '5.txt'];
    const items = files.map((name) => {
      const id = parseInt(name.replace('.txt', ''), 10);
      const content = fs.readFileSync(path.join(NODE_DIR, name), 'utf8');
      return { id, filename: name, content };
    });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/chat', async (req, res) => {
  const { baseUrl, apiKey, model, messages, temperature = 0.7 } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'apiKey required' });
  const v1 = normalizeV1Base(baseUrl);
  try {
    const r = await fetch(`${v1}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-5.1',
        messages,
        temperature,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data?.error || data });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

app.post('/api/images', async (req, res) => {
  const {
    baseUrl,
    apiKey,
    prompt,
    model = 'gpt-image-1',
    size = '1024x1024',
    quality = 'medium',
    n = 1,
  } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'apiKey required' });
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  const v1 = normalizeV1Base(baseUrl);
  try {
    const r = await fetch(`${v1}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, prompt, size, quality, n }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data?.error || data });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`API proxy http://localhost:${PORT}`);
});
