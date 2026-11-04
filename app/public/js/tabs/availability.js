// Chapter 07 — Availability.
//
// Two replicas, readiness that understands dependencies, and a chaos button.
// The page reports what actually happened: which pod died, which one answered,
// how long the replacement took.

import { api, describeError } from "../api.js";
import { el, header, card, badge, note, fmt, toast, withBusy, statRow } from "../ui.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  id: "availability",

  async mount(root) {
    const readinessSlot = el("div", { class: "mt-3" });
    const topologySlot = el("div", { class: "mt-3" });
    const timeline = el("div", { class: "timeline" });
    const chaosStatus = el("div", { class: "mt-3" });

    const refreshButton = el("button", { class: "btn btn-sm", type: "button", text: "Refresh readiness" });
    const crashButton = el("button", { class: "btn hover:border-bad hover:text-bad", type: "button", text: "Kill this pod" });
    const drainButton = el("button", { class: "btn", type: "button", text: "Drain this pod (60 s)" });

    const intro = card(
      header(
        "Chapter 07 · Availability",
        "Failure is a feature.",
        "Kubernetes does not prevent failure; it makes failure boring. The buttons below kill or drain the pod that served this page, then watch what the Service does."
      )
    );

    const readinessCard = card(
      el(
        "div",
        { class: "flex flex-wrap items-start justify-between gap-3" },
        header("Readiness", "Can this pod serve?", "Dependency-aware: Key Vault and Storage are part of the answer."),
        refreshButton
      ),
      readinessSlot
    );

    const topologyCard = card(
      header("Topology", "What is protecting traffic", "The manifest is the contract."),
      topologySlot
    );

    const chaosCard = card(
      header("Chaos", "Break something on purpose", "The crash endpoint is lab-only and guarded by ENABLE_DEBUG_ENDPOINTS; the drain endpoint is a time-bounded readiness override."),
      el("div", { class: "mt-4 flex flex-wrap gap-2" }, crashButton, drainButton),
      chaosStatus
    );

    const timelineCard = card(
      header("Timeline", "What the browser observed", "Times are measured from the click, in this tab."),
      timeline
    );

    const explainCard = card(
      header("The reasoning", "Readiness drains; liveness restarts", null),
      el(
        "div",
        { class: "mt-3 space-y-3" },
        reason("Readiness fails → the pod leaves Service endpoints.", "A dependency outage drains traffic without killing the process, so a Key Vault blip does not restart every pod and turn degradation into an outage."),
        reason("Liveness fails → kubelet restarts the container.", "The liveness probe is /health, which touches nothing external. Only a wedged process triggers it."),
        reason("Rolling update → maxUnavailable 0.", "A new pod must pass /ready before an old one is removed. The preStop sleep gives kube-proxy time to stop sending requests."),
        reason("Single node → shared fate.", "The PDB protects voluntary disruptions. It cannot protect against losing the only node. Zone redundancy would need a second node and a second availability zone; that cost was declined deliberately.")
      )
    );

    function reason(title, text) {
      return el(
        "div",
        { class: "border-b border-line pb-3 last:border-0 last:pb-0" },
        el("div", { class: "text-sm text-paper", text: title }),
        el("div", { class: "subtle mt-1 text-[13px]", text })
      );
    }

    function addEvent(text, tone = "muted") {
      timeline.append(
        el(
          "div",
          { class: "timeline-item", dataset: { tone } },
          el("span", { class: "font-mono text-[10px] text-muted", text: new Date().toLocaleTimeString("en-GB") }),
          el("span", { class: "ml-2 text-paper", text })
        )
      );
      timeline.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function renderReadiness({ httpStatus, body }) {
      const checks = (body && body.checks) || {};
      const ok = httpStatus === 200 && body && body.status === "ready";
      const dotTone = (value) => (value === "ok" || value === "not_configured" ? "ok" : value === "pending" ? "warn" : "bad");

      readinessSlot.replaceChildren(
        el(
          "div",
          { class: "flex flex-wrap items-center gap-2" },
          badge(ok ? "ready" : body && body.status === "shutting_down" ? "draining" : "not ready", ok ? "ok" : "bad"),
          el("span", { class: "font-mono text-[10px] text-muted", text: `HTTP ${httpStatus}` })
        ),
        statRow("Key Vault", checks.keyVault || "—"),
        statRow("Signing key", checks.signingKey || "—"),
        statRow("Storage", checks.storage || "—"),
        statRow("Storage failures in a row", fmt.number(checks.storageConsecutiveFailures)),
        el(
          "div",
          { class: "mt-2 flex flex-wrap gap-2" },
          badge(`vault ${checks.keyVault || "?"}`, dotTone(checks.keyVault)),
          badge(`storage ${checks.storage || "?"}`, dotTone(checks.storage))
        )
      );
    }

    async function refresh() {
      const ready = await api.ready();
      renderReadiness(ready);

      topologySlot.replaceChildren(
        statRow("Replicas", "2 (HPA 2 → 6)"),
        statRow("PodDisruptionBudget", "minAvailable 1"),
        statRow("Rollout", "maxSurge 1 / maxUnavailable 0"),
        statRow("preStop", "5 s"),
        statRow("Termination grace", "30 s"),
        statRow("Readiness period", "3 s × 3 failures"),
        note("Two replicas, one node: the scheduler spreads them if a second node appears, but today they share the node.", "muted")
      );
    }

    refreshButton.addEventListener("click", () => {
      refresh()
        .then(() => toast("Readiness refreshed", "ok"))
        .catch((err) => toast(describeError(err), "bad"));
    });

    crashButton.addEventListener("click", async () => {
      if (!window.confirm("Kill the pod that serves this request? The Deployment will replace it.")) return;
      try {
        await withBusy(
          crashButton,
          async () => {
            const before = await api.version();
            const beforePods = new Set((await api.probePods(10)).pods.map((entry) => entry.pod));
            addEvent(`before: ${before.pod} (${[...beforePods].join(", ") || "no pods"})`);

            const started = performance.now();
            try {
              const response = await api.debug.crash();
              addEvent(`crash accepted by ${response.pod}`, "warn");
            } catch (err) {
              addEvent(`crash request ended without a response: ${describeError(err)}`, "warn");
            }

            const failures = [];
            let replacement = null;
            let firstOther = null;
            const seen = new Set();

            for (let i = 0; i < 60; i += 1) {
              await sleep(600);
              const result = await api.probePods(4);
              for (const entry of result.pods) {
                seen.add(entry.pod);
                if (!beforePods.has(entry.pod) && !replacement) replacement = { pod: entry.pod, at: performance.now() - started };
              }
              if (!firstOther && result.pods.some((entry) => entry.pod !== before.pod)) {
                firstOther = performance.now() - started;
                addEvent(`first answer from another pod after ${fmt.ms(Math.round(firstOther))}`, "ok");
              }
              if (result.ok < result.total) failures.push(result.total - result.ok);
              chaosStatus.replaceChildren(
                el("span", { class: "label", text: `polling… ${seen.size} pod(s) seen · ${failures.reduce((a, b) => a + b, 0)} failed checks` })
              );
              if (replacement) break;
            }

            const totalFailed = failures.reduce((a, b) => a + b, 0);
            if (replacement) {
              addEvent(`replacement ${replacement.pod} ready after ${(replacement.at / 1000).toFixed(1)} s`, "ok");
              chaosStatus.replaceChildren(
                note(
                  `Recovered: ${replacement.pod} joined after ${(replacement.at / 1000).toFixed(1)} s. ${totalFailed} health checks failed while the Service was converging.`,
                  totalFailed === 0 ? "ok" : "warn"
                )
              );
            } else {
              addEvent("no replacement observed within 36 s", "bad");
              chaosStatus.replaceChildren(
                note(
                  "No replacement appeared. On a local run nothing restarts the process; on AKS check the Deployment and the node. This is an honest failure, not a hidden one.",
                  "bad"
                )
              );
            }
          },
          "Crashing…"
        );
      } catch (err) {
        chaosStatus.replaceChildren(note(describeError(err), "bad"));
      }
    });

    drainButton.addEventListener("click", async () => {
      if (!window.confirm("Force this pod out of the Service endpoints for 60 seconds?")) return;
      try {
        await withBusy(
          drainButton,
          async () => {
            const drained = await api.debug.drain(60);
            addEvent(`drain requested on ${drained.pod} for 60 s`, "warn");
            chaosStatus.replaceChildren(note(`Waiting for readiness to fail on ${drained.pod} (3 probes × 3 s)…`, "muted"));
            await sleep(11000);
            // Probe /ready, not /health: draining removes a pod from Service
            // endpoints, so the evidence is which pod answers readiness and
            // whether that answer is 200 or 503.
            const result = await api.probeReady(20);
            const seen = result.pods.find((entry) => entry.pod === drained.pod);
            const absent = !seen;
            addEvent(
              `after drain: ${result.ok}/${result.total} ready, ${
                absent ? `${drained.pod} absent from endpoints` : `${drained.pod} still reached ${seen.hits}× (${seen.failed} non-200)`
              }`,
              absent ? "ok" : "warn"
            );
            chaosStatus.replaceChildren(
              note(
                absent
                  ? `${drained.pod} is out of rotation; ${result.ok} of ${result.total} readiness requests were served by the remaining replica. It rejoins automatically after the 60 s TTL.`
                  : seen.failed === seen.hits
                    ? `${drained.pod} answered every readiness request with 503. With one reachable pod (local run or a single replica) there is no second endpoint to take over — readiness is failing, but the Service has nowhere else to send traffic.`
                    : `${drained.pod} was still reached ${seen.hits} times (${seen.failed} non-200). Endpoint removal is still converging; run the probe again in a few seconds.`,
                absent ? "ok" : "warn"
              )
            );
          },
          "Draining…"
        );
      } catch (err) {
        chaosStatus.replaceChildren(note(describeError(err), "bad"));
      }
    });

    root.replaceChildren(
      intro,
      el("div", { class: "mt-4 grid gap-4 lg:grid-cols-3" }, readinessCard, topologyCard, chaosCard),
      el("div", { class: "mt-4" }, timelineCard),
      el("div", { class: "mt-4" }, explainCard)
    );

    return refresh;
  },
};
