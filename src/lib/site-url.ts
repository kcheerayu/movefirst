import "server-only";

export function getSiteUrl() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) throw new Error("NEXT_PUBLIC_SITE_URL is not configured.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("NEXT_PUBLIC_SITE_URL must use http or https.");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("NEXT_PUBLIC_SITE_URL must be an origin without path, credentials, query, or fragment.");
  return url.origin;
}

export function authCallbackUrl(next?: "/auth/reset-password") {
  const callback = `${getSiteUrl()}/auth/callback`;
  return next ? `${callback}?next=${next}` : callback;
}
