export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Font proxy for MaterialIcons
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

    // Try fetching the asset directly from Cloudflare Pages static assets
    let response = await env.ASSETS.fetch(request);

    // If not found and it's a SPA navigation route (e.g. /wardrobe, /explore), fallback to root index.html
    if (response.status === 404 && !url.pathname.includes(".")) {
      response = await env.ASSETS.fetch(new URL("/", request.url));
    }

    // For all HTML responses, enforce no-cache so users always receive the latest JS bundle
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
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
