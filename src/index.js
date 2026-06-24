export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // MEMPERBAIKI CARA MENGAMBIL TARGET URL
    const workerURL = new URL(request.url);
    const originLength = workerURL.origin.length + 1; // Mengambil panjang domain + '/'
    let target = request.url.substring(originLength);

    // Jika target ter-encode, lakukan decode
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      target = decodeURIComponent(target);
    }

    if (!/^https?:\/\//i.test(target)) {
      return new Response(
        "Usage:\nhttps://workers.dev",
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

    // MEMPERBAIKI UTK TARGET ALAMAT IP (Mencegah Cloudflare Error 1003)
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    }

    const response = await fetch(targetURL.toString(), {
      method: request.method,
      headers,
      redirect: "follow",
    });

    // Tahap 2: Manipulasi Playlist M3U8
    if (
      targetURL.pathname.endsWith(".m3u8") ||
      (response.headers.get("content-type") || "").includes("mpegurl")
    ) {
      let playlist = await response.text();
      const base = targetURL.origin;
      const directory = targetURL.origin + targetURL.pathname.substring(0, targetURL.pathname.lastIndexOf("/") + 1);

      playlist = playlist
        .split("\n")
        .map((line) => {
          const value = line.trim();
          if (value === "") return value;

          // Komentar atau Atribut URI
          if (value.startsWith("#")) {
            return value.replace(/URI="([^"]+)"/g, (_, uri) => {
              let absolute;
              if (/^https?:\/\//i.test(uri)) {
                absolute = uri;
              } else if (uri.startsWith("/")) {
                absolute = base + uri;
              } else {
                absolute = directory + uri;
              }
              // Menggunakan format polos (tanpa encodeURIComponent) agar tidak merusak segmen tertentu
              return `URI="${workerURL.origin}/${absolute}"`;
            });
          }

          // Baris Link Segmen (.ts / .m3u8)
          let absolute;
          if (/^https?:\/\//i.test(value)) {
            absolute = value;
          } else if (value.startsWith("/")) {
            absolute = base + value;
          } else {
            absolute = directory + value;
          }

          // Menggunakan format polos tanpa encode agar struktur url segmen tetap bersih
          return `${workerURL.origin}/${absolute}`;
        })
        .join("\n");

      const outHeaders = new Headers(response.headers);
      outHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
      addCors(outHeaders);

      return new Response(playlist, {
        status: response.status,
        headers: outHeaders,
      });
    }

    // Tahap 3: Meneruskan file segmen video (.ts)
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
