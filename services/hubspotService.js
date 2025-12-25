const axios = require('axios');

const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const HUBSPOT_SEGMENT_ID = process.env.HUBSPOT_SEGMENT_ID || 2825;
const HUBSPOT_BASE_URL = 'https://api.hubapi.com';

const getCompaniesFromSegment = async () => {
  try {
    let allCompanies = [];
    let after = null;
    let hasMore = true;
    
    while (hasMore) {
      const requestBody = {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'hs_is_target_account',
                operator: 'EQ',
                value: 'true'
              }
            ]
          }
        ],
        properties: ['name', 'last_linkedin_scrape'],
        limit: 100
      };
      
      if (after) {
        requestBody.after = after;
      }
      
      const response = await axios.post(
        `${HUBSPOT_BASE_URL}/crm/v3/objects/companies/search`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const companies = response.data.results || [];
      allCompanies = allCompanies.concat(companies);
      
      after = response.data.paging?.next?.after;
      hasMore = !!after && companies.length > 0;
    }
    
    return allCompanies.map(company => ({
      id: company.id,
      name: company.properties?.name || '',
      company: company.properties?.name || '',
      lastLinkedinScrape: company.properties?.last_linkedin_scrape || null
    }));
  } catch (error) {
    console.error('=== HubSpot Get Companies Error ===');
    console.error('Status:', error.response?.status);
    console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Error Message:', error.message);
    console.error('===================================');
    throw new Error(`Failed to fetch companies from segment: ${error.message}`);
  }
};

const getCompanyById = async (companyId) => {
  try {
    const response = await axios.get(
      `${HUBSPOT_BASE_URL}/crm/v3/objects/companies/${companyId}`,
      {
        headers: {
          'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
          'Content-Type': 'application/json'
        },
        params: {
          properties: 'name,company,last_linkedin_scrape'
        }
      }
    );

    return {
      id: response.data.id,
      name: response.data.properties.name || response.data.properties.company || '',
      company: response.data.properties.name || response.data.properties.company || '',
      lastLinkedinScrape: response.data.properties.last_linkedin_scrape || null
    };
  } catch (error) {
    console.error('=== HubSpot Get Company Error ===');
    console.error('Status:', error.response?.status);
    console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Error Message:', error.message);
    console.error('=================================');
    throw new Error(`Failed to fetch company: ${error.message}`);
  }
};

const createPropertyIfNotExists = async () => {
  try {
    const response = await axios.get(
      `${HUBSPOT_BASE_URL}/crm/v3/properties/companies/last_linkedin_scrape`,
      {
        headers: {
          'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return true;
  } catch (error) {
    if (error.response?.status === 404) {
      try {
        await axios.post(
          `${HUBSPOT_BASE_URL}/crm/v3/properties/companies`,
          {
            name: 'last_linkedin_scrape',
            label: 'Last LinkedIn Scrape',
            type: 'date',
            fieldType: 'date',
            groupName: 'companyinformation'
          },
          {
            headers: {
              'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log('Created property last_linkedin_scrape in HubSpot');
        return true;
      } catch (createError) {
        console.error('Failed to create property:', createError.response?.data || createError.message);
        return false;
      }
    }
    return false;
  }
};

const updateLastScrape = async (companyId, date) => {
  try {
    await createPropertyIfNotExists();
    
    // HubSpot requiere fechas en formato YYYY-MM-DD a medianoche UTC
    const now = date ? new Date(date) : new Date();
    const dateValue = now.toISOString().split('T')[0]; // Solo la fecha: YYYY-MM-DD
    
    const response = await axios.patch(
      `${HUBSPOT_BASE_URL}/crm/v3/objects/companies/${companyId}`,
      {
        properties: {
          last_linkedin_scrape: dateValue
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    if (error.response?.data?.errors?.some(e => e.code === 'PROPERTY_DOESNT_EXIST')) {
      console.warn(`Property last_linkedin_scrape does not exist for company ${companyId}. Skipping update.`);
      return { skipped: true, reason: 'Property does not exist' };
    }
    
    console.error('=== HubSpot Update Company Error ===');
    console.error('Status:', error.response?.status);
    console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Error Message:', error.message);
    console.error('====================================');
    throw new Error(`Failed to update company: ${error.message}`);
  }
};

const shouldScrapeCompany = (lastScrapeDate) => {
  if (!lastScrapeDate) {
    return true;
  }

  const lastScrape = new Date(lastScrapeDate);
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());

  return lastScrape < threeMonthsAgo;
};

module.exports = {
  getCompaniesFromSegment,
  getCompanyById,
  updateLastScrape,
  shouldScrapeCompany
};

