// Page shell: status header, tab routing, lazy mounting.
//
// Each chapter is a module that renders its own panel and returns a refresh
// function. Mounting lazily keeps the first paint light and means a failure in
// one chapter cannot blank the whole page.

import { api, describeError } from "./api.js";
import { $, $$, el, setDot, toast, fmt } from "./ui.js";

import dropTab from "./tabs/drop.js";
import blobTab from "./tabs/blob.js";
import rbacTab from "./tabs/rbac.js";
import vaultTab from "./tabs/vault.js";
import scalingTab from "./tabs/scaling.js";
import costTab from "./tabs/cost.js";
import availabilityTab from "./tabs/availability.js";
import deliveryTab from "./tabs/delivery.js";

const TABS = [dropTab, blobTab, rbacTab, vaultTab, scalingTab, costTab, availabilityTab, deliveryTab];
const MOUNTED = new Set();
const REFRESH = new Map();

function runtimeName(pod) {
  if (!pod || pod === "unknown" || pod === "local") return "local";
  return pod.startsWith("ca-") ? "Container Apps" : "AKS";
}

function paintPill(node, text, tone) {
  node.textContent = text;
  node.className = `badge ${tone}`;
}

async function refreshConfig() {
  try {
    const config = await api.config();

    if (config.store === "memory") paintPill($("#store-pill"), "store: memory (dev)", "badge-warn");
    else if (config.store === "azure") paintPill($("#store-pill"), `store: blob · ${config.container}`, "badge-ok");
    else paintPill($("#store-pill"), `store: ${config.store}`, "badge-bad");

    if (config.keyVault === "keyvault") {
      paintPill($("#key-pill"), `key: vault · ${fmt.short(config.keyVersion, 8)}`, "badge-ok");
    } else if (config.keyVault === "ephemeral") {
      paintPill($("#key-pill"), "key: ephemeral", "badge-warn");
    } else {
      paintPill($("#key-pill"), "key: unavailable", "badge-bad");
    }

    const warnings = [];
    if (config.store === "memory") {
      warnings.push(
        "This instance stores drops in memory: everything disappears on restart. " +
          "Production runs against Blob Storage; the badge above makes the difference impossible to miss."
      );
    }
    if (config.keyVault === "ephemeral") {
      warnings.push(
        "Share links are signed with an ephemeral key, so they stop working when this process restarts. " +
          "Deployed instances read a versioned key from Key Vault."
      );
    }
    const warning = $("#env-warning");
    warning.hidden = warnings.length === 0;
    warning.textContent = warnings.join(" ");
  } catch (err) {
    paintPill($("#store-pill"), "store: unknown", "badge-bad");
    paintPill($("#key-pill"), "key: unknown", "badge-bad");
    $("#env-warning").hidden = true;
    console.warn("config refresh failed:", describeError(err));
  }
}

async function refreshRuntime() {
  try {
    const version = await api.version();
    const local = !version.pod || version.pod === "unknown" || version.pod === "local";
    $("#runtime-label").textContent = local ? "local process" : `${runtimeName(version.pod)} · ${version.pod}`;
    setDot($("#runtime-dot"), "ok");
  } catch (_err) {
    $("#runtime-label").textContent = "runtime unreachable";
    setDot($("#runtime-dot"), "bad");
  }

  try {
    const { httpStatus, body } = await api.ready();
    const ready = httpStatus === 200 && body && body.status === "ready";
    const draining = body && body.status === "shutting_down";
    $("#ready-label").textContent = draining ? "draining" : ready ? "ready" : "not ready";
    setDot($("#ready-dot"), ready ? "ok" : draining ? "warn" : "bad");
  } catch (_err) {
    $("#ready-label").textContent = "readiness unknown";
    setDot($("#ready-dot"), "warn");
  }
}

function errorPanel(err) {
  return el(
    "div",
    { class: "card border-bad/40" },
    el("div", { class: "label text-bad", text: "Chapter failed to load" }),
    el("p", { class: "subtle mt-2", text: describeError(err) })
  );
}

async function mountTab(tab) {
  if (MOUNTED.has(tab.id)) return;
  MOUNTED.add(tab.id);
  const root = $(`#panel-${tab.id}`);
  try {
    const refresh = await tab.mount(root);
    if (typeof refresh === "function") REFRESH.set(tab.id, refresh);
  } catch (err) {
    console.error(`mount ${tab.id} failed`, err);
    root.replaceChildren(errorPanel(err));
  }
}

async function activate(id, { updateHash = true } = {}) {
  const target = TABS.find((tab) => tab.id === id) || TABS[0];

  for (const tab of TABS) {
    const selected = tab.id === target.id;
    const button = $(`#tab-${tab.id}`);
    const panel = $(`#panel-${tab.id}`);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
  }

  if (updateHash && location.hash !== `#${target.id}`) {
    history.replaceState(null, "", `#${target.id}`);
  }

  await mountTab(target);
  const refresh = REFRESH.get(target.id);
  if (!refresh) return;
  try {
    await refresh();
  } catch (err) {
    toast(`Cannot refresh ${target.id}: ${describeError(err)}`, "bad");
  }
}

function initTabs() {
  const buttons = $$('[role="tab"]');
  buttons.forEach((button, index) => {
    const id = button.id.replace("tab-", "");
    button.addEventListener("click", () => activate(id));
    button.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = buttons.length - 1;
      if (next === null) return;
      event.preventDefault();
      buttons[next].focus();
      activate(TABS[next].id);
    });
  });

  window.addEventListener("hashchange", () => {
    const id = location.hash.replace("#", "");
    if (TABS.some((tab) => tab.id === id)) activate(id, { updateHash: false });
  });
}

initTabs();
refreshConfig();
refreshRuntime();
setInterval(refreshRuntime, 5000);
setInterval(refreshConfig, 20000);

const initial = location.hash.replace("#", "");
activate(TABS.some((tab) => tab.id === initial) ? initial : "drop", { updateHash: false });
