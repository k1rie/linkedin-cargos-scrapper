const axios = require('axios');

const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_API_KEY; // Compatibilidad
const HUBSPOT_SEGMENT_ID = process.env.HUBSPOT_SEGMENT_ID || 2825;
const HUBSPOT_BASE_URL = 'https://api.hubapi.com';
const HUBSPOT_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_ID || '811215668';
const HUBSPOT_DEAL_STAGE_ID = process.env.HUBSPOT_DEAL_STAGE_ID || null;

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

/**
 * Obtiene todos los pipelines y stages disponibles de HubSpot
 * @returns {Promise<Array>} Array de pipelines con sus stages
 */
const getPipelinesAndStages = async () => {
  try {
    const response = await axios.get(
      `${HUBSPOT_BASE_URL}/crm/v3/pipelines/deals`,
      {
        headers: {
          'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.results || [];
  } catch (error) {
    console.error('=== HubSpot Get Pipelines Error ===');
    console.error('Status:', error.response?.status);
    console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Error Message:', error.message);
    console.error('===================================');
    return [];
  }
};

/**
 * Obtiene el primer stage válido de un pipeline específico
 * @param {string} pipelineId - ID del pipeline (opcional, usa el primero disponible si no se especifica)
 * @returns {Promise<string|null>} ID del primer stage o null si no se encuentra
 */
const getValidStageId = async (pipelineId = null) => {
  try {
    const pipelines = await getPipelinesAndStages();
    
    if (!pipelines || pipelines.length === 0) {
      console.warn('No pipelines found in HubSpot');
      return null;
    }

    // Si no se especifica pipelineId, usar el primero disponible o el configurado
    let targetPipeline = null;
    if (pipelineId) {
      targetPipeline = pipelines.find(p => p.id === pipelineId);
    } else {
      // Usar el pipeline configurado o el primero disponible
      const configuredPipeline = pipelines.find(p => p.id === HUBSPOT_PIPELINE_ID);
      targetPipeline = configuredPipeline || pipelines[0];
    }

    if (!targetPipeline) {
      console.warn(`Pipeline ${pipelineId || HUBSPOT_PIPELINE_ID} not found`);
      return null;
    }

    // Obtener el primer stage del pipeline
    const stages = targetPipeline.stages || [];
    if (stages.length === 0) {
      console.warn(`No stages found in pipeline ${targetPipeline.id}`);
      return null;
    }

    // Retornar el ID del primer stage
    return stages[0].id || null;
  } catch (error) {
    console.error('Error getting valid stage ID:', error.message);
    return null;
  }
};

/**
 * Verifica si ya existe un deal con ese link del perfil/post
 * @param {string} profileUrl - URL del perfil o post de LinkedIn
 * @returns {Promise<boolean>} true si existe un deal duplicado
 */
const checkDuplicateDeal = async (profileUrl) => {
  try {
    if (!profileUrl || profileUrl.trim().length === 0) {
      return false;
    }

    const response = await axios.post(
      `${HUBSPOT_BASE_URL}/crm/v3/objects/deals/search`,
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'description',
                operator: 'CONTAINS_TOKEN',
                value: profileUrl
              }
            ]
          }
        ],
        limit: 1
      },
      {
        headers: {
          'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const results = response.data.results || [];
    return results.length > 0;
  } catch (error) {
    // Si hay error, asumir que no es duplicado para no bloquear la creación
    console.warn('Error checking duplicate deal:', error.message);
    return false;
  }
};

/**
 * Crea un deal en HubSpot para un perfil encontrado
 * @param {Object} personData - Datos del perfil {name, title, company, location, profileUrl}
 * @param {string} searchCompany - Nombre de la empresa buscada
 * @param {string} searchJobTitle - Cargo buscado
 * @returns {Promise<Object|null>} Deal creado o null si hay error, o {duplicate: true} si es duplicado
 */
const createDealForPerson = async (personData, searchCompany, searchJobTitle) => {
  try {
    // Verificar duplicados primero
    const isDuplicate = await checkDuplicateDeal(personData.profileUrl);
    if (isDuplicate) {
      console.log(`⚠️  Duplicate deal found for profile: ${personData.profileUrl}`);
      return { duplicate: true };
    }

    // Obtener stage ID
    let dealStageId = HUBSPOT_DEAL_STAGE_ID;
    
    // Validar que el stage ID sea numérico si está configurado
    if (dealStageId && !/^\d+$/.test(dealStageId)) {
      console.warn(`Invalid HUBSPOT_DEAL_STAGE_ID format: ${dealStageId}, using first stage of pipeline`);
      dealStageId = null;
    }

    // Si no hay stage configurado, obtener el primero del pipeline
    if (!dealStageId) {
      dealStageId = await getValidStageId(HUBSPOT_PIPELINE_ID);
      if (!dealStageId) {
        console.error('Could not get valid stage ID');
        return null;
      }
    }

    // Validar pipeline ID
    const pipelineId = /^\d+$/.test(HUBSPOT_PIPELINE_ID) ? HUBSPOT_PIPELINE_ID : '811215668';

    // Construir descripción
    const description = `Perfil de LinkedIn encontrado por búsqueda\n\n` +
      `Cargo buscado: ${searchJobTitle}\n` +
      `Empresa buscada: ${searchCompany}\n\n` +
      `Información del perfil:\n` +
      `- Nombre: ${personData.name || 'N/A'}\n` +
      `- Cargo: ${personData.title || 'N/A'}\n` +
      `- Empresa actual: ${personData.company || 'N/A'}\n` +
      `- Ubicación: ${personData.location || 'N/A'}\n` +
      `- URL del perfil: ${personData.profileUrl}\n\n` +
      `Fecha de extracción: ${new Date().toISOString()}\n`;

    // Construir nombre del deal
    const dealName = `${personData.name || 'LinkedIn Member'} - ${searchJobTitle} (${searchCompany})`;

    // Crear el deal
    const response = await axios.post(
      `${HUBSPOT_BASE_URL}/crm/v3/objects/deals`,
      {
        properties: {
          dealname: dealName,
          description: description,
          amount: '0',
          deal_currency_code: 'MXN',
          pipeline: pipelineId,
          dealstage: dealStageId
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ Deal created in HubSpot: ${dealName}`);
    return response.data;
  } catch (error) {
    console.error('=== HubSpot Create Deal Error ===');
    console.error('Status:', error.response?.status);
    console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Error Message:', error.message);
    console.error('================================');
    return null;
  }
};

/**
 * Crea un deal en HubSpot para un post de LinkedIn
 * @param {Object} postData - Datos del post {url, text, author, profileUrl, createdAt}
 * @param {string} keyword - Keyword usado para encontrar el post
 * @returns {Promise<Object|null>} Deal creado o null si hay error, o {duplicate: true} si es duplicado
 */
const createDealForPost = async (postData, keyword) => {
  try {
    // Verificar duplicados primero
    const isDuplicate = await checkDuplicateDeal(postData.url);
    if (isDuplicate) {
      console.log(`⚠️  Duplicate deal found for post: ${postData.url}`);
      return { duplicate: true };
    }

    // Obtener stage ID
    let dealStageId = HUBSPOT_DEAL_STAGE_ID;
    
    // Validar que el stage ID sea numérico si está configurado
    if (dealStageId && !/^\d+$/.test(dealStageId)) {
      console.warn(`Invalid HUBSPOT_DEAL_STAGE_ID format: ${dealStageId}, using first stage of pipeline`);
      dealStageId = null;
    }

    // Si no hay stage configurado, obtener el primero del pipeline
    if (!dealStageId) {
      dealStageId = await getValidStageId(HUBSPOT_PIPELINE_ID);
      if (!dealStageId) {
        console.error('Could not get valid stage ID');
        return null;
      }
    }

    // Validar pipeline ID
    const pipelineId = /^\d+$/.test(HUBSPOT_PIPELINE_ID) ? HUBSPOT_PIPELINE_ID : '811215668';

    // Limitar texto a 1000 caracteres
    const textPreview = postData.text && postData.text.length > 1000 
      ? postData.text.substring(0, 1000) + '...' 
      : (postData.text || 'N/A');

    // Construir descripción
    const description = `Post de LinkedIn encontrado por keyword: ${keyword}\n\n` +
      `Autor/Perfil: ${postData.author || 'N/A'}\n` +
      `URL del perfil: ${postData.profileUrl || 'N/A'}\n` +
      `URL del post: ${postData.url}\n\n` +
      `Contenido:\n${textPreview}\n\n` +
      `Fecha del post: ${postData.createdAt || new Date().toISOString()}\n`;

    // Construir nombre del deal
    const dealName = `${postData.author || 'LinkedIn User'} - Post LinkedIn (${keyword})`;

    // Crear el deal
    const response = await axios.post(
      `${HUBSPOT_BASE_URL}/crm/v3/objects/deals`,
      {
        properties: {
          dealname: dealName,
          description: description,
          amount: '0',
          deal_currency_code: 'MXN',
          pipeline: pipelineId,
          dealstage: dealStageId
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ Deal created in HubSpot: ${dealName}`);
    return response.data;
  } catch (error) {
    console.error('=== HubSpot Create Deal Error ===');
    console.error('Status:', error.response?.status);
    console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Error Message:', error.message);
    console.error('================================');
    return null;
  }
};

module.exports = {
  getCompaniesFromSegment,
  getCompanyById,
  updateLastScrape,
  shouldScrapeCompany,
  getPipelinesAndStages,
  getValidStageId,
  checkDuplicateDeal,
  createDealForPerson,
  createDealForPost
};

