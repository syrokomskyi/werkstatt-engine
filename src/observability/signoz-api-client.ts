/*
<MODULE_CONTRACT>
<purpose>Single SigNoz API client module for alert rule and channel management (RFC-0342).</purpose>
<non-goals>
  <item>No dashboard management.</item>
  <item>No user management.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0342: initial implementation.</item>
</CHANGE_SUMMARY>
*/

export interface SignozApiClientConfig {
  apiUrl: string;
  apiToken: string;
}

export interface SignozAlertRule {
  id: string;
  name: string;
  severity: string;
  promql?: string;
  builder?: unknown;
  evalWindow: string;
  forDuration: string;
  condition: { op: string; target: number };
  channels: string[];
  labels?: Record<string, string>;
  description: string;
}

export interface SignozChannel {
  id: string;
  kind: string;
  target: string[];
}

export interface SignozApplyPlan {
  rules: {
    create: SignozAlertRule[];
    update: SignozAlertRule[];
    delete: string[];
  };
  channels: {
    create: SignozChannel[];
    update: SignozChannel[];
    delete: string[];
  };
}

export interface SignozApiClient {
  listManagedRules(): Promise<SignozAlertRule[]>;
  listManagedChannels(): Promise<SignozChannel[]>;
  createRule(rule: SignozAlertRule): Promise<void>;
  updateRule(rule: SignozAlertRule): Promise<void>;
  deleteRule(id: string): Promise<void>;
  createChannel(channel: SignozChannel): Promise<void>;
  updateChannel(channel: SignozChannel): Promise<void>;
  deleteChannel(id: string): Promise<void>;
}

export function createSignozApiClient(config: SignozApiClientConfig): SignozApiClient {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiToken}`,
  };

  async function apiCall(path: string, options: RequestInit = {}): Promise<unknown> {
    const url = `${config.apiUrl}/api${path}`;
    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string>) },
    });
    if (!response.ok) {
      throw new Error(`SigNoz API ${path} returned ${response.status}: ${await response.text()}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  return {
    async listManagedRules(): Promise<SignozAlertRule[]> {
      const data = (await apiCall("/alerts/rules")) as { data?: SignozAlertRule[] };
      const rules = data?.data ?? [];
      return rules.filter((r) => r.labels?.managed_by === "warpgogol");
    },

    async listManagedChannels(): Promise<SignozChannel[]> {
      const data = (await apiCall("/alerts/channels")) as { data?: SignozChannel[] };
      const channels = data?.data ?? [];
      return channels.filter((c) => c.id.startsWith("warpgogol-"));
    },

    async createRule(rule: SignozAlertRule): Promise<void> {
      await apiCall("/alerts/rules", {
        method: "POST",
        body: JSON.stringify({ ...rule, labels: { ...rule.labels, managed_by: "warpgogol" } }),
      });
    },

    async updateRule(rule: SignozAlertRule): Promise<void> {
      await apiCall(`/alerts/rules/${rule.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...rule, labels: { ...rule.labels, managed_by: "warpgogol" } }),
      });
    },

    async deleteRule(id: string): Promise<void> {
      await apiCall(`/alerts/rules/${id}`, { method: "DELETE" });
    },

    async createChannel(channel: SignozChannel): Promise<void> {
      await apiCall("/alerts/channels", {
        method: "POST",
        body: JSON.stringify({ ...channel, id: `warpgogol-${channel.id}` }),
      });
    },

    async updateChannel(channel: SignozChannel): Promise<void> {
      await apiCall(`/alerts/channels/warpgogol-${channel.id}`, {
        method: "PUT",
        body: JSON.stringify(channel),
      });
    },

    async deleteChannel(id: string): Promise<void> {
      await apiCall(`/alerts/channels/warpgogol-${id}`, { method: "DELETE" });
    },
  };
}
