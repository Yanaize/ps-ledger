const KEY = 'ps-ledger-user';

let memoryId: string | null = null;

/** UUID v4 without crypto.randomUUID, which browsers hide on http:// LAN addresses. */
function createUserId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function readUserId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const id = createUserId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    memoryId ??= createUserId();
    return memoryId;
  }
}
