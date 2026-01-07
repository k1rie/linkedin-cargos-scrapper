const { ApifyClient } = require('apify-client');
const loggerService = require('./loggerService');

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || 'M2FMdjRVeF1HPGFcc'; // LinkedIn People Scraper

// Configuration from environment variables
const MAX_RESULTS_PER_SEARCH = parseInt(process.env.MAX_RESULTS_PER_SEARCH || '10');
const SEARCH_LOCATION = process.env.SEARCH_LOCATION || 'Mexico';
const ENRICH_PROFILES = process.env.ENRICH_PROFILES === 'true'; // false by default for cost control
const SEARCH_DELAY_MS = parseInt(process.env.SEARCH_DELAY_MS || '2000');

// Initialize the ApifyClient with API token
let client = null;

const getClient = () => {
  if (!client) {
    if (!APIFY_API_TOKEN) {
      throw new Error('APIFY_API_TOKEN no está configurado en .env');
    }
    client = new ApifyClient({
      token: APIFY_API_TOKEN,
    });
  }
  return client;
};

/**
 * Busca perfiles de LinkedIn usando Apify Actor M2FMdjRVeF1HPGFcc
 * @param {string} companyName - Nombre de la empresa
 * @param {string} jobTitle - Título del cargo
 * @returns {Promise<Array>} - Array de resultados de perfiles
 */
const searchPeopleWithApify = async (companyName, jobTitle) => {
  if (!companyName || !jobTitle) {
    throw new Error('companyName y jobTitle son requeridos');
  }

  try {
    loggerService.info(`\n=== INICIANDO BÚSQUEDA CON APIFY ===`);
    loggerService.info(`Actor ID: ${APIFY_ACTOR_ID}`);
    loggerService.info(`Modo: Full (información completa y precisa)`);
    loggerService.info(`Empresa: ${companyName}`);
    loggerService.info(`Cargo: ${jobTitle}`);
    loggerService.info(`Query: ${companyName} ${jobTitle}`);
    loggerService.info(`Límite de resultados: ${MAX_RESULTS_PER_SEARCH}`);
    loggerService.info(`Ubicación: ${SEARCH_LOCATION}`);

    const apifyClient = getClient();

    // Preparar input del Actor - usar full mode para información precisa
    const input = {
      profileScraperMode: "Full",
      maxItems: MAX_RESULTS_PER_SEARCH,
      startPage: 1,
      searchQuery: `${companyName} ${jobTitle}`, // Sin símbolos, formato simple
      location: SEARCH_LOCATION
    };

    loggerService.debug('Input del Actor:', JSON.stringify(input, null, 2));

    // Ejecutar el Actor y esperar a que termine
    loggerService.info('Ejecutando Actor de Apify para búsqueda de perfiles...');
    const run = await apifyClient.actor(APIFY_ACTOR_ID).call(input);

    loggerService.info(`Actor ejecutado. Run ID: ${run.id}`);
    loggerService.info(`Estado: ${run.status}`);
    loggerService.info(`URL del run: https://console.apify.com/actors/runs/${run.id}`);

    loggerService.info(`Actor ejecutado. Run ID: ${run.id}`);
    loggerService.info(`Estado: ${run.status}`);

    // Obtener resultados del dataset
    loggerService.info('Obteniendo resultados del dataset...');
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

    loggerService.info(`Perfiles encontrados: ${items.length}`);

    // Procesar y normalizar resultados
    const processedResults = [];

    for (const item of items) {
      try {
        // Debug: mostrar estructura completa del primer item
        if (processedResults.length === 0) {
          loggerService.debug('Estructura completa del primer item:', JSON.stringify(item, null, 2));
        }

        // Extraer información del perfil usando la estructura real de Apify
        const profileUrl = item.linkedinUrl || item.profile_url || item.linkedin_url || item.url;
        const name = item.firstName && item.lastName ? `${item.firstName} ${item.lastName}` :
                   item.name || item.full_name || item.person_name || item.fullName || item.personName || 'N/A';

        // Usar headline como título principal, o buscar en currentPosition
        const title = item.headline ||
                     (item.currentPosition && item.currentPosition[0] && item.currentPosition[0].position) ||
                     item.title || item.job_title || item.current_position || item.jobTitle || item.currentPosition || '';

        // Extraer empresa de currentPosition
        const company = (item.currentPosition && item.currentPosition[0] && item.currentPosition[0].companyName) ||
                       item.company || item.current_company || item.organization || item.currentCompany || '';

        // Manejar location con la estructura real
        let location = '';
        if (item.location) {
          if (typeof item.location === 'string') {
            location = item.location;
          } else if (typeof item.location === 'object' && item.location.parsed) {
            // Usar el campo parsed que tiene la ubicación formateada
            location = item.location.parsed.text || item.location.linkedinText || '';
          } else if (typeof item.location === 'object') {
            // Fallback para otras estructuras de location
            location = [item.location.city, item.location.state, item.location.country]
              .filter(Boolean)
              .join(', ') || item.location.linkedinText || '';
          }
        }

        // Extraer información adicional
        const about = item.about || item.summary || '';
        const experience = item.experience || [];
        const education = item.education || [];

        // Log de debug si no se encuentra nombre
        if (!name) {
          loggerService.debug('Item sin nombre encontrado:', JSON.stringify(item, null, 2));
        }

        // Solo incluir perfiles con URL válida
        if (profileUrl && profileUrl.includes('linkedin.com/in/')) {
          processedResults.push({
            name: name || 'N/A',
            title: title || '',
            company: company || '',
            location: location || '',
            profileUrl: profileUrl,
            // Campos adicionales extraídos correctamente
            about: about,
            experience: experience,
            education: education,
            // Información adicional útil
            headline: item.headline || '',
            currentPosition: item.currentPosition || [],
            skills: item.skills || [],
            connectionsCount: item.connectionsCount || 0
          });
        }
      } catch (itemError) {
        loggerService.warn(`Error procesando item: ${itemError.message}`);
        loggerService.debug('Item que causó error:', JSON.stringify(item, null, 2));
        continue;
      }
    }

    loggerService.info(`\n=== RESUMEN DE BÚSQUEDA APIFY ===`);
    loggerService.info(`Total items del dataset: ${items.length}`);
    loggerService.info(`Perfiles válidos procesados: ${processedResults.length}`);

    // Alertar si no se encontraron resultados
    if (processedResults.length === 0) {
      loggerService.warn(`⚠️ No se encontraron perfiles para "${companyName}" + "${jobTitle}" en ${SEARCH_LOCATION}`);
      loggerService.warn(`💡 Posibles causas: query demasiado restrictiva, actor con limitaciones, o datos no disponibles`);
      loggerService.warn(`🔗 Revisar run en: https://console.apify.com/actors/runs/${run.id}`);
    }

    return processedResults;

  } catch (error) {
    loggerService.error('Error en búsqueda con Apify:', error);
    throw new Error(`Error en búsqueda con Apify: ${error.message}`);
  }
};

module.exports = {
  searchPeopleWithApify
};
