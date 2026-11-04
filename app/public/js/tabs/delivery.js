// Chapter 08 — Delivery.
//
// One commit, one image, two runtimes. The map is the same system the previous
// chapters probe; here it is in one picture, with the live artifact beside it.

import { api, describeError } from "../api.js";
import { el, header, card, badge, note, fmt, statRow, codeBlock, copyButton, podName } from "../ui.js";

const MAP = `
<svg viewBox="0 0 920 400" class="h-auto w-full min-w-[760px]" role="img"
     aria-label="GitHub builds one image and deploys it to Container Apps and AKS; both use a managed identity to reach Key Vault and Blob Storage; logs go to Log Analytics.">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8"></path>
    </marker>
    <marker id="arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#7c8aa5"></path>
    </marker>
  </defs>

  <rect x="20" y="40" width="140" height="56" rx="6" fill="#0d1526" stroke="#1e2a44"></rect>
  <text x="90" y="63" text-anchor="middle" fill="#d6deeb" font-family="ui-monospace, monospace" font-size="12">GitHub main</text>
  <text x="90" y="81" text-anchor="middle" fill="#7c8aa5" font-family="ui-monospace, monospace" font-size="10">merge → CI</text>

  <rect x="200" y="40" width="110" height="56" rx="6" fill="#0d1526" stroke="#1e2a44"></rect>
  <text x="255" y="63" text-anchor="middle" fill="#d6deeb" font-family="ui-monospace, monospace" font-size="12">CI</text>
  <text x="255" y="81" text-anchor="middle" fill="#7c8aa5" font-family="ui-monospace, monospace" font-size="10">test + build</text>

  <rect x="350" y="40" width="140" height="56" rx="6" fill="#0d1526" stroke="#1e2a44"></rect>
  <text x="420" y="63" text-anchor="middle" fill="#d6deeb" font-family="ui-monospace, monospace" font-size="12">GHCR</text>
  <text x="420" y="81" text-anchor="middle" fill="#7c8aa5" font-family="ui-monospace, monospace" font-size="10">:commit-sha</text>

  <path d="M160 68 H200" stroke="#38bdf8" stroke-width="1.5" fill="none" marker-end="url(#arrow)"></path>
  <path d="M310 68 H350" stroke="#38bdf8" stroke-width="1.5" fill="none" marker-end="url(#arrow)"></path>
  <path d="M490 68 H520 V40 H560" stroke="#38bdf8" stroke-width="1.5" fill="none" marker-end="url(#arrow)"></path>
  <path d="M490 68 H520 V128 H560" stroke="#38bdf8" stroke-width="1.5" fill="none" marker-end="url(#arrow)"></path>

  <rect x="560" y="10" width="190" height="60" rx="6" fill="#0d1526" stroke="#38bdf8" stroke-opacity="0.5"></rect>
  <text x="655" y="35" text-anchor="middle" fill="#d6deeb" font-family="ui-monospace, monospace" font-size="12">Container Apps</text>
  <text x="655" y="53" text-anchor="middle" fill="#7c8aa5" font-family="ui-monospace, monospace" font-size="10">Easy Auth · scale to zero</text>

  <rect x="560" y="98" width="190" height="60" rx="6" fill="#0d1526" stroke="#38bdf8" stroke-opacity="0.5"></rect>
  <text x="655" y="123" text-anchor="middle" fill="#d6deeb" font-family="ui-monospace, monospace" font-size="12">AKS</text>
  <text x="655" y="141" text-anchor="middle" fill="#7c8aa5" font-family="ui-monospace, monospace" font-size="10">HPA 2–6 · public LB</text>

  <rect x="560" y="190" width="190" height="60" rx="6" fill="#0d1526" stroke="#1e2a44"></rect>
  <text x="655" y="215" text-anchor="middle" fill="#d6deeb" font-family="ui-monospace, monospace" font-size="12">Managed identity</text>
  <text x="655" y="233" text-anchor="middle" fill="#7c8aa5" font-family="ui-monospace, monospace" font-size="10">Workload Identity on AKS</text>

  <path d="M560 40 H535 V220 H560" stroke="#38bdf8" stroke-width="1.5" fill="none" marker-end="url(#arrow)"></path>
  <path d="M560 128 H535" stroke="#38bdf8" stroke-width="1.5" fill="none"></path>

  <rect x="330" y="300" width="160" height="60" rx="6" fill="#0d1526" stroke="#1e2a44"></rect>
  <text x="410" y="325" text-anchor="middle" fill="#d6deeb" font-family="ui-monospace, monospace" font-size="12">Key Vault</text>
  <text x="410" y="343" text-anchor="middle" fill="#7c8aa5" font-family="ui-monospace, monospace" font-size="10">signing key · audit</text>

  <rect x="530" y="300" width="160" height="60" rx="6" fill="#0d1526" stroke="#1e2a44"></rect>
  <text x="610" y="325" text-anchor="middle" fill="#d6deeb" font-family="ui-monospace, monospace" font-size="12">Blob Storage</text>
  <text x="610" y="343" text-anchor="middle" fill="#7c8aa5" font-family="ui-monospace, monospace" font-size="10">drops · no shared key</text>

  <path d="M600 250 L490 300" stroke="#38bdf8" stroke-width="1.5" fill="none" marker-end="url(#arrow)"></path>
  <path d="M680 250 L610 300" stroke="#38bdf8" stroke-width="1.5" fill="none" marker-end="url(#arrow)"></path>

  <rect x="730" y="300" width="170" height="60" rx="6" fill="#0d1526" stroke="#1e2a44"></rect>
  <text x="815" y="325" text-anchor="middle" fill="#d6deeb" font-family="ui-monospace, monospace" font-size="12">Log Analytics</text>
  <text x="815" y="343" text-anchor="middle" fill="#7c8aa5" font-family="ui-monospace, monospace" font-size="10">logs · metrics · audit</text>

  <path d="M690 330 H730" stroke="#7c8aa5" stroke-width="1.2" stroke-dasharray="4 4" fill="none" marker-end="url(#arrow-muted)"></path>
</svg>`;

const PIPELINE = [
  ["01", "Pull request", "Lint, unit tests, docker build, terraform validate. No image is published from a PR."],
  ["02", "CI on main", "Tests, build, push ghcr.io/…:<sha>. The tag is the full commit SHA; latest is never used."],
  ["03", "CD", "The same tag goes to Container Apps and AKS; the HPA manifest is applied, the rollout is watched."],
  ["04", "Verify", "Smoke /health and /ready on both runtimes, fetch a signed share link, confirm the protected Container App root is 401."],
];

export default {
  id: "delivery",

  async mount(root) {
    const artifactSlot = el("div", { class: "mt-3" });
    const runtimeSlot = el("div", { class: "mt-3" });

    const intro = card(
      header(
        "Chapter 08 · Delivery",
        "One image. Two runtimes.",
        "Every merge to main produces one immutable artifact. Container Apps and AKS pull the same tag, so \"it works on my machine\" is the same machine."
      )
    );

    const mapCard = card(
      header("System map", "Everything the previous chapters probed", "Build at the top, identity in the middle, data at the bottom. The dashed line is observability."),
      el("div", { class: "mt-4 overflow-x-auto" })
    );
    mapCard.querySelector("div:last-child").innerHTML = MAP;

    const artifactCard = card(
      header("This artifact", "Live from the process answering you", "The CD pipeline overwrites both the image and APP_VERSION with the deployed SHA."),
      artifactSlot
    );

    const pipelineCard = card(
      header("Pipeline", "Four gates", "The same workflow deploys both runtimes."),
      el(
        "ol",
        { class: "mt-4 space-y-3" },
        ...PIPELINE.map(([number, title, text]) =>
          el(
            "li",
            { class: "flex gap-3" },
            el("span", { class: "font-mono text-[10px] text-accent", text: number }),
            el("span", { class: "subtle" }, el("span", { class: "text-paper", text: `${title} — ` }), document.createTextNode(text))
          )
        )
      )
    );

    const runtimeCard = card(
      header("Runtime comparison", "Same code, different platform promises", null),
      el("div", { class: "mt-4 overflow-x-auto" }, runtimeTable())
    );

    const guaranteesCard = card(
      header("Guarantees", "What the pipeline will not do", null),
      el(
        "ul",
        { class: "mt-3 space-y-2 text-sm text-muted" },
        guarantee("It will not deploy a tag that was not built from main."),
        guarantee("It will not deploy an image that failed tests."),
        guarantee("It will not use :latest; the tag is the commit SHA."),
        guarantee("It will not store registry credentials: the GHCR image is public."),
        guarantee("It will not apply the full kustomization when only the Service needs recreating.")
      ),
      codeBlock("ghcr.io/fantazyoosh/azulab-fnt:<commit-sha>"),
      copyButton("ghcr.io/fantazyoosh/azulab-fnt:<commit-sha>")
    );

    const docsCard = card(
      header("Read more", "The written version", null),
      el(
        "ul",
        { class: "mt-3 space-y-2 text-sm" },
        docLink("Presentation runbook", "docs/presentation.md"),
        docLink("Study plan", "docs/study.md"),
        docLink("Demo script", "docs/demo-script.md"),
        docLink("Security architecture", "docs/security.md"),
        docLink("Architecture decisions", "docs/decisions.md")
      )
    );

    function guarantee(text) {
      return el(
        "li",
        { class: "flex gap-2" },
        el("span", { class: "mt-2 h-1 w-1 shrink-0 rounded-full bg-ok" }),
        el("span", { text })
      );
    }

    function runtimeTable() {
      return el(
        "table",
        { class: "table" },
        el(
          "thead",
          {},
          el("tr", {}, el("th", { text: "" }), el("th", { text: "AKS" }), el("th", { text: "Container Apps" }))
        ),
        el(
          "tbody",
          {},
          compareRow("Artifact", "same commit SHA", "same commit SHA"),
          compareRow("Ingress", "public LoadBalancer", "managed HTTPS endpoint"),
          compareRow("Auth", "none at ingress; the app is public", "Easy Auth (Entra ID); /s/* stays anonymous for signed links"),
          compareRow("Scaling", "HPA 2 → 6, CPU 60%", "platform scale rules, scale to zero"),
          compareRow("Share links", "work without a session", "work without a session")
        )
      );
    }

    function compareRow(label, aks, aca) {
      return el(
        "tr",
        {},
        el("td", { class: "font-mono text-[10px] uppercase tracking-[0.14em] text-muted", text: label }),
        el("td", { class: "text-[12px] text-paper", text: aks }),
        el("td", { class: "text-[12px] text-paper", text: aca })
      );
    }

    function docLink(label, path) {
      return el(
        "li",
        {},
        el("a", { href: `https://github.com/Fantazyoosh/azulab-fnt/blob/main/${path}`, text: label })
      );
    }

    async function refresh() {
      try {
        const version = await api.version();
        const local = !version.pod || version.pod === "unknown" || version.pod === "local";
        // Locally the platform fields are genuinely absent (no HOSTNAME, no
        // node object). A dash is more honest than the string "unknown".
        const known = (value) => (!value || value === "unknown" ? "—" : value);
        artifactSlot.replaceChildren(
          statRow("Commit SHA", known(version.version)),
          statRow("Image", known(version.image)),
          statRow("Pod", podName(version.pod)),
          statRow("Node", known(version.node)),
          statRow("Namespace", known(version.namespace)),
          statRow("Started", fmt.time(version.startedAt))
        );
        runtimeSlot.replaceChildren(
          badge(
            local ? "served by a local process" : version.pod.startsWith("ca-") ? "served by Container Apps" : "served by AKS",
            "accent"
          ),
          note("The header pills and this card read the same process. If the pod name changes, the image did not.", "muted")
        );
      } catch (err) {
        artifactSlot.replaceChildren(note(describeError(err), "bad"));
      }
    }

    root.replaceChildren(
      intro,
      el("div", { class: "mt-4" }, mapCard),
      el("div", { class: "mt-4 grid gap-4 lg:grid-cols-2" }, artifactCard, runtimeCard),
      el("div", { class: "mt-4 grid gap-4 lg:grid-cols-2" }, pipelineCard, guaranteesCard),
      el("div", { class: "mt-4" }, docsCard)
    );

    return refresh;
  },
};
