require('dotenv').config();
const scrapeService = require('../services/scrapeService');
const cron = require('node-cron');

const runScraping = async () => {
  try {
    await scrapeService.startScraping();
  } catch (error) {
    console.error('Scraping failed:', error);
    process.exit(1);
  }
};

const scheduleScraping = () => {
  console.log('Scheduling scraping check daily...');
  console.log('Each company will be scraped when 3 months have passed since last scrape.');
  
  cron.schedule('0 9 * * *', async () => {
    console.log('Running daily scraping check...');
    await runScraping();
  });
  
  console.log('Scheduler started. Scraping check will run daily at 9:00 AM.');
  console.log('Running initial scraping...');
  runScraping();
};

const mode = process.argv[2];

if (mode === '--schedule') {
  scheduleScraping();
} else {
  runScraping();
}

