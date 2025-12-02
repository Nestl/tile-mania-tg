let unityInstance = null;
var unityInstanceRef = null;
var unsubscribe = null;

const canvas = document.querySelector("#unity-canvas");
const loader = document.getElementById("loader");
const errorBox = document.getElementById("error-message");

const bubbleTrack = document.getElementById("bubble-track");
const BUBBLE_COUNT = 12;
const bubbles = [];

const stage  = document.getElementById('stage');

let isLayouting = false;
let isResizing = false;
let resizeTimeout;
let telegramViewportStable = false;

for (let i = 0; i < BUBBLE_COUNT; i++) {
  const b = document.createElement("div");
  b.className = "bubble";
  bubbleTrack.appendChild(b);
  bubbles.push(b);
}

function showError(message){ errorBox.style.display="block"; errorBox.innerHTML=message; }

const buildUrl = "Build";
const config = {
  dataUrl: buildUrl + "/tile-mania-tg.data",
  frameworkUrl: buildUrl + "/tile-mania-tg.framework.js",
  codeUrl: buildUrl + "/tile-mania-tg.wasm",
  streamingAssetsUrl: "StreamingAssets",
  companyName: "Playmania LTD",
  productName: "Tile Mania",
  productVersion: "0.0.1"
};

config.matchWebGLToCanvasSize = true;
//config.devicePixelRatio = 2;

// WebGL context attributes для предотвращения "блика" при разворачивании
config.webglContextAttributes = {
  preserveDrawingBuffer: false, // false для производительности, context restore обрабатываем вручную
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false,
  antialias: false // Unity сам управляет AA
};

const BG_PARAMS = {
  color1: '#4A1A5C',
  color2: '#1A0A2E',
  angle: 125,
  frequency: 2,
  spacing: 1.5,
  offset: 0.15
};

const bgCanvas = document.getElementById('bg-waves');
const bgCtx = bgCanvas.getContext('2d', { alpha:false, desynchronized:true });
if (!bgCtx) bgCtx = bgCanvas.getContext('2d');

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function hexToRgb(h){
  const s = h.replace('#','');
  const n = parseInt(s.length===3 ? s.split('').map(c=>c+c).join('') : s, 16);
  return [ (n>>16)&255, (n>>8)&255, n&255 ];
}

function drawDiagonalWaves(params = BG_PARAMS){
  const { vw, vh } = getViewportSize();
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
  const W = Math.max(1, Math.round(vw * dpr));
  const H = Math.max(1, Math.round(vh * dpr));
  if (bgCanvas.width !== W || bgCanvas.height !== H){
    bgCanvas.width = W; bgCanvas.height = H;
    bgCanvas.style.width  = vw + 'px';
    bgCanvas.style.height = vh + 'px';
  }

  const c1 = hexToRgb(params.color1);
  const c2 = hexToRgb(params.color2);

  const rad = params.angle * Math.PI / 180;
  const dirx = Math.cos(rad);
  const diry = Math.sin(rad);

  const freq    = params.frequency;
  const spacing = params.spacing;
  const offset  = params.offset;

  const img = bgCtx.createImageData(W, H);
  const data = img.data;

  for (let y = 0; y < H; y++){
    const v = 1 - (y / (H - 1));
    let row = y * W * 4;
    for (let x = 0; x < W; x++){
      const u = x / (W - 1);

      let t = (u * dirx + v * diry);
      t = (t * freq * spacing + offset) * Math.PI;

      const w = 0.5 + 0.5 * Math.sin(t);

      data[row++] = Math.round(c1[0] * (1 - w) + c2[0] * w);
      data[row++] = Math.round(c1[1] * (1 - w) + c2[1] * w);
      data[row++] = Math.round(c1[2] * (1 - w) + c2[2] * w);
      data[row++] = 255;
    }
  }
  bgCtx.putImageData(img, 0, 0);
}

let backgroundCache = null;

function redrawBackground(){ drawDiagonalWaves(); }

function getSafeTopFromTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return 0;

  const csi = tg.contentSafeAreaInset || tg.contentSafeAreaInsets;
  const si  = tg.safeAreaInset        || tg.safeAreaInsets;

  let top = 0;
  if (csi && typeof csi.top === 'number') top = csi.top;
  else if (si && typeof si.top === 'number') top = si.top;

  if (!top) {
    const css = getComputedStyle(document.documentElement);
    const cssTop = parseFloat(css.getPropertyValue('--sat')) || 0;
    const tgH = tg?.viewportStableHeight || tg?.viewportHeight || window.innerHeight;
    const overlayTotal = Math.max(0, window.innerHeight - tgH);
    top = Math.round(cssTop + overlayTotal);
  }
  
  // Добавляем дополнительный отступ для кнопки Close и меню только на мобильных (примерно 60-70px)
  if (top > 0 && isMobileLike()) {
    top = Math.max(top, 70);
  }
  
  return Math.max(0, Math.round(top));
}

function sendSafeAreaToUnity(){
  const px = getSafeTopFromTelegram();
  if (window.unityInstance){
    try { 
      window.unityInstance.SendMessage('WebGLResizeHandler','SetSafeArea', String(px)); 
    } catch (e) {
      console.log('SendMessage failed:', e);
    }
  }
}

function hookTelegramSafeArea(){
  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  try { tg.requestContentSafeArea?.(); } catch {}
  try { tg.requestSafeArea?.(); } catch {}

  sendSafeAreaToUnity();

  const onChange = () => sendSafeAreaToUnity();

  tg.onEvent?.('contentSafeAreaChanged', onChange);
  tg.onEvent?.('safeAreaChanged', onChange);
  tg.onEvent?.('fullscreenChanged', onChange);
  tg.onEvent?.('viewportChanged', (e)=>{ if (!e || e.isStateStable === undefined || e.isStateStable) onChange(); });

  tg.onEvent?.('content_safe_area_changed', onChange);
  tg.onEvent?.('safe_area_changed', onChange);
}

hookTelegramSafeArea();

function getViewportSize() {
  const tg = window.Telegram?.WebApp;
  let vh = window.innerHeight;
  let vw = window.innerWidth;

  if (tg) {
    const stable = tg.viewportStableHeight || tg.viewportHeight;
    if (stable && stable > 200) vh = stable;
  }
  return { vw, vh };
}

function isMobileLike(){
  if (window.Telegram?.WebApp && typeof Telegram.WebApp.isDesktop === 'boolean')
    return !Telegram.WebApp.isDesktop;
  return matchMedia('(pointer:coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

function layoutStage(){
  if (isLayouting) return;
  isLayouting = true;

  // Получаем safe area от Telegram
  const safeTop = getSafeTopFromTelegram();
  
  // Применяем padding к stage только на мобильных устройствах
  if (safeTop > 0 && isMobileLike()) {
    stage.style.paddingTop = `${safeTop}px`;
  } else {
    stage.style.paddingTop = '0';
  }

  const r = stage.getBoundingClientRect();
  const w = Math.round(r.width);
  const h = Math.round(r.height);
  
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    try { 
      unityInstance?.Module?.setCanvasSize?.(w, h);
      // Вызываем Unity метод для пересоздания framebuffer
      if (window.unityInstance) {
        window.unityInstance.SendMessage('WebGLResizeHandler', 'ForceResize', '');
      }
    } catch {}
  }
  
  isLayouting = false;
}

function debouncedResize() {
  if (isResizing) return;
  isResizing = true;
  
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    layoutStage();
    redrawBackground();
    sendSafeAreaToUnity();
    isResizing = false;
  }, 100);
}

// Инициализация
layoutStage();
redrawBackground();

window.addEventListener('resize', debouncedResize);
window.addEventListener('orientationchange', debouncedResize);
document.addEventListener('visibilitychange', () => { 
  if (!document.hidden) { 
    debouncedResize(); 
  }
});
window.addEventListener('pageshow', debouncedResize);

try {
  if (window.Telegram?.WebApp) {
    const tg = Telegram.WebApp;
    tg.ready();
    tg.expand();
    
    // Скрываем заголовок Telegram для предотвращения перекрытия интерфейса
    try {
      tg.setHeaderColor?.('bg_color');
      if (typeof tg.isClosingConfirmationEnabled !== 'undefined') {
        tg.enableClosingConfirmation();
      }
    } catch (e) {}

    const tgVersion = parseFloat(tg.version);
    if (!Number.isNaN(tgVersion) && tgVersion >= 7.7 && typeof tg.disableVerticalSwipes === 'function') {
      tg.disableVerticalSwipes();
    }
    
    // Viewport change handler
    tg.onEvent('viewportChanged', (e) => {
      if (e && e.isStateStable === true && !telegramViewportStable) {
        telegramViewportStable = true;
        debouncedResize();
        requestFullscreenOnce();
      }
    });
    
    // Initial fullscreen attempt
    requestAnimationFrame(() => {
      debouncedResize();
      requestFullscreenOnce();
    });
  }
} catch (error) {
  console.warn('Telegram WebApp initialization failed:', error);
}

function isMobileTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return false;
  if (tg.platform === 'android' || tg.platform === 'ios') return true;
  if (typeof tg.isDesktop === 'boolean') return !tg.isDesktop;
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

function isMobileTelegramStrict() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return false;
  if (tg.platform === 'android' || tg.platform === 'ios') return true;
  if (typeof tg.isDesktop === 'boolean') return !tg.isDesktop;
  return false;
}

// Функция для включения native immersive fullscreen
function enterImmersiveMode() {
  const docEl = document.documentElement;
  
  try {
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen({ navigationUI: 'hide' });
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen();
    } else if (docEl.mozRequestFullScreen) {
      docEl.mozRequestFullScreen();
    }
  } catch (e) {
    console.log('Immersive mode failed:', e);
  }
}

// Функция для Telegram fullscreen
function requestTGFullscreen() {
  const tg = window.Telegram?.WebApp;
  if (tg && typeof tg.requestFullscreen === 'function') {
    try {
      tg.requestFullscreen();
    } catch (e) {
      console.log('TG fullscreen failed:', e);
    }
  }
}

// Полное включение fullscreen (для Android)
function enforceFullscreen() {
  requestTGFullscreen();
  setTimeout(() => {
    enterImmersiveMode();
  }, 150);
}

// Настройка анти-навигация для Android
function setupAntiNavigationBar() {
  const tg = window.Telegram?.WebApp;
  if (!tg || tg.platform !== 'android') return;
  
  let isFullscreenActive = false;
  let lastTouchTime = 0;
  const THROTTLE_MS = 500; // Ограничение частоты вызовов
  
  // Проверяем, в fullscreen ли мы
  function checkFullscreenState() {
    isFullscreenActive = !!(document.fullscreenElement || document.webkitFullscreenElement);
    return isFullscreenActive;
  }
  
  // Повторно включаем fullscreen если он сбросился
  function reEnableFullscreenIfNeeded() {
    const now = Date.now();
    
    // Throttle: не чаще раза в 500ms
    if (now - lastTouchTime < THROTTLE_MS) return;
    lastTouchTime = now;
    
    // Если fullscreen сбросился - включаем снова
    if (!checkFullscreenState()) {
      enforceFullscreen();
    }
  }
  
  // Обработчик касаний - повторно включаем fullscreen
  document.addEventListener('touchstart', reEnableFullscreenIfNeeded, { passive: true });
  
  // При изменении размера окна - проверяем fullscreen
  window.addEventListener('resize', () => {
    if (!checkFullscreenState()) {
      setTimeout(enforceFullscreen, 100);
    }
  });
  
  // Отслеживаем выход из fullscreen
  document.addEventListener('fullscreenchange', checkFullscreenState);
  document.addEventListener('webkitfullscreenchange', checkFullscreenState);
  
  // CSS для скрытия переполнения
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  
  console.log('Android anti-navigation bar setup complete');
}

// Обработка сворачивания/разворачивания вкладки для предотвращения "блика"
function setupVisibilityHandling() {
  let wasHidden = false;
  
  // Обработчик изменения видимости вкладки
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Вкладка сворачивается
      wasHidden = true;
      console.log('Tab hidden - preserving state');
    } else if (wasHidden) {
      // Вкладка разворачивается
      wasHidden = false;
      console.log('Tab visible - restoring');
      
      // Небольшая задержка перед resize для стабилизации
      setTimeout(() => {
        debouncedResize();
      }, 100);
    }
  });
  
  // Обработка потери/восстановления WebGL контекста
  const canvas = document.getElementById('unity-canvas');
  if (canvas) {
    canvas.addEventListener('webglcontextlost', (e) => {
      console.log('WebGL context lost');
      e.preventDefault(); // Предотвращаем дефолтное поведение
    }, false);
    
    canvas.addEventListener('webglcontextrestored', () => {
      console.log('WebGL context restored');
      // Форсируем resize после восстановления контекста
      setTimeout(() => {
        debouncedResize();
      }, 50);
    }, false);
  }
}

async function requestFullscreenOnce() {
  const tg = window.Telegram?.WebApp;
  if (!tg || !isMobileTelegramStrict()) return;

  try { 
    tg.ready?.(); 
    tg.expand?.(); 
    tg.setHeaderColor?.('bg_color');
    
    const isAndroid = tg.platform === 'android';
    
    if (isAndroid) {
      // Для Android - запускаем систему анти-навигации
      enforceFullscreen();
      setupAntiNavigationBar();
    } else {
      // iOS - только Telegram API
      if (typeof tg.requestFullscreen === 'function') {
        await tg.requestFullscreen();
      }
    }
  } catch (error) {
    console.log('Fullscreen request failed:', error);
  }
}

function updateBubbles(progress){
  const total = BUBBLE_COUNT;
  const p = Math.max(0, Math.min(1, progress || 0));
  const filled = Math.floor(p * total);
  const frac   = (p * total) - filled;

  bubbleTrack.setAttribute("aria-valuenow", String(Math.round(p * 100)));

  for (let i = 0; i < total; i++) {
    let s = 0;
    if (i < filled) {
      s = 1;
    } else if (i === filled && p < 1) {
      s = 0.4 + 0.6 * frac;
    } else if (p === 1) {
      s = 1;
    }
    bubbles[i].style.setProperty("--s", s.toFixed(3));
  }
}


window.addEventListener("load", () => {
  errorBox.style.display = "none";
  layoutStage();
  
  // Инициализируем обработку видимости вкладки
  setupVisibilityHandling();

  createUnityInstance(canvas, config, (progress) => {
    updateBubbles(progress);
  }).then((instance) => {
    unityInstance = instance;
    unityInstanceRef = instance;
    window.unityInstance = instance;
    sendSafeAreaToUnity();

    // Меняем фон на монолитный фиолетовый после загрузки
    bgCanvas.style.background = '#210d32';
    bgCtx.fillStyle = '#210d32';
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

    loader.style.opacity = "0";
    setTimeout(() => { loader.style.display = "none"; }, 180);
  }).catch((error) => {
    console.error(error);
    showError('Unable to load the game. Please refresh the page.');
  });

  debouncedResize();
});
