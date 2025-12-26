const hubspotService = require('./hubspotService');
const clickupService = require('./clickupService');
const linkedinService = require('./linkedinService');

// ⚠️ Delays para evitar detección
const DELAYS = linkedinService.DELAYS || {
  minDelay: 3000,
  maxDelay: 8000
};

// Función helper para delay aleatorio entre búsquedas
const randomDelay = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const filterResults = (results, companyName, jobTitle) => {
  return results.filter(person => {
    if (!person.title || !person.profileUrl) {
      return false;
    }
    
    const personTitle = person.title.toLowerCase();
    const searchJobTitle = jobTitle.toLowerCase();
    
    // Normalizar títulos: remover caracteres especiales y normalizar espacios
    const normalizeTitle = (title) => {
      return title
        .toLowerCase()
        .replace(/\|/g, ' ') // Reemplazar | con espacio
        .replace(/[^\w\s]/g, ' ') // Remover caracteres especiales
        .replace(/\s+/g, ' ') // Normalizar espacios
        .trim();
    };
    
    const normalizedPersonTitle = normalizeTitle(personTitle);
    const normalizedSearchTitle = normalizeTitle(searchJobTitle);
    
    // Extraer palabras clave del cargo (ignorar artículos y palabras muy cortas)
    const stopWords = ['de', 'del', 'la', 'el', 'en', 'y', 'o', 'a', 'al', 'los', 'las', 'un', 'una', 'el', 'en', 'con', 'por', 'para'];
    const jobTitleWords = normalizedSearchTitle
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));
    
    // Verificar coincidencia con el cargo
    // LinkedIn ya filtra por empresa, solo necesitamos verificar el cargo
    let titleMatch = false;
    
    if (jobTitleWords.length > 0) {
      // Contar cuántas palabras clave coinciden
      const matchingWords = jobTitleWords.filter(word => {
        // Buscar palabra completa o como parte de otra palabra relevante
        return normalizedPersonTitle.includes(word) || 
               normalizedPersonTitle.split(' ').some(t => t.startsWith(word) || word.startsWith(t));
      });
      
      // Si coincide al menos el 50% de las palabras clave importantes (mínimo 1)
      const matchRatio = matchingWords.length / jobTitleWords.length;
      const minMatches = Math.max(1, Math.ceil(jobTitleWords.length * 0.5));
      
      titleMatch = matchingWords.length >= minMatches || 
                  matchRatio >= 0.5 ||
                  normalizedPersonTitle.includes(normalizedSearchTitle) ||
                  normalizedSearchTitle.includes(normalizedPersonTitle.split('|')[0].trim());
    } else {
      // Si el título de búsqueda es muy corto, hacer match exacto o parcial
      titleMatch = normalizedPersonTitle.includes(normalizedSearchTitle) || 
                  normalizedSearchTitle.includes(normalizedPersonTitle);
    }
    
    return titleMatch;
  });
};

const startScraping = async () => {
  try {
    console.log('Starting scraping process...');
    
    const loginStatus = await linkedinService.ensureLoggedIn();
    
    if (typeof loginStatus === 'object' && !loginStatus.loggedIn) {
      throw new Error(loginStatus.error || 'Login failed');
    }

    const companies = await hubspotService.getCompaniesFromSegment();
    const jobTitles = await clickupService.getJobTitles();
    
    console.log(`Found ${companies.length} companies and ${jobTitles.length} job titles`);
    
    const companiesToScrape = companies.filter(company => 
      hubspotService.shouldScrapeCompany(company.lastLinkedinScrape)
    );
    
    console.log(`Companies to scrape: ${companiesToScrape.length}`);
    
    for (const company of companiesToScrape) {
      console.log(`Scraping company: ${company.company}`);
      
      for (const jobTitle of jobTitles) {
        try {
          console.log(`  Searching for: ${jobTitle.title} at ${company.company}`);
          
          let results;
          let dailyLimitReached = false;
          try {
            results = await linkedinService.searchPeople(company.company, jobTitle.title);
          } catch (searchError) {
            // Check for daily limit reached
            if (searchError.message && (searchError.message.includes('Daily limit reached') || 
                searchError.message.includes('Daily view limit reached'))) {
              console.error('\n⚠️  Daily limit reached!');
              console.error(`   ${searchError.message}`);
              console.error('🛑 Stopping scraping process...');
              console.error('💡 The scraping will resume tomorrow or increase DAILY_VIEW_LIMIT in .env\n');
              
              dailyLimitReached = true;
              results = []; // Empty results to continue gracefully
            }
            
            if (searchError.message === 'VERIFICATION_REQUIRED') {
              console.error('⚠️  Verification required!');
              console.error('📝 Please use the frontend to enter the verification code');
              console.error('⚠️  Scraping paused until verification is complete');
              
              return {
                success: false,
                requiresVerification: true,
                message: 'LinkedIn requires verification code. Please use the frontend to enter it.'
              };
            }
            if (searchError.message && (searchError.message.includes('CAPTCHA') || searchError.message.includes('CAPTCHA_REQUIRED'))) {
              console.error('⚠️  CAPTCHA detected!');
              console.error('📝 Options:');
              console.error('   1. Add CAPTCHA_API_KEY to .env (get it from https://2captcha.com)');
              console.error('   2. Or run in non-headless mode to solve manually');
              console.error('⚠️  Scraping paused');
              
              return {
                success: false,
                requiresCaptcha: true,
                message: 'CAPTCHA detected. Please configure CAPTCHA_API_KEY or solve manually.'
              };
            }
            if (!dailyLimitReached) {
              throw searchError;
            }
          }
          
          // Stop if daily limit reached
          if (dailyLimitReached) {
            await linkedinService.closeSharedBrowser();
            return {
              success: false,
              dailyLimitReached: true,
              message: 'Daily view limit reached. Scraping stopped.'
            };
          }
          
          console.log(`  Found ${results.length} results`);
          
          const filteredResults = filterResults(results, company.company, jobTitle.title);
          console.log(`  Filtered to ${filteredResults.length} matching results`);
          
          for (const person of filteredResults) {
            try {
              const exists = await clickupService.checkPersonExists(person.profileUrl, jobTitle.id);
              
              if (!exists) {
                await clickupService.createPersonTask(person, jobTitle.id, company.company, jobTitle.title);
                console.log(`    ✓ Saved: ${person.name} - ${person.title}`);
              } else {
                console.log(`    ⊙ Already exists: ${person.name}`);
              }
            } catch (saveError) {
              console.error(`    ✗ Error saving ${person.name}:`, saveError.message);
            }
            
            // Delay entre guardar cada persona (1 segundo)
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          // ⚠️ Delay aleatorio entre búsquedas (minDelay - maxDelay)
          const delayBetweenSearches = randomDelay(DELAYS.minDelay, DELAYS.maxDelay);
          console.log(`  ⏳ Waiting ${delayBetweenSearches}ms before next search...`);
          await new Promise(resolve => setTimeout(resolve, delayBetweenSearches));
        } catch (error) {
          console.error(`  Error searching for ${jobTitle.title}:`, error.message);
          // Delay incluso si hay error
          const delayOnError = randomDelay(DELAYS.minDelay, DELAYS.maxDelay);
          await new Promise(resolve => setTimeout(resolve, delayOnError));
        }
      }
      
      try {
        const now = new Date().toISOString();
        await hubspotService.updateLastScrape(company.id, now);
        console.log(`Updated last scrape date for ${company.company}`);
      } catch (updateError) {
        console.warn(`Could not update last scrape date for ${company.company}: ${updateError.message}`);
      }
      
      // ⚠️ Delay aleatorio entre empresas (más largo)
      const delayBetweenCompanies = randomDelay(DELAYS.minDelay * 2, DELAYS.maxDelay * 2);
      console.log(`⏳ Waiting ${delayBetweenCompanies}ms before next company...`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenCompanies));
    }
    
    console.log('Scraping process completed');
    
    // Cerrar el navegador compartido al finalizar
    console.log('🔒 Closing browser session...');
    await linkedinService.closeSharedBrowser();
    
    return { success: true };
  } catch (error) {
    console.error('Scraping error:', error);
    
    // Cerrar el navegador en caso de error
    try {
      await linkedinService.closeSharedBrowser();
    } catch (e) {
      // Ignorar errores al cerrar
    }
    
    throw error;
  }
};

module.exports = {
  startScraping,
  filterResults
};

