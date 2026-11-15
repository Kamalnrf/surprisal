import { H3 } from "h3";
import api from "./backend/api.ts";

// Static files in dist/ are served before the Worker runs, so only
// /api/* and unknown paths reach this app.
const app = new H3().all("/api/**", api.handler);

export default {
  fetch: (request: Request) => app.fetch(request),
};
