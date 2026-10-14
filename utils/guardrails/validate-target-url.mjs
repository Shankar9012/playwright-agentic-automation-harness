/**
 * Target URL policy. The harness only drives sites the operator explicitly authorized
 * through BASE_URL / ALLOWED_HOSTS, and never silently swaps one site for another.
 */

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * @typedef {{ ok: true, url: URL } | { ok: false, reason: string }} UrlVerdict
 */

/**
 * Normalize a host allow-list entry (strip scheme/port/path, lowercase).
 * @param {string} entry
 */
export function normalizeHost(entry) {
  const trimmed = entry.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return trimmed;
  }
}

/**
 * True when `host` equals an allowed host or is a subdomain of a `*.`-prefixed entry.
 * @param {string} host
 * @param {string[]} allowedHosts
 */
export function isHostAllowed(host, allowedHosts) {
  const target = host.toLowerCase();
  return allowedHosts.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      return target.endsWith(suffix) && target.length > suffix.length;
    }
    return normalizeHost(entry) === target;
  });
}

/**
 * Validate a target URL against scheme and host policy.
 * @param {string} rawUrl
 * @param {{ allowedHosts: string[] }} policy
 * @returns {UrlVerdict}
 */
export function validateTargetUrl(rawUrl, { allowedHosts }) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { ok: false, reason: 'Target URL is empty. Set BASE_URL.' };
  }
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false, reason: `Target URL "${rawUrl}" is not a valid absolute URL.` };
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: `Scheme "${url.protocol}" is not allowed; use http or https.` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Credentials must not be embedded in the target URL.' };
  }
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    return { ok: false, reason: 'ALLOWED_HOSTS is empty; refusing to target an unapproved host.' };
  }
  if (!isHostAllowed(url.hostname, allowedHosts)) {
    return {
      ok: false,
      reason: `Host "${url.hostname}" is not in ALLOWED_HOSTS (${allowedHosts.join(', ')}). Add it explicitly if it is authorized.`,
    };
  }
  return { ok: true, url };
}
