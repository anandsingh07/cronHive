import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local and metadata ranges", async () => {
    const { isPrivateAddress } = await import("../../src/lib/ssrf.js");
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.16.5.4")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true); // cloud metadata
    expect(isPrivateAddress("100.64.0.1")).toBe(true); // CGNAT
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
  });

  it("allows public addresses", async () => {
    const { isPrivateAddress } = await import("../../src/lib/ssrf.js");
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("172.15.0.1")).toBe(false); // just outside 172.16/12
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
  });

  it("rejects unknown formats conservatively", async () => {
    const { isPrivateAddress } = await import("../../src/lib/ssrf.js");
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("assertSafeCallbackUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    const { assertSafeCallbackUrl } = await import("../../src/lib/ssrf.js");
    const r = await assertSafeCallbackUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
  });

  it("rejects a URL whose host resolves to loopback", async () => {
    const { assertSafeCallbackUrl } = await import("../../src/lib/ssrf.js");
    const r = await assertSafeCallbackUrl("http://localhost:8080/hook");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private address/);
  });

  it("bypasses checks when allowPrivate is set (dev mode)", async () => {
    const { assertSafeCallbackUrl } = await import("../../src/lib/ssrf.js");
    const r = await assertSafeCallbackUrl("http://localhost:8080/hook", { allowPrivate: true });
    expect(r.ok).toBe(true);
  });
});
