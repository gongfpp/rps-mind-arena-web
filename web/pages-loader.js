// GitHub Pages serves .gz files as static assets. Decode the two large runtime
// files explicitly, so Godot receives their original bytes and content types.
(() => {
  const originalFetch = window.fetch.bind(window);
  const assets = new Map([
    [new URL('index.wasm', document.baseURI).href, 'application/wasm'],
    [new URL('index.pck', document.baseURI).href, 'application/octet-stream'],
  ]);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL
      ? new URL(input, document.baseURI).href : input.url;
    if (!assets.has(url)) return originalFetch(input, init);
    const response = await originalFetch(url + '.gz', init);
    if (!response.ok) return response;
    const decoded = response.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(decoded, {status: response.status,
      headers: {'Content-Type': assets.get(url)}});
  };
})();
