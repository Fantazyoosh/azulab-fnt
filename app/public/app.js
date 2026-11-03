// Azulab dashboard — vanilla JS, no framework, no runtime CDN.
// Everything on this page comes from the endpoints the app already exposes:
// /version, /ready, /metrics, /api/message, /health.

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  async function fetchJSON(path, options) {
    const res = await fetch(path, { cache: "no-store", ...options });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }

  function setDot(el, state) {
    if (!el) return;
    el.classList.remove("dot-ok", "dot-warn", "dot-bad");
    if (state === "ok") el.classList.add("dot-ok");
    else if (state === "warn") el.classList.add("dot-warn");
    else if (state === "bad") el.classList.add("dot-bad");
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms)) return "—";
    const total = Math.floor(ms / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function formatTime(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  }

  function runtimeName(pod) {
    if (!pod || pod === "unknown") return "runtime";
    return pod.startsWith("ca-") ? "Container Apps" : "AKS";
  }

  // ---------------------------------------------------------------- status

  async function refreshStatus() {
    try {
      const [version, ready, metrics] = await Promise.all([
        fetchJSON("/version"),
        fetchJSON("/ready"),
        fetchJSON("/metrics"),
      ]);

      $("pod-value").textContent = version.pod || "unknown";
      $("node-value").textContent = version.node || "unknown";
      $("version-value").textContent = version.version || "unknown";

      $("delivery-version").textContent = version.version || "—";
      $("delivery-image").textContent = version.image || "—";
      $("delivery-namespace").textContent = version.namespace || "—";
      $("delivery-started").textContent = formatTime(version.startedAt);

      $("runtime-label").textContent = runtimeName(version.pod);
      setDot($("runtime-dot"), "ok");

      const checks = ready.checks || {};
      const keyVault = checks.keyVault || "unknown";
      const storage = checks.storage || "unknown";

      $("ready-kv").textContent = keyVault;
      $("ready-storage").textContent = storage;
      setDot($("ready-kv-dot"), keyVault === "ok" || keyVault === "not_configured" ? "ok" : "bad");
      setDot($("ready-storage-dot"), storage === "ok" || storage === "not_configured" ? "ok" : "bad");

      const isReady = ready.status === "ready";
      $("ready-label").textContent = isReady ? "ready" : "not ready";
      setDot($("ready-dot"), isReady ? "ok" : "bad");

      $("metric-uptime").textContent = formatDuration(metrics.uptimeMs);
      $("metric-requests").textContent = Number(metrics.requests || 0).toLocaleString("en-US");
      $("metric-errors").textContent = Number(metrics.errors || 0).toLocaleString("en-US");

      const latency = metrics.latencyMs || {};
      $("metric-latency").textContent =
        `${latency.p50 ?? "—"} / ${latency.p95 ?? "—"} / ${latency.p99 ?? "—"} ms`;
    } catch (_err) {
      $("runtime-label").textContent = "runtime unreachable";
      setDot($("runtime-dot"), "bad");
      $("ready-label").textContent = "readiness unknown";
      setDot($("ready-dot"), "warn");
    }
  }

  // --------------------------------------------------------------- message

  async function refreshMessage() {
    try {
      const data = await fetchJSON("/api/message");
      $("message-text").textContent = data.message || "—";
      $("message-source").textContent =
        data.source === "blob" ? "source: Blob Storage" : "source: Key Vault";
    } catch (_err) {
      $("message-text").textContent = "Message unavailable";
      $("message-source").textContent = "source: unreachable";
    }
  }

  async function submitMessage(event) {
    event.preventDefault();
    const input = $("message-input");
    const button = event.target.querySelector("button[type=submit]");
    const message = input.value.trim();

    button.disabled = true;
    try {
      await fetchJSON("/api/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      input.value = "";
      await refreshMessage();
    } catch (_err) {
      $("message-source").textContent = "update failed";
    } finally {
      button.disabled = false;
    }
  }

  // ---------------------------------------------------------------- probe

  async function probePods() {
    const button = $("probe-btn");
    const target = $("pod-bars");
    button.disabled = true;
    target.textContent = "Probing…";

    const counts = new Map();
    try {
      await Promise.all(
        Array.from({ length: 10 }, async () => {
          const res = await fetch("/health", { cache: "no-store" });
          const pod = res.headers.get("x-pod-name") || "unknown";
          counts.set(pod, (counts.get(pod) || 0) + 1);
        })
      );

      const total = 10;
      const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      target.replaceChildren(
        ...rows.map(([pod, count]) => {
          const row = document.createElement("div");
          row.className = "space-y-1";

          const head = document.createElement("div");
          head.className = "flex items-center justify-between gap-3";

          const name = document.createElement("span");
          name.className = "break-all font-mono text-[11px] text-paper";
          name.textContent = pod;

          const value = document.createElement("span");
          value.className = "font-mono text-[11px] text-muted";
          value.textContent = `${count}/${total}`;

          head.append(name, value);

          const track = document.createElement("div");
          track.className = "h-2 w-full rounded-sm bg-line";
          const bar = document.createElement("div");
          bar.className = "bar";
          bar.style.width = `${(count / total) * 100}%`;
          track.append(bar);

          row.append(head, track);
          return row;
        })
      );
    } catch (err) {
      target.textContent = `Probe failed: ${err.message}`;
    } finally {
      button.disabled = false;
    }
  }

  // ----------------------------------------------------------------- tabs

  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

  function activate(name) {
    const known = tabs.some((tab) => tab.id === `tab-${name}`);
    const target = known ? name : "overview";

    tabs.forEach((tab) => {
      const selected = tab.id === `tab-${target}`;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });

    panels.forEach((panel) => {
      const selected = panel.id === `panel-${target}`;
      panel.hidden = !selected;
      panel.classList.toggle("hidden", !selected);
    });

    if (location.hash !== `#${target}`) {
      history.replaceState(null, "", `#${target}`);
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab.id.replace("tab-", "")));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      activate(tabs[next].id.replace("tab-", ""));
    });
  });

  window.addEventListener("hashchange", () => activate(location.hash.replace("#", "")));

  // ----------------------------------------------------------- copy proof

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const label = button.textContent;
      try {
        await copyText(button.getAttribute("data-copy") || "");
        button.textContent = "Copied";
      } catch (_err) {
        button.textContent = "Copy failed";
      }
      setTimeout(() => {
        button.textContent = label;
      }, 1200);
    });
  });

  // ----------------------------------------------------------------- init

  activate(location.hash.replace("#", "") || "overview");
  refreshStatus();
  refreshMessage();
  $("message-form").addEventListener("submit", submitMessage);
  $("probe-btn").addEventListener("click", probePods);

  setInterval(refreshStatus, 5000);
  setInterval(refreshMessage, 15000);
})();
