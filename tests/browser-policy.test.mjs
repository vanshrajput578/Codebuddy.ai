import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBrowserUrl, validateBrowserTarget } from "../computer/browser-policy.mjs";

test("browser URL policy permits only normal HTTP and HTTPS destinations", () => {
  assert.equal(parseBrowserUrl("https://example.com/path#section").href, "https://example.com/path");
  assert.equal(parseBrowserUrl("http://93.184.216.34/").hostname, "93.184.216.34");
  for (const value of [
    "file:///etc/passwd", "javascript:alert(1)", "ftp://example.com",
    "http://user:pass@example.com", "http://localhost", "http://service.local",
    "http://metadata.google.internal", "http://example.com:3000"
  ]) assert.throws(() => parseBrowserUrl(value));
});

test("browser URL policy blocks private, loopback, link-local and reserved IPs", () => {
  for (const address of [
    "127.0.0.1", "10.0.0.2", "172.16.0.1", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "192.0.2.8", "224.0.0.1",
    "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1"
  ]) assert.throws(() => parseBrowserUrl(`http://[${address}]/`.replace("http://[127.", "http://127.")));
});

test("DNS policy rejects any hostname answer that is private or reserved", async () => {
  const lookup = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 }
  ];
  await assert.rejects(validateBrowserTarget("https://example.com", { lookup }), /private|reserved/i);
});

test("DNS policy rejects failed and empty resolutions", async () => {
  await assert.rejects(validateBrowserTarget("https://example.com", { lookup: async () => { throw new Error("dns failure"); } }), /could not be resolved/i);
  await assert.rejects(validateBrowserTarget("https://example.com", { lookup: async () => [] }), /no usable address/i);
});

test("DNS policy permits a hostname only when every resolved address is public", async () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const result = await validateBrowserTarget("https://example.com", { lookup });
  assert.equal(result.hostname, "example.com");
});
