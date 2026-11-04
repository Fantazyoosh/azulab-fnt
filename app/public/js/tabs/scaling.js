// Chapter 05 — Scaling.
//
// The seal is the load generator. It is CPU-bound on purpose: PBKDF2 runs on
// the libuv threadpool, so the event loop keeps answering while the pod burns
// CPU, and the HPA has a real signal to react to.

import { api, describeError } from "../api.js";
import { el, header, card, badge, note, fmt, toast, withBusy, statRow, codeBlock, copyButton, podName } from "../ui.js";

const LOAD_SECONDS = 12;
const LOAD_BATCH = 2;
const LOAD_PAUSE_MS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  id: "scaling",

  async mount(root) {
    const observeSlot = el("div", { class: "mt-4" });
    const loadSlot = el("div", { class: "mt-4" });
    const metricsSlot = el("div", { class: "mt-3" });
    const runtimeSlot = el("div", { class: "mt-3" });

    const observeButton = el("button", { class: "btn btn-primary", type: "button", text: "Observe 20 requests" });
    const loadButton = el("button", { class: "btn", type: "button", text: `Run ${LOAD_SECONDS}s of seals` });

    const intro = card(
      el(
        "div",
        { class: "flex flex-wrap items-start justify-between gap-3" },
        header(
          "Chapter 05 · Scaling",
          "Real CPU, real replicas.",
          "AKS runs a HorizontalPodAutoscaler: minimum 2, maximum 6, target 60% CPU. The seal is deliberately expensive, so a few parallel requests are enough to move the metric."
        ),
        el("div", { class: "flex flex-wrap gap-2" }, badge("min 2", "accent"), badge("max 6", "accent"), badge("cpu 60%", "accent"))
      )
    );

    const hpaCard = card(
      header("Policy", "What the HPA is allowed to do", "Autoscaling is a contract, not a magic trick."),
      el(
        "div",
        { class: "mt-3" },
        statRow("Replicas", "2 → 6"),
        statRow("CPU target", "60% of requests"),
        statRow("CPU request / limit", "100m / 300m"),
        statRow("Scale-down stabilization", "60 s"),
        statRow("Metrics source", "metrics-server"),
        statRow("PodDisruptionBudget", "minAvailable 1")
      )
    );

    const observeCard = card(
      el(
        "div",
        { class: "flex flex-wrap items-start justify-between gap-3" },
        header("Observed", "Which pods answer?", "Each response carries x-pod-name, so load balancing is visible from the browser."),
        observeButton
      ),
      observeSlot,
      runtimeSlot
    );

    const loadCard = card(
      header("Load", "Burn CPU on purpose", "Parallel seals on the newest drop. This is real PBKDF2 work, not a sleep; the request duration and the pod names come back in the response."),
      el("div", { class: "mt-4" }, loadButton),
      loadSlot
    );

    const metricsCard = card(
      header("This replica", "Runtime metrics", "The numbers are per process, so each pod starts from zero."),
      metricsSlot
    );

    const whyCard = card(
      header("Why the event loop survives", "Threadpool, not blocking", null),
      el(
        "p",
        { class: "subtle mt-2" },
        "PBKDF2 is executed on the libuv threadpool. The Node event loop stays free to answer health checks and new requests while the CPU is saturated. A blocking loop would make the pod fail readiness before the HPA could help."
      ),
      el(
        "ul",
        { class: "mt-3 space-y-2 text-sm text-muted" },
        bullet("CPU rises above 60% of the request → the HPA adds pods, up to six."),
        bullet("New pods need their signing key loaded before /ready passes; the startup probe allows 60 s."),
        bullet("When the load stops, scale-down waits 60 s before removing a replica."),
        bullet("Container Apps uses its own scale rules; this chapter is about the AKS runtime.")
      )
    );

    const commandsCard = card(
      header("Operator view", "Watch it happen", null),
      codeBlock("kubectl -n azulab get hpa azulab -w\nkubectl -n azulab top pods\nkubectl -n azulab get pods -w"),
      copyButton("kubectl -n azulab get hpa azulab -w"),
      note("On a single node the replicas share 2 vCPU. The HPA still adds pods; the node is the ceiling. That trade-off is deliberate and shows up in the Cost chapter.", "muted")
    );

    function bullet(text) {
      return el(
        "li",
        { class: "flex gap-2" },
        el("span", { class: "mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" }),
        el("span", { text })
      );
    }

    function renderPods(result) {
      observeSlot.replaceChildren();
      if (!result.pods.length) {
        observeSlot.append(note("No pod answered. Check readiness and the Service.", "bad"));
        return;
      }
      observeSlot.append(
        el("div", { class: "label mb-2", text: `${result.ok}/${result.total} answered` }),
        el(
          "div",
          { class: "space-y-3" },
          ...result.pods.map(({ pod, hits }) => {
            const row = el(
              "div",
              { class: "space-y-1" },
              el(
                "div",
                { class: "flex items-center justify-between gap-3" },
                el("span", { class: "break-all font-mono text-[11px] text-paper", text: podName(pod) }),
                el("span", { class: "font-mono text-[11px] text-muted", text: `${hits}/${result.total}` })
              )
            );
            const meter = el("div", { class: "meter" });
            const fill = el("div", { class: "meter-fill" });
            fill.style.width = `${(hits / result.total) * 100}%`;
            meter.append(fill);
            row.append(meter);
            return row;
          })
        )
      );
    }

    async function refreshRuntime() {
      try {
        const version = await api.version();
        const local = !version.pod || version.pod === "unknown" || version.pod === "local";
        runtimeSlot.replaceChildren(
          note(
            version.pod.startsWith("ca-")
              ? "This instance is Container Apps. The HPA chapter describes the AKS runtime; here the platform applies its own scale rules."
              : local
                ? "This is a local process: one instance, no Service and no HPA. The button still burns real CPU, so the pause between batches keeps it from flooding the store."
                : `This request was served by ${version.pod} on ${version.node || "an unknown node"}.`,
            version.pod.startsWith("ca-") || local ? "warn" : "muted"
          )
        );
      } catch (_err) {
        runtimeSlot.replaceChildren();
      }
    }

    async function refreshMetrics() {
      try {
        const metrics = await api.metrics();
        const latency = metrics.latencyMs || {};
        metricsSlot.replaceChildren(
          statRow("Uptime", fmt.duration(metrics.uptimeMs)),
          statRow("Requests", fmt.number(metrics.requests)),
          statRow("Errors", fmt.number(metrics.errors)),
          statRow("p50 / p95 / p99", `${latency.p50 ?? "—"} / ${latency.p95 ?? "—"} / ${latency.p99 ?? "—"} ms`)
        );
      } catch (err) {
        metricsSlot.replaceChildren(note(describeError(err), "bad"));
      }
    }

    observeButton.addEventListener("click", async () => {
      try {
        await withBusy(observeButton, async () => {
          renderPods(await api.probePods(20));
          await refreshRuntime();
        }, "Observing…");
      } catch (err) {
        observeSlot.replaceChildren(note(describeError(err), "bad"));
      }
    });

    loadButton.addEventListener("click", async () => {
      let drop = null;
      try {
        const list = await api.drops.list();
        drop = (list.items || [])[0] || null;
      } catch (err) {
        return toast(describeError(err), "bad");
      }
      if (!drop) return toast("Upload a drop first — the seal is the CPU work.", "bad");

      try {
        await withBusy(
          loadButton,
          async () => {
            loadSlot.replaceChildren(el("div", { class: "label", text: `Sealing ${drop.name} in parallel…` }));
            const started = performance.now();
            const end = started + LOAD_SECONDS * 1000;
            const durations = [];
            const pods = new Map();
            let completed = 0;
            let failed = 0;

            while (performance.now() < end) {
              const batch = await Promise.allSettled(
                Array.from({ length: LOAD_BATCH }, () => api.drops.seal(drop.id))
              );
              for (const outcome of batch) {
                if (outcome.status === "fulfilled") {
                  completed += 1;
                  durations.push(outcome.value.ms || 0);
                  const pod = outcome.value.pod || "unknown";
                  pods.set(pod, (pods.get(pod) || 0) + 1);
                } else {
                  failed += 1;
                }
              }
              loadSlot.replaceChildren(
                el(
                  "div",
                  { class: "flex flex-wrap items-center justify-between gap-2" },
                  el("span", { class: "label", text: `Sealing ${drop.name}` }),
                  el("span", { class: "font-mono text-[10px] text-muted", text: `${completed} done · ${Math.max(0, Math.round((end - performance.now()) / 1000))}s left` })
                )
              );
              // Leave the threadpool a little room between batches: the goal is
              // sustained CPU above the request, not a write flood.
              await sleep(LOAD_PAUSE_MS);
            }

            const wall = Math.round(performance.now() - started);
            const slowest = durations.length ? Math.max(...durations) : 0;
            loadSlot.replaceChildren(
              el("div", { class: "label", text: "Load finished" }),
              statRow("Completed", `${completed}${failed ? ` · ${failed} failed` : ""}`),
              statRow("Wall time", fmt.ms(wall)),
              statRow("Slowest seal", fmt.ms(slowest)),
              statRow("Pods that sealed", [...pods.entries()].map(([pod, count]) => `${podName(pod)} ×${count}`).join(" · ") || "—"),
              note("The HPA reacts on a ~15 s window. Wait up to a minute, then observe again: the new pod should appear in the distribution.", "muted")
            );
            await refreshMetrics();
            toast("Load finished", failed ? "bad" : "ok");
          },
          "Running load…"
        );
      } catch (err) {
        loadSlot.replaceChildren(note(describeError(err), "bad"));
      }
    });

    root.replaceChildren(
      intro,
      el("div", { class: "mt-4 grid gap-4 lg:grid-cols-3" }, hpaCard, observeCard, loadCard),
      el("div", { class: "mt-4 grid gap-4 lg:grid-cols-2" }, metricsCard, whyCard),
      el("div", { class: "mt-4" }, commandsCard)
    );

    return async () => {
      await Promise.all([refreshMetrics(), refreshRuntime()]);
    };
  },
};
