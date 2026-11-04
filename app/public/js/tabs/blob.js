// Chapter 02 — Blob Storage.
//
// The drop flow writes three blobs per file. This chapter shows the container
// from the inside: how much it holds, what a bulk write looks like, and that a
// deleted blob is recoverable because soft delete is on.

import { api, describeError } from "../api.js";
import { el, header, card, note, fmt, toast, withBusy } from "../ui.js";

export default {
  id: "blob",

  async mount(root) {
    const statsSlot = el("div", { class: "grid gap-4 sm:grid-cols-2 lg:grid-cols-5" });
    const resultSlot = el("div", { class: "mt-4" });

    const count = el("input", {
      class: "input w-24",
      type: "number",
      min: "1",
      max: "200",
      value: "25",
      attrs: { "aria-label": "Number of objects to write" },
    });
    const bulkButton = el("button", { class: "btn btn-primary", type: "button", text: "Write objects" });
    const softButton = el("button", { class: "btn", type: "button", text: "Soft-delete round trip" });
    const refreshButton = el("button", { class: "btn btn-sm", type: "button", text: "Refresh stats" });

    const intro = card(
      header(
        "Chapter 02 · Blob Storage",
        "Storage without a key.",
        "The container is private, shared-key auth is disabled, and the app reaches it with its managed identity. The numbers below come from listing the real account."
      )
    );

    const statsCard = card(
      el(
        "div",
        { class: "flex flex-wrap items-start justify-between gap-3" },
        header("Live container", "What Blob actually holds", "Objects, versions and soft-deleted blobs are counted separately."),
        refreshButton
      ),
      el("div", { class: "mt-4" }, statsSlot)
    );

    const actionsCard = card(
      header("Write traffic", "Move the numbers", "A bulk write is just many small PUTs; the soft-delete demo uploads, deletes, lists the deleted blob, then undeletes it."),
      el(
        "div",
        { class: "mt-4 flex flex-wrap items-end gap-3" },
        el("label", { class: "flex flex-col gap-1" }, el("span", { class: "stat-label", text: "objects" }), count),
        bulkButton,
        softButton
      ),
      resultSlot
    );

    const layoutCard = card(
      header("Layout", "Three blobs per drop", "The original filename is metadata only. The blob name is always \"file\", so no user input reaches a path."),
      el("pre", {
        class: "proof",
        text:
          "drops/<id>/file       bytes exactly as uploaded\n" +
          "drops/<id>/meta.json  name, size, content-type, sha256, pod, timestamps\n" +
          "drops/<id>/seal.json  algorithm, iterations, digest, seal",
      }),
      el(
        "p",
        { class: "subtle mt-3" },
        "Updating meta.json after a seal creates a new blob version. That is why the version count grows even when the drop count does not."
      )
    );

    const protectionCard = card(
      header("Protection", "What is switched on", "These are account-level settings, not application promises."),
      el(
        "div",
        { class: "mt-3" },
        row("Versioning", "on", "every overwrite keeps the previous body"),
        row("Soft delete", "7 days", "a deleted blob is listed as deleted and can be undeleted"),
        row("Shared key auth", "disabled", "the account key cannot authenticate a data-plane request"),
        row("Lifecycle", "30 d / 90 d", "declared in Terraform: Cool after 30 days, delete after 90")
      )
    );

    function row(label, value, text) {
      return el(
        "div",
        { class: "flex flex-wrap items-baseline justify-between gap-3 border-b border-line py-2 last:border-0" },
        el("span", { class: "stat-label", text: label }),
        el(
          "span",
          { class: "text-right" },
          el("span", { class: "font-mono text-xs text-paper", text: value }),
          el("span", { class: "subtle ml-2 text-[12px]", text })
        )
      );
    }

    function statCard(label, value, hint) {
      return el(
        "div",
        { class: "card" },
        el("div", { class: "label", text: label }),
        el("div", { class: "value text-xl", text: value }),
        el("div", { class: "subtle mt-1 text-[12px]", text: hint })
      );
    }

    function renderStats(stats) {
      const tiers = Object.entries(stats.tiers || {})
        .map(([tier, count]) => `${tier}: ${count}`)
        .join(" · ") || "—";
      statsSlot.replaceChildren(
        statCard("Objects", fmt.number(stats.objects), "live blobs"),
        statCard("Bytes", fmt.bytes(stats.bytes), "current versions"),
        statCard("Versions", fmt.number(stats.versions), "older bodies kept"),
        statCard("Soft-deleted", fmt.number(stats.deleted), "recoverable"),
        statCard("Tiers", tiers, "counts per access tier")
      );
    }

    function renderUnavailable() {
      statsSlot.replaceChildren();
      statsSlot.append(
        el(
          "div",
          { class: "card sm:col-span-2 lg:col-span-5" },
          note(
            "This instance has no Azure storage account configured, so there is nothing to inspect. Run it with DROP_STORE=memory for the product flow, or configure STORAGE_ACCOUNT_URL and the runtime identity for this chapter.",
            "warn"
          )
        )
      );
      bulkButton.disabled = true;
      softButton.disabled = true;
      refreshButton.disabled = true;
    }

    async function refresh() {
      try {
        const stats = await api.blob.stats();
        renderStats(stats);
      } catch (err) {
        if (err.status === 503) {
          renderUnavailable();
          return;
        }
        throw err;
      }
    }

    bulkButton.addEventListener("click", async () => {
      const value = Math.min(Math.max(Number(count.value) || 25, 1), 200);
      try {
        await withBusy(bulkButton, async () => {
          const result = await api.blob.bulk(value);
          resultSlot.replaceChildren(
            note(`Wrote ${result.count} objects under ${result.prefix} (${fmt.bytes(result.bytes)}).`, "ok")
          );
          toast(`${result.count} objects written`, "ok");
          await refresh();
        }, "Writing…");
      } catch (err) {
        resultSlot.replaceChildren(note(describeError(err), "bad"));
      }
    });

    softButton.addEventListener("click", async () => {
      try {
        await withBusy(softButton, async () => {
          const result = await api.blob.softDeleteDemo();
          resultSlot.replaceChildren(
            el("div", { class: "label mt-4", text: `Soft-delete round trip · ${result.name}` }),
            el(
              "div",
              { class: "timeline" },
              ...result.steps.map((step) =>
                el(
                  "div",
                  { class: "timeline-item", dataset: { tone: step.ok ? "ok" : "bad" } },
                  el("span", { class: "text-paper", text: step.step.replace(/_/g, " ") }),
                  el("span", { class: "ml-2 font-mono text-[10px] uppercase tracking-[0.14em]", text: step.ok ? "ok" : "failed" })
                )
              )
            )
          );
          toast(result.steps.every((step) => step.ok) ? "Soft delete recovered the blob" : "One step failed", "ok");
          await refresh();
        }, "Running…");
      } catch (err) {
        resultSlot.replaceChildren(note(describeError(err), "bad"));
      }
    });

    refreshButton.addEventListener("click", () => {
      refresh().catch((err) => toast(describeError(err), "bad"));
    });

    root.replaceChildren(
      intro,
      el(
        "div",
        { class: "mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]" },
        el("div", { class: "space-y-4" }, statsCard, actionsCard),
        el("div", { class: "space-y-4" }, layoutCard, protectionCard)
      )
    );

    return refresh;
  },
};
