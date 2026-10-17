(() => {
  if (window.top !== window || document.getElementById('kmcero-helper-root')) return;

  const SHOP = '/dashboard/buyer/shop';
  const DEFAULT_PRODUCT = 'Habana-Gas Licuado GLP (10kg / 22lb)';
  const productPageUrl = name => `${SHOP}?search=${encodeURIComponent(name)}`;
  const KEY      = 'kmcero-cart-helper-v1';
  const KEY_LIC  = 'kmcero-license-v1';   // clave de licencia en localStorage
  // IMPORTANTE: cambia este valor por tu propia clave secreta antes de distribuir.
  // Esta misma clave debes usar en keygen.html para generar licencias.
  const LICENSE_SECRET = 'MI_CLAVE_SECRETA_PRIVADA_2024';

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

  const DEFAULT_MAX_REOPEN = 5;

  // ─── Sistema de licencias ──────────────────────────────────────────────────
  // Formato de clave: KMCERO-XXXX-XXXX-XXXX-XXXX.PAYLOAD
  // PAYLOAD = base64url(nombre|timestamp_expiracion)
  // XXXX... = primeros 16 chars HMAC-SHA256(secret, payload) en hex mayúsculas

  async function hmacSha256hex(secret, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function b64urlDecode(str) {
    // base64url → base64 → string
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    try { return atob(str); } catch { return null; }
  }

  // Retorna { valid, reason, username, expiresAt } 
  async function validateLicense(fullKey) {
    if (!fullKey || typeof fullKey !== 'string') return { valid: false, reason: 'Clave vacía' };

    const dotIdx = fullKey.indexOf('.');
    if (dotIdx === -1) return { valid: false, reason: 'Formato inválido' };

    const keyPart     = fullKey.substring(0, dotIdx).trim().toUpperCase();
    const payloadB64  = fullKey.substring(dotIdx + 1).trim();

    // Verificar prefijo y estructura KMCERO-XXXX-XXXX-XXXX-XXXX
    if (!keyPart.startsWith('KMCERO-')) return { valid: false, reason: 'Prefijo inválido' };
    const sigPart = keyPart.replace('KMCERO-', '').replace(/-/g, '');
    if (sigPart.length !== 16) return { valid: false, reason: 'Firma con longitud incorrecta' };

    // Decodificar payload
    const decoded = b64urlDecode(payloadB64);
    if (!decoded) return { valid: false, reason: 'Payload corrupto' };

    const parts = decoded.split('|');
    if (parts.length !== 2) return { valid: false, reason: 'Payload mal formado' };

    const [username, expStr] = parts;
    const expiresAt = parseInt(expStr, 10);
    if (isNaN(expiresAt)) return { valid: false, reason: 'Fecha de expiración inválida' };

    // Verificar que no haya expirado
    if (Date.now() > expiresAt) {
      const daysAgo = Math.ceil((Date.now() - expiresAt) / 86_400_000);
      return { valid: false, reason: `Licencia expirada hace ${daysAgo} día(s)`, username, expiresAt };
    }

    // Verificar firma HMAC
    const expectedHmac = await hmacSha256hex(LICENSE_SECRET, payloadB64);
    const expectedSig  = expectedHmac.substring(0, 16).toUpperCase();
    if (sigPart !== expectedSig) return { valid: false, reason: 'Firma inválida — clave no auténtica' };

    const daysLeft = Math.ceil((expiresAt - Date.now()) / 86_400_000);
    return { valid: true, reason: 'OK', username, expiresAt, daysLeft };
  }

  // Estado de licencia cargado al inicio
  let licenseState = { valid: false, reason: 'Sin licencia', username: '', daysLeft: 0 };

  async function checkStoredLicense() {
    const stored = localStorage.getItem(KEY_LIC);
    if (!stored) { licenseState = { valid: false, reason: 'Sin licencia' }; return; }
    licenseState = await validateLicense(stored);
  }

  // ─── Logger ────────────────────────────────────────────────────────────────
  const LOG_STYLES = {
    info:  'color:#096b59;font-weight:bold',
    warn:  'color:#b45309;font-weight:bold',
    error: 'color:#dc2626;font-weight:bold',
    ok:    'color:#16a34a;font-weight:bold',
    net:   'color:#7c3aed;font-weight:bold',
  };
  let lastLogMsg = '';
  function log(level, msg, data) {
    const full = `[KMCERO] ${msg}`;
    // Solo suprimir mensajes de espera repetitivos (info/warn de bucle),
    // nunca suprimir ok/error que indican una acción importante.
    if (full === lastLogMsg && level !== 'ok' && level !== 'error') return;
    lastLogMsg = full;
    data !== undefined
      ? console.log(`%c${full}`, LOG_STYLES[level] || '', data)
      : console.log(`%c${full}`, LOG_STYLES[level] || '');
  }

  // ─── Backoff exponencial ───────────────────────────────────────────────────
  const BACKOFF_BASE_MS = 10_000;
  const BACKOFF_MAX_MS  = 300_000;
  const BACKOFF_FACTOR  = 2;
  let backoffLevel = 0;

  function backoffMs() {
    return Math.min(BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, backoffLevel), BACKOFF_MAX_MS);
  }
  function bumpBackoff(reason) {
    backoffLevel = Math.min(backoffLevel + 1, 8);
    log('warn', `Backoff nivel ${backoffLevel} (${Math.round(backoffMs()/1000)}s) — ${reason}`);
  }
  function resetBackoff(reason) {
    if (backoffLevel > 0) log('ok', `Backoff reseteado — ${reason}`);
    backoffLevel = 0;
  }

  // ─── Detección de saturación vía red ──────────────────────────────────────
  const RATE_LIMIT_RE   = /demasiadas solicitudes|uso intensivo|cuenta bloqueada|error 429|intentos excesivos/i;
  const SERVER_ERROR_RE = /error 503|servicio no disponible|bad gateway|error 502/i;

  let saturationFlag  = false;
  let serverErrorFlag = false;
  let lastNetworkEvent = 0;

  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '?';
    try {
      const res = await _origFetch.apply(this, args);
      if (res.status === 429) {
        saturationFlag = true; lastNetworkEvent = Date.now();
        bumpBackoff(`HTTP 429 en fetch → ${url}`);
      } else if (res.status === 502 || res.status === 503) {
        serverErrorFlag = true; lastNetworkEvent = Date.now();
        bumpBackoff(`HTTP ${res.status} en fetch → ${url}`);
      } else if (res.ok) {
        if (Date.now() - lastNetworkEvent > 30_000) {
          if (saturationFlag || serverErrorFlag) log('ok', `Servidor recuperado (${res.status}) → ${url}`);
          saturationFlag = false; serverErrorFlag = false;
        }
      } else {
        log('warn', `fetch no-ok: ${res.status} → ${url}`);
      }
      return res;
    } catch (err) {
      log('error', `fetch falló (red) → ${url}`, err.message);
      bumpBackoff(`error de red en fetch → ${url}`);
      throw err;
    }
  };

  const _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    const url = args[1] || '?';
    this.addEventListener('load', () => {
      if (this.status === 429) {
        saturationFlag = true; lastNetworkEvent = Date.now();
        bumpBackoff(`HTTP 429 en XHR → ${url}`);
      } else if (this.status === 502 || this.status === 503) {
        serverErrorFlag = true; lastNetworkEvent = Date.now();
        bumpBackoff(`HTTP ${this.status} en XHR → ${url}`);
      } else if (this.status >= 200 && this.status < 300) {
        if (Date.now() - lastNetworkEvent > 30_000) {
          if (saturationFlag || serverErrorFlag) log('ok', `Servidor recuperado (${this.status}) XHR → ${url}`);
          saturationFlag = false; serverErrorFlag = false;
        }
      } else if (this.status !== 0) {
        log('warn', `XHR no-ok: ${this.status} → ${url}`);
      }
    });
    this.addEventListener('error', () => {
      log('error', `XHR falló (red) → ${url}`);
      bumpBackoff(`error de red en XHR → ${url}`);
    });
    return _origOpen.apply(this, args);
  };

  let blockedCache = { at: 0, value: false };
  function blocked() {
    const now = Date.now();
    if (saturationFlag) return true;
    if (now - blockedCache.at < 1500) return blockedCache.value;
    const domBlocked = RATE_LIMIT_RE.test(document.body.innerText);
    if (domBlocked && !blockedCache.value) log('error', 'Bloqueo detectado en el DOM (429)');
    blockedCache = { at: now, value: domBlocked };
    return domBlocked;
  }
  function serverBusy() {
    return serverErrorFlag || SERVER_ERROR_RE.test(document.body.innerText);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OPTIMIZACIONES DE CONEXIÓN — cada una se activa/desactiva desde el panel
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── 1. Bloqueo de imágenes ────────────────────────────────────────────────
  const IMG_BLOCK_ATTR = 'data-kmcero-src';
  const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  let imgBlockActive = false;
  let imgObserver = null;

  function blockImage(img) {
    if (!img.complete && img.src && img.src !== BLANK_GIF && !img.hasAttribute(IMG_BLOCK_ATTR)) {
      img.setAttribute(IMG_BLOCK_ATTR, img.src);
      img.src = BLANK_GIF;
    }
  }
  function startImageBlocking() {
    if (imgBlockActive) return;
    imgBlockActive = true;
    document.querySelectorAll('img').forEach(blockImage);
    imgObserver = new MutationObserver(mutations => {
      if (!imgBlockActive) return;
      for (const m of mutations)
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'IMG') blockImage(node);
          node.querySelectorAll?.('img').forEach(blockImage);
        }
    });
    imgObserver.observe(document.documentElement, { childList: true, subtree: true });
    log('info', 'Bloqueo de imágenes activado');
  }
  function stopImageBlocking() {
    if (!imgBlockActive) return;
    imgBlockActive = false;
    imgObserver?.disconnect(); imgObserver = null;
    let n = 0;
    document.querySelectorAll(`img[${IMG_BLOCK_ATTR}]`).forEach(img => {
      img.src = img.getAttribute(IMG_BLOCK_ATTR);
      img.removeAttribute(IMG_BLOCK_ATTR); n++;
    });
    if (n > 0) log('info', `Bloqueo de imágenes desactivado — ${n} restauradas`);
  }

  // ─── 2. Bloqueo de fuentes web ─────────────────────────────────────────────
  // Elimina los <link rel="stylesheet"> que apuntan a Google Fonts u otras CDN
  // de fuentes. Las fuentes del sistema se mantienen; la página sigue legible.
  const FONT_HOST_RE = /fonts\.(googleapis|gstatic)\.com|typekit\.net|use\.fontawesome|cdn\.jsdelivr\.net.*font/i;
  let fontBlockActive = false;
  let fontObserver = null;
  const blockedFontEls = [];

  function blockFontEl(el) {
    const href = el.href || el.src || '';
    if (FONT_HOST_RE.test(href) && !el.dataset.kmceroFont) {
      el.dataset.kmceroFont = href;
      el.disabled = true;      // <link> se puede deshabilitar sin removerlo
      blockedFontEls.push(el);
    }
  }
  function startFontBlocking() {
    if (fontBlockActive) return;
    fontBlockActive = true;
    document.querySelectorAll('link[rel="stylesheet"],link[rel="preload"],style').forEach(blockFontEl);
    fontObserver = new MutationObserver(mutations => {
      if (!fontBlockActive) return;
      for (const m of mutations)
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.('link,style')) blockFontEl(node);
          node.querySelectorAll?.('link,style').forEach(blockFontEl);
        }
    });
    fontObserver.observe(document.documentElement, { childList: true, subtree: true });
    log('info', `Bloqueo de fuentes web activado (${blockedFontEls.length} bloqueadas)`);
  }
  function stopFontBlocking() {
    if (!fontBlockActive) return;
    fontBlockActive = false;
    fontObserver?.disconnect(); fontObserver = null;
    blockedFontEls.forEach(el => { el.disabled = false; delete el.dataset.kmceroFont; });
    blockedFontEls.length = 0;
    log('info', 'Bloqueo de fuentes desactivado');
  }

  // ─── 3. Bloqueo de analítica y tracking ───────────────────────────────────
  // Cancela peticiones fetch/XHR a dominios de analítica conocidos.
  // No afecta a las peticiones propias de kmcero.cu.
  const ANALYTICS_RE = /google-analytics\.com|googletagmanager\.com|analytics\.google\.com|hotjar\.com|segment\.(io|com)|mixpanel\.com|amplitude\.com|clarity\.ms|facebook\.net|connect\.facebook|doubleclick\.net|_vercel\/insights|plausible\.io|matomo\.|piwik\./i;
  let analyticsBlockActive = false;

  // Guardamos los originales UNA sola vez para no anidar wrappers
  const _fetchForAnalytics = _origFetch; // ya tenemos el original guardado arriba

  function startAnalyticsBlocking() {
    if (analyticsBlockActive) return;
    analyticsBlockActive = true;
    log('info', 'Bloqueo de analítica activado');
  }
  function stopAnalyticsBlocking() {
    if (!analyticsBlockActive) return;
    analyticsBlockActive = false;
    log('info', 'Bloqueo de analítica desactivado');
  }
  // El filtro se aplica dentro del wrapper de fetch ya instalado:
  // lo chequeamos en la función shouldBlockRequest()
  function shouldBlockAnalytics(url) {
    return analyticsBlockActive && ANALYTICS_RE.test(url);
  }

  // Parchamos el fetch una sola vez (ya está parcheado arriba); añadimos
  // el chequeo de analítica dentro del flujo existente mediante una variable.
  // Para XHR hacemos lo mismo: detectamos en el send.
  const _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (this._kmceroUrl && shouldBlockAnalytics(this._kmceroUrl)) {
      log('net', `XHR analítica bloqueado → ${this._kmceroUrl}`);
      return; // no enviar
    }
    return _origSend.apply(this, args);
  };
  // Guardamos la URL en open para poder leerla en send
  const _origOpenWrapped = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    this._kmceroUrl = args[1] || '';
    return _origOpenWrapped.apply(this, args);
  };

  // ─── 4. Adaptación automática a conexión lenta ────────────────────────────
  // Usa navigator.connection para ajustar el retrySeconds automáticamente
  // cuando la red es lenta, y pausa la extensión si no hay conexión.
  let connAdaptActive = false;
  let connAdaptMultiplier = 1; // factor actual aplicado al retrySeconds

  const CONN_SLOW_TYPES = new Set(['slow-2g', '2g', '3g']);

  function getConnectionQuality() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return 'unknown';
    if (!navigator.onLine) return 'offline';
    if (CONN_SLOW_TYPES.has(conn.effectiveType)) return 'slow';
    if (conn.effectiveType === '4g' && conn.rtt > 500) return 'slow'; // 4G con latencia alta
    return 'good';
  }

  function applyConnAdapt() {
    if (!connAdaptActive) { connAdaptMultiplier = 1; return; }
    const quality = getConnectionQuality();
    const prev = connAdaptMultiplier;
    if (quality === 'offline') {
      connAdaptMultiplier = 0; // señal para pausar
      if (prev !== 0) log('warn', 'Sin conexión — extensión en pausa hasta recuperar red');
    } else if (quality === 'slow') {
      connAdaptMultiplier = 2;
      if (prev !== 2) log('warn', `Conexión lenta (${navigator.connection?.effectiveType}) — intervalos duplicados`);
    } else {
      connAdaptMultiplier = 1;
      if (prev > 1) log('ok', 'Conexión recuperada — intervalos normales');
    }
  }

  function effectiveRetryMs(base) {
    // base en segundos → ms con el multiplicador aplicado
    return base * 1000 * Math.max(1, connAdaptMultiplier);
  }

  // Escuchar cambios de conexión
  window.addEventListener('online',  () => { applyConnAdapt(); });
  window.addEventListener('offline', () => { applyConnAdapt(); });
  navigator.connection?.addEventListener?.('change', () => { applyConnAdapt(); });

  function startConnAdapt() {
    connAdaptActive = true;
    applyConnAdapt();
    log('info', `Adaptación de conexión activada (calidad actual: ${getConnectionQuality()})`);
  }
  function stopConnAdapt() {
    connAdaptActive = false;
    connAdaptMultiplier = 1;
    log('info', 'Adaptación de conexión desactivada');
  }

  // ─── Sincronizar todas las optimizaciones con el estado ───────────────────
  function syncOptimizations() {
    const s = state;
    const on = s?.active ?? false;

    // Imágenes
    (on && (s?.blockImages ?? true)) ? startImageBlocking() : stopImageBlocking();
    // Fuentes
    (on && (s?.blockFonts ?? false)) ? startFontBlocking() : stopFontBlocking();
    // Analítica
    (on && (s?.blockAnalytics ?? true)) ? startAnalyticsBlocking() : stopAnalyticsBlocking();
    // Conexión
    (on && (s?.adaptConn ?? true)) ? startConnAdapt() : stopConnAdapt();
  }

  // ─── Estabilidad del modal ─────────────────────────────────────────────────
  const MODAL_IDLE_MS    = 1200;
  const MODAL_TIMEOUT_MS = 8000;
  let modalObserver   = null;
  let modalStableAt   = 0;
  let modalObservedEl = null;

  function observeModal(box) {
    if (modalObservedEl === box) return;
    stopModalObserver();
    modalObservedEl = box;
    modalStableAt   = 0;
    let idleTimer = null;
    const markStable = () => { modalStableAt = Date.now(); };
    const reset = () => { modalStableAt = 0; clearTimeout(idleTimer); idleTimer = setTimeout(markStable, MODAL_IDLE_MS); };
    modalObserver = new MutationObserver(reset);
    modalObserver.observe(box, { childList: true, subtree: true, characterData: true, attributes: true });
    idleTimer = setTimeout(markStable, MODAL_IDLE_MS);
    log('info', 'Observando modal — esperando que cargue la disponibilidad…');
  }
  function stopModalObserver() {
    modalObserver?.disconnect(); modalObserver = null;
    modalObservedEl = null; modalStableAt = 0;
  }
  function modalReady(box, openAt) {
    observeModal(box);
    if (modalStableAt > 0) return true;
    if (Date.now() - openAt > MODAL_TIMEOUT_MS) {
      log('warn', `Modal tardó más de ${MODAL_TIMEOUT_MS/1000}s — actuando igual`);
      return true;
    }
    return false;
  }

  // ─── Cerrar modal ──────────────────────────────────────────────────────────
  function closeModal(box) {
    stopModalObserver();
    const closeBtn = [...box.querySelectorAll('button,[role="button"]')]
      .find(el => visible(el) && /^(×|✕|✖|cerrar|close|cancelar)$/i.test(label(el).trim()));
    if (closeBtn) { closeBtn.click(); return; }
    const ariaClose = box.querySelector('[aria-label*="cerrar" i],[aria-label*="close" i]');
    if (ariaClose && visible(ariaClose)) { ariaClose.click(); return; }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Escape', bubbles: true, cancelable: true }));
    const backdrop = document.querySelector('[class*="overlay" i],[class*="backdrop" i],[class*="mask" i]');
    if (backdrop && visible(backdrop)) backdrop.click();
  }

  // ─── Panel UI ──────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'kmcero-helper-root';
  const shadow = root.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; } * { box-sizing: border-box; }
      #toggle { position: fixed; left: 18px; bottom: 18px; z-index: 2147483646; border: 0; border-radius: 999px; padding: 13px 18px; background: #096b59; color: white; font: 700 14px system-ui; box-shadow: 0 5px 20px #0004; cursor: pointer; }
      #panel { position: fixed; left: 18px; bottom: 72px; z-index: 2147483646; width: min(390px, calc(100vw - 36px)); background: white; color: #152621; border: 1px solid #d2e2dc; border-radius: 16px; box-shadow: 0 12px 38px #0004; font: 14px system-ui; overflow: hidden; display: none; }
      #panel.open { display: block; }
      main { padding: 12px 16px; }
      #lic-bar { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 10px; background:#ecf7f3; border-radius:8px; font-size:12px; color:#096b59; margin-bottom:10px; }
      #lic-bar span { font-weight:700; }
      #lic-bar small { color:#52635d; font-weight:400; }
      #lic-bar button { border:0; background:none; color:#b45309; font-size:11px; cursor:pointer; padding:2px 6px; border-radius:4px; white-space:nowrap; }
      #lic-bar button:hover { background:#fff3cd; }
      section.group { border: 1px solid #d2e2dc; border-radius: 10px; padding: 10px 12px; margin: 10px 0; }
      section.group summary-title { display: block; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #52635d; margin-bottom: 8px; }
      strong.block { display: block; margin-bottom: 9px; }
      input[type=text] { width: 100%; padding: 8px 9px; margin-bottom: 4px; border: 1px solid #adcbc0; border-radius: 7px; font: 13px system-ui; }
      label.row { display: flex; align-items: center; gap: 8px; margin: 7px 0; font-size: 13px; }
      label.row small { color: #7a948c; font-size: 11px; margin-left: auto; }
      select, input[type=number] { padding: 6px; border: 1px solid #adcbc0; border-radius: 7px; }
      input[type=number] { width: 64px; }
      input[type=checkbox] { width: 16px; height: 16px; accent-color: #096b59; flex-shrink: 0; }
      button.action { border: 0; border-radius: 8px; padding: 9px 12px; background: #096b59; color: white; font: 700 13px system-ui; cursor: pointer; margin: 4px 6px 0 0; }
      #stop { background: #67746f; }
      #status { margin-top: 13px; min-height: 35px; font-size: 13px; }
      #conn-info { margin-top: 4px; font-size: 11px; color: #096b59; min-height: 14px; }
      #backoff-info { margin-top: 3px; font-size: 11px; color: #888; min-height: 14px; }
    </style>
    <button id="toggle" type="button">🛒 Ayuda carrito</button>
    <section id="panel" aria-label="Ayuda para comprar">
      <main>
        <!-- Barra de licencia: se reemplaza según estado -->
        <div id="lic-bar" style="display:none"></div>

        <div id="lic-section">
          <strong class="block">🔑 Licencia de uso</strong>
          <input id="license-input" type="text" placeholder="KMCERO-XXXX-XXXX-XXXX-XXXX.xxxxx" autocomplete="off" spellcheck="false">
          <div id="lic-status" style="font-size:12px;margin-top:6px;min-height:18px;"></div>
          <button id="lic-save" class="action" type="button" style="margin-top:8px;font-size:12px;padding:7px 12px">Validar licencia</button>
        </div>

        <div id="main-section" style="display:none">
          <strong class="block">Producto</strong>
          <input id="product" type="text" placeholder="Nombre exacto del producto">

        <section class="group">
          <summary-title>⏱ Reintentos</summary-title>
          <label class="row">Reabrir ficha cada <input id="retry" type="number" min="1" step="1" value="10"> s</label>
          <label class="row">Máx. reaperturas antes de recargar <input id="maxreopen" type="number" min="1" step="1" value="5"></label>
          <label class="row">Recargar página cada <input id="reload" type="number" min="0" step="1" value="0"> min <small>0 = nunca</small></label>
        </section>

        <section class="group">
          <summary-title>⚡ Optimización de conexión</summary-title>
          <label class="row"><input id="blockimgs"     type="checkbox" checked> No cargar imágenes <small>ahorra banda</small></label>
          <label class="row"><input id="blockfonts"    type="checkbox">         No cargar fuentes web <small>Google Fonts…</small></label>
          <label class="row"><input id="blockanalytics" type="checkbox" checked> Bloquear analítica <small>GA, Hotjar…</small></label>
          <label class="row"><input id="adaptconn"     type="checkbox" checked> Adaptar a conexión lenta <small>auto</small></label>
        </section>

        <button id="start" class="action" type="button">Activar</button>
        <button id="stop"  class="action" type="button">Detener</button>
        <button id="shop"  class="action" type="button">Abrir tienda</button>
        <p id="status"      role="status"></p>
        <p id="conn-info"   aria-live="polite"></p>
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
      if (q) {
        state = { active: true, phase: 'looking', productName: q, retrySeconds: 10,
                  reloadMinutes: 0, lastReload: Date.now(), reopenAttempts: 0,
                  blockImages: true, blockFonts: false, blockAnalytics: true, adaptConn: true };
        log('info', `Estado restaurado desde URL: buscando "${q}"`);
        save();
      }
    }
  }

  function save() {
    if (state) sessionStorage.setItem(KEY, JSON.stringify(state));
    syncOptimizations();
    renderStatus();
  }

  function renderStatus() {
    const s = state;
    if (s?.productName)    $('product').value     = s.productName;
    $('retry').value        = String(s?.retrySeconds || 10);
    $('maxreopen').value    = String(s?.maxReopen ?? DEFAULT_MAX_REOPEN);
    $('reload').value       = String(s?.reloadMinutes ?? 0);
    $('blockimgs').checked      = s?.blockImages     ?? true;
    $('blockfonts').checked     = s?.blockFonts      ?? false;
    $('blockanalytics').checked = s?.blockAnalytics  ?? true;
    $('adaptconn').checked      = s?.adaptConn       ?? true;

    const name = s?.productName || $('product').value;
    $('shop').style.display = name && onProductPage(name) ? 'none' : 'inline-block';

    const reopens = s?.reopenAttempts || 0;
    $('status').textContent = !s ? 'Escribe el producto y pulsa Activar.' :
      !s.active ? (
        s.phase === 'done'        ? '✅ KMCERO confirmó el producto en el carrito.' :
        s.phase === 'rateLimited' ? '🛑 KMCERO mostró un aviso de uso intensivo. Se detuvo.' :
        s.phase === 'unconfirmed' ? '⚠️ Se pulsó Añadir, pero falta confirmación del carrito.' :
        'Detenido.'
      ) :
      s.phase === 'reopening' ? `🔄 Reabriendo ficha en ${Math.max(0, Math.ceil((s.retryAt - Date.now()) / 1000))} s (intento ${reopens}/${s.maxReopen ?? DEFAULT_MAX_REOPEN})…` :
      s.phase === 'waiting'   ? `⏳ Esperando ${Math.max(0, Math.ceil((s.retryAt - Date.now()) / 1000))} s para recargar…` :
      s.phase === 'opening'   ? '🔍 Abriendo la ficha del producto…' :
      s.phase === 'verifying' ? '🛒 Pulsado Añadir — esperando confirmación…' :
      '👀 Vigilando el producto en la tienda…';

    // Indicador de calidad de conexión
    const ci = $('conn-info');
    if (s?.active && s?.adaptConn) {
      const q = getConnectionQuality();
      ci.textContent = q === 'offline' ? '📵 Sin conexión — en pausa'
        : q === 'slow' ? `🐢 Conexión lenta (${navigator.connection?.effectiveType || '?'}) — intervalos ×2`
        : `🟢 Conexión (${navigator.connection?.effectiveType || 'ok'})`;
    } else { ci.textContent = ''; }

    const bi = $('backoff-info');
    bi.textContent = (backoffLevel > 0 && s?.active)
      ? `⚠️ Servidor con carga — próximo intento en hasta ${Math.round(backoffMs()/1000)} s (nivel ${backoffLevel})`
      : '';
  }

  ensureState();
  renderStatus();
  log('info', 'Extensión iniciada', { version: '2.4.0' });

  // ── Inicializar licencia ──────────────────────────────────────────────────
  async function renderLicense() {
    await checkStoredLicense();
    const bar   = $('lic-bar');
    const sec   = $('lic-section');
    const main  = $('main-section');

    if (licenseState.valid) {
      const exp = new Date(licenseState.expiresAt).toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' });
      const days = licenseState.daysLeft;
      const daysColor = days <= 5 ? 'color:#b45309' : 'color:#096b59';
      // Barra compacta: ✅ Usuario · vence DD/MM/YYYY · X días  [Cambiar]
      bar.style.display = 'flex';
      bar.innerHTML = `<span>✅ ${licenseState.username}</span><small style="${daysColor}">${days}d · ${exp}</small><button id="lic-change">Cambiar</button>`;
      sec.style.display  = 'none';
      main.style.display = 'block';
      // Listener del botón Cambiar (se regenera con innerHTML)
      $('lic-change').addEventListener('click', () => {
        localStorage.removeItem(KEY_LIC);
        bar.style.display  = 'none';
        sec.style.display  = 'block';
        main.style.display = 'none';
        $('lic-status').textContent = '';
        $('license-input').value = '';
        licenseState = { valid: false, reason: 'Sin licencia' };
      });
    } else {
      bar.style.display  = 'none';
      sec.style.display  = 'block';
      main.style.display = 'none';
      const ls = $('lic-status');
      ls.style.color   = '#dc2626';
      ls.textContent   = licenseState.reason === 'Sin licencia'
        ? '⚠️ Ingresa tu clave de licencia para continuar.'
        : `❌ ${licenseState.reason}`;
    }
  }

  $('lic-save').addEventListener('click', async () => {
    const val = $('license-input').value.trim();
    if (!val) return;
    const result = await validateLicense(val);
    if (result.valid) {
      localStorage.setItem(KEY_LIC, val);
      await renderLicense();
    } else {
      const ls = $('lic-status');
      ls.style.color = '#dc2626';
      ls.textContent = `❌ ${result.reason}`;
    }
  });

  // Validar también con Enter en el campo de licencia
  $('license-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('lic-save').click(); });

  renderLicense();

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
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.25, now + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + delay); osc.stop(now + delay + 0.26);
      });
      setTimeout(() => ctx.close(), 600);
    } catch {}
  }

  // ─── Lógica principal ──────────────────────────────────────────────────────
  function step() {
    if (document.readyState !== 'complete') return;
    ensureState();
    if (!state?.active) return;

    // Pausar si no hay conexión (adaptación automática)
    if (connAdaptMultiplier === 0) return;

    const name = state.productName;
    if (!onProductPage(name)) return;

    if (blocked()) {
      log('error', 'Deteniendo: bloqueo por uso intensivo detectado');
      state.active = false; state.phase = 'rateLimited'; save(); return;
    }
    if (serverBusy()) {
      if (state.phase !== 'waiting') {
        bumpBackoff('servidor con error 502/503');
        state.phase = 'waiting';
        state.retryAt = Date.now() + backoffMs();
        log('warn', `Servidor ocupado — esperando ${Math.round(backoffMs()/1000)}s`);
        save();
      }
      return;
    }

    const target   = norm(name);
    const headings = visibleHeadings();
    const box      = modal(target, headings);

    // ── Fase: esperando para reabrir modal ────────────────────────────────
    if (state.phase === 'reopening') {
      if (Date.now() < state.retryAt) return;
      if (box) {
        log('warn', 'Modal todavía visible — reintentando cierre…');
        closeModal(box);
        state.retryAt = Date.now() + 1500; save(); return;
      }
      log('info', `Modal cerrado — reabriendo ficha (intento ${state.reopenAttempts})`);
      state.phase = 'opening'; state.openAt = Date.now(); state.openAttempts = 1; save();
      const card = clickableCard(target, visibleHeadings());
      if (card) { card.click(); return; }
      state.phase = 'looking'; save(); return;
    }

    if (box) {
      const text = norm(box.innerText);
      log('info', `Ficha abierta — phase: ${state.phase}`);

      // ── Buscar el botón PRIMERO, antes de cualquier otra comprobación ───
      // Si el botón ya está activo, actuar de inmediato sin esperar que el
      // modal se "estabilice" — el botón disponible ES la señal de que cargó.
      if (state.phase !== 'verifying' && state.phase !== 'waiting') {
        const addButtonsEarly = [...box.querySelectorAll('button,[role="button"]')]
          .filter(el => visible(el) && /agregar al carrito|a[ñn]adir al carrito/i.test(label(el)));
        const addEarly = addButtonsEarly.find(el => !el.disabled);
        if (addEarly) {
          log('ok', 'Botón "Añadir al carrito" activo — haciendo click inmediato');
          resetBackoff('botón disponible');
          state.phase = 'verifying'; state.addAt = Date.now(); save(); addEarly.click(); return;
        }
      }

      // ── Esperar a que el modal cargue antes de leer estado ──────────────
      if (!modalReady(box, state.openAt || Date.now())) {
        log('info', 'Esperando que el modal termine de cargar…');
        return;
      }

      if (/en el carrito|este producto ya esta en el carrito/.test(text)) {
        log('ok', `¡Producto añadido al carrito! "${name}"`);
        resetBackoff('producto añadido');
        if (state.phase !== 'done') playAddedSound();
        state.active = false; state.phase = 'done'; save(); return;
      }

      if (state.phase === 'waiting') {
        if (Date.now() < state.retryAt) return;
        if (serverBusy() || saturationFlag) {
          const delay = backoffMs();
          log('warn', `Backoff activo — servidor saturado, posponiendo ${Math.round(delay/1000)}s`);
          state.retryAt = Date.now() + delay; save(); return;
        }
        log('info', 'Recargando página para refrescar stock…');
        location.reload(); return;
      }

      const addButtons = [...box.querySelectorAll('button,[role="button"]')]
        .filter(el => visible(el) && /agregar al carrito|a[ñn]adir al carrito/i.test(label(el)));
      const add = addButtons.find(el => !el.disabled);

      // El botón activo ya se procesó arriba (click inmediato).
      // Aquí solo manejamos el caso de verifying y botón desactivado.
      if (state.phase === 'verifying' && Date.now() - state.addAt > 8000) {
        log('warn', 'Timeout confirmación del carrito (8s)');
        state.active = false; state.phase = 'unconfirmed'; save(); return;
      }

      const isUnavailable = /\bagotad[oa]s?\b|sin existencias|sin stock|no disponible/.test(text);
      const isDisabled    = !add && addButtons.length > 0;

      if ((isUnavailable || isDisabled) && state.phase !== 'verifying') {
        const reopenAttempts = (state.reopenAttempts || 0) + 1;
        const reason    = isUnavailable ? 'agotado' : 'botón desactivado';
        const maxReopen = state.maxReopen ?? DEFAULT_MAX_REOPEN;

        if (reopenAttempts > maxReopen) {
          log('warn', `${maxReopen} reaperturas sin cambio (${reason}) — recargando página`);
          state.reopenAttempts = 0;
          state.phase   = 'waiting';
          state.retryAt = Date.now() + effectiveRetryMs(state.retrySeconds);
          save(); return;
        }

        log('warn', `${reason} — cerrando modal para reabrirlo (intento ${reopenAttempts}/${maxReopen})`);
        closeModal(box);
        state.reopenAttempts = reopenAttempts;
        state.phase   = 'reopening';
        state.retryAt = Date.now() + effectiveRetryMs(state.retrySeconds);
        save(); return;
      }
      return;
    }

    // ── Sin ficha abierta ──────────────────────────────────────────────────
    if (state.phase === 'waiting' && Date.now() < state.retryAt) return;
    if (state.phase === 'opening' && Date.now() - state.openAt < 5000) return;
    if (state.phase === 'opening' && state.openAttempts >= 2) {
      bumpBackoff('no se pudo abrir la ficha tras 2 intentos');
      const delay = Math.max(effectiveRetryMs(state.retrySeconds), backoffMs());
      log('warn', `Ficha no abre — esperando ${Math.round(delay/1000)}s`);
      state.phase = 'waiting'; state.retryAt = Date.now() + delay; save(); return;
    }

    const card = clickableCard(target, headings);
    if (!card) {
      if (state.phase !== 'looking') log('info', 'Tarjeta del producto no visible — buscando…');
      state.phase = 'looking'; save(); return;
    }

    log('info', `Tarjeta encontrada — abriendo ficha (intento ${state.phase === 'opening' ? state.openAttempts + 1 : 1})`);
    resetBackoff('tarjeta encontrada');
    state.reopenAttempts = 0;
    state.openAttempts   = state.phase === 'opening' ? state.openAttempts + 1 : 1;
    state.phase = 'opening'; state.openAt = Date.now(); save(); card.click();
  }

  let timer;
  function schedule() {
    if (timer) return;
    const tickMs = backoffLevel > 0 ? Math.min(backoffMs() / 4, 5000) : 60;
    timer = setTimeout(() => { timer = null; step(); }, tickMs);
  }

  // ─── Eventos UI ────────────────────────────────────────────────────────────
  $('toggle').addEventListener('click', () => { $('panel').classList.toggle('open'); renderStatus(); });

  $('start').addEventListener('click', async () => {
    // Re-verificar licencia antes de activar
    await checkStoredLicense();
    if (!licenseState.valid) {
      $('lic-status').style.color = '#dc2626';
      $('lic-status').textContent = '❌ Licencia inválida o expirada. No se puede activar.';
      $('main-section').style.display = 'none';
      $('lic-section').style.display  = 'block';
      $('lic-bar').style.display      = 'none';
      return;
    }
    const name           = $('product').value.trim() || DEFAULT_PRODUCT;
    const retrySeconds   = Math.max(1, Number($('retry').value)     || 10);
    const maxReopen      = Math.max(1, Number($('maxreopen').value)  || DEFAULT_MAX_REOPEN);
    const reloadMinutes  = Math.max(0, Number($('reload').value)     || 0);
    const blockImages    = $('blockimgs').checked;
    const blockFonts     = $('blockfonts').checked;
    const blockAnalytics = $('blockanalytics').checked;
    const adaptConn      = $('adaptconn').checked;
    backoffLevel = 0; saturationFlag = false; serverErrorFlag = false;
    state = { active: true, phase: 'looking', productName: name,
              retrySeconds, maxReopen, reloadMinutes, lastReload: Date.now(), reopenAttempts: 0,
              blockImages, blockFonts, blockAnalytics, adaptConn };
    log('info', `Activado`, { name, retrySeconds, maxReopen, reloadMinutes, blockImages, blockFonts, blockAnalytics, adaptConn });
    save();
    if (!onProductPage(name)) location.assign(productPageUrl(name)); else schedule();
  });

  $('stop').addEventListener('click', () => {
    log('info', 'Detenido por el usuario');
    state = { ...(state || {}), active: false, phase: 'stopped' }; save();
  });
  $('shop').addEventListener('click', () => {
    location.assign(productPageUrl($('product').value.trim() || state?.productName || DEFAULT_PRODUCT));
  });

  // Cambios en caliente — se aplican sin pulsar Activar de nuevo
  $('retry').addEventListener('change',        () => { if (state) { state.retrySeconds   = Math.max(1, Number($('retry').value)     || 10);                  save(); } });
  $('maxreopen').addEventListener('change',    () => { if (state) { state.maxReopen       = Math.max(1, Number($('maxreopen').value)  || DEFAULT_MAX_REOPEN); save(); } });
  $('reload').addEventListener('change',       () => { if (state) { state.reloadMinutes   = Math.max(0, Number($('reload').value)     || 0);                  save(); } });
  $('blockimgs').addEventListener('change',    () => { if (state) { state.blockImages     = $('blockimgs').checked;     save(); } });
  $('blockfonts').addEventListener('change',   () => { if (state) { state.blockFonts      = $('blockfonts').checked;    save(); } });
  $('blockanalytics').addEventListener('change',() => { if (state) { state.blockAnalytics = $('blockanalytics').checked; save(); } });
  $('adaptconn').addEventListener('change',    () => { if (state) { state.adaptConn       = $('adaptconn').checked;     save(); } });

  // ─── Observadores ──────────────────────────────────────────────────────────
  new MutationObserver(changes => {
    if (changes.some(c => !root.contains(c.target))) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'disabled'] });

  setInterval(() => {
    applyConnAdapt(); // re-evaluar calidad de red periódicamente
    step();
    if (state?.active) renderStatus();
  }, 250);

  setInterval(() => {
    if (!state?.active || !state.reloadMinutes || !onProductPage(state.productName) ||
        document.visibilityState !== 'visible' || blocked() || backoffLevel > 1 || connAdaptMultiplier === 0) return;
    if (Date.now() - state.lastReload < state.reloadMinutes * 60_000 ||
        modal(norm(state.productName), visibleHeadings())) return;
    log('info', `Recarga periódica (cada ${state.reloadMinutes} min)`);
    state.lastReload = Date.now(); save(); location.reload();
  }, 30_000);

  if (document.readyState !== 'complete') window.addEventListener('load', schedule, { once: true });
  schedule();
})();
