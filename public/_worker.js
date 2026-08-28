export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Font proxy for MaterialIcons
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

    // 2. Real static assets with extensions (.js, .css, .png, .jpg, .ico, .json, .ttf, .woff2, etc.)
    if (url.pathname.includes(".")) {
      return env.ASSETS.fetch(request);
    }

    // 3. For ALL in-app routes (/, /wardrobe, /explore, /profile, /outfit-builder, etc.):
    // ALWAYS serve the single root index.html with strict no-cache headers!
    const indexUrl = new URL("/index.html", url.origin);
    const indexResponse = await env.ASSETS.fetch(new Request(indexUrl.toString(), {
      headers: request.headers,
      method: "GET",
    }));

    const newHeaders = new Headers(indexResponse.headers);
    newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
    newHeaders.set("Pragma", "no-cache");
    newHeaders.set("Expires", "0");
    newHeaders.set("Content-Type", "text/html; charset=utf-8");

    return new Response(indexResponse.body, {
      status: 200,
      statusText: "OK",
      headers: newHeaders,
    });
  },
};
