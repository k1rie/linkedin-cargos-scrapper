const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const COOKIES_FILE = path.join(__dirname, '../data/cookies.json');

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
  // Primero intentar cargar desde .env
  if (process.env.LINKEDIN_COOKIES) {
    try {
      const cookies = JSON.parse(process.env.LINKEDIN_COOKIES);
      console.log('✓ Loaded cookies from .env');
      return cookies;
    } catch (error) {
      console.error('Error parsing LINKEDIN_COOKIES from .env:', error.message);
    }
  }
  
  // Si no hay en .env, intentar cargar desde archivo
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(COOKIES_FILE, 'utf8');
    const cookies = JSON.parse(data);
    console.log('✓ Loaded cookies from file');
    return cookies;
  } catch {
    return null;
  }
};

const checkSession = async () => {
  const cookies = await loadCookies();
  
  if (!cookies || cookies.length === 0) {
    return false;
  }

  const isHeadless = process.env.NODE_ENV === 'production' || process.env.HEADLESS === 'true';
  const browser = await chromium.launch({ 
    headless: isHeadless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext();
  
  try {
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto('https://www.linkedin.com/feed', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    const isLoggedIn = !page.url().includes('/login');
    await browser.close();
    
    return isLoggedIn;
  } catch (error) {
    await browser.close();
    return false;
  }
};

const ensureLoggedIn = async () => {
  const isLoggedIn = await checkSession();
  
  if (!isLoggedIn) {
    console.error('❌ No valid LinkedIn session found');
    console.error('📝 Please upload your LinkedIn cookies via the frontend:');
    console.error('   1. Open http://localhost:8080');
    console.error('   2. Follow the instructions to copy your cookies');
    console.error('   3. Paste them and click "Guardar Cookies"');
    
    return { 
      loggedIn: false, 
      requiresCookies: true,
      error: 'No valid LinkedIn session. Please upload cookies via the frontend.'
    };
  }
  
  return { loggedIn: true };
};

const getBrowserContext = async () => {
  const isHeadless = process.env.NODE_ENV === 'production' || process.env.HEADLESS === 'true';
  const browser = await chromium.launch({ 
    headless: isHeadless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
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
        'a[href*="/in/"]',
        '[class*="search-result"]',
        '[data-view-name*="search"]',
        'li[class*="result"]'
      ];
      
      let resultElements = [];
      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        resultElements = Array.from(elements).filter(el => {
          const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
          return href.includes('/in/') && el.textContent.trim().length > 0;
        });
        if (resultElements.length > 0) break;
      }
      
      if (resultElements.length === 0) {
        const allLinks = document.querySelectorAll('a[href*="/in/"]');
        resultElements = Array.from(allLinks).filter(link => {
          const container = link.closest('[class*="result"], [class*="search"], li, div[role="listitem"]');
          return container && link.textContent.trim().length > 0;
        });
      }
      
      const processedContainers = new Set();
      
      resultElements.forEach((element) => {
        try {
          let container = element;
          if (element.tagName !== 'A' || !element.href.includes('/in/')) {
            container = element.closest('a[href*="/in/"]') || 
                       element.closest('[role="listitem"]') ||
                       element.closest('[class*="result"]') ||
                       element.parentElement;
          }
          
          const containerId = container.getAttribute('href') || 
                            container.textContent.substring(0, 50) || 
                            container.outerHTML.substring(0, 100);
          
          if (processedContainers.has(containerId)) {
            return;
          }
          processedContainers.add(containerId);
          
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
          
          let name = profileLink.innerText.trim() || profileLink.textContent.trim();
          name = name.replace(/•.*$/, '').trim();
          name = name.replace(/·.*$/, '').trim();
          name = name.replace(/\s+/g, ' ').trim();
          
          if (!name || name.length < 2) {
            const nameFromContainer = container.textContent.trim().split('\n')[0].trim();
            if (nameFromContainer.length > 2) {
              name = nameFromContainer.split('•')[0].split('·')[0].trim();
            }
          }
          
          let title = '';
          let location = '';
          
          const allTextElements = container.querySelectorAll('p, div, span');
          const textElements = Array.from(allTextElements);
          
          for (const el of textElements) {
            const text = el.innerText.trim();
            if (!text || text.length < 5) continue;
            
            if (!location && (
              text.match(/^(Ciudad de México|México|Argentina|Colombia|España|Bogotá|Buenos Aires|Madrid|Barcelona|Lima|Santiago)/i) ||
              (text.includes(',') && text.length < 60 && text.match(/[A-Z][a-z]+,\s*[A-Z][a-z]+/))
            )) {
              location = text;
              continue;
            }
            
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
          // Silently skip
        }
      });
      
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

const saveCookiesFromUser = async (cookies) => {
  try {
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return { success: false, error: 'Invalid cookies format' };
    }
    
    const hasLinkedInCookies = cookies.some(cookie => 
      cookie.domain && cookie.domain.includes('linkedin.com')
    );
    
    if (!hasLinkedInCookies) {
      return { success: false, error: 'No LinkedIn cookies found' };
    }
    
    await saveCookies(cookies);
    
    const isValid = await checkSession();
    
    if (isValid) {
      return { success: true, message: 'Cookies saved and validated successfully' };
    } else {
      return { success: false, error: 'Cookies saved but session validation failed. They might be expired.' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
};

module.exports = {
  checkSession,
  ensureLoggedIn,
  searchPeople,
  getBrowserContext,
  saveCookiesFromUser
};
