// Browser client for the Azulab API.
//
// Every call goes through one function so errors keep their HTTP status: the
// UI shows "403" as a fact, not as a generic failure message.

export class ApiError extends Error {
  constructor(status, body) {
    const code = body && body.error ? body.error : `http_${status}`;
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function describeError(err) {
  if (err instanceof ApiError) {
    const message = err.body && err.body.message;
    return message ? `${err.status} · ${message}` : `${err.status} · ${err.message}`;
  }
  return err && err.message ? err.message : "request failed";
}

async function request(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(path, { method, cache: "no-store", headers, body });
  const type = res.headers.get("content-type") || "";
  const payload = type.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => "");
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

async function healthOnce() {
  try {
    const res = await fetch("/health", { cache: "no-store" });
    return { ok: res.ok, pod: res.headers.get("x-pod-name") || "unknown" };
  } catch (_err) {
    return { ok: false, pod: null };
  }
}

export const api = {
  config: () => request("/api/config"),
  version: () => request("/version"),
  metrics: () => request("/metrics"),
  self: () => request("/api/self"),

  // /ready answers 503 when the pod is draining; the body is still the useful
  // part, so this call intentionally does not throw on a non-200 status.
  ready: async () => {
    const res = await fetch("/ready", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    return { httpStatus: res.status, body };
  },

  health: healthOnce,

  readyOnce: async () => {
    try {
      const res = await fetch("/ready", { cache: "no-store" });
      return { status: res.status, pod: res.headers.get("x-pod-name") || "unknown" };
    } catch (_err) {
      return { status: 0, pod: null };
    }
  },

  probeReady: async (count = 12) => {
    const results = await Promise.all(Array.from({ length: count }, api.readyOnce));
    const counts = new Map();
    let ok = 0;
    for (const result of results) {
      if (result.status === 200) ok += 1;
      if (!result.pod) continue;
      const entry = counts.get(result.pod) || { pod: result.pod, hits: 0, failed: 0 };
      entry.hits += 1;
      if (result.status !== 200) entry.failed += 1;
      counts.set(result.pod, entry);
    }
    return { total: count, ok, pods: [...counts.values()].sort((a, b) => b.hits - a.hits) };
  },

  probePods: async (count = 12) => {
    const results = await Promise.all(Array.from({ length: count }, healthOnce));
    const counts = new Map();
    for (const result of results) {
      if (!result.ok || !result.pod) continue;
      counts.set(result.pod, (counts.get(result.pod) || 0) + 1);
    }
    const pods = [...counts.entries()]
      .map(([pod, hits]) => ({ pod, hits }))
      .sort((a, b) => b.hits - a.hits);
    return { total: count, ok: results.filter((r) => r.ok).length, pods };
  },

  probe: (action) =>
    request("/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }),

  drops: {
    list: () => request("/api/drops"),
    get: (id) => request(`/api/drops/${id}`),
    upload: (file) =>
      request("/api/drops", {
        method: "POST",
        body: file,
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-filename": encodeURIComponent(file.name),
        },
      }),
    seal: (id) => request(`/api/drops/${id}/seal`, { method: "POST" }),
    verify: (id) => request(`/api/drops/${id}/verify`, { method: "POST" }),
    share: (id, ttlSeconds) =>
      request(`/api/drops/${id}/share`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ttlSeconds }) }),
    remove: (id) => request(`/api/drops/${id}`, { method: "DELETE" }),
    downloadUrl: (id) => `/api/drops/${id}/download`,
  },

  blob: {
    stats: () => request("/api/blob/stats"),
    bulk: (count) => request("/api/blob/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count }) }),
    softDeleteDemo: () => request("/api/blob/soft-delete-demo", { method: "POST" }),
  },

  debug: {
    crash: () => request("/debug/crash", { method: "POST" }),
    // Returns the pod that accepted the drain so the UI can name it.
    drain: async (ttlSeconds = 60) => {
      const res = await fetch(`/debug/fail-readiness?value=true&ttl=${ttlSeconds}`, { method: "POST", cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, body);
      return { pod: res.headers.get("x-pod-name") || "unknown", body };
    },
  },
};
