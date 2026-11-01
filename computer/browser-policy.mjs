import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]
]) blockedIpv4.addSubnet(network, prefix, "ipv4");

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10],
  ["ff00::", 8], ["2001:db8::", 32], ["2001::", 32], ["2002::", 16],
  ["64:ff9b::", 96], ["64:ff9b:1::", 48]
]) blockedIpv6.addSubnet(network, prefix, "ipv6");

const blockedSuffixes = [
  ".localhost", ".local", ".internal", ".lan", ".home",
  ".test", ".invalid", ".example", ".onion"
];

function blockedIp(address) {
  const value = String(address).split("%")[0].toLowerCase();
  const family = isIP(value);
  if (family === 4) return blockedIpv4.check(value, "ipv4");
  if (family === 6) {
    // IPv4-mapped IPv6 addresses are rejected rather than interpreted ambiguously.
    if (value.startsWith("::ffff:")) return true;
    return blockedIpv6.check(value, "ipv6");
  }
  return true;
}

export function parseBrowserUrl(input) {
  if (typeof input !== "string" || input.length > 2048 || !input.trim()) {
    throw new Error("A valid HTTP or HTTPS URL is required.");
  }
  let url;
  try { url = new URL(input.trim()); }
  catch { throw new Error("A valid HTTP or HTTPS URL is required."); }

  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    throw new Error("Only standard HTTP and HTTPS ports are allowed.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname === "localhost" || blockedSuffixes.some(suffix => hostname.endsWith(suffix))) {
    throw new Error("Local and private hostnames are not allowed.");
  }
  if (hostname.includes("%") || hostname.includes("/") || hostname.includes("\\") || hostname.includes("@")) {
    throw new Error("Invalid browser hostname.");
  }
  if (isIP(hostname) && blockedIp(hostname)) throw new Error("Private, local and reserved IP addresses are not allowed.");

  url.hash = "";
  return url;
}

export async function validateBrowserTarget(input, options = {}) {
  const url = parseBrowserUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!isIP(hostname)) {
    const lookup = options.lookup || dnsLookup;
    let records;
    try { records = await lookup(hostname, { all: true, verbatim: true }); }
    catch { throw new Error("The destination hostname could not be resolved safely."); }
    if (!Array.isArray(records) || records.length === 0) throw new Error("The destination hostname has no usable address.");
    if (records.some(record => !record?.address || blockedIp(record.address))) {
      throw new Error("The destination resolves to a private, local or reserved IP address.");
    }
  }
  return url;
}
