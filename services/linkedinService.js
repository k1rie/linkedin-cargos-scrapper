const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Import new services
const proxyService = require('./proxyService');
const rateLimitService = require('./rateLimitService');
const loggerService = require('./loggerService');
const dataExtractionService = require('./dataExtractionService');

const LINKEDIN_LI_AT = process.env.LINKEDIN_LI_AT;
const CAPTCHA_API_KEY = process.env.CAPTCHA_API_KEY; // 2captcha API key (opcional, no recomendado)

// Directorio para perfil persistente del navegador (evita CAPTCHAs)
const USER_DATA_DIR = path.join(__dirname, '../data/browser-profile');
const COOKIES_FILE = path.join(__dirname, '../data/cookies.json');

// Session tracking for sticky proxy
let currentSessionId = `session-${Date.now()}`;

const ensureDataDirectory = async () => {
  const dataDir = path.dirname(COOKIES_FILE);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
};

const saveCookies = async (cookies) => {
  await ensureDataDirectory();
  await fs.writeFile(COOKIES_FILE, JSON.stringify(cookies, null, 2));
};

// Normalizar cookies para Playwright (asegurar formato correcto)
const normalizeCookies = (cookies) => {
  if (!Array.isArray(cookies)) {
    return null;
  }
  
  return cookies.map(cookie => {
    const normalized = {
      name: cookie.name || cookie.key,
      value: cookie.value || cookie.val,
      domain: cookie.domain || '.linkedin.com',
      path: cookie.path || '/',
      expires: cookie.expires || cookie.expirationDate || -1,
      httpOnly: cookie.httpOnly !== undefined ? cookie.httpOnly : true,
      secure: cookie.secure !== undefined ? cookie.secure : true,
      sameSite: cookie.sameSite || 'None'
    };
    
    // Asegurar que el dominio sea correcto
    if (!normalized.domain.includes('linkedin.com')) {
      if (normalized.domain.startsWith('.')) {
        normalized.domain = '.linkedin.com';
      } else {
        normalized.domain = '.linkedin.com';
      }
    }
    
    // Convertir expires si es una fecha
    if (normalized.expires && typeof normalized.expires === 'string') {
      const date = new Date(normalized.expires);
      normalized.expires = date.getTime() / 1000;
    }
    
    return normalized;
  }).filter(cookie => cookie.name && cookie.value); // Filtrar cookies inválidas
};

const loadCookies = async () => {
  let cookies = null;
  let source = '';
  
  // Primero intentar cargar desde .env
  if (process.env.LINKEDIN_COOKIES) {
    try {
      const rawCookies = JSON.parse(process.env.LINKEDIN_COOKIES);
      cookies = normalizeCookies(rawCookies);
      source = '.env';
      console.log(`✓ Loaded ${cookies.length} cookies from .env`);
      
      // Validar que tenga la cookie crítica li_at
      const hasLiAt = cookies.some(c => c.name === 'li_at');
      if (!hasLiAt) {
        console.warn('⚠️  Warning: No "li_at" cookie found. Session may not work.');
      } else {
        console.log('✓ Found critical "li_at" cookie');
      }
    } catch (error) {
      console.error('❌ Error parsing LINKEDIN_COOKIES from .env:', error.message);
      console.error('   Make sure LINKEDIN_COOKIES is valid JSON in a single line');
    }
  }
  
  // Si no hay en .env, intentar cargar desde archivo
  if (!cookies) {
    try {
      await ensureDataDirectory();
      const data = await fs.readFile(COOKIES_FILE, 'utf8');
      const rawCookies = JSON.parse(data);
      cookies = normalizeCookies(rawCookies);
      source = 'file';
      console.log(`✓ Loaded ${cookies.length} cookies from file`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('❌ Error loading cookies from file:', error.message);
      }
    }
  }
  
  if (cookies && cookies.length > 0) {
    console.log(`📦 Cookie summary: ${cookies.length} cookies loaded from ${source}`);
    const cookieNames = cookies.map(c => c.name).join(', ');
    console.log(`   Cookie names: ${cookieNames.substring(0, 100)}${cookieNames.length > 100 ? '...' : ''}`);
  }
  
  return cookies;
};

const checkSession = async () => {
  const cookies = await loadCookies();
  
  if (!cookies || cookies.length === 0) {
    console.error('❌ No cookies found');
    return false;
  }

  const isHeadless = process.env.NODE_ENV === 'production' || process.env.HEADLESS === 'true';
  
  // ⚠️ Configuración anti-detección para headless
  const browser = await chromium.launch({ 
    headless: isHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', // Ocultar que es automatizado
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // Agregar permisos que un navegador real tendría
    permissions: ['geolocation'],
    // Headers adicionales para parecer más real
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-User': '?1',
      'Sec-Fetch-Dest': 'document'
    }
  });
  
  try {
    console.log(`🔐 Adding ${cookies.length} cookies to browser context...`);
    
    // ⚠️ Inyectar scripts para ocultar headless/automation
    await context.addInitScript(() => {
      // Sobrescribir navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
      
      // Sobrescribir plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      
      // Sobrescribir languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
      
      // Chrome runtime
      window.chrome = {
        runtime: {}
      };
      
      // Permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });
    
    // Intentar agregar cookies
    try {
      await context.addCookies(cookies);
      console.log('✓ Cookies added successfully');
    } catch (cookieError) {
      console.error('❌ Error adding cookies:', cookieError.message);
      console.error('   This might be due to invalid cookie format or expired cookies');
      
      // Intentar con cookies simplificadas (solo las esenciales)
      const essentialCookies = cookies.filter(c => 
        c.name === 'li_at' || 
        c.name === 'JSESSIONID' || 
        c.name === 'bcookie'
      );
      
      if (essentialCookies.length > 0) {
        console.log(`   Trying with ${essentialCookies.length} essential cookies only...`);
        try {
          await context.addCookies(essentialCookies);
          console.log('✓ Essential cookies added');
        } catch (e) {
          console.error('❌ Failed to add even essential cookies:', e.message);
          await browser.close();
          return false;
        }
      } else {
        await browser.close();
        return false;
      }
    }
    
    const page = await context.newPage();
    console.log('🌐 Navigating to LinkedIn feed...');
    
    await page.goto('https://www.linkedin.com/feed', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);
    
    const isLoggedIn = !currentUrl.includes('/login') && !currentUrl.includes('/uas/login');
    
    if (isLoggedIn) {
      console.log('✅ Session is valid - logged in successfully');
    } else {
      console.error('❌ Session invalid - redirected to login page');
      console.error(`   Final URL: ${currentUrl}`);
      
      // Intentar obtener más información del error
      try {
        const pageText = await page.textContent('body').catch(() => '');
        if (pageText.includes('captcha') || pageText.includes('CAPTCHA')) {
          console.error('   ⚠️  LinkedIn is showing CAPTCHA');
        }
        if (pageText.includes('suspicious') || pageText.includes('verify')) {
          console.error('   ⚠️  LinkedIn detected suspicious activity');
        }
      } catch (e) {
        // Ignorar errores al leer el contenido
      }
    }
    
    await browser.close();
    return isLoggedIn;
  } catch (error) {
    console.error('❌ Error checking session:', error.message);
    console.error('   Stack:', error.stack);
    await browser.close();
    return false;
  }
};

const ensureLoggedIn = async () => {
  // Verificar cookie
  if (!LINKEDIN_LI_AT || LINKEDIN_LI_AT.trim().length < 10) {
    console.error('❌ LinkedIn cookie not configured');
    console.error('📝 Please set LINKEDIN_LI_AT in .env');
    console.error('   Extract it from browser: DevTools > Application > Cookies > linkedin.com > li_at');
    return { 
      loggedIn: false, 
      error: 'LinkedIn cookie (LINKEDIN_LI_AT) not configured in .env'
    };
  }
  
  // La cookie se inyectará en getSharedBrowser
  return { loggedIn: true };
};

// Asegurar que el directorio de perfil exista
const ensureUserDataDir = async () => {
  try {
    await fs.access(USER_DATA_DIR);
  } catch {
    await fs.mkdir(USER_DATA_DIR, { recursive: true });
  }
};

const getBrowserContext = async () => {
  const isHeadless = process.env.NODE_ENV === 'production' || process.env.HEADLESS === 'true';
  
  await ensureUserDataDir();
  
  // Get proxy configuration
  const proxy = proxyService.getPlaywrightProxy(currentSessionId);
  if (proxy) {
    loggerService.info('Using proxy', { proxyType: proxyService.PROXY_TYPE, sessionId: currentSessionId });
  }
  
  // Randomize user agent and timezone for better stealth
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  ];
  const timezones = ['America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Europe/London', 'Europe/Paris'];
  const locales = ['en-US', 'en-GB', 'en-CA'];
  
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  const randomTimezone = timezones[Math.floor(Math.random() * timezones.length)];
  const randomLocale = locales[Math.floor(Math.random() * locales.length)];
  
  // ⚠️ Usar perfil persistente (MUY IMPORTANTE para evitar CAPTCHAs)
  // LinkedIn "recuerda" el dispositivo y es menos probable que pida CAPTCHA
  const browserConfig = {
    headless: isHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-popup-blocking',
    ],
    userAgent: randomUserAgent,
    viewport: { width: 1920, height: 1080 },
    locale: randomLocale,
    timezoneId: randomTimezone,
    permissions: ['geolocation'],
    extraHTTPHeaders: {
      'Accept-Language': `${randomLocale},${randomLocale.split('-')[0]};q=0.9`,
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-User': '?1',
      'Sec-Fetch-Dest': 'document',
      'Cache-Control': 'max-age=0',
    },
  };
  
  // Add proxy if configured
  if (proxy) {
    browserConfig.proxy = proxy;
  }
  
  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, browserConfig);
  
  // ⚠️ Enhanced stealth patches
  await browser.addInitScript(() => {
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
    
    // Spoof plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ];
        return plugins;
      }
    });
    
    // Spoof languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
    
    // Chrome runtime
    window.chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {}
    };
    
    // Permissions API
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
    
    // WebGL vendor/renderer spoofing
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) { // UNMASKED_VENDOR_WEBGL
        return 'Intel Inc.';
      }
      if (parameter === 37446) { // UNMASKED_RENDERER_WEBGL
        return 'Intel Iris OpenGL Engine';
      }
      return getParameter.call(this, parameter);
    };
    
    // Canvas fingerprinting protection
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    const toDataURL = HTMLCanvasElement.prototype.toDataURL;
    const getImageData = CanvasRenderingContext2D.prototype.getImageData;
    
    // Add noise to canvas operations (optional, can be disabled if needed)
    // HTMLCanvasElement.prototype.toBlob = function(...args) {
    //   // Add slight noise
    //   return toBlob.apply(this, args);
    // };
    
    // Override toString to hide automation
    Object.defineProperty(navigator, 'userAgent', {
      get: () => window.navigator.userAgent.replace(/HeadlessChrome/g, 'Chrome')
    });
  });
  
  loggerService.info('Browser context created', { 
    headless: isHeadless, 
    proxy: proxy ? 'enabled' : 'disabled',
    userAgent: randomUserAgent.substring(0, 50) + '...',
    timezone: randomTimezone 
  });
  
  // En launchPersistentContext, browser y context son el mismo objeto
  return { browser, context: browser };
};

// ⚠️ Delays para evitar detección (MÍNIMO ABSOLUTO)
// Now using rateLimitService for delays
const DELAYS = {
  minDelay: rateLimitService.MIN_DELAY,
  maxDelay: rateLimitService.MAX_DELAY,
  typeDelay: 80,         // 80ms entre cada letra (escribir realista)
  postSearchDelay: 2000  // 2 segundos después de presionar Enter
};

// Función helper para delay aleatorio
const randomDelay = (min, max) => {
  if (min !== undefined && max !== undefined) {
    // Use provided min/max for specific delays
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  // Use rateLimitService for default delays between searches
  return rateLimitService.getRandomDelay();
};

// Función helper para escribir texto con delay realista
const typeWithDelay = async (page, selector, text) => {
  await page.focus(selector);
  await page.waitForTimeout(randomDelay(200, 500)); // Delay antes de empezar a escribir
  
  for (const char of text) {
    await page.type(selector, char, { delay: DELAYS.typeDelay });
    // Ocasionalmente agregar pequeñas pausas (como humanos)
    if (Math.random() < 0.1) {
      await page.waitForTimeout(randomDelay(100, 300));
    }
  }
};

// Variable global para mantener el navegador abierto entre búsquedas
let sharedBrowser = null;
let sharedContext = null;
let sharedPage = null;
let searchCount = 0;

// Función para resolver CAPTCHA con 2captcha (NO RECOMENDADO - puede causar baneo)
const solveCaptcha = async (page) => {
  if (!CAPTCHA_API_KEY) {
    return { success: false, error: 'CAPTCHA_API_KEY not configured' };
  }
  
  console.warn('⚠️  WARNING: Using 2captcha may increase risk of account ban!');
  console.warn('   Consider using persistent browser profile instead (already configured)');
  
  try {
    console.log('🤖 Attempting to solve CAPTCHA with 2captcha...');
    
    // Buscar el iframe del CAPTCHA
    const captchaIframe = await page.$('iframe[src*="captcha"], iframe[src*="recaptcha"]');
    if (!captchaIframe) {
      return { success: false, error: 'CAPTCHA iframe not found' };
    }
    
    const iframeSrc = await captchaIframe.getAttribute('src');
    const siteKeyMatch = iframeSrc.match(/k=([^&]+)/);
    if (!siteKeyMatch) {
      return { success: false, error: 'Could not extract CAPTCHA site key' };
    }
    
    const siteKey = siteKeyMatch[1];
    console.log(`   Found CAPTCHA site key: ${siteKey.substring(0, 20)}...`);
    
    // Enviar CAPTCHA a 2captcha
    const submitResponse = await axios.post('http://2captcha.com/in.php', null, {
      params: {
        key: CAPTCHA_API_KEY,
        method: 'userrecaptcha',
        googlekey: siteKey,
        pageurl: page.url(),
        json: 1
      }
    });
    
    if (submitResponse.data.status !== 1) {
      return { success: false, error: `2captcha error: ${submitResponse.data.request}` };
    }
    
    const captchaId = submitResponse.data.request;
    console.log(`   CAPTCHA submitted, ID: ${captchaId}`);
    console.log('   Waiting for solution (this may take 10-30 seconds)...');
    
    // Esperar solución (polling cada 5 segundos, máximo 2 minutos)
    for (let i = 0; i < 24; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const resultResponse = await axios.get('http://2captcha.com/res.php', {
        params: {
          key: CAPTCHA_API_KEY,
          action: 'get',
          id: captchaId,
          json: 1
        }
      });
      
      if (resultResponse.data.status === 1) {
        const solution = resultResponse.data.request;
        console.log('   ✓ CAPTCHA solved!');
        
        // Inyectar la solución en la página
        await page.evaluate((token) => {
          const textarea = document.querySelector('textarea[name="g-recaptcha-response"]');
          if (textarea) {
            textarea.value = token;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          // También intentar con el callback
          if (window.grecaptcha) {
            window.grecaptcha.execute();
          }
        }, solution);
        
        await page.waitForTimeout(2000);
        
        return { success: true, solution };
      } else if (resultResponse.data.request !== 'CAPCHA_NOT_READY') {
        return { success: false, error: `2captcha error: ${resultResponse.data.request}` };
      }
    }
    
    return { success: false, error: 'CAPTCHA solution timeout' };
  } catch (error) {
    console.error('❌ Error solving CAPTCHA:', error.message);
    return { success: false, error: error.message };
  }
};

// Función para detectar CAPTCHA
const detectCaptcha = async (page) => {
  try {
    // Buscar iframe de CAPTCHA
    const captchaIframe = await page.$('iframe[src*="captcha"], iframe[src*="recaptcha"]');
    if (captchaIframe) {
      return true;
    }
    
    // Buscar texto de CAPTCHA
    const pageText = await page.textContent('body').catch(() => '');
    if (pageText.toLowerCase().includes('captcha') || 
        pageText.toLowerCase().includes('robot') ||
        pageText.toLowerCase().includes('verify you are human')) {
      return true;
    }
    
    // Buscar elementos de CAPTCHA
    const captchaElements = await page.$$('.g-recaptcha, [data-sitekey], #captcha');
    if (captchaElements.length > 0) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
};

// Función para hacer login manual con credenciales
const performLogin = async (page) => {
  console.log('🔐 Performing login with credentials...');
  
  try {
    await page.goto('https://www.linkedin.com/login', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    await page.waitForTimeout(randomDelay(1000, 2000));
    
    // Verificar si hay CAPTCHA antes de intentar login
    const hasCaptcha = await detectCaptcha(page);
      if (hasCaptcha) {
        console.log('⚠️  CAPTCHA detected on login page');
        console.log('💡 TIP: Using persistent browser profile should reduce CAPTCHAs');
        console.log('   The profile is saved in: data/browser-profile/');
        console.log('   LinkedIn will "remember" this device after first login');
        
        // Intentar resolver automáticamente si hay API key (NO RECOMENDADO)
        if (CAPTCHA_API_KEY) {
          console.warn('⚠️  WARNING: Using 2captcha may increase ban risk!');
          const captchaResult = await solveCaptcha(page);
          if (!captchaResult.success) {
            console.error(`❌ Failed to solve CAPTCHA: ${captchaResult.error}`);
            console.error('📝 Recommended: Run in non-headless mode once to solve CAPTCHA manually');
            console.error('   After that, the persistent profile will remember your session');
            return { 
              success: false, 
              requiresCaptcha: true,
              error: 'CAPTCHA detected. Please solve manually in non-headless mode once'
            };
          }
          console.log('✅ CAPTCHA solved, continuing login...');
          await page.waitForTimeout(2000);
        } else {
          console.error('❌ CAPTCHA detected');
          console.error('📝 Recommended solution:');
          console.error('   1. Set HEADLESS=false in .env');
          console.error('   2. Run the scraper once and solve CAPTCHA manually');
          console.error('   3. The persistent profile will save your session');
          console.error('   4. After that, you can use HEADLESS=true');
          console.error('');
          console.error('   Alternative (NOT RECOMMENDED - may cause ban):');
          console.error('   Add CAPTCHA_API_KEY to .env (get it from https://2captcha.com)');
          return { 
            success: false, 
            requiresCaptcha: true,
            error: 'CAPTCHA detected. Please solve manually in non-headless mode once, then use persistent profile'
          };
        }
      }
    
    // Esperar a que aparezcan los campos de login
    await page.waitForSelector('#username', { timeout: 10000 });
    
    console.log('📝 Entering credentials...');
    
    // Escribir email con delay humano
    await page.type('#username', LINKEDIN_EMAIL, { delay: randomDelay(50, 150) });
    await page.waitForTimeout(randomDelay(500, 1000));
    
    // Escribir password con delay humano
    await page.type('#password', LINKEDIN_PASSWORD, { delay: randomDelay(50, 150) });
    await page.waitForTimeout(randomDelay(500, 1000));
    
    // Verificar si apareció CAPTCHA después de escribir
    const captchaAfterType = await detectCaptcha(page);
    if (captchaAfterType && CAPTCHA_API_KEY) {
      console.log('⚠️  CAPTCHA appeared after entering credentials, solving...');
      const captchaResult = await solveCaptcha(page);
      if (!captchaResult.success) {
        return { 
          success: false, 
          requiresCaptcha: true,
          error: 'CAPTCHA appeared and could not be solved'
        };
      }
      await page.waitForTimeout(2000);
    }
    
    // Click en el botón de login
    console.log('🚀 Submitting login...');
    await page.click('button[type="submit"]');
    
    // Esperar a que cargue
    await page.waitForTimeout(5000);
    
    // Verificar si apareció CAPTCHA después de submit
    const captchaAfterSubmit = await detectCaptcha(page);
    if (captchaAfterSubmit && CAPTCHA_API_KEY) {
      console.log('⚠️  CAPTCHA appeared after submit, solving...');
      const captchaResult = await solveCaptcha(page);
      if (!captchaResult.success) {
        return { 
          success: false, 
          requiresCaptcha: true,
          error: 'CAPTCHA appeared after submit and could not be solved'
        };
      }
      // Reintentar submit después de resolver CAPTCHA
      await page.click('button[type="submit"]');
      await page.waitForTimeout(5000);
    }
    
    // Verificar si llegamos al feed o hay verificación
    const currentUrl = page.url();
    console.log(`📍 After login URL: ${currentUrl}`);
    
    if (currentUrl.includes('/feed') || currentUrl.includes('/mynetwork')) {
      console.log('✅ Login successful!');
      return { success: true };
    } else if (currentUrl.includes('/checkpoint') || currentUrl.includes('/challenge')) {
      // Verificar si es CAPTCHA o código de verificación
      const isCaptcha = await detectCaptcha(page);
      if (isCaptcha) {
        if (CAPTCHA_API_KEY) {
          console.log('⚠️  CAPTCHA detected in checkpoint, solving...');
          const captchaResult = await solveCaptcha(page);
          if (captchaResult.success) {
            await page.waitForTimeout(3000);
            const newUrl = page.url();
            if (newUrl.includes('/feed') || newUrl.includes('/mynetwork')) {
              console.log('✅ Login successful after CAPTCHA!');
              return { success: true };
            }
          }
        }
        return { 
          success: false, 
          requiresCaptcha: true,
          error: 'CAPTCHA required. Please configure CAPTCHA_API_KEY'
        };
      }
      
      console.log('⚠️  LinkedIn requires verification code');
      console.log('   Waiting for verification code from frontend...');
      
      // Guardar el navegador para usar en verifyCode
      // Con persistent context, browser y context son el mismo
      verificationBrowser = page.context();
      verificationContext = page.context();
      verificationPage = page;
      
      return { 
        success: false, 
        requiresVerification: true,
        verificationType: 'code',
        message: 'Please enter the verification code sent to your email/phone'
      };
    } else {
      console.error('❌ Login failed - unexpected redirect');
      return { success: false, error: 'Login failed' };
    }
  } catch (error) {
    console.error('❌ Error during login:', error.message);
    return { success: false, error: error.message };
  }
};

// Función para verificar código de verificación
const verifyCode = async (code) => {
  if (!verificationPage) {
    return { success: false, error: 'No verification session found. Please login again.' };
  }
  
  try {
    console.log('🔐 Entering verification code...');
    
    // Buscar el campo de código
    const codeSelectors = [
      'input[name="pin"]',
      'input[name="verificationCode"]',
      'input[type="text"][placeholder*="code"]',
      'input[type="text"][placeholder*="código"]',
      'input[id*="pin"]',
      'input[id*="code"]',
      'input[type="tel"]'
    ];
    
    let codeInput = null;
    for (const selector of codeSelectors) {
      try {
        codeInput = await verificationPage.$(selector);
        if (codeInput) {
          console.log(`✓ Found verification input: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!codeInput) {
      // Intentar con cualquier input visible
      const allInputs = await verificationPage.$$('input[type="text"], input[type="tel"], input');
      for (const input of allInputs) {
        const isVisible = await input.isVisible();
        if (isVisible) {
          codeInput = input;
          break;
        }
      }
    }
    
    if (!codeInput) {
      return { success: false, error: 'Could not find verification code input field' };
    }
    
    // Ingresar el código
    await codeInput.fill(code);
    await verificationPage.waitForTimeout(500);
    
    // Buscar y hacer click en el botón de submit
    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Verify")',
      'button:has-text("Verificar")',
      'input[type="submit"]'
    ];
    
    let submitButton = null;
    for (const selector of submitSelectors) {
      try {
        submitButton = await verificationPage.$(selector);
        if (submitButton) break;
      } catch (e) {
        continue;
      }
    }
    
    if (!submitButton) {
      await codeInput.press('Enter');
    } else {
      await submitButton.click();
    }
    
    // Esperar respuesta
    await verificationPage.waitForTimeout(5000);
    
    const currentUrl = verificationPage.url();
    
    if (currentUrl.includes('/feed') || currentUrl.includes('/mynetwork')) {
      console.log('✅ Verification successful!');
      
      // Limpiar variables de verificación
      verificationBrowser = null;
      verificationContext = null;
      verificationPage = null;
      
      return { success: true };
    } else if (currentUrl.includes('/checkpoint') || currentUrl.includes('/challenge')) {
      // Verificar si hay mensaje de error
      const pageText = await verificationPage.textContent('body').catch(() => '');
      if (pageText.includes('incorrect') || pageText.includes('incorrecto') || pageText.includes('invalid')) {
        return { success: false, error: 'Invalid verification code' };
      }
      return { success: false, error: 'Verification may require additional steps' };
    } else {
      console.log('✅ Verification successful - redirected');
      
      verificationBrowser = null;
      verificationContext = null;
      verificationPage = null;
      
      return { success: true };
    }
  } catch (error) {
    console.error('❌ Error verifying code:', error.message);
    return { success: false, error: error.message };
  }
};

// Función para obtener o crear el navegador compartido
const getSharedBrowser = async () => {
  // Si ya existe y está funcionando, reutilizarlo
  if (sharedBrowser && sharedContext && sharedPage) {
    try {
      // Verificar que siga funcionando
      await sharedPage.evaluate(() => true);
      
      // Verificar que siga logueado
      const currentUrl = sharedPage.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/uas/login')) {
        console.log('⚠️  Session expired, cookie may be invalid...');
        throw new Error('COOKIE_EXPIRED');
      }
      
      console.log('♻️  Reusing existing browser session');
      return { browser: sharedBrowser, context: sharedContext, page: sharedPage };
    } catch (error) {
      if (error.message === 'VERIFICATION_REQUIRED') {
        throw error;
      }
      console.log('Previous browser session invalid, creating new one');
      await closeSharedBrowser();
    }
  }
  
  // Crear nuevo navegador compartido
  console.log('🌐 Creating new browser session...');
  const { browser, context } = await getBrowserContext();
  const page = await context.newPage();
  
  // Verificar cookie
  if (!LINKEDIN_LI_AT || LINKEDIN_LI_AT.trim().length < 10) {
    await browser.close();
    throw new Error('LinkedIn cookie (LINKEDIN_LI_AT) not found in .env. Please set it.');
  }
  
  // Inyectar cookie
  try {
    console.log('🍪 Injecting LinkedIn cookie...');
    await context.addCookies([
      {
        name: 'li_at',
        value: LINKEDIN_LI_AT.trim(),
        domain: '.linkedin.com',
        path: '/',
        expires: -1, // Session cookie
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      },
    ]);
    
    // Validar cookie navegando al feed
    await page.goto('https://www.linkedin.com/feed', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    const currentUrl = page.url();
    const isLoggedIn = !currentUrl.includes('/login') && !currentUrl.includes('/uas/login');
    
    if (!isLoggedIn) {
      await browser.close();
      throw new Error('Cookie validation failed - cookie may be expired. Please extract a new li_at cookie.');
    }
    
    console.log('✅ Cookie validated successfully');
    await page.waitForTimeout(randomDelay(2000, 4000)); // Simular lectura del feed
  } catch (error) {
    await browser.close();
    if (error.message.includes('Cookie validation failed')) {
      throw error;
    }
    throw new Error(`Failed to inject cookie: ${error.message}`);
  }
  
  sharedBrowser = browser;
  sharedContext = context;
  sharedPage = page;
  searchCount = 0;
  
  return { browser, context, page };
};

// Función para cerrar el navegador compartido
const closeSharedBrowser = async () => {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch (e) {
      // Ignorar errores al cerrar
    }
    sharedBrowser = null;
    sharedContext = null;
    sharedPage = null;
    searchCount = 0;
  }
};

const searchPeople = async (companyName, jobTitle) => {
  // Check rate limit before making request
  const canRequest = await rateLimitService.canMakeRequest();
  if (!canRequest.allowed) {
    loggerService.warn('Rate limit check failed', canRequest);
    throw new Error(canRequest.message || 'Rate limit exceeded');
  }
  
  const { page } = await getSharedBrowser();
  searchCount++;
  
  try {
    const searchQuery = `"${companyName}" "${jobTitle}"`;
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}`;
    
    loggerService.info('Starting search', { searchCount, companyName, jobTitle, url: searchUrl });
    console.log(`  🔍 Search #${searchCount}: ${companyName} - ${jobTitle}`);
    
    // ⚠️ Cada 5 búsquedas, visitar el feed (comportamiento humano)
    if (searchCount % 5 === 0) {
      loggerService.info('Taking break - visiting feed', { searchCount });
      console.log('  📱 Taking a break - visiting feed...');
      await page.goto('https://www.linkedin.com/feed', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      await page.waitForTimeout(randomDelay(3000, 6000));
    }
    
    // Navigate to search URL with error handling
    let response;
    try {
      response = await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      
      // Check response status
      const status = response?.status();
      if (status === 403) {
        await rateLimitService.handleForbiddenError();
        await loggerService.logError(searchUrl, 403, 'forbidden', { companyName, jobTitle });
        throw new Error('403 Forbidden - Account may be restricted. STOP scraping and appeal to LinkedIn.');
      }
      if (status === 429) {
        const backoff = await rateLimitService.handleRateLimitError('429');
        await loggerService.logError(searchUrl, 429, 'rate_limit', { companyName, jobTitle, backoff });
        throw new Error(`429 Rate Limit - Backing off for ${backoff.backoffMinutes} minutes`);
      }
      
      // Check for Cloudflare/Turnstile
      const pageContent = await page.content();
      if (pageContent.includes('cf-browser-verification') || 
          pageContent.includes('challenge-platform') ||
          pageContent.includes('turnstile')) {
        loggerService.warn('Cloudflare/Turnstile detected', { url: searchUrl });
        throw new Error('CLOUDFLARE_DETECTED: Manual intervention required');
      }
      
      await loggerService.logRequest(searchUrl, status || 200, { 
        companyName, 
        jobTitle, 
        view: true 
      });
      
      // Record view
      await rateLimitService.recordView();
    } catch (error) {
      if (error.message.includes('403') || error.message.includes('Forbidden')) {
        await rateLimitService.handleForbiddenError();
        await loggerService.logError(searchUrl, 403, 'forbidden', { companyName, jobTitle });
        throw error;
      }
      if (error.message.includes('429') || error.message.includes('Rate Limit')) {
        const backoff = await rateLimitService.handleRateLimitError('429');
        await loggerService.logError(searchUrl, 429, 'rate_limit', { companyName, jobTitle, backoff });
        throw error;
      }
      if (error.message.includes('CLOUDFLARE')) {
        throw error;
      }
      // Network error - retry with exponential backoff
      loggerService.error('Network error during search', { 
        url: searchUrl, 
        error: error.message,
        companyName,
        jobTitle 
      });
      throw error;
    }
    
    // ⚠️ Esperar a que la página cargue completamente
    // Estrategia múltiple: esperar networkidle, luego selectores específicos, luego scroll
    try {
      // Esperar a que la red esté inactiva (página cargada)
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
        loggerService.debug('Network idle timeout, continuing anyway');
      });
      
      // Esperar un poco más para que JavaScript renderice
      await page.waitForTimeout(2000);
      
      // Intentar esperar por selectores específicos de resultados
      const resultSelectors = [
        'a[href*="/in/"]',
        '[role="listitem"]',
        '.reusable-search__result-container',
        '[class*="search-result"]',
        'ul[class*="results"]',
      ];
      
      let foundResults = false;
      for (const selector of resultSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          foundResults = true;
          break;
        } catch (e) {
          continue;
        }
      }
      
      // Si no encontramos selectores específicos, verificar si hay contenido en la página
      if (!foundResults) {
        const hasContent = await page.evaluate(() => {
          // Verificar si hay elementos que sugieren que la página cargó
          return document.body.textContent.length > 1000 || 
                 document.querySelectorAll('a, div, p').length > 50;
        });
        
        if (hasContent) {
          loggerService.debug('Page has content, attempting extraction even without specific selectors');
          foundResults = true;
        }
      }
      
      // Scroll para cargar más resultados (comportamiento humano)
      await page.evaluate(() => {
        // Scroll suave hacia abajo para cargar contenido lazy-loaded
        window.scrollBy(0, 500);
      });
      await page.waitForTimeout(1500);
      
      // Scroll un poco más
      await page.evaluate(() => {
        window.scrollBy(0, 300);
      });
      await page.waitForTimeout(1000);
      
      // Scroll de vuelta arriba para tener mejor vista
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(500);
      
      loggerService.debug('Page loaded and scrolled', { foundResults });
    } catch (waitError) {
      loggerService.warn('Error waiting for page load', { error: waitError.message });
      // Continuar de todas formas - intentaremos extraer lo que haya
    }
    
    // Use enhanced data extraction service with Cheerio
    let results = await dataExtractionService.extractSearchResults(page);
    
    // Si Cheerio no encontró resultados, intentar con el método fallback
    if (!results || results.length === 0) {
      loggerService.warn('Cheerio extraction returned no results, trying fallback method');
      console.log('⚠️  Cheerio no encontró resultados, intentando método alternativo...');
      results = await dataExtractionService.extractSearchResultsFallback(page);
    }
    
    loggerService.info('Search completed', { 
      companyName, 
      jobTitle, 
      resultsCount: results.length,
      profileExtracted: results.length 
    });
    
    // Apply random delay before next request
    const delay = rateLimitService.getRandomDelay();
    loggerService.debug('Waiting before next request', { delay });
    
    // NO cerrar el navegador - mantenerlo abierto para la siguiente búsqueda
    return results;
  } catch (error) {
    loggerService.error('Error searching LinkedIn', { 
      error: error.message, 
      companyName, 
      jobTitle,
      stack: error.stack 
    });
    console.error(`Error searching LinkedIn: ${error.message}`);
    
    // Handle specific error types
    if (error.message.includes('403') || error.message.includes('Forbidden')) {
      loggerService.critical('403 Forbidden - Account restricted', { companyName, jobTitle });
      await closeSharedBrowser();
      throw error; // Re-throw to stop scraping
    }
    
    if (error.message.includes('429') || error.message.includes('Rate Limit')) {
      loggerService.warn('429 Rate Limit hit', { companyName, jobTitle });
      // Don't close browser, just wait for backoff period
      throw error;
    }
    
    if (error.message.includes('CLOUDFLARE')) {
      loggerService.warn('Cloudflare detected', { companyName, jobTitle });
      throw error;
    }
    
    // Si el error es crítico, cerrar y recrear el navegador
    if (error.message.includes('Session closed') || 
        error.message.includes('Target closed') ||
        error.message.includes('login')) {
      loggerService.warn('Critical error detected, will recreate browser on next search', { 
        error: error.message 
      });
      console.log('⚠️  Critical error detected, will recreate browser on next search');
      await closeSharedBrowser();
    }
    
    return [];
  }
};


module.exports = {
  ensureLoggedIn,
  searchPeople,
  getBrowserContext,
  verifyCode,
  closeSharedBrowser,
  DELAYS
};

