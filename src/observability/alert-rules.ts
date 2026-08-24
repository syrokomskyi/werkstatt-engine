/*
<MODULE_CONTRACT>
<purpose>Authored source of truth for observability alert rules and notification channels (RFC-0342).</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0342: initial implementation with baseline v1 rules.</item>
</CHANGE_SUMMARY>
*/

export type WarpgogolAlertSeverity = "critical" | "warning";
export type WarpgogolChannelId = "email-studio" | "telegram-studio";

export interface WarpgogolAlertRule {
  id: string;
  name: string;
  severity: WarpgogolAlertSeverity;
  promql?: string;
  builder?: unknown;
  evalWindow: string;
  forDuration: string;
  condition: { op: ">" | "<" | ">=" | "<=" | "=="; target: number };
  channels: WarpgogolChannelId[];
  labels?: Record<string, string>;
  description: string;
}

export interface WarpgogolNotificationChannel {
  id: WarpgogolChannelId;
  kind: "email" | "webhook";
  target: string[];
}

export const NOTIFICATION_CHANNELS: readonly WarpgogolNotificationChannel[] = [
  {
    id: "email-studio",
    kind: "email",
    target: ["founder@warpgogol.com"],
  },
  {
    id: "telegram-studio",
    kind: "webhook",
    target: ["WARPGOGOL_TG_BRIDGE_URL"],
  },
];

export const ALERT_RULES: readonly WarpgogolAlertRule[] = [
  {
    id: "fleet-site-down",
    name: "Fleet site down",
    severity: "critical",
    promql: 'min by (site_id) (warpgogol_probe_up{route="/"}) == 0',
    evalWindow: "5m",
    forDuration: "10m",
    condition: { op: "==", target: 0 },
    channels: ["email-studio", "telegram-studio"],
    description:
      "A fleet site has been unreachable for 10 minutes. runbook: check Cloudflare status, then SSH to VPS and inspect the observability-stack services.",
  },
  {
    id: "fleet-cert-expiry-warn",
    name: "TLS certificate expiring soon (14 days)",
    severity: "warning",
    promql: "min by (site_id) (warpgogol_probe_cert_expiry_days) < 14",
    evalWindow: "1h",
    forDuration: "1h",
    condition: { op: "<", target: 14 },
    channels: ["email-studio"],
    description:
      "A fleet site's TLS certificate expires in less than 14 days. runbook: renew the certificate via Caddy or the Cloudflare dashboard.",
  },
  {
    id: "fleet-cert-expiry-crit",
    name: "TLS certificate expiring critical (7 days)",
    severity: "critical",
    promql: "min by (site_id) (warpgogol_probe_cert_expiry_days) < 7",
    evalWindow: "1h",
    forDuration: "1h",
    condition: { op: "<", target: 7 },
    channels: ["email-studio", "telegram-studio"],
    description:
      "A fleet site's TLS certificate expires in less than 7 days. runbook: renew immediately via Caddy or the Cloudflare dashboard.",
  },
  {
    id: "factory-build-check-failed",
    name: "Factory build.check failed",
    severity: "warning",
    promql:
      'increase(warpgogol_factory_command_runs_total{command="build.check",status=~"fail|error"}[6h]) > 0',
    evalWindow: "6h",
    forDuration: "0m",
    condition: { op: ">", target: 0 },
    channels: ["email-studio"],
    description:
      "A build.check command failed in the last 6 hours. runbook: check CI logs for the failing command and diagnostics.",
  },
  {
    id: "workers-error-rate",
    name: "Workers error rate above 5%",
    severity: "warning",
    builder: {
      queryType: "trace",
      filters: [],
      groupBy: ["service.name"],
      ratio: { numerator: "status=error", denominator: "*" },
    },
    evalWindow: "15m",
    forDuration: "15m",
    condition: { op: ">", target: 0.05 },
    channels: ["email-studio"],
    description:
      "A Cloudflare Worker service has an error span ratio above 5% for 15 minutes. runbook: check the Worker logs in the Cloudflare dashboard and SigNoz trace explorer.",
  },
];
