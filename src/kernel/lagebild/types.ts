/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/lagebild/types.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Added Compass scaffolding.</item>
</CHANGE_SUMMARY>
*/

export interface TenantAddInput {
  site: string;
  tenantId?: string; // UUID v7, generated if omitted
  vendor?: string; // default 'pipedrive'
  enable?: boolean; // default false
}

export interface TenantAddResult {
  command: "lagebild.tenant.add";
  status: "ok" | "error";
  tenantId: string;
  siteName: string;
  secretRefs: {
    supabaseUrl: string;
    supabaseServiceKey: string;
    destinationToken: string;
    destinationDomain: string;
  };
  commandsToRun: string[]; // wrangler secret put commands
  message?: string;
}

export interface TenantStatusResult {
  command: "lagebild.tenant.status";
  status: "ok" | "error";
  tenant: {
    tenant_id: string;
    site_name: string;
    enabled: boolean;
    last_seen_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
  } | null;
  pendingCount: number;
  failedCount: number;
  deadCount: number;
  missingSecrets: string[];
}

export interface LagebildValidateResult {
  command: "lagebild.validate";
  status: "ok" | "fail";
  violations: Array<{
    rule: string;
    message: string;
    path?: string;
  }>;
}
