# Security notes

## What this project does

- **No stored cloud secrets in CI/CD.** GitHub Actions authenticates to Azure with
  OIDC (workload identity federation) via `azure/login@v2`. The only values stored
  are non-secret identifiers (`client id`, `tenant id`, `subscription id`).
- **App secrets in Key Vault.** The Container App's user-assigned managed identity
  has `Key Vault Secrets User`. The app reads the secret at startup through
  `DefaultAzureCredential`.
- **Blob access via RBAC.** The same identity has `Storage Blob Data Contributor`
  on the storage account. The container is private; shared-key access is not used.
- **TLS-only storage**, minimum TLS 1.2, public blob access disabled.
- **Network policy is explicit.** By default the storage account is reachable. To
  deny everyone except approved ranges, set `allowed_storage_ip_ranges` and Terraform
  switches `default_action` to `Deny`.

## geo-blocking question ("how to stop people from Russia using the blob")

Azure Storage network rules are an **IP allow-list, not a country filter**. There
is no native country rule on a storage account. Three realistic options, from
cheapest to most expensive:

1. **Front Door / CDN WAF geomatch rule** — the one EPAM-style answer. Put Azure
   Front Door in front of the storage (or the app), add a WAF custom rule with
   `GeoMatch` on country code `RU` (and others) set to Block/Redirect. Cost:
   Front Door standard tier + rule evaluations. This is where country-level
   filtering actually belongs, because it is an edge concern, not a storage
   concern.
2. **Application-level gating** — check `CF-IPCountry` / `X-Forwarded-For`? Only if
   you control routing; not trustworthy on its own. Use only as defence in depth.
3. **Private endpoint + no public access** — kills the problem entirely by
   removing public reachability, at the cost of needing a VNet/VPN for legit
   access. Right answer for sensitive data; wrong answer for a public portfolio
   app.

The reason storage accounts do not ship country rules: they are a data plane, and
the platform expects edge/WAF to own geography. Saying "I added an IP list to the
storage account" in an interview is a red flag; saying "storage doesn't do geo,
Front Door WAF geomatch is the right layer, here is the cost" is the right
answer.

## honesty line

This is a personal lab, not enterprise production. No SLA, no HA across zones,
no private networking, no formal threat model. The security claims above are
configuration facts, provable from `terraform show` and the role-assignment
output.
