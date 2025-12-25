const scrapeService = require('../services/scrapeService');

let scrapingStatus = {
  isRunning: false,
  currentCompany: null,
  progress: 0,
  total: 0
};

const startScraping = async (req, res) => {
  try {
    if (scrapingStatus.isRunning) {
      return res.status(400).json({ error: 'Scraping is already running' });
    }

    scrapingStatus.isRunning = true;
    res.json({ message: 'Scraping started' });

    scrapeService.startScraping()
      .then(() => {
        scrapingStatus.isRunning = false;
        scrapingStatus.currentCompany = null;
        scrapingStatus.progress = 0;
        scrapingStatus.total = 0;
      })
      .catch((error) => {
        scrapingStatus.isRunning = false;
        console.error('Scraping error:', error);
      });
  } catch (error) {
    scrapingStatus.isRunning = false;
    res.status(500).json({ error: error.message });
  }
};

const getStatus = (req, res) => {
  res.json(scrapingStatus);
};

module.exports = {
  startScraping,
  getStatus
};

