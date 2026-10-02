// Pages 副本显式解压，下载期间直接报告压缩字节进度，避免等待引擎读完才更新。
(() => {
  const originalFetch = window.fetch.bind(window);
  const sizes = document.currentScript?.dataset || {};
  const assets = new Map([
    [new URL('index.wasm', document.baseURI).href,
      {type: 'application/wasm', total: Number(sizes.wasmSize) || 0, loaded: 0}],
    [new URL('index.pck', document.baseURI).href,
      {type: 'application/octet-stream', total: Number(sizes.pckSize) || 0, loaded: 0}],
  ]);
  const active = new Set();
  let failed = null;
  function progress() {
    const values = [...assets.values()];
    window.dispatchEvent(new CustomEvent('rps-download-progress', {detail: {
      current: values.reduce((sum, value) => sum + value.loaded, 0),
      total: values.reduce((sum, value) => sum + value.total, 0),
    }}));
  }
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL
      ? new URL(input, document.baseURI).href : input.url;
    if (!assets.has(url)) return originalFetch(input, init);
    if (failed) throw failed;
    const state = assets.get(url);
    state.loaded = 0;
    const controller = new AbortController();
    const external = init?.signal || input?.signal;
    const abort = () => controller.abort(external.reason);
    if (external?.aborted) abort();
    else external?.addEventListener('abort', abort, {once: true});
    active.add(controller);
    let timer;
    const watch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new DOMException('Download stalled', 'TimeoutError')), 30000);
    };
    watch();
    progress();
    try {
      const response = await originalFetch(url + '.gz', {...init, signal: controller.signal});
      if (!response.ok) return response;
      watch();
      if (!state.total) state.total = Number(response.headers.get('Content-Length')) || 0;
      const reader = response.body.getReader();
      const chunks = [];
      try {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          chunks.push(value);
          state.loaded += value.byteLength;
          watch();
          progress();
        }
      } finally {reader.releaseLock();}
      clearTimeout(timer);
      const compressed = new Uint8Array(state.loaded);
      let offset = 0;
      for (const chunk of chunks) {compressed.set(chunk, offset); offset += chunk.byteLength;}
      // 引擎的进度流不转发读取异常；先完成读取与解压，再交付可靠的内存流。
      const decoded = await new Response(new Response(compressed).body
        .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      return new Response(decoded, {status: response.status,
        headers: {'Content-Type': state.type}});
    } catch (error) {
      if (!failed) {
        failed = error;
        for (const pending of active) pending.abort(error);
        window.dispatchEvent(new CustomEvent('rps-download-error', {detail: error}));
      }
      throw error;
    } finally {
      clearTimeout(timer);
      active.delete(controller);
      external?.removeEventListener('abort', abort);
    }
  };
})();
