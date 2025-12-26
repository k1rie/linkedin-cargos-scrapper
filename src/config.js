/**
 * Configuration loader and validator
 * Loads and validates environment variables
 * @module config
 */

require('dotenv').config();
const path = require('path');

/**
 * Load and validate configuration
 * @returns {Object} Configuration object
 * @throws {Error} If required configuration is missing
 */
function loadConfig() {
  const config = {
    // LinkedIn Cookie
    linkedinLiAt: process.env.LINKEDIN_LI_AT,
    
    // Environment
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    
    // Rate limiting
    dailyLimit: parseInt(process.env.DAILY_LIMIT || '40', 10),
    minDelay: parseInt(process.env.MIN_DELAY || '3000', 10),
    maxDelay: parseInt(process.env.MAX_DELAY || '8000', 10),
    
    // Paths
    logDir: path.join(__dirname, '../logs'),
    dataDir: path.join(__dirname, '../data'),
    
    // Browser
    headless: process.env.HEADLESS !== 'false',
    viewport: {
      width: parseInt(process.env.VIEWPORT_WIDTH || '1920', 10),
      height: parseInt(process.env.VIEWPORT_HEIGHT || '1080', 10),
    },
    
    // Retry configuration
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.RETRY_DELAY || '5000', 10),
  };

  // Validate required configuration
  if (!config.linkedinLiAt || config.linkedinLiAt.trim().length < 10) {
    throw new Error(
      'LINKEDIN_LI_AT is required. Please set it in .env file.\n' +
      'Extract it from your browser: DevTools > Application > Cookies > linkedin.com > li_at'
    );
  }

  // Validate rate limiting
  if (config.dailyLimit < 1 || config.dailyLimit > 100) {
    throw new Error('DAILY_LIMIT must be between 1 and 100');
  }

  if (config.minDelay < 1000 || config.maxDelay < config.minDelay) {
    throw new Error('MIN_DELAY must be >= 1000ms and MAX_DELAY must be >= MIN_DELAY');
  }

  return config;
}

module.exports = { loadConfig };

