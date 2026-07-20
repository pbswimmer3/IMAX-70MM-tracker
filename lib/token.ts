import crypto from "crypto";

export interface DismissTokenPayload {
  userId: string;
  dropEventId: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLength), "base64");
}

function getSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error("CRON_SECRET is not set; cannot sign/verify tokens");
  }
  return secret;
}

function hmac(payloadB64: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payloadB64).digest("hex");
}

export function sign(payload: DismissTokenPayload): string {
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = hmac(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verify(token: string): DismissTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  try {
    const expected = hmac(payloadB64);
    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(signature, "hex");
    if (
      expectedBuf.length !== actualBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, actualBuf)
    ) {
      return null;
    }

    const json = base64urlToBuffer(payloadB64).toString("utf8");
    const payload = JSON.parse(json);
    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof payload.userId === "string" &&
      typeof payload.dropEventId === "string"
    ) {
      return { userId: payload.userId, dropEventId: payload.dropEventId };
    }
    return null;
  } catch {
    return null;
  }
}
