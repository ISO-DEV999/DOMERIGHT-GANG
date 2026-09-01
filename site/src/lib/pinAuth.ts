import { timingSafeEqual } from "crypto";

/**
 * Shared helpers for the API verify PIN routes.
 *
 * These PIN checks only gate which *screen* the client shows — they do not,
 * by themselves, protect the underlying Firestore data (that still depends
 * entirely on Firestore Security Rules; see firestore.rules). Treat these
 * PINs as a UX speed-bump, not a real access-control boundary.
 */

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

// Best-effort, in-memory rate limiting. Resets on server restart / cold
// start and is per-instance only, but it still meaningfully slows down
// naive brute-force attempts against a 6-digit PIN.
const attempts = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > MAX_ATTEMPTS_PER_WINDOW;
}

export function getClientKey(request: Request): string {
  // Best-effort client identifier behind a proxy; falls back to a shared
  // bucket if no forwarding header is present.
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

/** Constant-time comparison so response timing doesn't leak how many
 * characters of the PIN were correct. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    // Still run a comparison of equal length buffers so this branch takes
    // roughly the same time as the equal-length case.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
