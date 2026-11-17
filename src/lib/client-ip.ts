import { BlockList, isIP } from "node:net";

/**
 * عنوان IP الحقيقي للزائر خلف Cloudflare → Render.
 * - Render يضيف IP من اتصل به في آخر X-Forwarded-For (يُقرأ بعدد TRUSTED_PROXY_HOPS).
 * - إذا كان هذا الاتصال من شبكة Cloudflare نثق بترويسة CF-Connecting-IP (تضعها Cloudflare نفسها).
 * - إذا لم يكن من Cloudflare (دخول مباشر على onrender.com) نتجاهل CF-Connecting-IP لأنها قابلة للتزوير.
 * المصدر: https://www.cloudflare.com/ips/
 */
const CLOUDFLARE = new BlockList();
for (const c of [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
]) {
  const [ip, bits] = c.split("/") as [string, string];
  CLOUDFLARE.addSubnet(ip, Number(bits), "ipv4");
}
for (const c of ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"]) {
  const [ip, bits] = c.split("/") as [string, string];
  CLOUDFLARE.addSubnet(ip, Number(bits), "ipv6");
}

export function isCloudflareIp(ip: string): boolean {
  const v = isIP(ip);
  return v === 4 ? CLOUDFLARE.check(ip, "ipv4") : v === 6 ? CLOUDFLARE.check(ip, "ipv6") : false;
}

export function resolveClientIp(h: { xff: string | null; realIp: string | null; cfConnectingIp: string | null }, trustedHops: number): string | null {
  let peer: string | null = null;
  if (h.xff && trustedHops > 0) {
    const parts = h.xff.split(",").map((s) => s.trim()).filter(Boolean);
    peer = parts[Math.max(0, parts.length - trustedHops)] ?? null;
  }
  peer ??= h.realIp;
  const cf = h.cfConnectingIp?.trim() ?? null;
  if (peer && cf && isIP(cf) && isCloudflareIp(peer)) return cf;
  return peer;
}
