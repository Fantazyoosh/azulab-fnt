// Tiny in-memory metrics. Not a replacement for Application Insights; it exists
// so the /metrics endpoint and the discussion of observability are concrete.
class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.requests = 0;
    this.errors = 0;
    this.latencies = [];
  }

  record(statusCode, durationMs) {
    this.requests += 1;
    if (statusCode >= 500) this.errors += 1;
    this.latencies.push(durationMs);
    if (this.latencies.length > 1000) this.latencies.shift();
  }

  percentile(p) {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  snapshot() {
    return {
      uptimeMs: Date.now() - this.startedAt,
      requests: this.requests,
      errors: this.errors,
      latencyMs: { p50: this.percentile(50), p95: this.percentile(95), p99: this.percentile(99) },
    };
  }
}

const metrics = new Metrics();
module.exports = { Metrics, metrics };
