require('dotenv').config();
const express = require('express');
const app = express();

// CORS para permitir peticiones desde el frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint para Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'LinkedIn Scraper API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      scrape: '/api/scrape',
      companies: '/api/companies'
    }
  });
});

const authRoutes = require('./routes/auth');
const scrapeRoutes = require('./routes/scrape');
const companiesRoutes = require('./routes/companies');

app.use('/api/auth', authRoutes);
app.use('/api/scrape', scrapeRoutes);
app.use('/api/companies', companiesRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Iniciar scraping automáticamente al arrancar el servidor
  const scrapeService = require('./services/scrapeService');
  
  console.log('Starting automatic scraping...');
  scrapeService.startScraping()
    .then(() => {
      console.log('Initial scraping completed');
    })
    .catch((error) => {
      console.error('Initial scraping error:', error);
    });
});

