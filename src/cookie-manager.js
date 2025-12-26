/**
 * Cookie Manager - Simple cookie loader from environment
 * Reads li_at cookie directly from environment variables
 * @module cookie-manager
 */

const { chromium } = require('playwright');
const { logger } = require('./logger');

/**
 * Cookie Manager class
 * Handles loading and validation of LinkedIn li_at cookie from environment
 */
class CookieManager {
  /**
   * @param {string} liAtCookie - li_at cookie value from environment
   */
  constructor(liAtCookie) {
    this.liAtCookie = liAtCookie;
  }

  /**
   * Get li_at cookie value
   * @returns {string} li_at cookie value
   * @throws {Error} If cookie is not set
   */
  getCookie() {
    if (!this.liAtCookie || typeof this.liAtCookie !== 'string' || this.liAtCookie.trim().length < 10) {
      throw new Error(
        'LINKEDIN_LI_AT cookie not found or invalid. Please set LINKEDIN_LI_AT in .env file.\n' +
        'Extract it from your browser: DevTools > Application > Cookies > linkedin.com > li_at'
      );
    }

    return this.liAtCookie.trim();
  }

  /**
   * Validate cookie by navigating to LinkedIn feed
   * @param {Page} page - Playwright page object
   * @returns {Promise<boolean>} True if cookie is valid
   */
  async validate(page) {
    try {
      logger.info('Validating cookie...');

      // Navigate to feed
      const response = await page.goto('https://www.linkedin.com/feed', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      const status = response?.status();
      const currentUrl = page.url();

      // Check if redirected to login
      const isLoggedIn = 
        !currentUrl.includes('/login') && 
        !currentUrl.includes('/uas/login') &&
        status === 200;

      if (isLoggedIn) {
        logger.info('Cookie validation successful');
        return true;
      } else {
        logger.warn('Cookie validation failed - redirected to login', {
          url: currentUrl,
          status,
        });
        return false;
      }
    } catch (error) {
      logger.error('Cookie validation error', error);
      return false;
    }
  }

  /**
   * Get cookie info (simple check if exists)
   * @returns {Object} Cookie info
   */
  getCookieInfo() {
    if (!this.liAtCookie) {
      return null;
    }

    return {
      exists: true,
      length: this.liAtCookie.length,
      preview: this.liAtCookie.substring(0, 20) + '...',
    };
  }
}

module.exports = CookieManager;
