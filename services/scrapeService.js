const hubspotService = require('./hubspotService');
const clickupService = require('./clickupService');
const linkedinService = require('./linkedinService');

// Configuration from environment variables
const SEARCH_DELAY_MS = parseInt(process.env.SEARCH_DELAY_MS || '2000');
const MAX_COMPANIES_PER_RUN = parseInt(process.env.MAX_COMPANIES_PER_RUN || '50');

// Función helper para delay configurable
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const filterResults = (results, companyName, jobTitle) => {
  console.log(`\n  🔍 Filtering ${results.length} results for: "${jobTitle}" at "${companyName}"`);
  console.log(`  🇲🇽 Location filter: Only profiles from Mexico will be accepted`);
  
  const filtered = results.filter(person => {
    // Si no tiene URL, descartar
    if (!person.profileUrl) {
      console.log(`    ❌ Skipped (no URL): ${person.name}`);
      return false;
    }
    
    // 🔒 FILTRO DE UBICACIÓN: Solo perfiles de México
    // Simplificado: solo verificar keywords básicas (la extracción ya busca estas)
    const isFromMexico = (location) => {
      if (!location || location.trim().length === 0) {
        // Si no hay ubicación, rechazar (ser estricto)
        return false;
      }
      
      const locationLower = location.toLowerCase();
      
      // Keywords básicas de México (las mismas que busca la extracción)
      const mexicoKeywords = ['méxico', 'mexico', 'mex', 'cdmx', 'ciudad de méxico', 'ciudad de mexico'];
      
      // Verificar si contiene alguna keyword de México
      return mexicoKeywords.some(keyword => locationLower.includes(keyword));
    };
    
    if (!isFromMexico(person.location)) {
      console.log(`    ❌ Not from Mexico: ${person.name} - Location: "${person.location || 'N/A'}"`);
      return false;
    }
    
    // Verificar empresa primero (más importante)
    const normalizeCompany = (name) => {
      return name
        .toLowerCase()
        .replace(/[^\w\sáéíóúñü]/g, ' ') // Remover caracteres especiales
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    const normalizedSearchCompany = normalizeCompany(companyName);
    const normalizedPersonCompany = person.company ? normalizeCompany(person.company) : '';
    
    // Verificar si la empresa coincide
    let companyMatch = false;
    if (normalizedPersonCompany) {
      // Coincidencia exacta o parcial (la empresa de la persona contiene la buscada o viceversa)
      companyMatch = normalizedPersonCompany.includes(normalizedSearchCompany) || 
                     normalizedSearchCompany.includes(normalizedPersonCompany);
      
      if (!companyMatch) {
        // Intentar match por palabras clave de la empresa
        const companyWords = normalizedSearchCompany.split(/\s+/).filter(w => w.length > 2);
        const matchingCompanyWords = companyWords.filter(word => normalizedPersonCompany.includes(word));
        // Si coinciden al menos 50% de las palabras de la empresa
        companyMatch = matchingCompanyWords.length >= Math.ceil(companyWords.length * 0.5);
      }
    } else {
      // Si no tenemos empresa extraída, confiar en que LinkedIn filtró correctamente
      // Pero ser más estricto con el título
      companyMatch = true; // Asumir que LinkedIn ya filtró por empresa
    }
    
    if (!companyMatch) {
      console.log(`    ❌ Company mismatch: ${person.name} - works at "${person.company}" (searching for "${companyName}")`);
      return false;
    }
    
    // Si no tiene título, pero pasó el filtro de empresa y ubicación, aceptar
    if (!person.title) {
      console.log(`    ⚠️  No title but company matches: ${person.name} - ${person.company} [${person.location || 'N/A'}]`);
      return true;
    }
    
    const personTitle = person.title.toLowerCase();
    const searchJobTitle = jobTitle.toLowerCase();
    
    // Normalizar títulos: remover caracteres especiales y normalizar espacios
    const normalizeTitle = (title) => {
      return title
        .toLowerCase()
        .replace(/\|/g, ' ') // Reemplazar | con espacio
        .replace(/[^\w\sáéíóúñü]/g, ' ') // Remover caracteres especiales pero mantener acentos
        .replace(/\s+/g, ' ') // Normalizar espacios
        .trim();
    };
    
    const normalizedPersonTitle = normalizeTitle(personTitle);
    const normalizedSearchTitle = normalizeTitle(searchJobTitle);
    
    // Extraer palabras clave del cargo (ignorar artículos y palabras muy cortas)
    const stopWords = ['de', 'del', 'la', 'el', 'en', 'y', 'o', 'a', 'al', 'los', 'las', 'un', 'una', 'con', 'por', 'para'];
    const jobTitleWords = normalizedSearchTitle
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));
    
    // Verificar coincidencia con el cargo
    let titleMatch = false;
    let matchReason = '';
    
    if (jobTitleWords.length > 0) {
      // Contar cuántas palabras clave coinciden
      const matchingWords = jobTitleWords.filter(word => {
        // Buscar palabra completa o como parte de otra palabra relevante
        return normalizedPersonTitle.includes(word) || 
               normalizedPersonTitle.split(' ').some(t => 
                 t.startsWith(word) || 
                 word.startsWith(t) ||
                 (t.length > 3 && word.length > 3 && (t.includes(word) || word.includes(t)))
               );
      });
      
      // Si coincide al menos el 50% de las palabras clave importantes (mínimo 1)
      const matchRatio = matchingWords.length / jobTitleWords.length;
      const minMatches = Math.max(1, Math.ceil(jobTitleWords.length * 0.5));
      
      if (matchingWords.length >= minMatches) {
        titleMatch = true;
        matchReason = `${matchingWords.length}/${jobTitleWords.length} keywords match`;
      } else if (normalizedPersonTitle.includes(normalizedSearchTitle)) {
        titleMatch = true;
        matchReason = 'exact phrase match';
      } else if (normalizedSearchTitle.includes(normalizedPersonTitle.split('|')[0].trim())) {
        titleMatch = true;
        matchReason = 'reverse match';
      }
      
      // Logging detallado
      if (titleMatch) {
        console.log(`    ✅ Match (${matchReason}): ${person.name} - "${person.title}" at ${person.company || 'N/A'} [${person.location || 'N/A'}]`);
      } else {
        console.log(`    ❌ No title match: ${person.name} - "${person.title}" (keywords: ${matchingWords.join(', ')} vs ${jobTitleWords.join(', ')})`);
      }
    } else {
      // Si el título de búsqueda es muy corto, hacer match exacto o parcial
      titleMatch = normalizedPersonTitle.includes(normalizedSearchTitle) || 
                  normalizedSearchTitle.includes(normalizedPersonTitle);
      
      if (titleMatch) {
        console.log(`    ✅ Match (partial): ${person.name} - "${person.title}" at ${person.company || 'N/A'} [${person.location || 'N/A'}]`);
      } else {
        console.log(`    ❌ No title match: ${person.name} - "${person.title}"`);
      }
    }
    
    return titleMatch;
  });
  
  console.log(`  📊 Filtered: ${filtered.length}/${results.length} results match\n`);
  return filtered;
};

const startScraping = async () => {
  try {
    console.log('🚀 Starting scraping process with Apify...');

    const companies = await hubspotService.getCompaniesFromSegment();
    const jobTitles = await clickupService.getJobTitles();
    
    console.log(`Found ${companies.length} companies and ${jobTitles.length} job titles`);
    
    let companiesToScrape = companies.filter(company =>
      hubspotService.shouldScrapeCompany(company.lastLinkedinScrape)
    );

    // Aplicar límite máximo de compañías por ejecución
    if (companiesToScrape.length > MAX_COMPANIES_PER_RUN) {
      console.log(`Limiting to ${MAX_COMPANIES_PER_RUN} companies per run (out of ${companiesToScrape.length} available)`);
      companiesToScrape = companiesToScrape.slice(0, MAX_COMPANIES_PER_RUN);
    }

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
              // Guardar en HubSpot como deal
              const hubspotResult = await hubspotService.createDealForPerson(person, company.company, jobTitle.title);
              if (hubspotResult && hubspotResult.duplicate) {
                console.log(`    ⊙ Already exists in HubSpot: ${person.name}${person.title ? ` - ${person.title}` : ''}`);
              } else if (hubspotResult) {
                console.log(`    ✓ Saved to HubSpot: ${person.name}${person.title ? ` - ${person.title}` : ''}`);
              } else {
                console.warn(`    ⚠️  Failed to save to HubSpot: ${person.name}`);
              }
            } catch (saveError) {
              console.error(`    ✗ Error saving ${person.name} to HubSpot:`, saveError.message);
            }
            
            // Delay entre guardar cada persona (configurable)
            await delay(1000);
          }
          
          // Delay configurable entre búsquedas
          console.log(`  ⏳ Waiting ${SEARCH_DELAY_MS}ms before next search...`);
          await delay(SEARCH_DELAY_MS);
        } catch (error) {
          console.error(`  Error searching for ${jobTitle.title}:`, error.message);
          // Delay incluso si hay error
          console.log(`  ⏳ Waiting ${SEARCH_DELAY_MS}ms after error before continuing...`);
          await delay(SEARCH_DELAY_MS);
        }
      }
      
      try {
        const now = new Date().toISOString();
        await hubspotService.updateLastScrape(company.id, now);
        console.log(`Updated last scrape date for ${company.company}`);
      } catch (updateError) {
        console.warn(`Could not update last scrape date for ${company.company}: ${updateError.message}`);
      }
      
      // Delay entre empresas (configurable)
      const delayBetweenCompanies = SEARCH_DELAY_MS * 2; // Doble delay entre empresas
      console.log(`⏳ Waiting ${delayBetweenCompanies}ms before next company...`);
      await delay(delayBetweenCompanies);
    }
    
    console.log('Scraping process completed');
    
    // Scraping completado exitosamente (Apify no requiere cerrar navegador)
    
    return { success: true };
  } catch (error) {
    console.error('Scraping error:', error);
    
    // Error en scraping (Apify no requiere cerrar navegador)
    
    throw error;
  }
};

module.exports = {
  startScraping,
  filterResults
};

