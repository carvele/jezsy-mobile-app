export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.includes("MaterialIcons")) {
      const fontRes = await fetch("https://fonts.gstatic.com/s/materialicons/v142/flUhRq6tzZclQEJ-Vdg-IuiaDsNc.woff2");
      return new Response(fontRes.body, {
        headers: {
          "Content-Type": "font/woff2",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get("content-type") || "";

    // Never cache index.html or HTML responses so browser always loads latest JS bundles immediately
    if (contentType.includes("text/html") || url.pathname === "/" || url.pathname.endsWith(".html") || !url.pathname.includes(".")) {
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      newHeaders.set("Pragma", "no-cache");
      newHeaders.set("Expires", "0");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    return response;
  },
};
