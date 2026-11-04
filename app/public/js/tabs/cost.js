// Chapter 06 — Cost.
//
// List prices, not a bill. The point is the shape of the spend: one node and
// one load balancer dominate; everything else is noise at lab volume.

import { el, header, card, badge, note, codeBlock, copyButton } from "../ui.js";

const ITEMS = [
  { item: "AKS node · Standard_D2as_v5", unit: "2 vCPU / 8 GiB", day: 2.21, month: 66.3, note: "the compute floor" },
  { item: "Standard Load Balancer", unit: "one public Service", day: 0.6, month: 18.0, note: "rules + data processed" },
  { item: "Public IP", unit: "static, Standard", day: 0.12, month: 3.6, note: "released with the Service" },
  { item: "Container Apps", unit: "scale to zero", day: 0, month: 0, note: "idle costs nothing" },
  { item: "Azure Container Registry", unit: "not used", day: 0, month: 0, note: "image is public on GHCR" },
  { item: "Key Vault", unit: "per 10k operations", day: 0, month: 0.1, note: "cents at demo volume" },
  { item: "Blob Storage", unit: "GB-month + operations", day: 0, month: 0.2, note: "small files, lifecycle policy" },
  { item: "Log Analytics", unit: "per GB ingested", day: 0, month: 0, note: "lab volume is small" },
];

const LEVERS = [
  ["One node, two vCPU", "The cluster is a demo, not a production fleet. A second node would double the largest line item."],
  ["Container Apps scales to zero", "The second runtime is free when nobody is using it; it wakes on the next request."],
  ["No ACR", "The image lives on GHCR. A basic registry would add a fixed monthly fee for no demo value."],
  ["Lifecycle policy", "Sealed drops move to Cool after 30 days and are deleted after 90. The container cannot grow without a bound."],
  ["Delete the Service between sessions", "The load balancer and public IP are the second largest line. Removing the Service releases both."],
  ["Stop the cluster", "az aks stop deallocates the node. The disks and any remaining public IP still bill, so the Service is deleted first."],
];

const NOT_BOUGHT = [
  ["App Gateway / WAF", "A managed ingress would add a fixed monthly cost; the built-in LoadBalancer is enough to show traffic."],
  ["Redis / SQL", "The app is stateless by design. Sessions and share links need neither."],
  ["NAT Gateway", "The cluster has outbound connectivity without one; it would be a fixed cost for no demo behaviour."],
  ["Second node / zone redundancy", "Availability is discussed honestly as a trade-off: two replicas on one node share its fate."],
  ["PIM / Entra ID P2", "Not licensed in this tenant. Compensating controls are in the RBAC chapter."],
  ["Premium storage", "Standard LRS is appropriate for demo data and keeps the storage line negligible."],
];

export default {
  id: "cost",

  async mount(root) {
    const intro = card(
      el(
        "div",
        { class: "flex flex-wrap items-start justify-between gap-3" },
        header(
          "Chapter 06 · Cost",
          "Small by design.",
          "The lab runs at roughly 2.93 $/day when everything is on. That number is dominated by one node and one load balancer; the managed services are noise at this volume."
        ),
        el("div", { class: "flex flex-wrap gap-2" }, badge("2.93 $/day", "accent"), badge("~88 $/30d", "warn"), badge("budget alert 50 $", "warn"))
      )
    );

    const summary = el(
      "div",
      { class: "mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" },
      statCard("Run rate", "2.93 $", "per day, all services on"),
      statCard("30 days", "~88 $", "if left running"),
      statCard("Budget alert", "50 $", "early warning, not a cap"),
      statCard("Quota", "4 vCPU", "Free Trial subscription")
    );

    const table = el(
      "table",
      { class: "table" },
      el(
        "thead",
        {},
        el("tr", {}, el("th", { text: "Line" }), el("th", { text: "Unit" }), el("th", { text: "$/day" }), el("th", { text: "$/30d" }), el("th", { text: "Note" }))
      ),
      el(
        "tbody",
        {},
        ...ITEMS.map((row) =>
          el(
            "tr",
            {},
            el("td", { class: "font-mono text-[11px]", text: row.item }),
            el("td", { class: "text-[12px] text-muted", text: row.unit }),
            el("td", { class: "font-mono text-[11px]", text: row.day ? row.day.toFixed(2) : "0.00" }),
            el("td", { class: "font-mono text-[11px]", text: row.month ? row.month.toFixed(2) : "0.00" }),
            el("td", { class: "text-[12px] text-muted", text: row.note })
          )
        )
      )
    );

    const billCard = card(
      header("The bill", "What dominates", "Sweden Central list prices, captured for the demo. Not a substitute for the Cost Management blade."),
      el("div", { class: "mt-4 overflow-x-auto" }, table),
      note("The 50 $ budget alert is an early warning, not a spending cap. At 2.93 $/day it fires after roughly 17 days of continuous runtime — which is why the cluster is stopped between sessions.", "warn")
    );

    const leversCard = card(
      header("Levers", "How the number is kept small", null),
      el(
        "div",
        { class: "mt-3" },
        ...LEVERS.map(([title, text]) =>
          el(
            "div",
            { class: "border-b border-line py-3 last:border-0" },
            el("div", { class: "text-sm text-paper", text: title }),
            el("div", { class: "subtle mt-1 text-[13px]", text })
          )
        )
      )
    );

    const notBoughtCard = card(
      header("Deliberate omissions", "What we did not buy", "Every omission is a trade-off, not an oversight."),
      el(
        "div",
        { class: "mt-3" },
        ...NOT_BOUGHT.map(([title, text]) =>
          el(
            "div",
            { class: "border-b border-line py-3 last:border-0" },
            el("div", { class: "text-sm text-paper", text: title }),
            el("div", { class: "subtle mt-1 text-[13px]", text })
          )
        )
      )
    );

    const commandsCard = card(
      header("Between sessions", "Stop paying for idle", "Delete the Service first: it owns the load balancer and the public IP."),
      codeBlock(
        "kubectl -n azulab delete svc azulab\n" +
          "az aks stop --name aks-azulab-dev --resource-group rg-azulab-dev-polandcentral\n\n" +
          "# next session\n" +
          "az aks start --name aks-azulab-dev --resource-group rg-azulab-dev-polandcentral\n" +
          "kubectl apply -f k8s/service.yaml"
      ),
      copyButton("az aks stop --name aks-azulab-dev --resource-group rg-azulab-dev-polandcentral"),
      note("Recreating the Service gives the cluster a new public IP and resets the image to the baseline manifest; the CD pipeline re-applies the current tag. Full `kubectl apply -k` at this point would do the same, so prefer the single Service manifest.", "muted")
    );

    root.replaceChildren(
      intro,
      summary,
      el("div", { class: "mt-4" }, billCard),
      el("div", { class: "mt-4 grid gap-4 lg:grid-cols-2" }, leversCard, notBoughtCard),
      el("div", { class: "mt-4" }, commandsCard)
    );

    return async () => {};
  },
};

function statCard(label, value, hint) {
  return el(
    "div",
    { class: "card" },
    el("div", { class: "label", text: label }),
    el("div", { class: "value text-xl", text: value }),
    el("div", { class: "subtle mt-1 text-[12px]", text: hint })
  );
}
