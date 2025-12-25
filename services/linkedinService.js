const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const COOKIES_FILE = path.join(__dirname, '../data/cookies.json');
const LINKEDIN_EMAIL = process.env.LINKEDIN_EMAIL;
const LINKEDIN_PASSWORD = process.env.LINKEDIN_PASSWORD;

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

const loadCookies = async () => {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(COOKIES_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const login = async (email, password) => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://www.linkedin.com/login');
    
    await page.fill('#username', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    
    await page.waitForURL('https://www.linkedin.com/feed/**', { timeout: 30000 });
    
    const cookies = await context.cookies();
    await saveCookies(cookies);
    await browser.close();
    
    return { success: true, cookies };
  } catch (error) {
    await browser.close();
    return { success: false, error: error.message };
  }
};

const checkSession = async () => {
  const cookies = await loadCookies();
  
  if (!cookies || cookies.length === 0) {
    return false;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  
  try {
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto('https://www.linkedin.com/feed', { waitUntil: 'networkidle' });
    
    const isLoggedIn = !page.url().includes('/login');
    await browser.close();
    
    return isLoggedIn;
  } catch (error) {
    await browser.close();
    return false;
  }
};

const attemptAutoLogin = async () => {
  if (!LINKEDIN_EMAIL || !LINKEDIN_PASSWORD) {
    return { success: false, error: 'LinkedIn credentials not found in .env file' };
  }
  
  console.log('Attempting auto-login with credentials from .env...');
  return await login(LINKEDIN_EMAIL, LINKEDIN_PASSWORD);
};

const ensureLoggedIn = async () => {
  const isLoggedIn = await checkSession();
  
  if (!isLoggedIn) {
    console.log('No active session found. Attempting auto-login...');
    const loginResult = await attemptAutoLogin();
    
    if (!loginResult.success) {
      throw new Error(`Auto-login failed: ${loginResult.error}`);
    }
    
    console.log('Auto-login successful');
    return true;
  }
  
  return true;
};

const getBrowserContext = async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  
  const cookies = await loadCookies();
  if (cookies && cookies.length > 0) {
    await context.addCookies(cookies);
  }
  
  return { browser, context };
};

const searchPeople = async (companyName, jobTitle) => {
  const { browser, context } = await getBrowserContext();
  const page = await context.newPage();
  
  try {
    const searchQuery = `"${companyName}" "${jobTitle}"`;
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}`;
    
    await page.goto(searchUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    await page.waitForTimeout(5000);
    
    // Esperar a que aparezcan links a perfiles
    try {
      await page.waitForSelector('a[href*="/in/"]', { timeout: 20000 });
    } catch (selectorError) {
      console.warn(`No profile links found, trying to extract results anyway...`);
    }
    
    const results = await page.evaluate(() => {
      const people = [];
      
      const selectors = [
        'a[href*="/in/"]', // Links a perfiles de LinkedIn
        '[class*="search-result"]',
        '[data-view-name*="search"]',
        'li[class*="result"]'
      ];
      
      let resultElements = [];
      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        // Filtrar solo los que parecen ser tarjetas de resultados de búsqueda
        resultElements = Array.from(elements).filter(el => {
          const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
          return href.includes('/in/') && el.textContent.trim().length > 0;
        });
        if (resultElements.length > 0) break;
      }
      
      // Si no encontramos con los selectores anteriores, buscar todos los links a perfiles
      if (resultElements.length === 0) {
        const allLinks = document.querySelectorAll('a[href*="/in/"]');
        resultElements = Array.from(allLinks).filter(link => {
          // Filtrar solo los que están en contenedores de resultados
          const container = link.closest('[class*="result"], [class*="search"], li, div[role="listitem"]');
          return container && link.textContent.trim().length > 0;
        });
      }
      
      // Agrupar elementos por contenedor para evitar duplicados
      const processedContainers = new Set();
      
      resultElements.forEach((element) => {
        try {
          // Buscar el contenedor principal - puede ser un <a> que contiene todo o un contenedor padre
          let container = element;
          if (element.tagName !== 'A' || !element.href.includes('/in/')) {
            container = element.closest('a[href*="/in/"]') || 
                       element.closest('[role="listitem"]') ||
                       element.closest('[class*="result"]') ||
                       element.parentElement;
          }
          
          // Crear un ID único para este contenedor basado en su posición y contenido
          const containerId = container.getAttribute('href') || 
                            container.textContent.substring(0, 50) || 
                            container.outerHTML.substring(0, 100);
          
          if (processedContainers.has(containerId)) {
            return; // Ya procesamos este contenedor
          }
          processedContainers.add(containerId);
          
          // Buscar el link principal al perfil
          let profileLink = null;
          if (container.tagName === 'A' && container.href.includes('/in/')) {
            profileLink = container;
          } else {
            profileLink = container.querySelector('a[href*="/in/"]') ||
                         container.querySelector('a[data-view-name="search-result-lockup-title"]');
          }
          
          if (!profileLink) return;
          
          const profileUrl = profileLink.href || profileLink.getAttribute('href');
          if (!profileUrl || !profileUrl.includes('/in/')) return;
          
          // Extraer el nombre del link o del contenedor
          let name = profileLink.innerText.trim() || profileLink.textContent.trim();
          // Limpiar el nombre - remover iconos, badges, etc.
          name = name.replace(/•.*$/, '').trim();
          name = name.replace(/·.*$/, '').trim();
          name = name.replace(/\s+/g, ' ').trim();
          
          // Si el nombre está vacío o es muy corto, buscar en el contenedor
          if (!name || name.length < 2) {
            const nameFromContainer = container.textContent.trim().split('\n')[0].trim();
            if (nameFromContainer.length > 2) {
              name = nameFromContainer.split('•')[0].split('·')[0].trim();
            }
          }
          
          // Buscar el título/cargo - buscar todos los párrafos y encontrar el que parece ser el título
          let title = '';
          let location = '';
          
          const allTextElements = container.querySelectorAll('p, div, span');
          const textElements = Array.from(allTextElements);
          
          for (const el of textElements) {
            const text = el.innerText.trim();
            if (!text || text.length < 5) continue;
            
            // Detectar ubicación
            if (!location && (
              text.match(/^(Ciudad de México|México|Argentina|Colombia|España|Bogotá|Buenos Aires|Madrid|Barcelona|Lima|Santiago)/i) ||
              (text.includes(',') && text.length < 60 && text.match(/[A-Z][a-z]+,\s*[A-Z][a-z]+/))
            )) {
              location = text;
              continue;
            }
            
            // Detectar título (no es ubicación, no es "Anterior:", tiene más de 10 caracteres)
            if (!title && 
                text.length > 10 && 
                !text.includes('Anterior:') &&
                !text.match(/^(Ciudad|México|Argentina|Colombia|España)/i) &&
                !text.match(/^\d+\s*(conexión|conexiones|seguidor|seguidores)/i) &&
                !text.match(/^Conectar|^Enviar mensaje/i) &&
                text !== location) {
              title = text;
            }
          }
          
          // Si no encontramos título, buscar en divs específicos
          if (!title) {
            const titleDivs = container.querySelectorAll('div[class*="_65b5d50b"] p, div[class*="subtitle"]');
            for (const div of titleDivs) {
              const text = div.innerText.trim();
              if (text.length > 10 && !text.includes('Anterior:') && text !== location) {
                title = text;
                break;
              }
            }
          }
          
          if (name && profileUrl) {
            people.push({
              name: name,
              profileUrl: profileUrl,
              title: title,
              location: location
            });
          }
        } catch (error) {
          // Silently skip this element if there's an error
        }
      });
      
      // Eliminar duplicados basados en la URL del perfil
      const uniquePeople = [];
      const seenUrls = new Set();
      for (const person of people) {
        if (!seenUrls.has(person.profileUrl)) {
          seenUrls.add(person.profileUrl);
          uniquePeople.push(person);
        }
      }
      
      return uniquePeople;
    });
    
    await browser.close();
    return results;
  } catch (error) {
    await browser.close();
    console.error(`Error searching LinkedIn: ${error.message}`);
    return [];
  }
};

module.exports = {
  login,
  checkSession,
  attemptAutoLogin,
  ensureLoggedIn,
  searchPeople,
  getBrowserContext
};

