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

    // Static assets with file extensions (.js, .css, .png, .jpg, .ico, .json, .ttf, .woff2)
    if (url.pathname.includes(".") && !url.pathname.endsWith(".html")) {
      return env.ASSETS.fetch(request);
    }

    // For ALL client-side navigation routes (/, /wardrobe, /explore, etc.), ALWAYS serve the latest index.html with NO CACHE
    const indexRequest = new Request(new URL("/index.html", request.url), request);
    const response = await env.ASSETS.fetch(indexRequest);
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
    newHeaders.set("Pragma", "no-cache");
    newHeaders.set("Expires", "0");
    newHeaders.set("Content-Type", "text/html; charset=utf-8");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
