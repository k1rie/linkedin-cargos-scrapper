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
  
  // Verificar cookie
  const LINKEDIN_LI_AT = process.env.LINKEDIN_LI_AT;
  
  if (!LINKEDIN_LI_AT || LINKEDIN_LI_AT.trim().length < 10) {
    console.log('⚠️  LinkedIn cookie not configured');
    console.log('📝 Please set LINKEDIN_LI_AT in .env');
    console.log('');
    console.log('📝 How to extract li_at cookie:');
    console.log('   1. Open LinkedIn in your browser and log in');
    console.log('   2. Open DevTools (F12 or Cmd+Option+I)');
    console.log('   3. Go to Application > Cookies > https://www.linkedin.com');
    console.log('   4. Find the "li_at" cookie');
    console.log('   5. Copy the "Value" field');
    console.log('   6. Add it to .env as: LINKEDIN_LI_AT=your-cookie-value');
    return;
  }
  
  console.log('✅ LinkedIn cookie found');
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

