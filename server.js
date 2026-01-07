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
  
  // Verificar configuración de Apify
  const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;

  if (!APIFY_API_TOKEN || APIFY_API_TOKEN.trim().length < 10) {
    console.log('⚠️  Apify API token not configured');
    console.log('📝 Please set APIFY_API_TOKEN in .env');
    console.log('');
    console.log('📝 How to get your Apify API token:');
    console.log('   1. Go to https://console.apify.com/account/integrations');
    console.log('   2. Copy your API token');
    console.log('   3. Add it to .env as: APIFY_API_TOKEN=your-token-here');
    console.log('');
    console.log('💡 Tip: Run "npm run setup" for complete setup instructions');
    return;
  }

  console.log('✅ Apify API token found');
  console.log('Starting automatic scraping...');
  console.log('');
  
  // Iniciar scraping automáticamente
  const scrapeService = require('./services/scrapeService');
  
  scrapeService.startScraping()
    .then((result) => {
      if (result && result.requiresVerification) {
        console.log('⚠️  Verification required!');
        console.log('📝 Please use http://localhost:8080 to enter the verification code');
        return;
      }
      
      if (result && result.success) {
        console.log('✓ Initial scraping completed successfully');
      }
    })
    .catch((error) => {
      if (error.message === 'VERIFICATION_REQUIRED' || error.message.includes('verification')) {
        console.log('⚠️  Verification required!');
        console.log('📝 Please use http://localhost:8080 to enter the verification code');
      } else {
        console.error('Initial scraping error:', error.message);
        console.log('⚠️  Server will continue running');
      }
    });
});

