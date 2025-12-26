#!/usr/bin/env node

/**
 * Main entry point for LinkedIn scraper
 * CLI interface for cookie management and scraping
 * @module main
 */

const CookieManager = require('./cookie-manager');
const LinkedInScraper = require('./linkedin-scraper');
const { loadConfig } = require('./config');
const { logger } = require('./logger');

/**
 * Show cookie setup instructions
 */
function showCookieSetup() {
  console.log('\n🔐 LinkedIn Cookie Setup Instructions\n');
  console.log('To use this scraper, you need to extract your li_at cookie from LinkedIn:\n');
  console.log('1. Open LinkedIn in your browser and log in');
  console.log('2. Open Developer Tools (F12 or Cmd+Option+I)');
  console.log('3. Go to Application tab (Chrome) or Storage tab (Firefox)');
  console.log('4. Click on Cookies > https://www.linkedin.com');
  console.log('5. Find the "li_at" cookie');
  console.log('6. Copy the "Value" field (it\'s a long string)');
  console.log('7. Add it to your .env file as:');
  console.log('   LINKEDIN_LI_AT=your-cookie-value-here\n');
  console.log('⚠️  Keep your .env file secure and never commit it to git!\n');
}

/**
 * Validate cookie
 * @param {CookieManager} cookieManager - Cookie manager instance
 * @param {Object} config - Configuration object
 * @returns {Promise<void>}
 */
async function validateCookie(cookieManager, config) {
  try {
    console.log('\n🔍 Validating cookie...\n');

    const { chromium } = require('playwright');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Load cookie
    const liAtValue = cookieManager.getCookie();
    await context.addCookies([
      {
        name: 'li_at',
        value: liAtValue,
        domain: '.linkedin.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      },
    ]);

    // Validate
    const isValid = await cookieManager.validate(page);

    await browser.close();

    if (isValid) {
      console.log('✅ Cookie is valid and working!\n');
      
      // Show cookie info
      const info = cookieManager.getCookieInfo();
      if (info) {
        console.log('📊 Cookie Information:');
        console.log(`   Length: ${info.length} characters`);
        console.log(`   Preview: ${info.preview}\n`);
      }
    } else {
      console.log('❌ Cookie is invalid or expired');
      console.log('📝 Please extract a new li_at cookie and update LINKEDIN_LI_AT in .env\n');
      process.exit(1);
    }
  } catch (error) {
    logger.error('Cookie validation failed', error);
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Scrape profiles
 * @param {string[]} urls - Array of LinkedIn profile URLs
 * @param {CookieManager} cookieManager - Cookie manager instance
 * @param {Object} config - Configuration object
 * @returns {Promise<void>}
 */
async function scrapeProfiles(urls, cookieManager, config) {
  try {
    console.log('\n🚀 Starting LinkedIn scraper...\n');

    const scraper = new LinkedInScraper(cookieManager, config);

    // Show stats before scraping
    const stats = scraper.getStats();
    console.log('📊 Daily Statistics:');
    console.log(`   Views today: ${stats.dailyViewCount}/${stats.dailyLimit}`);
    console.log(`   Remaining: ${stats.remaining}`);
    console.log(`   URLs to scrape: ${urls.length}\n`);

    // Scrape
    const results = await scraper.scrape(urls);

    // Show results
    console.log('\n✅ Scraping completed!\n');
    console.log('📊 Results:');
    console.log(JSON.stringify(results, null, 2));

    // Show final stats
    const finalStats = scraper.getStats();
    console.log('\n📈 Final Statistics:');
    console.log(`   Profiles scraped: ${results.length}`);
    console.log(`   Views used: ${finalStats.dailyViewCount}/${finalStats.dailyLimit}`);
    console.log(`   Remaining: ${finalStats.remaining}\n`);
  } catch (error) {
    logger.error('Scraping failed', error);
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Show statistics
 * @param {CookieManager} cookieManager - Cookie manager instance
 * @param {Object} config - Configuration object
 * @returns {Promise<void>}
 */
function showStats(cookieManager, config) {
  try {
    console.log('\n📊 LinkedIn Scraper Statistics\n');

    // Cookie info
    const cookieInfo = cookieManager.getCookieInfo();
    if (cookieInfo) {
      console.log('🍪 Cookie Information:');
      console.log(`   Length: ${cookieInfo.length} characters`);
      console.log(`   Preview: ${cookieInfo.preview}\n`);
    } else {
      console.log('🍪 Cookie: Not set in .env\n');
    }

    // Configuration
    console.log('⚙️  Configuration:');
    console.log(`   Daily limit: ${config.dailyLimit} profiles`);
    console.log(`   Delay range: ${config.minDelay}-${config.maxDelay}ms`);
    console.log(`   Log level: ${config.logLevel}\n`);
  } catch (error) {
    logger.error('Failed to show stats', error);
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Main CLI handler
 */
async function main() {
  try {
    // Load configuration
    const config = loadConfig();

    // Initialize cookie manager
    const cookieManager = new CookieManager(config.linkedinLiAt);

    // Parse CLI arguments
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
      case '--init':
      case '-i':
        showCookieSetup();
        break;

      case '--validate':
      case '-v':
        await validateCookie(cookieManager, config);
        break;

      case '--scrape':
      case '-s':
        const urls = args.slice(1);
        if (urls.length === 0) {
          console.error('❌ Error: Please provide LinkedIn profile URLs');
          console.error('   Usage: node src/main.js --scrape <url1> <url2> ...');
          process.exit(1);
        }
        await scrapeProfiles(urls, cookieManager, config);
        break;

      case '--stats':
        await showStats(cookieManager, config);
        break;

      case '--help':
      case '-h':
        console.log('\n📖 LinkedIn Cookie-Based Scraper\n');
        console.log('Usage:');
        console.log('  node src/main.js --init                    Show cookie setup instructions');
        console.log('  node src/main.js --validate                Validate cookie from .env');
        console.log('  node src/main.js --scrape <url1> <url2>   Scrape profiles');
        console.log('  node src/main.js --stats                   Show statistics');
        console.log('  node src/main.js --help                   Show this help\n');
        console.log('Configuration:');
        console.log('  Set LINKEDIN_LI_AT in .env file with your li_at cookie value\n');
        break;

      default:
        console.error('❌ Unknown command. Use --help for usage information.');
        process.exit(1);
    }
  } catch (error) {
    logger.error('Application error', error);
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run main function
if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error', error);
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { main };

