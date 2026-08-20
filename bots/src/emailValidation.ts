import { disposableEmailBlocklistSet } from "disposable-email-domains-js";

const disposableDomains = disposableEmailBlocklistSet();
const EMAIL_MAX_LENGTH = 254;
const LOCAL_PART_MAX_LENGTH = 64;

export type EmailValidationResult =
  | { ok: true; email: string; domain: string }
  | { ok: false; reason: "invalid_format" | "disposable_domain" | "undeliverable_domain" };

type DnsAnswer = { type?: number; data?: string };
type DnsJsonResponse = { Status?: number; Answer?: DnsAnswer[] };

export function normalizeEmailAddress(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX_LENGTH) return null;
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator !== email.indexOf("@")) return null;

  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (!local || local.length > LOCAL_PART_MAX_LENGTH || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return null;
  if (!domain || domain.length > 253 || !domain.includes(".")) return null;

  const labels = domain.split(".");
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return null;
  if (labels.at(-1)!.length < 2) return null;
  return email;
}

export function isDisposableEmailDomain(domain: string): boolean {
  const labels = domain.trim().toLowerCase().split(".").filter(Boolean);
  for (let index = 0; index < labels.length - 1; index += 1) {
    if (disposableDomains.has(labels.slice(index).join("."))) return true;
  }
  return false;
}

async function dnsQuery(domain: string, type: "MX" | "A" | "AAAA", fetcher: typeof fetch): Promise<DnsJsonResponse | null> {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", domain);
  url.searchParams.set("type", type);
  try {
    const response = await fetcher(url, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return await response.json() as DnsJsonResponse;
  } catch {
    return null;
  }
}

export async function hasDeliverableEmailDomain(domain: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const mx = await dnsQuery(domain, "MX", fetcher);
  if (!mx || mx.Status !== 0) return false;
  const mxAnswers = (mx.Answer ?? []).filter((answer) => answer.type === 15);
  if (mxAnswers.some((answer) => /^\s*0\s+\.\s*$/.test(answer.data ?? ""))) return false;
  if (mxAnswers.length > 0) return true;

  const [a, aaaa] = await Promise.all([
    dnsQuery(domain, "A", fetcher),
    dnsQuery(domain, "AAAA", fetcher),
  ]);
  return [a, aaaa].some((result) => result?.Status === 0 && (result.Answer ?? []).some((answer) => answer.type === 1 || answer.type === 28));
}

export async function validateEmailAddress(raw: string, fetcher: typeof fetch = fetch): Promise<EmailValidationResult> {
  const email = normalizeEmailAddress(raw);
  if (!email) return { ok: false, reason: "invalid_format" };
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (isDisposableEmailDomain(domain)) return { ok: false, reason: "disposable_domain" };
  if (!(await hasDeliverableEmailDomain(domain, fetcher))) return { ok: false, reason: "undeliverable_domain" };
  return { ok: true, email, domain };
}
