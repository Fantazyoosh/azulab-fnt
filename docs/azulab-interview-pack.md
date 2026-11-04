# Azulab — interview pack

One image, two runtimes, one signed link.

- **Blob Storage** — private container, shared key disabled, lifecycle bound.
- **RBAC** — groups hold assignments; Owner is control plane, not data plane.
- **Key Vault** — versioned HMAC key; only the version and fingerprint are shown.
- **Scaling** — HPA 2 → 6 on CPU, 60% of the request.
- **Cost** — one node and one load balancer dominate; ACA scales to zero.
- **Availability** — readiness drains, liveness restarts; one node is shared fate.

Upload this file in the Drop chapter to demonstrate the full flow.
