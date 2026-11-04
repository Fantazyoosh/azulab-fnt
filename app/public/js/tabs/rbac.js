// Chapter 03 — RBAC.
//
// The claims are read from the token the pod itself receives, and the probes
// call Azure live. A 200 or a 403 on screen is produced at request time; it is
// not a slide.

import { api, describeError } from "../api.js";
import { el, header, card, badge, note, fmt, toast, withBusy, statRow, codeBlock, copyButton } from "../ui.js";

const PROBES = [
  {
    action: "read-secret",
    label: "Key Vault · read secret",
    expect: 200,
    why: "The runtime identity is Key Vault Secrets User on one vault. It can read secret values, not administer the vault.",
  },
  {
    action: "read-blob",
    label: "Blob · list container",
    expect: 200,
    why: "Storage Blob Data Contributor on one account. The call goes through Entra, never through the account key.",
  },
  {
    action: "list-keys",
    label: "Storage · list account keys",
    expect: 403,
    why: "A control-plane action. The runtime identity deliberately lacks it, so a compromised pod cannot exfiltrate the account key.",
  },
];

export default {
  id: "rbac",

  async mount(root) {
    const selfSlot = el("div", { class: "mt-3" });
    const refreshSelf = el("button", { class: "btn btn-sm", type: "button", text: "Refresh identity" });
    const runAll = el("button", { class: "btn btn-primary", type: "button", text: "Run all three probes" });

    const intro = card(
      el(
        "div",
        { class: "flex flex-wrap items-start justify-between gap-3" },
        header(
          "Chapter 03 · RBAC",
          "Identity, not keys.",
          "The pod authenticates with a managed identity. Groups hold the assignments; the pipeline and the runtime get narrow roles on narrow scopes. The probes below ask Azure directly."
        ),
        runAll
      )
    );

    const identityCard = card(
      el(
        "div",
        { class: "flex flex-wrap items-start justify-between gap-3" },
        header("Who is this pod?", "Token claims", "The token itself never leaves the server. The page only receives the claims."),
        refreshSelf
      ),
      selfSlot
    );

    const probeGrid = el("div", { class: "grid gap-4 lg:grid-cols-3" });
    const probeCards = PROBES.map((probe) => {
      const slot = el("div", { class: "mt-3" });
      const button = el("button", { class: "btn btn-sm", type: "button", text: "Run probe" });
      button.addEventListener("click", () => runProbe(probe, button, slot));
      const cardEl = card(
        el(
          "div",
          { class: "flex items-start justify-between gap-2" },
          el("div", { class: "label", text: probe.label }),
          badge(`expect ${probe.expect}`, probe.expect === 200 ? "ok" : "warn")
        ),
        el("p", { class: "subtle mt-2 text-[13px]", text: probe.why }),
        el("div", { class: "mt-3" }, button),
        slot
      );
      probeGrid.append(cardEl);
      return { probe, button, slot };
    });

    const matrixCard = card(
      header("Assignments", "Groups first, direct roles by exception", "Onboarding is a membership change, not a tour of every resource."),
      el(
        "div",
        { class: "mt-4 overflow-x-auto" },
        el(
          "table",
          { class: "table" },
          el(
            "thead",
            {},
            el("tr", {}, el("th", { text: "Principal" }), el("th", { text: "Role" }), el("th", { text: "Scope" }), el("th", { text: "Why" }))
          ),
          el(
            "tbody",
            {},
            matrixRow("azulab-platform-admins", "Maciej", "Key Vault Administrator", "the vault", "the only path to vault administration"),
            matrixRow("azulab-deployers", "GitHub OIDC SP", "Contributor", "resource group", "deploy, no data access"),
            matrixRow("azulab-readers", "empty", "Reader", "resource group", "onboarding path"),
            matrixRow("id-azulab-dev-app", "managed identity", "Key Vault Secrets User", "the vault", "runtime, one vault"),
            matrixRow("id-azulab-dev-app", "managed identity", "Storage Blob Data Contributor", "storage account", "runtime, one account")
          )
        )
      )
    );

    const planeCard = card(
      header("The distinction that matters", "Owner is control plane, not data plane", null),
      el(
        "p",
        { class: "subtle mt-2" },
        "The human account owns the subscription and still cannot list a blob. Creating a resource and reading its contents are separate permissions. That is why the pipeline can deploy the app but cannot read the signing key."
      ),
      codeBlock("az storage blob list --account-name stazulabdev6mvarl \\\n  --container-name demo --auth-mode login\n# 403 — Owner is control plane"),
      copyButton("az storage blob list --account-name stazulabdev6mvarl --container-name demo --auth-mode login"),
      note("Local runs authenticate with your az login, so results can differ from the pod. The deployed answer is the one that matters.", "muted")
    );

    function matrixRow(group, member, role, scope, why) {
      return el(
        "tr",
        {},
        el(
          "td",
          {},
          el("div", { class: "font-mono text-[11px] text-paper", text: group }),
          el("div", { class: "font-mono text-[10px] text-muted", text: member })
        ),
        el("td", { class: "font-mono text-[11px]", text: role }),
        el("td", { class: "text-[12px] text-muted", text: scope }),
        el("td", { class: "text-[12px] text-muted", text: why })
      );
    }

    function renderSelf(data) {
      selfSlot.replaceChildren();
      if (!data || data.configured === false) {
        selfSlot.append(note("No Azure credential is configured in this instance, so there are no claims to show.", "warn"));
        return;
      }
      if (data.error) {
        selfSlot.append(note(`${data.error} · ${data.message || ""}`, "bad"));
        return;
      }
      selfSlot.append(
        statRow("Object id (oid)", data.oid || "—"),
        statRow("Application id (appid)", data.appid || "—"),
        statRow("Tenant", data.tenantId || "—"),
        statRow("Token type", data.idtyp || "—"),
        statRow("Credential", data.credential || "—"),
        statRow("Expires", fmt.time(data.expiresAt)),
        note("The signature of this token was verified by Azure when it was issued; the app only decodes the payload for display.", "muted")
      );
    }

    function renderProbeResult(result, slot, probe) {
      const status = Number(result.status) || 0;
      const matched = status === probe.expect;
      const tone = matched ? "ok" : probe.expect === 403 && status === 403 ? "ok" : status === 403 ? "warn" : "bad";
      const label = matched
        ? probe.expect === 403
          ? "denied as expected"
          : "allowed"
        : status === 403
          ? "denied"
          : `HTTP ${status || "error"}`;

      const detail = result.detail
        ? Object.entries(result.detail)
            .map(([key, value]) => `${key}=${value}`)
            .join(" · ")
        : result.code || result.message || "";

      slot.replaceChildren(
        el(
          "div",
          { class: "rounded border border-line bg-black/30 p-3" },
          el(
            "div",
            { class: "flex flex-wrap items-center justify-between gap-2" },
            badge(label, tone),
            el("span", { class: "font-mono text-[10px] text-muted", text: fmt.ms(result.durationMs) })
          ),
          detail ? el("div", { class: "mt-2 break-all font-mono text-[10px] text-muted", text: detail }) : null
        )
      );
    }

    async function runProbe(probe, button, slot) {
      try {
        await withBusy(button, async () => {
          const started = performance.now();
          try {
            const result = await api.probe(probe.action);
            renderProbeResult({ ...result, durationMs: result.durationMs ?? Math.round(performance.now() - started) }, slot, probe);
          } catch (err) {
            const body = err.body || {};
            renderProbeResult(
              {
                status: err.status,
                code: body.code || err.message,
                message: body.message,
                durationMs: body.durationMs ?? Math.round(performance.now() - started),
              },
              slot,
              probe
            );
            if (!(probe.expect === 403 && err.status === 403)) toast(describeError(err), "bad");
          }
        }, "Calling Azure…");
      } catch (err) {
        toast(describeError(err), "bad");
      }
    }

    refreshSelf.addEventListener("click", () => {
      api
        .self()
        .then(renderSelf)
        .catch((err) => {
          selfSlot.replaceChildren(note(describeError(err), "bad"));
          toast(describeError(err), "bad");
        });
    });

    runAll.addEventListener("click", async () => {
      await withBusy(
        runAll,
        async () => {
          for (const item of probeCards) {
            await runProbe(item.probe, item.button, item.slot);
          }
        },
        "Running probes…"
      );
    });

    root.replaceChildren(
      intro,
      el("div", { class: "mt-4 grid gap-4" }, identityCard, probeGrid, matrixCard, planeCard)
    );

    return async () => {
      try {
        renderSelf(await api.self());
      } catch (err) {
        selfSlot.replaceChildren(note(describeError(err), "bad"));
      }
    };
  },
};
