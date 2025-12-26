/**
 * LinkedIn Scraper - Cookie-based scraping with stealth and rate limiting
 * @module linkedin-scraper
 */

const { chromium } = require('playwright');
const { logger, logRequest, logError } = require('./logger');

/**
 * LinkedIn Scraper class
 * Handles browser automation, cookie injection, and profile scraping
 */
class LinkedInScraper {
  /**
   * @param {CookieManager} cookieManager - Cookie manager instance
   * @param {Object} config - Configuration object
   * @param {Object} logger - Winston logger instance
   */
  constructor(cookieManager, config) {
    this.cookieManager = cookieManager;
    this.config = config;
    this.browser = null;
    this.page = null;
    this.dailyViewCount = 0;
    this.lastResetDate = null;
    this.requestCount = 0;
  }

  /**
   * Initialize browser with stealth configuration
   * @returns {Promise<void>}
   */
  async initBrowser() {
    try {
      logger.info('Initializing browser with stealth configuration...');

      // Random viewport for better stealth
      const viewports = [
        { width: 1920, height: 1080 },
        { width: 1440, height: 900 },
        { width: 1366, height: 768 },
      ];
      const viewport = viewports[Math.floor(Math.random() * viewports.length)];

      // Random user agents
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      ];
      const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });

      const context = await this.browser.newContext({
        userAgent,
        viewport,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: ['geolocation'],
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-User': '?1',
          'Sec-Fetch-Dest': 'document',
        },
      });

      // Inject stealth scripts
      await context.addInitScript(() => {
        // Hide webdriver
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });

        // Spoof plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', filename: 'internal-nacl-plugin' },
          ],
        });

        // Spoof languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });

        // Chrome runtime
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {},
        };

        // WebGL spoofing
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) {
            return 'Intel Inc.';
          }
          if (parameter === 37446) {
            return 'Intel Iris OpenGL Engine';
          }
          return getParameter.call(this, parameter);
        };

        // Permissions API
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      });

      this.page = await context.newPage();

      logger.info('Browser initialized', { viewport, userAgent: userAgent.substring(0, 50) + '...' });
    } catch (error) {
      logError('Failed to initialize browser', error);
      throw error;
    }
  }

  /**
   * Load and inject cookie into browser
   * @returns {Promise<void>}
   * @throws {Error} If cookie loading fails
   */
  async loadCookie() {
    try {
      logger.info('Loading cookie from environment...');

      // Get cookie from manager
      const liAtValue = this.cookieManager.getCookie();

      // Inject cookie
      await this.page.context().addCookies([
        {
          name: 'li_at',
          value: liAtValue,
          domain: '.linkedin.com',
          path: '/',
          expires: -1, // Session cookie
          httpOnly: true,
          secure: true,
          sameSite: 'None',
        },
      ]);

      logger.info('Cookie injected successfully');

      // Validate cookie
      const isValid = await this.cookieManager.validate(this.page);
      if (!isValid) {
        throw new Error('Cookie validation failed - cookie may be expired');
      }
    } catch (error) {
      logError('Failed to load cookie', error);
      throw error;
    }
  }

  /**
   * Check and reset daily view counter if needed
   * @returns {void}
   */
  _checkDailyLimit() {
    const today = new Date().toISOString().split('T')[0];

    // Reset counter if new day
    if (this.lastResetDate !== today) {
      this.dailyViewCount = 0;
      this.lastResetDate = today;
      logger.info('Daily limit reset', { date: today });
    }

    // Check if limit reached
    if (this.dailyViewCount >= this.config.dailyLimit) {
      throw new Error(
        `Daily limit reached (${this.dailyViewCount}/${this.config.dailyLimit}). ` +
        'Please try again tomorrow or increase DAILY_LIMIT in .env'
      );
    }
  }

  /**
   * Get random delay between requests
   * @returns {number} Delay in milliseconds
   */
  _getRandomDelay() {
    const { minDelay, maxDelay } = this.config;
    return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  }

  /**
   * Humanize browser behavior with random delays and scrolling
   * @param {Page} page - Playwright page object
   * @returns {Promise<void>}
   */
  async humanizeBehavior(page) {
    // Random scroll
    await page.evaluate(() => {
      window.scrollBy(0, Math.random() * 500 + 300);
    });

    // Random delay
    const delay = this._getRandomDelay();
    await page.waitForTimeout(delay);

    logger.debug('Humanized behavior', { delay });
  }

  /**
   * Extract profile data from page
   * Primary: JSON-LD parsing, Fallback: CSS selectors
   * @param {Page} page - Playwright page object
   * @param {string} url - Profile URL
   * @returns {Promise<Object>} Extracted profile data
   */
  async extractProfile(page, url) {
    try {
      // Wait for page to load
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Try JSON-LD first
      const jsonLdData = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
          try {
            const data = JSON.parse(script.textContent);
            if (data['@type'] === 'Person' || data['@type'] === 'http://schema.org/Person') {
              return {
                name: data.name,
                jobTitle: data.jobTitle,
                worksFor: data.worksFor?.name || data.worksFor,
                address: data.address?.addressLocality || data.address,
                url: data.url,
                image: data.image,
              };
            }
          } catch (e) {
            continue;
          }
        }
        return null;
      });

      if (jsonLdData) {
        logger.debug('Profile extracted via JSON-LD', { url });
        return { ...jsonLdData, source: 'json-ld', url };
      }

      // Fallback to CSS selectors
      const cssData = await page.evaluate(() => {
        const data = {
          name: '',
          title: '',
          location: '',
          company: '',
        };

        // Extract name
        const nameEl = document.querySelector('h1.text-heading-xlarge, h1[class*="text-heading"]');
        if (nameEl) data.name = nameEl.textContent.trim();

        // Extract title
        const titleEl = document.querySelector('.text-body-medium.break-words, [class*="headline"]');
        if (titleEl) data.title = titleEl.textContent.trim();

        // Extract location
        const locationEl = document.querySelector('.text-body-small.inline.t-black--light');
        if (locationEl) data.location = locationEl.textContent.trim();

        // Extract company from experience
        const companyEl = document.querySelector('[data-view-name="profile-components-entity"] .pvs-entity__sub-title');
        if (companyEl) data.company = companyEl.textContent.trim();

        return data;
      });

      logger.debug('Profile extracted via CSS selectors', { url });
      return { ...cssData, source: 'css-selectors', url };
    } catch (error) {
      logError('Profile extraction failed', error, { url });
      return { url, error: error.message };
    }
  }

  /**
   * Handle rate limit error (429)
   * @param {Error} error - Error object
   * @returns {Promise<void>}
   * @throws {Error} Re-throws error after logging
   */
  async handleRateLimit(error) {
    logger.warn('Rate limit detected (429)', {
      message: error.message,
      requestCount: this.requestCount,
    });

    // Exponential backoff: wait 30 minutes minimum
    const backoffMinutes = 30;
    const backoffMs = backoffMinutes * 60 * 1000;

    logger.warn(`Rate limited. Waiting ${backoffMinutes} minutes before retry...`);

    // Wait with progress updates
    const interval = 60000; // 1 minute
    let remaining = backoffMs;

    while (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
      remaining -= interval;
      const minutesLeft = Math.ceil(remaining / 60000);
      if (minutesLeft > 0) {
        logger.info(`Rate limit backoff: ${minutesLeft} minutes remaining...`);
      }
    }

    throw error; // Re-throw to stop scraping
  }

  /**
   * Handle expired cookie error (403)
   * @param {Error} error - Error object
   * @returns {Promise<void>}
   * @throws {Error} Re-throws error after logging
   */
  async handleExpiredCookie(error) {
    logger.error('Cookie expired or account restricted (403)', {
      message: error.message,
    });

    console.error('\n❌ Cookie expired or account restricted.');
    console.error('📝 Please extract a new li_at cookie:');
    console.error('   1. Log into LinkedIn in your browser');
    console.error('   2. Open DevTools > Application > Cookies');
    console.error('   3. Copy the "li_at" cookie value');
    console.error('   4. Run: node src/main.js --init\n');

    throw error;
  }

  /**
   * Scrape multiple LinkedIn profile URLs
   * @param {string[]} urls - Array of LinkedIn profile URLs
   * @returns {Promise<Array>} Array of extracted profile data
   */
  async scrape(urls) {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('URLs must be a non-empty array');
    }

    // Validate URLs
    const validUrls = urls.filter((url) => {
      try {
        const urlObj = new URL(url);
        return urlObj.hostname.includes('linkedin.com');
      } catch {
        return false;
      }
    });

    if (validUrls.length === 0) {
      throw new Error('No valid LinkedIn URLs provided');
    }

    const results = [];

    try {
      // Initialize browser
      await this.initBrowser();

      // Load cookie
      await this.loadCookie();

      // Scrape each URL
      for (let i = 0; i < validUrls.length; i++) {
        const url = validUrls[i];
        this.requestCount++;

        try {
          // Check daily limit
          this._checkDailyLimit();

          logger.info(`Scraping profile ${i + 1}/${validUrls.length}`, { url });

          // Navigate to profile
          const response = await this.page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          const status = response?.status();

          // Handle errors
          if (status === 403) {
            await this.handleExpiredCookie(new Error('403 Forbidden'));
            break;
          }

          if (status === 429) {
            await this.handleRateLimit(new Error('429 Too Many Requests'));
            break;
          }

          // Extract profile data
          const profileData = await this.extractProfile(this.page, url);

          // Increment view count
          this.dailyViewCount++;
          results.push(profileData);

          logRequest(url, status || 200, {
            requestNumber: this.requestCount,
            dailyViewCount: this.dailyViewCount,
            profileExtracted: !!profileData.name,
          });

          // Humanize behavior before next request
          if (i < validUrls.length - 1) {
            await this.humanizeBehavior(this.page);
          }
        } catch (error) {
          logError(`Failed to scrape profile ${i + 1}`, error, { url });

          // Handle specific errors
          if (error.message.includes('403') || error.message.includes('Forbidden')) {
            await this.handleExpiredCookie(error);
            break;
          }

          if (error.message.includes('429') || error.message.includes('Rate Limit')) {
            await this.handleRateLimit(error);
            break;
          }

          // Add error to results
          results.push({ url, error: error.message });
        }
      }

      return results;
    } finally {
      // Clean up browser
      if (this.browser) {
        await this.browser.close();
        logger.info('Browser closed');
      }
    }
  }

  /**
   * Get daily statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      dailyViewCount: this.dailyViewCount,
      dailyLimit: this.config.dailyLimit,
      remaining: this.config.dailyLimit - this.dailyViewCount,
      lastResetDate: this.lastResetDate,
      requestCount: this.requestCount,
    };
  }
}

module.exports = LinkedInScraper;

