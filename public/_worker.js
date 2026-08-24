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
    return env.ASSETS.fetch(request);
  },
};
