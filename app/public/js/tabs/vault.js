// Chapter 04 — Key Vault.
//
// The share-signing key is versioned. That single fact is what makes rotation
// boring: old links name the version they were signed with.

import { api, describeError } from "../api.js";
import { el, header, card, badge, note, fmt, toast, withBusy, statRow, codeBlock, copyButton } from "../ui.js";

const ROTATE = `NEW=$(openssl rand -base64 48)
az keyvault secret set \\
  --vault-name kv-azulab-dev-6mvarl \\
  --name share-signing-key --value "$NEW"`;

const REVOKE = `az keyvault secret set-attributes \\
  --vault-name kv-azulab-dev-6mvarl \\
  --name share-signing-key \\
  --version <old-version> --enabled false`;

const AUDIT = `AzureDiagnostics
| where ResourceType == 'VAULTS'
| where OperationName in ('SecretGet','SecretList')
| project TimeGenerated, OperationName, ResultType, CallerIPAddress, identity_claim_oid_g
| order by TimeGenerated desc
| take 20`;

export default {
  id: "vault",

  async mount(root) {
    const keySlot = el("div", { class: "mt-3" });
    const probeSlot = el("div", { class: "mt-3" });
    const refreshButton = el("button", { class: "btn btn-sm", type: "button", text: "Refresh key state" });
    const probeButton = el("button", { class: "btn btn-primary", type: "button", text: "Read the secret" });

    const intro = card(
      header(
        "Chapter 04 · Key Vault",
        "The key never leaves the vault.",
        "Share links are signed with an HMAC key stored in Key Vault. The app caches versions in memory, never writes the value to disk, and reports only the version and a fingerprint."
      )
    );

    const keyCard = card(
      el(
        "div",
        { class: "flex flex-wrap items-start justify-between gap-3" },
        header("Current key", "What this process is using", "The current version is re-read every five minutes; older versions stay cached so old links still verify."),
        refreshButton
      ),
      keySlot,
      el("div", { class: "mt-4" }, probeButton),
      probeSlot
    );

    const linkCard = card(
      header("Signed link", "Three facts in one signature", null),
      codeBlock("sig = HMAC-SHA256(key, id + \".\" + exp + \".\" + keyVersion)\nURL = /s/<id>?exp=<exp>&v=<keyVersion>&sig=<sig>"),
      el(
        "ul",
        { class: "mt-4 space-y-2 text-sm text-muted" },
        bullet("The key version is inside the signed payload and in the URL, so a v1 signature cannot be replayed against v2."),
        bullet("Rotating the secret creates a new version. New links use it; links already handed out keep their old version."),
        bullet("Disabling an old version revokes exactly the links signed with it. That is revocation without a database."),
        bullet("Expiry is checked before the signature, so an expired link is a 410, not a 403.")
      )
    );

    const rotateCard = card(
      header("Operations", "Rotate, then revoke on purpose", "Both commands are safe to run while the app is serving; no redeploy is required."),
      el("div", { class: "label mt-4", text: "rotate" }),
      codeBlock(ROTATE),
      copyButton(ROTATE),
      el("div", { class: "label mt-5", text: "revoke one version" }),
      codeBlock(REVOKE),
      copyButton(REVOKE),
      note("The deployed identity needs Key Vault Secrets User to read and Key Vault Administrator (or secret set permission) to rotate. The runtime has the first, the human group has the second.", "muted")
    );

    const auditCard = card(
      header("Audit", "Who read the key?", "Key Vault diagnostic logs land in Log Analytics. The caller identity is the managed identity's object id."),
      codeBlock(AUDIT),
      copyButton(AUDIT)
    );

    function bullet(text) {
      return el(
        "li",
        { class: "flex gap-2" },
        el("span", { class: "mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" }),
        el("span", { text })
      );
    }

    function renderKey(config) {
      keySlot.replaceChildren();
      const source = config.keyVault;
      const tone = source === "keyvault" ? "ok" : source === "ephemeral" ? "warn" : "bad";

      keySlot.append(
        el(
          "div",
          { class: "flex flex-wrap items-center gap-2" },
          badge(`source: ${source}`, tone),
          source === "ephemeral" ? badge("not for production", "warn") : null
        ),
        statRow("Secret name", "share-signing-key"),
        statRow("Version", config.keyVersion || "—"),
        statRow("Fingerprint", config.keyFingerprint || "—"),
        statRow("Loaded at", fmt.time(config.keyLoadedAt)),
        statRow("Current-version TTL", "5 minutes"),
        source === "ephemeral"
          ? note("No Key Vault configured: this process generated a random key. Restarting it invalidates every link it signed.", "warn")
          : note("Only the version and fingerprint are shown. The secret value is never returned by the API or rendered in the page.", "ok")
      );
    }

    function renderProbe(result) {
      probeSlot.replaceChildren(
        el(
          "div",
          { class: "rounded border border-line bg-black/30 p-3" },
          el(
            "div",
            { class: "flex flex-wrap items-center justify-between gap-2" },
            badge(`HTTP ${result.status}`, result.status === 200 ? "ok" : "bad"),
            el("span", { class: "font-mono text-[10px] text-muted", text: fmt.ms(result.durationMs) })
          ),
          result.detail
            ? el("div", {
                class: "mt-2 break-all font-mono text-[10px] text-muted",
                text: `version=${result.detail.keyVersion} · source=${result.detail.source} · fingerprint=${result.detail.fingerprint}`,
              })
            : el("div", { class: "mt-2 font-mono text-[10px] text-bad", text: result.code || result.message || "" })
        )
      );
    }

    async function refresh() {
      const config = await api.config();
      renderKey(config);
    }

    refreshButton.addEventListener("click", () => {
      refresh()
        .then(() => toast("Key state refreshed", "ok"))
        .catch((err) => toast(describeError(err), "bad"));
    });

    probeButton.addEventListener("click", async () => {
      try {
        await withBusy(probeButton, async () => {
          const started = performance.now();
          const result = await api.probe("read-secret");
          renderProbe({ ...result, durationMs: result.durationMs ?? Math.round(performance.now() - started) });
        }, "Reading…");
      } catch (err) {
        renderProbe({ status: err.status || 0, code: err.body && err.body.code, message: err.body && err.body.message });
        toast(describeError(err), "bad");
      }
    });

    root.replaceChildren(
      intro,
      el("div", { class: "mt-4 grid gap-4 lg:grid-cols-2" }, keyCard, linkCard),
      el("div", { class: "mt-4 grid gap-4 lg:grid-cols-2" }, rotateCard, auditCard)
    );

    return refresh;
  },
};
