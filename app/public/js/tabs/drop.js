// Chapter 01 — Drop: the product flow.
//
// Upload → seal → share. Everything else on the page exists to explain what
// these three steps actually did inside Azure.

import { api, describeError } from "../api.js";
import { el, header, card, badge, note, fmt, toast, withBusy, copyButton, statRow, podName } from "../ui.js";

export default {
  id: "drop",

  async mount(root) {
    const state = { config: null, items: [], share: null };
    const verified = new Map();

    const status = el("div", { class: "subtle mt-2", text: "" });
    const list = el("div", { class: "mt-4" });
    const count = badge("0 drops", "muted");

    // ── intro ──────────────────────────────────────────────────────────────
    const intro = card(
      header(
        "Chapter 01 · Drop",
        "A file, a seal, a link.",
        "Upload any file. The app stores it in Blob Storage, computes a deliberately slow seal, and signs a link that expires. No account, no session, no shared key."
      ),
      el(
        "div",
        { class: "mt-5 grid gap-4 sm:grid-cols-3" },
        step("01", "Upload", "Raw bytes go to Blob under a random id; the original name stays metadata."),
        step("02", "Seal", "SHA-256 digest plus PBKDF2-SHA256 work factor. Recomputing it is real CPU."),
        step("03", "Share", "HMAC over id, expiry and key version. The signature is the credential.")
      )
    );

    const bannerSlot = el("div", { class: "mt-4" });

    // ── upload ─────────────────────────────────────────────────────────────
    const fileInput = el("input", { type: "file", id: "drop-file", class: "sr-only" });
    const zone = el(
      "label",
      { class: "dropzone", attrs: { for: "drop-file" } },
      el("div", { class: "text-sm text-paper", text: "Drop a file here" }),
      el("div", { class: "subtle", text: "or click to choose" }),
      el("div", { class: "font-mono text-[10px] uppercase tracking-[0.14em] text-muted", text: "max 5 MB" }),
      fileInput
    );

    const ttl = el(
      "select",
      { class: "input w-auto", attrs: { "aria-label": "Share link lifetime" } },
      el("option", { value: "300", text: "5 minutes" }),
      el("option", { value: "900", text: "15 minutes" }),
      el("option", { value: "3600", text: "60 minutes" })
    );
    ttl.value = "900";

    const autoSeal = el("input", { type: "checkbox", checked: true, class: "h-4 w-4" });

    const uploadCard = card(
      header("Upload", "New drop", "The file is sent as raw bytes, not multipart. The name travels in a header."),
      el("div", { class: "mt-4" }, zone),
      el(
        "div",
        { class: "mt-4 flex flex-wrap items-center gap-4" },
        el("label", { class: "flex items-center gap-2" }, el("span", { class: "stat-label", text: "link ttl" }), ttl),
        el("label", { class: "flex items-center gap-2" }, autoSeal, el("span", { class: "stat-label", text: "seal automatically" }))
      ),
      status
    );

    // ── share result ───────────────────────────────────────────────────────
    const shareBody = el("div", { class: "mt-4" });
    const shareCard = card(
      el(
        "div",
        { class: "flex flex-wrap items-center justify-between gap-3" },
        header("Signed link", "Ready to hand out", null),
        badge("HMAC-SHA256", "accent")
      ),
      shareBody
    );
    shareCard.hidden = true;

    // ── list ───────────────────────────────────────────────────────────────
    const refreshButton = el("button", { class: "btn btn-sm", type: "button", text: "Refresh" });
    const listCard = card(
      el(
        "div",
        { class: "flex flex-wrap items-start justify-between gap-3" },
        header("Catalogue", "Drops in this container", "One container listing, then one small read per drop."),
        el("div", { class: "flex items-center gap-2" }, count, refreshButton)
      ),
      list
    );

    // ── behaviour ──────────────────────────────────────────────────────────
    async function run(button, label, task) {
      try {
        await withBusy(button, task, label);
      } catch (err) {
        toast(describeError(err), "bad");
      }
    }

    async function upload(file) {
      if (!state.config) return;
      if (file.size === 0) return toast("That file is empty.", "bad");
      if (file.size > state.config.maxUploadBytes) {
        return toast(`File is larger than ${fmt.bytes(state.config.maxUploadBytes)}.`, "bad");
      }

      status.textContent = `Uploading ${file.name}…`;
      try {
        const meta = await api.drops.upload(file);
        let sealNote = "";
        if (autoSeal.checked) {
          status.textContent = "Sealing…";
          const record = await api.drops.seal(meta.id);
          sealNote = ` · sealed in ${fmt.ms(record.ms)}`;
        }
        status.textContent = `${meta.name} uploaded${sealNote}`;
        toast(`${meta.name} uploaded${sealNote}`, "ok");
        await refresh();
      } catch (err) {
        status.textContent = `Upload failed: ${describeError(err)}`;
        toast(describeError(err), "bad");
      } finally {
        fileInput.value = "";
      }
    }

    async function seal(item, button) {
      await run(button, "Sealing…", async () => {
        const record = await api.drops.seal(item.id);
        toast(`Sealed ${item.name} in ${fmt.ms(record.ms)} · ${fmt.number(record.iterations)} iterations`, "ok");
        await refresh();
      });
    }

    async function verify(item, button) {
      await run(button, "Verifying…", async () => {
        const result = await api.drops.verify(item.id);
        verified.set(item.id, { ...result, at: Date.now() });
        toast(result.ok ? "Seal matches the bytes." : "Seal does not match: the bytes changed.", result.ok ? "ok" : "bad");
        renderList();
      });
    }

    async function share(item, button) {
      await run(button, "Signing…", async () => {
        state.share = await api.drops.share(item.id, Number(ttl.value));
        renderShare();
        shareCard.scrollIntoView({ behavior: "smooth", block: "center" });
        toast(`Link signed with key ${fmt.short(state.share.keyVersion, 8)}`, "ok");
      });
    }

    async function remove(item, button) {
      if (!window.confirm(`Delete ${item.name}? This is a hard delete of the drop.`)) return;
      await run(button, "Deleting…", async () => {
        await api.drops.remove(item.id);
        verified.delete(item.id);
        toast(`${item.name} deleted`, "ok");
        await refresh();
      });
    }

    function renderShare() {
      shareCard.hidden = !state.share;
      if (!state.share) return;
      const share = state.share;

      const input = el("input", {
        class: "input font-mono text-[11px]",
        readOnly: true,
        value: share.url,
        attrs: { "aria-label": "Signed share URL" },
      });

      shareBody.replaceChildren(
        el(
          "div",
          { class: "flex flex-col gap-2 sm:flex-row" },
          input,
          el("div", { class: "flex gap-2" }, copyButton(() => state.share.url), el("a", {
            class: "btn btn-sm",
            href: share.url,
            target: "_blank",
            rel: "noopener",
            text: "Open",
          }))
        ),
        el(
          "div",
          { class: "mt-3" },
          statRow("Expires", fmt.time(share.expiresAt)),
          statRow("Key version", share.keyVersion),
          statRow("Fingerprint", share.fingerprint)
        ),
        note("The signature covers the drop id, the expiry and the key version. Rotating the key does not break this link; disabling that version does.", "muted")
      );
    }

    function verifyLine(item) {
      const result = verified.get(item.id);
      if (!result) return null;
      return el(
        "div",
        { class: `mt-2 font-mono text-[10px] uppercase tracking-[0.14em] ${result.ok ? "text-ok" : "text-bad"}` },
        el("span", { text: result.ok ? "verified · " : "tampered · " }),
        el("span", { text: `${fmt.ms(result.ms)} · checked ${fmt.time(new Date(result.at).toISOString())}` })
      );
    }

    function sealDetails(item) {
      if (!item.seal) return null;
      return el(
        "details",
        { class: "mt-3" },
        el("summary", {
          class: "cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-muted hover:text-paper",
          text: "Seal record",
        }),
        el(
          "div",
          { class: "mt-2" },
          statRow("Algorithm", item.seal.algorithm),
          statRow("Iterations", fmt.number(item.seal.iterations)),
          statRow("sha256", item.seal.digest),
          statRow("seal", item.seal.seal),
          statRow("Sealed at", fmt.time(item.seal.sealedAt)),
          statRow("Sealed by", podName(item.seal.pod))
        )
      );
    }

    function dropRow(item) {
      const sealed = Boolean(item.seal);
      const actions = el("div", { class: "flex flex-wrap gap-2" });

      const sealButton = el("button", { class: "btn btn-sm", type: "button", text: sealed ? "Re-seal" : "Seal" });
      sealButton.addEventListener("click", () => seal(item, sealButton));
      actions.append(sealButton);

      const verifyButton = el("button", { class: "btn btn-sm", type: "button", text: "Verify" });
      verifyButton.disabled = !sealed;
      verifyButton.addEventListener("click", () => verify(item, verifyButton));
      actions.append(verifyButton);

      const shareButton = el("button", { class: "btn btn-sm btn-primary", type: "button", text: "Share" });
      shareButton.addEventListener("click", () => share(item, shareButton));
      actions.append(shareButton);

      actions.append(
        el("a", { class: "btn btn-sm", href: api.drops.downloadUrl(item.id), download: item.name, text: "Download" })
      );

      const deleteButton = el("button", {
        class: "btn btn-sm hover:border-bad hover:text-bad",
        type: "button",
        text: "Delete",
      });
      deleteButton.addEventListener("click", () => remove(item, deleteButton));
      actions.append(deleteButton);

      return el(
        "div",
        { class: "border-b border-line py-4 first:pt-0 last:border-0 last:pb-0" },
        el(
          "div",
          { class: "flex flex-wrap items-start justify-between gap-3" },
          el(
            "div",
            { class: "min-w-0" },
            el(
              "div",
              { class: "flex flex-wrap items-center gap-2" },
              el("span", { class: "max-w-[18rem] truncate font-mono text-sm text-paper", text: item.name }),
              sealed ? badge("sealed", "ok") : badge("unsealed", "warn")
            ),
            el("div", {
              class: "mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted",
              text: `${item.id} · ${fmt.bytes(item.size)} · ${fmt.time(item.createdAt)}`,
            }),
            el("div", {
              class: "mt-1 font-mono text-[10px] text-muted",
              text: sealed ? `sealed by ${podName(item.seal.pod)}` : `uploaded via ${podName(item.pod)}`,
            })
          ),
          actions
        ),
        verifyLine(item),
        sealDetails(item)
      );
    }

    function renderList() {
      list.replaceChildren();
      count.textContent = `${state.items.length} ${state.items.length === 1 ? "drop" : "drops"}`;
      if (state.items.length === 0) {
        list.append(note("No drops yet. Upload a file above — it stays in this container until you delete it.", "muted"));
        return;
      }
      for (const item of state.items) list.append(dropRow(item));
    }

    async function refresh() {
      if (!state.config) {
        state.config = await api.config();
        zone.querySelector("div:last-of-type").textContent = `max ${fmt.bytes(state.config.maxUploadBytes)}`;
        if (state.config.store === "memory") {
          bannerSlot.replaceChildren(
            note(
              "Memory store: this chapter works, but every drop disappears when the process restarts. The deployed app uses the drops container in Blob Storage.",
              "warn"
            )
          );
        } else {
          bannerSlot.replaceChildren();
        }
      }

      const data = await api.drops.list();
      state.items = data.items || [];
      renderList();
    }

    refreshButton.addEventListener("click", () => {
      refresh().catch((err) => toast(describeError(err), "bad"));
    });

    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) upload(fileInput.files[0]);
    });

    for (const event of ["dragenter", "dragover"]) {
      zone.addEventListener(event, (e) => {
        e.preventDefault();
        zone.dataset.active = "true";
      });
    }
    for (const event of ["dragleave", "dragend"]) {
      zone.addEventListener(event, () => {
        zone.dataset.active = "false";
      });
    }
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.dataset.active = "false";
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) upload(file);
    });

    root.replaceChildren(
      intro,
      bannerSlot,
      el("div", { class: "mt-4 grid gap-4 lg:grid-cols-2" }, el("div", { class: "space-y-4" }, uploadCard, shareCard), listCard)
    );

    return refresh;
  },
};

function step(number, title, text) {
  return el(
    "div",
    { class: "rounded border border-line bg-black/20 p-4" },
    el("div", { class: "font-mono text-[10px] text-accent", text: number }),
    el("div", { class: "mt-2 text-sm text-paper", text: title }),
    el("div", { class: "subtle mt-1 text-[13px]", text })
  );
}
