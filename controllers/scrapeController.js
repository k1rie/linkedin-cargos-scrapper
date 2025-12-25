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
    
    // Iniciar scraping en background
    scrapeService.startScraping()
      .then((result) => {
        // Verificar si el resultado indica que se requiere verificación
        if (result && result.requiresVerification) {
          scrapingStatus.isRunning = false;
          scrapingStatus.requiresVerification = true;
          scrapingStatus.verificationType = result.verificationType;
          scrapingStatus.verificationMessage = result.verificationMessage;
          console.log('⚠️  Scraping paused - verification required');
          return;
        }
        
        scrapingStatus.isRunning = false;
        scrapingStatus.currentCompany = null;
        scrapingStatus.progress = 0;
        scrapingStatus.total = 0;
        scrapingStatus.requiresVerification = false;
      })
      .catch((error) => {
        scrapingStatus.isRunning = false;
        console.error('Scraping error:', error);
        scrapingStatus.error = error.message;
      });
    
    // Responder inmediatamente
    res.json({ message: 'Scraping started' });
  } catch (error) {
    scrapingStatus.isRunning = false;
    
    // Si requiere verificación, retornar información específica
    if (error.message && error.message.includes('Verification required')) {
      return res.status(200).json({ 
        requiresVerification: true,
        message: error.message,
        error: 'Verification required to continue scraping'
      });
    }
    
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

