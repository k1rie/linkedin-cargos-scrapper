require('dotenv').config();

// Import services
const loggerService = require('./loggerService');
const apifyService = require('./apifyService');

const searchPeople = async (companyName, jobTitle) => {
  try {
    loggerService.info('🔍 Searching with Apify', { companyName, jobTitle });

    const apifyResults = await apifyService.searchPeopleWithApify(companyName, jobTitle);

    // Convert Apify results to the format expected by the rest of the system
    const convertedResults = apifyResults.map(profile => ({
      name: profile.name,
      title: profile.title,
      company: profile.company,
      location: profile.location,
      profileUrl: profile.profileUrl
    }));

    loggerService.info(`✅ Apify search completed: ${convertedResults.length} results found`, {
      companyName,
      jobTitle,
      resultsCount: convertedResults.length
    });

    return convertedResults;

  } catch (error) {
    loggerService.error('❌ Error searching with Apify', {
      error: error.message,
      companyName,
      jobTitle,
      stack: error.stack
    });

    // Re-throw error to be handled by the caller
    throw new Error(`Apify search failed: ${error.message}`);
  }
};

module.exports = {
  searchPeople
};
