export function parseJsonObject<T>(raw: string): T {
  const s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const inner = fence ? fence[1].trim() : s;
  return JSON.parse(inner) as T;
}
