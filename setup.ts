import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";

// Run once after remixing. Creates the tables and the key that signs requests
// to the scorer, then prints the public half to paste into scorer.py.
await sqlite.execute(
  "CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY, public TEXT NOT NULL, private TEXT NOT NULL)",
);
await sqlite.execute(
  "CREATE TABLE IF NOT EXISTS allowance (name TEXT PRIMARY KEY, calls INTEGER NOT NULL, last_ms INTEGER NOT NULL)",
);
let pub = (await sqlite.execute("SELECT public FROM identity WHERE id=1"))
  .rows[0]?.public as string | undefined;
if (!pub) {
  const pair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  pub = JSON.stringify(
    await crypto.subtle.exportKey("jwk", pair.publicKey),
  );
  const priv = JSON.stringify(
    await crypto.subtle.exportKey("jwk", pair.privateKey),
  );
  await sqlite.execute({
    sql: "INSERT INTO identity (id, public, private) VALUES (1, ?, ?)",
    args: [pub, priv],
  });
}
console.log(`PUBLIC_KEY = "${JSON.parse(pub).x}"`);
