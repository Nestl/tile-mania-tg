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

config.matchWebGLToCanvasSize = false;
config.devicePixelRatio = 1;

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
    try { window.unityInstance.SendMessage('PlayerDataManager','SetSafeArea', String(px)); } catch {}
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

async function requestFullscreenOnce() {
  const tg = window.Telegram?.WebApp;
  if (!tg || !isMobileTelegramStrict()) return;

  try { 
    tg.ready?.(); 
    tg.expand?.(); 
    tg.setHeaderColor?.('bg_color');
    
    // Запрашиваем fullscreen только на мобильных
    if (typeof tg.requestFullscreen === 'function') {
      const isAndroid = tg.platform === 'android';
      
      // Для Android используем специальный режим для скрытия системных кнопок
      if (isAndroid) {
        // Сначала пробуем Telegram API
        await tg.requestFullscreen();
        
        // Затем пробуем нативный fullscreen с immersive mode
        setTimeout(async () => {
          try {
            const docEl = document.documentElement;
            if (docEl.requestFullscreen) {
              await docEl.requestFullscreen({ navigationUI: 'hide' });
            } else if (docEl.webkitRequestFullscreen) {
              await docEl.webkitRequestFullscreen();
            } else if (docEl.mozRequestFullScreen) {
              await docEl.mozRequestFullScreen();
            }
            
            // Добавляем meta-тег для Android immersive mode
            let metaTheme = document.querySelector('meta[name="theme-color"]');
            if (!metaTheme) {
              metaTheme = document.createElement('meta');
              metaTheme.name = 'theme-color';
              document.head.appendChild(metaTheme);
            }
            metaTheme.content = '#210d32';
          } catch (e) {
            console.log('Native fullscreen failed:', e);
          }
        }, 300);
      } else {
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
