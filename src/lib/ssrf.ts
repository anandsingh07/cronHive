import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guard for user-supplied callback URLs.
 *
 * Without this, a caller could register a job whose callbackUrl points at internal
 * infrastructure — cloud metadata endpoints (169.254.169.254), localhost, or RFC1918
 * private ranges — turning the worker into a confused-deputy that makes requests on the
 * attacker's behalf. We validate the scheme and resolve the host, rejecting any address
 * that lands in a private / loopback / link-local / reserved range.
 *
 * Set CRONHIVE_ALLOW_PRIVATE_CALLBACKS=true to bypass in local/dev where callbacks point
 * at localhost on purpose.
 */

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // be conservative
  const [a, b] = p;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this" network
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped — validate the embedded v4.
    const v4 = lower.split(":").pop() ?? "";
    if (net.isIPv4(v4)) return isPrivateIPv4(v4);
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unknown format -> reject
}

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
}

export async function assertSafeCallbackUrl(
  rawUrl: string,
  opts: { allowPrivate?: boolean } = {}
): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported scheme ${url.protocol}` };
  }

  if (opts.allowPrivate) return { ok: true };

  // Resolve all A/AAAA records; reject if ANY resolves to a private range (defends
  // against DNS rebinding to a single bad record).
  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    return { ok: false, reason: "host did not resolve" };
  }
  if (addresses.length === 0) return { ok: false, reason: "host did not resolve" };

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      return { ok: false, reason: `resolves to private address ${address}` };
    }
  }
  return { ok: true };
}
