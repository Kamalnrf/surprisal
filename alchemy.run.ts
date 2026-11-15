import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "Surprisal",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    // Signs every request to the scorer. Generated once, kept in Alchemy's
    // state; scorer.py pins the public half.
    const key = yield* Alchemy.KeyPair("ScorerKey");
    const db = yield* Cloudflare.D1.Database("Allowance", {
      migrations: "./migrations",
    });
    const site = yield* Cloudflare.Website.StaticSite("Surprisal", {
      command: "bun run build",
      outdir: "dist",
      main: "./index.ts",
      // Other stages are previews on workers.dev.
      domain: stage === "prod" ? process.env.SURPRISAL_DOMAIN : undefined,
      env: {
        DB: db,
        SIGNING_KEY: key.privateKey,
        SCORER_URL: Config.String("SCORER_URL"),
      },
    });
    return {
      url: site.url,
      // Paste into PUBLIC_KEYS in scorer.py.
      scorerPublicKey: Output.map(
        key.publicKey,
        (pem) =>
          Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64")
            .subarray(-32).toString("base64url"),
      ),
    };
  }),
);
