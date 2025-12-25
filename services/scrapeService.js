const hubspotService = require('./hubspotService');
const clickupService = require('./clickupService');
const linkedinService = require('./linkedinService');

const filterResults = (results, companyName, jobTitle) => {
  return results.filter(person => {
    if (!person.title || !person.profileUrl) {
      return false;
    }
    
    const personTitle = person.title.toLowerCase();
    const searchJobTitle = jobTitle.toLowerCase();
    
    // Extraer palabras clave del cargo (ignorar artículos y palabras muy cortas)
    const stopWords = ['de', 'del', 'la', 'el', 'en', 'y', 'o', 'a', 'al', 'los', 'las', 'un', 'una'];
    const jobTitleWords = searchJobTitle
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));
    
    // Verificar coincidencia con el cargo
    // LinkedIn ya filtra por empresa, solo necesitamos verificar el cargo
    let titleMatch = false;
    if (jobTitleWords.length > 0) {
      const matchingWords = jobTitleWords.filter(word => personTitle.includes(word));
      // Si hay al menos 1 palabra clave del cargo (más flexible)
      titleMatch = matchingWords.length >= 1 || 
                  personTitle.includes(searchJobTitle) ||
                  searchJobTitle.includes(personTitle.split('|')[0].trim().toLowerCase());
    } else {
      titleMatch = personTitle.includes(searchJobTitle) || searchJobTitle.includes(personTitle);
    }
    
    return titleMatch;
  });
};

const startScraping = async () => {
  try {
    console.log('Starting scraping process...');
    
    await linkedinService.ensureLoggedIn();

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
          const results = await linkedinService.searchPeople(company.company, jobTitle.title);
          
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
            
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`  Error searching for ${jobTitle.title}:`, error.message);
        }
      }
      
      try {
        const now = new Date().toISOString();
        await hubspotService.updateLastScrape(company.id, now);
        console.log(`Updated last scrape date for ${company.company}`);
      } catch (updateError) {
        console.warn(`Could not update last scrape date for ${company.company}: ${updateError.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    console.log('Scraping process completed');
  } catch (error) {
    console.error('Scraping error:', error);
    throw error;
  }
};

module.exports = {
  startScraping,
  filterResults
};

