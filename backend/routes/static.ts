import {
  parseProject,
  readFile,
  serveFile,
} from "https://esm.town/v/std/utils@85-main/index.ts";
import { escapeHTML } from "../../shared/stream.ts";

export async function serveStatic(
  request: Request,
  projectUrl: string,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== "GET") {
    return new Response("Not found", { status: 404 });
  }
  let response: Response;
  let importMapHash = "";
  if (path === "/manifest.webmanifest") {
    response = new Response(
      JSON.stringify({
        name: "Surprisal",
        short_name: "Surprisal",
        start_url: "/",
        display: "standalone",
        background_color: "#f7f7f2",
        theme_color: "#f7f7f2",
        icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
      }),
      { headers: { "Content-Type": "application/manifest+json" } },
    );
  } else if (path === "/icon.png" || path === "/favicon.ico") {
    const source = await readFile("/icon.txt", projectUrl);
    response = new Response(
      Uint8Array.from(atob(source.trim()), (c) => c.charCodeAt(0)),
      {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      },
    );
  } else if (path === "/intro.webp") {
    const source = await readFile("/intro.txt", projectUrl);
    response = new Response(
      Uint8Array.from(atob(source.trim()), (c) => c.charCodeAt(0)),
      {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=86400",
        },
      },
    );
  } else if (path === "/codelia.otf") {
    const source = await readFile("/codelia.txt", projectUrl);
    response = new Response(
      Uint8Array.from(atob(source.trim()), (c) => c.charCodeAt(0)),
      {
        headers: {
          "Content-Type": "font/otf",
          "Cache-Control": "public, max-age=86400",
        },
      },
    );
  } else if (path === "/") {
    const source = (await readFile("/frontend/index.html", projectUrl))
      .replace(
        /data-source-url="[^"]*"/,
        `data-source-url="${
          escapeHTML(parseProject(projectUrl).links.self.project)
        }"`,
      );
    const map =
      source.match(/<script type="importmap">([\s\S]*?)<\/script>/)![1];
    importMapHash = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(map)),
        ),
      ),
    );
    response = new Response(source, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (/^\/(frontend|shared)\/[\w/.-]+\.(tsx?|css)$/.test(path)) {
    if (path.includes("..")) return new Response("Not found", { status: 404 });
    response = await serveFile(path, projectUrl);
  } else return new Response("Not found", { status: 404 });
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' https://esm.sh https://esm.town${
      importMapHash ? ` 'sha256-${importMapHash}'` : ""
    }; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
  );
  if (!["/codelia.otf", "/icon.png", "/favicon.ico"].includes(path)) {
    headers.set("Cache-Control", "no-cache");
  }
  return new Response(response.body, { status: response.status, headers });
}
