(() => {
  if (window.top !== window || document.getElementById('kmcero-helper-root')) return;

  const SHOP = '/dashboard/buyer/shop';
  const DEFAULT_PRODUCT = 'Habana-Gas Licuado GLP (10kg / 22lb)';
  const productPageUrl = name => `${SHOP}?search=${encodeURIComponent(name)}`;
  const KEY = 'kmcero-cart-helper-v1';
  const norm = value => String(value || '').toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const isShop = () => location.pathname.startsWith(SHOP);
  const onProductPage = name => isShop() && norm(new URLSearchParams(location.search).get('search')) === norm(name);
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  const label = el => (el?.getAttribute('aria-label') || el?.innerText || el?.getAttribute('alt') || el?.textContent || '').trim();

  // ─── Backoff exponencial ───────────────────────────────────────────────────
  // Cada vez que el servidor está saturado o hay que esperar, el intervalo
  // se duplica hasta un máximo de BACKOFF_MAX_MS. Se resetea al detectar
  // una respuesta exitosa del servidor.
  const BACKOFF_BASE_MS  = 10_000;   // 10 s — intervalo inicial
  const BACKOFF_MAX_MS   = 300_000;  // 5 min — techo del backoff
  const BACKOFF_FACTOR   = 2;        // duplicar en cada fallo consecutivo

  let backoffLevel = 0; // número de fallos consecutivos acumulados

  function backoffMs() {
    return Math.min(BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, backoffLevel), BACKOFF_MAX_MS);
  }
  function bumpBackoff() {
    backoffLevel = Math.min(backoffLevel + 1, 8); // tope en 2^8 × base = ~2560 s > MAX
  }
  function resetBackoff() {
    backoffLevel = 0;
  }

  // ─── Detección de saturación (HTTP + texto) ────────────────────────────────
  // Además del texto visible, escucha respuestas fetch/XHR para capturar
  // 429 / 503 / 502 antes de que el DOM refleje el error.
  const RATE_LIMIT_RE = /demasiadas solicitudes|uso intensivo|cuenta bloqueada|error 429|intentos excesivos/i;
  const SERVER_ERROR_RE = /error 503|servicio no disponible|bad gateway|error 502/i;

  let saturationFlag = false;   // 429 / saturación detectada vía red
  let serverErrorFlag = false;  // 502 / 503 detectada vía red
  let lastNetworkEvent = 0;     // timestamp del último evento de red problemático

  // Interceptar fetch para detectar códigos de error HTTP sin recargar la página
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const res = await _origFetch.apply(this, args);
      if (res.status === 429) {
        saturationFlag = true;
        lastNetworkEvent = Date.now();
        bumpBackoff();
      } else if (res.status === 502 || res.status === 503) {
        serverErrorFlag = true;
        lastNetworkEvent = Date.now();
        bumpBackoff();
      } else if (res.ok) {
        // Respuesta exitosa: limpiar flags si han pasado al menos 30 s sin error
        if (Date.now() - lastNetworkEvent > 30_000) {
          saturationFlag = false;
          serverErrorFlag = false;
        }
      }
      return res;
    } catch (err) {
      // Error de red (timeout, sin conexión): tratar como saturación temporal
      bumpBackoff();
      throw err;
    }
  };

  // Interceptar XMLHttpRequest para el mismo propósito
  const _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    this.addEventListener('load', () => {
      if (this.status === 429) {
        saturationFlag = true;
        lastNetworkEvent = Date.now();
        bumpBackoff();
      } else if (this.status === 502 || this.status === 503) {
        serverErrorFlag = true;
        lastNetworkEvent = Date.now();
        bumpBackoff();
      } else if (this.status >= 200 && this.status < 300) {
        if (Date.now() - lastNetworkEvent > 30_000) {
          saturationFlag = false;
          serverErrorFlag = false;
        }
      }
    });
    this.addEventListener('error', () => { bumpBackoff(); });
    return _origOpen.apply(this, args);
  };

  let blockedCache = { at: 0, value: false };
  function blocked() {
    const now = Date.now();
    // Respetar el flag de red aunque el DOM no lo muestre aún
    if (saturationFlag) return true;
    if (now - blockedCache.at < 1500) return blockedCache.value;
    blockedCache = { at: now, value: RATE_LIMIT_RE.test(document.body.innerText) };
    return blockedCache.value;
  }
  function serverBusy() {
    return serverErrorFlag || SERVER_ERROR_RE.test(document.body.innerText);
  }

  // ─── Panel UI ──────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'kmcero-helper-root';
  const shadow = root.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; } * { box-sizing: border-box; }
      #toggle { position: fixed; left: 18px; bottom: 18px; z-index: 2147483646; border: 0; border-radius: 999px; padding: 13px 18px; background: #096b59; color: white; font: 700 14px system-ui; box-shadow: 0 5px 20px #0004; cursor: pointer; }
      #panel { position: fixed; left: 18px; bottom: 72px; z-index: 2147483646; width: min(370px, calc(100vw - 36px)); background: white; color: #152621; border: 1px solid #d2e2dc; border-radius: 16px; box-shadow: 0 12px 38px #0004; font: 14px system-ui; overflow: hidden; display: none; }
      #panel.open { display: block; } header { padding: 16px; background: #ecf7f3; } h2 { margin: 0 0 6px; font-size: 18px; } p { margin: 0; color: #52635d; font-size: 12px; line-height: 1.45; }
      main { padding: 15px 16px; } strong { display: block; margin-bottom: 9px; }
      input[type=text] { width: 100%; padding: 8px 9px; margin-bottom: 4px; border: 1px solid #adcbc0; border-radius: 7px; font: 13px system-ui; }
      label { display: flex; align-items: center; gap: 8px; margin: 12px 0; font-size: 13px; } select, input[type=number] { padding: 6px; border: 1px solid #adcbc0; border-radius: 7px; } input[type=number] { width: 64px; }
      button.action { border: 0; border-radius: 8px; padding: 9px 12px; background: #096b59; color: white; font: 700 13px system-ui; cursor: pointer; margin: 4px 6px 0 0; } #stop { background: #67746f; } #status { margin-top: 13px; min-height: 35px; }
      #backoff-info { margin-top: 6px; font-size: 11px; color: #888; min-height: 16px; }
    </style>
    <button id="toggle" type="button">🛒 Ayuda carrito</button>
    <section id="panel" aria-label="Ayuda para comprar">
      <header><h2>Ayuda para el carrito</h2><p>Busca el producto por su nombre exacto y vigila su ficha en la tienda KMCERO.</p></header>
      <main><strong>Producto</strong>
        <input id="product" type="text" placeholder="Nombre exacto del producto">
        <label>Reabrir si está agotado o el botón está desactivado, cada <input id="retry" type="number" min="1" step="1" value="10"> segundos</label>
        <label>Recargar página completa cada <input id="reload" type="number" min="0" step="1" value="0"> minutos (0 = nunca)</label>
        <button id="start" class="action" type="button">Activar</button>
        <button id="stop" class="action" type="button">Detener</button>
        <button id="shop" class="action" type="button">Abrir tienda</button>
        <p id="status" role="status"></p>
        <p id="backoff-info" aria-live="polite"></p>
      </main>
    </section>`;
  document.documentElement.append(root);
  const $ = id => shadow.getElementById(id);
  $('product').value = DEFAULT_PRODUCT;

  let state;
  try { state = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { state = null; }

  function ensureState() {
    if (!state && isShop()) {
      const q = new URLSearchParams(location.search).get('search');
      if (q) { state = { active: true, phase: 'looking', productName: q, retrySeconds: 10, reloadMinutes: 0, lastReload: Date.now() }; save(); }
    }
  }
  function save() {
    if (state) sessionStorage.setItem(KEY, JSON.stringify(state));
    renderStatus();
  }

  function renderStatus() {
    const s = state;
    if (s?.productName) $('product').value = s.productName;
    $('retry').value = String(s?.retrySeconds || 10);
    $('reload').value = String(s?.reloadMinutes ?? 0);
    const name = s?.productName || $('product').value;
    $('shop').style.display = name && onProductPage(name) ? 'none' : 'inline-block';
    $('status').textContent = !s ? 'Escribe el producto y pulsa Activar.' :
      !s.active ? (
        s.phase === 'done'        ? 'KMCERO confirmó el producto en el carrito.' :
        s.phase === 'rateLimited' ? 'KMCERO mostró un aviso de uso intensivo. Se detuvo.' :
        s.phase === 'unconfirmed' ? 'Se pulsó Añadir, pero falta confirmación del carrito.' :
        'Detenido.'
      ) :
      s.phase === 'waiting'   ? `Se reintentará en ${Math.max(0, Math.ceil((s.retryAt - Date.now()) / 1000))} s.` :
      s.phase === 'opening'   ? 'Abriendo la ficha del producto…' :
      s.phase === 'verifying' ? 'Se pulsó Añadir. Esperando confirmación de KMCERO…' :
      'Vigilando el producto en la tienda…';

    // Mostrar nivel de backoff si hay presión en el servidor
    const bi = $('backoff-info');
    if (backoffLevel > 0 && s?.active) {
      const nextMs = backoffMs();
      const nextSec = Math.round(nextMs / 1000);
      bi.textContent = `Servidor con carga — próximo intento en hasta ${nextSec} s (nivel ${backoffLevel})`;
    } else {
      bi.textContent = '';
    }
  }
  ensureState();
  renderStatus();

  // ─── Helpers DOM ──────────────────────────────────────────────────────────
  function visibleHeadings() {
    return [...document.querySelectorAll('h1,h2,h3,h4,h5')].filter(visible);
  }
  function modal(target, headings) {
    for (const heading of headings) {
      if (norm(label(heading)) !== target) continue;
      const role = heading.closest('[role="dialog"], [aria-modal="true"]');
      if (role && visible(role)) return role;
      let node = heading.parentElement;
      for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
        if (node === document.body || node === document.documentElement) break;
        const r = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (r.width > innerWidth * 0.55 && r.height > innerHeight * 0.5 && r.top >= 0 && r.top < innerHeight * 0.25 &&
            (style.position === 'fixed' || (style.position === 'absolute' && Number(style.zIndex) > 10))) return node;
      }
    }
    return null;
  }
  function featuredSection(headings) {
    const heading = headings.find(el => /destacados/i.test(label(el)));
    if (!heading) return null;
    let node = heading.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (node === document.body) break;
      if (node.querySelectorAll('img[alt],h2,h3,h4,h5').length >= 2) return node;
    }
    return heading.parentElement;
  }
  function clickableCard(target, headings) {
    const section = featuredSection(headings);
    const candidates = [...document.querySelectorAll('img[alt],h2,h3,h4,h5')].filter(el =>
      norm(label(el)) === target && !el.closest('[role="dialog"], [aria-modal="true"]') &&
      !(section && section.contains(el)) && visible(el));
    const nodes = candidates.map(el => {
      let node = el;
      for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        if (node === document.body) break;
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.width < 700 && (node.matches('a[href],button,[role="button"]') || getComputedStyle(node).cursor === 'pointer')) return node;
      }
      return el;
    });
    return nodes[0] || null;
  }
  function playAddedSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      [[880, 0], [1175, 0.12]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.25, now + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.26);
      });
      setTimeout(() => ctx.close(), 600);
    } catch {}
  }

  // ─── Lógica principal ──────────────────────────────────────────────────────
  function step() {
    if (document.readyState !== 'complete') return;
    ensureState();
    if (!state?.active) return;
    const name = state.productName;
    if (!onProductPage(name)) return;

    // Si el servidor está saturado (429) → bump backoff y esperar
    if (blocked()) {
      state.active = false; state.phase = 'rateLimited'; save(); return;
    }

    // Si el servidor tiene error temporal (502/503) → esperar con backoff, sin detener
    if (serverBusy()) {
      if (state.phase !== 'waiting') {
        bumpBackoff();
        state.phase = 'waiting';
        state.retryAt = Date.now() + backoffMs();
        save();
      }
      return;
    }

    const target = norm(name);
    const headings = visibleHeadings();
    const box = modal(target, headings);

    if (box) {
      const text = norm(box.innerText);

      if (/en el carrito|este producto ya esta en el carrito/.test(text)) {
        resetBackoff();
        if (state.phase !== 'done') playAddedSound();
        state.active = false; state.phase = 'done'; save(); return;
      }

      if (state.phase === 'waiting') {
        if (Date.now() < state.retryAt) return;
        // Antes de recargar, verificar que no haya presión de red acumulada
        const delay = backoffMs();
        if (delay > state.retrySeconds * 1000) {
          // El backoff supera el intervalo base: esperar el backoff completo
          state.retryAt = Date.now() + delay;
          save();
          return;
        }
        location.reload();
        return;
      }

      if (/\bagotad[oa]s?\b|sin existencias|sin stock|no disponible/.test(text)) {
        bumpBackoff();
        const delay = Math.max(state.retrySeconds * 1000, backoffMs());
        state.phase = 'waiting'; state.retryAt = Date.now() + delay; save();
        return;
      }

      const addButtons = [...box.querySelectorAll('button,[role="button"]')].filter(el => visible(el) && /agregar al carrito|a[ñn]adir al carrito/i.test(label(el)));
      const add = addButtons.find(el => !el.disabled);

      if (add && state.phase !== 'verifying') {
        resetBackoff(); // hay botón activo → servidor respondió bien
        state.phase = 'verifying'; state.addAt = Date.now(); save(); add.click(); return;
      }
      if (state.phase === 'verifying' && Date.now() - state.addAt > 8000) {
        state.active = false; state.phase = 'unconfirmed'; save(); return;
      }
      if (!add && addButtons.length && state.phase !== 'verifying') {
        bumpBackoff();
        const delay = Math.max(state.retrySeconds * 1000, backoffMs());
        state.phase = 'waiting'; state.retryAt = Date.now() + delay; save();
        return;
      }
      return;
    }

    if (state.phase === 'waiting' && Date.now() < state.retryAt) return;
    if (state.phase === 'opening' && Date.now() - state.openAt < 5000) return;
    if (state.phase === 'opening' && state.openAttempts >= 2) {
      bumpBackoff();
      const delay = Math.max(state.retrySeconds * 1000, backoffMs());
      state.phase = 'waiting'; state.retryAt = Date.now() + delay; save(); return;
    }

    const card = clickableCard(target, headings);
    if (!card) { state.phase = 'looking'; save(); return; }

    resetBackoff(); // encontró la tarjeta del producto → servidor ok
    state.openAttempts = state.phase === 'opening' ? state.openAttempts + 1 : 1;
    state.phase = 'opening'; state.openAt = Date.now(); save(); card.click();
  }

  let timer;
  function schedule() {
    if (timer) return;
    // Cuando hay backoff activo, el tick mínimo respeta el nivel acumulado
    // para no generar polling inútil cuando el servidor está saturado.
    const tickMs = backoffLevel > 0 ? Math.min(backoffMs() / 4, 5000) : 60;
    timer = setTimeout(() => { timer = null; step(); }, tickMs);
  }

  // ─── Eventos UI ────────────────────────────────────────────────────────────
  $('toggle').addEventListener('click', () => { $('panel').classList.toggle('open'); renderStatus(); });
  $('start').addEventListener('click', () => {
    const name = $('product').value.trim() || DEFAULT_PRODUCT;
    const retrySeconds = Math.max(1, Number($('retry').value) || 10);
    const reloadMinutes = Math.max(0, Number($('reload').value) || 0);
    backoffLevel = 0; // reset al activar manualmente
    saturationFlag = false;
    serverErrorFlag = false;
    state = { active: true, phase: 'looking', productName: name, retrySeconds, reloadMinutes, lastReload: Date.now() };
    save();
    if (!onProductPage(name)) location.assign(productPageUrl(name)); else schedule();
  });
  $('stop').addEventListener('click', () => { state = { ...(state || {}), active: false, phase: 'stopped' }; save(); });
  $('shop').addEventListener('click', () => { location.assign(productPageUrl($('product').value.trim() || state?.productName || DEFAULT_PRODUCT)); });
  $('retry').addEventListener('change', () => { if (state) { state.retrySeconds = Math.max(1, Number($('retry').value) || 10); save(); } });
  $('reload').addEventListener('change', () => { if (state) { state.reloadMinutes = Math.max(0, Number($('reload').value) || 0); save(); } });

  // ─── Observadores ──────────────────────────────────────────────────────────
  new MutationObserver(changes => {
    if (changes.some(change => !root.contains(change.target))) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'disabled'] });

  // Tick principal: 250 ms base, pero respeta el backoff para no saturar más el servidor
  setInterval(() => {
    step();
    if (state?.active && (state.phase === 'waiting' || backoffLevel > 0)) renderStatus();
  }, 250);

  // Recarga periódica opcional — solo cuando no hay backoff activo
  setInterval(() => {
    if (!state?.active || !state.reloadMinutes || !onProductPage(state.productName) ||
        document.visibilityState !== 'visible' || blocked() || backoffLevel > 1) return;
    if (Date.now() - state.lastReload < state.reloadMinutes * 60_000 ||
        modal(norm(state.productName), visibleHeadings())) return;
    state.lastReload = Date.now(); save(); location.reload();
  }, 30_000);

  if (document.readyState !== 'complete') window.addEventListener('load', schedule, { once: true });
  schedule();
})();
