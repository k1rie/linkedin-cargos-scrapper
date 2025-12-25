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
  console.log('');
  console.log('📝 To start scraping:');
  console.log('   1. Open http://localhost:8080 in your browser');
  console.log('   2. Upload your LinkedIn cookies');
  console.log('   3. The scraping will start automatically');
  console.log('');
  
  // Verificar si ya hay cookies guardadas
  const scrapeService = require('./services/scrapeService');
  const linkedinService = require('./services/linkedinService');
  
  linkedinService.checkSession()
    .then((isLoggedIn) => {
      if (isLoggedIn) {
        console.log('✅ Valid LinkedIn session found!');
        console.log('Starting automatic scraping...');
        
        scrapeService.startScraping()
          .then((result) => {
            if (result && result.requiresCookies) {
              console.log('⚠️  Cookies expired. Please upload new cookies.');
              return;
            }
            
            if (result && result.success) {
              console.log('✓ Initial scraping completed successfully');
            }
          })
          .catch((error) => {
            console.error('Initial scraping error:', error.message);
            console.log('⚠️  Server will continue running');
          });
      } else {
        console.log('⚠️  No valid LinkedIn session found');
        console.log('📝 Please upload your cookies via http://localhost:8080');
      }
    })
    .catch((error) => {
      console.error('Session check error:', error.message);
    });
});

