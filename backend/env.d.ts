// The bindings alchemy.run.ts gives the Worker, typed only as far as we use them.
declare module "cloudflare:workers" {
  interface D1Statement {
    bind(...values: unknown[]): D1Statement;
    run(): Promise<{ meta: { changes: number } }>;
    first(): Promise<Record<string, unknown> | null>;
  }
  export const env: {
    DB: { prepare(sql: string): D1Statement };
    SCORER_URL: string;
    SIGNING_KEY: string;
  };
}
