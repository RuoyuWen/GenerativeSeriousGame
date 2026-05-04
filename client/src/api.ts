import type { AppConfig } from './gameTypes';

const CHAT_PATH = '/api/chat';
const IMAGE_PATH = '/api/images';
const STRUCTURES_PATH = '/api/node-structures';

export async function fetchNodeStructures() {
  const r = await fetch(STRUCTURES_PATH);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{
    items: { id: number; filename: string; content: string }[];
  }>;
}

export function chatMessageText(data: unknown): string {
  const d = data as { choices?: { message?: { content?: string } }[] };
  return d?.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function chatComplete(
  cfg: AppConfig,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  temperature = 0.6,
) {
  const r = await fetch(CHAT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.chatModel,
      messages,
      temperature,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data?.error === 'string' ? data.error : JSON.stringify(data?.error || data));
  return data;
}

export async function imageGenerate(cfg: AppConfig, prompt: string) {
  const r = await fetch(IMAGE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.imageModel,
      prompt,
      size: '1024x1024',
      quality: 'medium',
      n: 1,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data?.error === 'string' ? data.error : JSON.stringify(data?.error || data));
  return data as {
    data?: { url?: string; b64_json?: string }[];
  };
}

export function firstImageDataUrl(res: { data?: { url?: string; b64_json?: string }[] }): string | null {
  const item = res.data?.[0];
  if (!item) return null;
  if (item.url) return item.url;
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  return null;
}

export async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency = 2,
): Promise<void> {
  let i = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) {
      const current = i;
      i += 1;
      try {
        await worker(items[current]);
      } catch {
        /* handled inside worker */
      }
    }
  });
  await Promise.all(runners);
}
