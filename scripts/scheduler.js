require('dotenv').config();
const cron = require('node-cron');
const hubspotService = require('../services/hubspotService');
const clickupService = require('../services/clickupService');
const linkedinService = require('../services/linkedinService');
const scrapeService = require('../services/scrapeService');

let isRunning = false;

const checkAndScrapeCompanies = async () => {
  if (isRunning) {
    console.log('[Scheduler] Scraping already in progress, skipping this run...');
    return;
  }

  try {
    isRunning = true;
    console.log(`[Scheduler] ${new Date().toISOString()} - Starting hourly check...`);
    
    // Verificar sesión de LinkedIn
    await linkedinService.ensureLoggedIn();
    
    // Obtener empresas del segmento
    const companies = await hubspotService.getCompaniesFromSegment();
    console.log(`[Scheduler] Found ${companies.length} companies in segment`);
    
    // Filtrar empresas que necesitan scraping (han pasado 3 meses o nunca se han scrapeado)
    const companiesToScrape = companies.filter(company => 
      hubspotService.shouldScrapeCompany(company.lastLinkedinScrape)
    );
    
    if (companiesToScrape.length === 0) {
      console.log('[Scheduler] No companies need scraping at this time');
      return;
    }
    
    console.log(`[Scheduler] Found ${companiesToScrape.length} companies that need scraping`);
    
    // Obtener cargos de ClickUp
    const jobTitles = await clickupService.getJobTitles();
    console.log(`[Scheduler] Found ${jobTitles.length} job titles to search`);
    
    // Scrapear cada empresa
    for (const company of companiesToScrape) {
      try {
        console.log(`[Scheduler] Scraping company: ${company.company}`);
        
        for (const jobTitle of jobTitles) {
          try {
            console.log(`  [Scheduler] Searching for: ${jobTitle.title} at ${company.company}`);
            const results = await linkedinService.searchPeople(company.company, jobTitle.title);
            
            console.log(`  [Scheduler] Found ${results.length} results`);
            
            const { filterResults } = require('../services/scrapeService');
            const filteredResults = filterResults(results, company.company, jobTitle.title);
            console.log(`  [Scheduler] Filtered to ${filteredResults.length} matching results`);
            
            for (const person of filteredResults) {
              try {
                const exists = await clickupService.checkPersonExists(person.profileUrl, jobTitle.id);
                
                if (!exists) {
                  await clickupService.createPersonTask(person, jobTitle.id, company.company, jobTitle.title);
                  console.log(`    [Scheduler] ✓ Saved: ${person.name} - ${person.title}`);
                } else {
                  console.log(`    [Scheduler] ⊙ Already exists: ${person.name}`);
                }
              } catch (saveError) {
                console.error(`    [Scheduler] ✗ Error saving ${person.name}:`, saveError.message);
              }
              
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            console.error(`  [Scheduler] Error searching for ${jobTitle.title}:`, error.message);
          }
        }
        
        // Actualizar fecha de último scrape
        try {
          const now = new Date().toISOString().split('T')[0];
          await hubspotService.updateLastScrape(company.id, now);
          console.log(`[Scheduler] Updated last scrape date for ${company.company}`);
        } catch (updateError) {
          console.warn(`[Scheduler] Could not update last scrape date for ${company.company}: ${updateError.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        console.error(`[Scheduler] Error scraping company ${company.company}:`, error.message);
      }
    }
    
    console.log(`[Scheduler] ${new Date().toISOString()} - Hourly check completed`);
  } catch (error) {
    console.error('[Scheduler] Error in hourly check:', error);
  } finally {
    isRunning = false;
  }
};

// Ejecutar inmediatamente al iniciar
console.log('[Scheduler] Starting scheduler...');
console.log('[Scheduler] Will check for companies every hour');
checkAndScrapeCompanies();

// Programar ejecución cada hora
// Cron: '0 * * * *' = cada hora en el minuto 0
cron.schedule('0 * * * *', () => {
  checkAndScrapeCompanies();
});

console.log('[Scheduler] Scheduler started. Checking every hour at minute 0');
console.log('[Scheduler] Press Ctrl+C to stop');

// Manejar cierre graceful
process.on('SIGINT', () => {
  console.log('\n[Scheduler] Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Scheduler] Shutting down gracefully...');
  process.exit(0);
});

