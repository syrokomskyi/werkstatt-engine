declare module "miniflare" {
  export interface MiniflareOptions {
    modules?: Array<{ type: string; path: string }>;
    compatibilityDate?: string;
    bindings?: Record<string, unknown>;
    fetch?: typeof fetch;
    [key: string]: unknown;
  }
  export class Miniflare {
    constructor(options: MiniflareOptions);
    dispatchFetch(url: string): Promise<Response>;
    dispose(): Promise<void>;
  }
}
