require('dotenv').config();
const scrapeService = require('../services/scrapeService');
const cron = require('node-cron');

const runScraping = async () => {
  try {
    const result = await scrapeService.startScraping();
    
    // Verificar si el resultado indica que se requiere verificación
    if (result && result.requiresVerification) {
      console.log('⚠️  Scraping paused - verification required');
      console.log('⚠️  Please verify your account via the frontend');
      console.log('⚠️  The server will continue running');
      return;
    }
    
    if (result && result.success) {
      console.log('✓ Scraping completed successfully');
    }
  } catch (error) {
    console.error('Scraping failed:', error.message);
    console.log('⚠️  Scraping error occurred, but server will continue running');
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

