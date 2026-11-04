// Small DOM helpers. No framework: the page is a set of plain elements built
// with textContent, so user-provided file names are never parsed as HTML.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "attrs") {
      for (const [name, attr] of Object.entries(value)) {
        if (attr === undefined || attr === null || attr === false) continue;
        node.setAttribute(name, attr === true ? "" : String(attr));
      }
    } else if (key === "on") {
      for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
    } else {
      node[key] = value;
    }
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

const DOT_TONES = { ok: "dot-ok", warn: "dot-warn", bad: "dot-bad", muted: "" };
const BADGE_TONES = { ok: "badge-ok", warn: "badge-warn", bad: "badge-bad", accent: "badge-accent", muted: "" };

export function dot(tone = "muted") {
  return el("span", { class: `dot ${DOT_TONES[tone] || ""}`.trim() });
}

export function setDot(node, tone) {
  if (!node) return;
  node.classList.remove("dot-ok", "dot-warn", "dot-bad");
  if (tone === "ok") node.classList.add("dot-ok");
  else if (tone === "warn") node.classList.add("dot-warn");
  else if (tone === "bad") node.classList.add("dot-bad");
}

export function badge(text, tone = "muted") {
  return el("span", { class: `badge ${BADGE_TONES[tone] || ""}`.trim(), text });
}

export function note(text, tone = "muted") {
  return el("div", { class: `note note-${tone}`, text });
}

export function header(label, title, lead) {
  return el(
    "div",
    {},
    el("div", { class: "label", text: label }),
    title ? el("h2", { class: "mt-1 text-xl font-light tracking-tight text-paper", text: title }) : null,
    lead ? el("p", { class: "subtle mt-2", text: lead }) : null
  );
}

export function card(...children) {
  return el("div", { class: "card" }, ...children);
}

export function statRow(label, value) {
  return el(
    "div",
    { class: "stat" },
    el("span", { class: "stat-label", text: label }),
    el("span", { class: "stat-value break-all", text: value })
  );
}

export function codeBlock(text) {
  return el("pre", { class: "proof", text });
}

export function copyButton(value, label = "Copy") {
  const button = el("button", { class: "btn btn-sm", type: "button", text: label });
  button.addEventListener("click", async () => {
    const original = button.textContent;
    try {
      await copyText(typeof value === "function" ? value() : value);
      button.textContent = "Copied";
    } catch (_err) {
      button.textContent = "Copy failed";
    }
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  });
  return button;
}

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = el("textarea", { value: text, readOnly: true });
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

let toastHost = null;

export function toast(message, tone = "ok") {
  if (!toastHost) {
    toastHost = el("div", { class: "toast-host" });
    document.body.append(toastHost);
  }
  const item = el("div", { class: `toast toast-${tone}`, text: message });
  toastHost.append(item);
  setTimeout(() => item.remove(), 4200);
}

export async function withBusy(button, task, busyLabel = "Working…") {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

export function divider() {
  return el("div", { class: "divider" });
}

// A pod name is only meaningful when the platform provides one. Local runs have
// no HOSTNAME and the API reports "unknown"; labelling that as a local process
// is accurate and keeps the page from looking broken.
export function podName(value) {
  if (!value || value === "unknown" || value === "local") return "local process";
  return value;
}

export const fmt = {
  bytes(value) {
    const n = Number(value) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  },

  number(value) {
    return (Number(value) || 0).toLocaleString("en-US");
  },

  time(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });
  },

  duration(ms) {
    if (!Number.isFinite(ms)) return "—";
    const total = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  },

  ms(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n} ms` : "—";
  },

  short(value, length = 12) {
    if (!value) return "—";
    const text = String(value);
    return text.length > length ? `${text.slice(0, length)}…` : text;
  },

  ago(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return `${hours}h ago`;
  },
};
