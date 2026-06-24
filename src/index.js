export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const workerURL = new URL(request.url);

    // Target URL berada setelah /
    // contoh:
    // https://worker.workers.dev/http://example.com/live/index.m3u8
    const target = decodeURIComponent(workerURL.pathname.substring(1));

    if (!/^https?:\/\//i.test(target)) {
      return new Response(
        "Usage:\nhttps://worker.workers.dev/http://host/path/file.m3u8",
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const targetURL = new URL(target);

    // Header yang diteruskan
    const headers = new Headers();

    const forwardHeaders = [
      "Range",
      "Accept",
      "Accept-Encoding",
      "User-Agent",
      "If-Modified-Since",
      "If-None-Match",
      "Referer",
      "Origin",
    ];

    for (const h of forwardHeaders) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }

    const response = await fetch(targetURL.toString(), {
      method: request.method,
      headers,
      redirect: "follow",
    });

    // ------------------------
    // Playlist (.m3u8)
    // ------------------------
    if (
      targetURL.pathname.endsWith(".m3u8") ||
      (response.headers.get("content-type") || "").includes("mpegurl")
    ) {
      let playlist = await response.text();

      const base = targetURL.origin;

      const directory =
        targetURL.origin +
        targetURL.pathname.substring(
          0,
          targetURL.pathname.lastIndexOf("/") + 1
        );

      playlist = playlist
        .split("\n")
        .map((line) => {
          const value = line.trim();

          if (value === "") return value;

          // komentar
          if (value.startsWith("#")) {
            // Rewrite URI="xxx"
            return value.replace(
              /URI="([^"]+)"/g,
              (_, uri) => {
                let absolute;

                if (/^https?:\/\//i.test(uri)) {
                  absolute = uri;
                } else if (uri.startsWith("/")) {
                  absolute = base + uri;
                } else {
                  absolute = directory + uri;
                }

                return `URI="${workerURL.origin}/${encodeURIComponent(
                  absolute
                )}"`;
              }
            );
          }

          let absolute;

          if (/^https?:\/\//i.test(value)) {
            absolute = value;
          } else if (value.startsWith("/")) {
            absolute = base + value;
          } else {
            absolute = directory + value;
          }

          return `${workerURL.origin}/${encodeURIComponent(absolute)}`;
        })
        .join("\n");

      const outHeaders = new Headers(response.headers);

      outHeaders.set(
        "Content-Type",
        "application/vnd.apple.mpegurl"
      );

      addCors(outHeaders);

      return new Response(playlist, {
        status: response.status,
        headers: outHeaders,
      });
    }

    // ------------------------
    // Semua file selain m3u8
    // Streaming langsung
    // ------------------------

    const outHeaders = new Headers(response.headers);

    addCors(outHeaders);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders,
    });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  };
}

function addCors(headers) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "*");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");

  if (!headers.has("Accept-Ranges")) {
    headers.set("Accept-Ranges", "bytes");
  }
}
