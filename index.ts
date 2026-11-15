import { H3 } from "https://esm.sh/h3@2.0.2";
import api from "./backend/api.ts";
import { serveStatic } from "./backend/routes/static.ts";

// Val Town invokes fetch directly; do not start a server inside an HTTP trigger.
const app = new H3()
  .all("/api/**", api.handler)
  .get("/**", (event) => serveStatic(event.req, import.meta.url));

export default app.fetch;
