import { H3 } from "h3";
import { analyzeRequest } from "./routes/analysis.ts";
import { surprisalRequest } from "./routes/surprisal.ts";

const api = new H3()
  .post("/api/annotate", (event) => analyzeRequest(event.req))
  .post("/api/surprisal", (event) => surprisalRequest(event.req))
  .all("/**", () =>
    Response.json({ error: "Not found" }, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }));

export default api;
