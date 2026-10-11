const encoder = new TextEncoder();
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}
export function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}
async function key(value: string) {
  if (!/^[a-f\d]{64}$/i.test(value))
    throw new Error("Configuration key unavailable");
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(value.match(/../g)!, (v) => parseInt(v, 16)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
}
export async function seal(value: unknown, secret: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await key(secret),
    encoder.encode(JSON.stringify(value))
  );
  return JSON.stringify({
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(data))
  });
}
export async function unseal<T>(
  value: string,
  secret: string,
  context: string
): Promise<T> {
  const payload = JSON.parse(value) as { iv: number[]; data: number[] };
  const data = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(payload.iv),
      additionalData: encoder.encode(context)
    },
    await key(secret),
    new Uint8Array(payload.data)
  );
  return JSON.parse(new TextDecoder().decode(data)) as T;
}
