#!/usr/bin/env node

/**
 * Script para reiniciar la propiedad last_linkedin_scrape en todas las empresas
 * Esto permite que todas las empresas sean scrapeadas de nuevo
 */

require('dotenv').config();
const hubspotService = require('../services/hubspotService');
const axios = require('axios');

const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const HUBSPOT_BASE_URL = 'https://api.hubapi.com';

/**
 * Resetear last_linkedin_scrape para una empresa
 * @param {string} companyId - ID de la empresa
 * @param {string} companyName - Nombre de la empresa
 * @returns {Promise<boolean>} True si se actualizó correctamente
 */
const resetCompanyScrape = async (companyId, companyName) => {
  try {
    // Establecer la fecha a null o a una fecha muy antigua (1970-01-01)
    // Usamos null para que shouldScrapeCompany retorne true
    const response = await axios.patch(
      `${HUBSPOT_BASE_URL}/crm/v3/objects/companies/${companyId}`,
      {
        properties: {
          last_linkedin_scrape: null // o '1970-01-01' si HubSpot no acepta null
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return true;
  } catch (error) {
    // Si HubSpot no acepta null, intentar con fecha antigua
    if (error.response?.status === 400) {
      try {
        await axios.patch(
          `${HUBSPOT_BASE_URL}/crm/v3/objects/companies/${companyId}`,
          {
            properties: {
              last_linkedin_scrape: '1970-01-01' // Fecha muy antigua
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
        return true;
      } catch (retryError) {
        console.error(`  ❌ Error actualizando ${companyName} (${companyId}):`, retryError.response?.data?.message || retryError.message);
        return false;
      }
    }
    
    console.error(`  ❌ Error actualizando ${companyName} (${companyId}):`, error.response?.data?.message || error.message);
    return false;
  }
};

/**
 * Obtener todas las empresas del segmento
 * @returns {Promise<Array>} Array de empresas
 */
const getAllCompanies = async () => {
  try {
    let allCompanies = [];
    let after = null;
    let hasMore = true;
    
    console.log('📊 Obteniendo todas las empresas del segmento...\n');
    
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
      
      console.log(`  ✓ Obtenidas ${allCompanies.length} empresas...`);
    }
    
    return allCompanies.map(company => ({
      id: company.id,
      name: company.properties?.name || 'Sin nombre',
      lastLinkedinScrape: company.properties?.last_linkedin_scrape || null
    }));
  } catch (error) {
    console.error('❌ Error obteniendo empresas:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Función principal
 */
const main = async () => {
  try {
    // Verificar configuración
    if (!HUBSPOT_API_KEY) {
      console.error('❌ Error: HUBSPOT_API_KEY no está configurado en .env');
      process.exit(1);
    }

    console.log('🔄 Reiniciando last_linkedin_scrape para todas las empresas\n');
    console.log('⚠️  Esto permitirá que todas las empresas sean scrapeadas de nuevo\n');

    // Obtener todas las empresas
    const companies = await getAllCompanies();
    
    if (companies.length === 0) {
      console.log('ℹ️  No se encontraron empresas para actualizar');
      return;
    }

    console.log(`\n📋 Total de empresas encontradas: ${companies.length}\n`);
    console.log('🔄 Iniciando actualización...\n');

    // Resetear cada empresa
    let successCount = 0;
    let errorCount = 0;
    const batchSize = 10; // Procesar en lotes para no sobrecargar la API

    for (let i = 0; i < companies.length; i += batchSize) {
      const batch = companies.slice(i, i + batchSize);
      
      const promises = batch.map(async (company) => {
        const success = await resetCompanyScrape(company.id, company.name);
        if (success) {
          successCount++;
          console.log(`  ✓ ${company.name} (${company.id})`);
        } else {
          errorCount++;
        }
        return success;
      });

      await Promise.all(promises);

      // Pequeño delay entre lotes para no sobrecargar la API
      if (i + batchSize < companies.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Resumen
    console.log('\n' + '='.repeat(50));
    console.log('📊 RESUMEN');
    console.log('='.repeat(50));
    console.log(`Total de empresas: ${companies.length}`);
    console.log(`✓ Actualizadas exitosamente: ${successCount}`);
    console.log(`❌ Errores: ${errorCount}`);
    console.log('='.repeat(50));
    console.log('\n✅ Proceso completado');
    console.log('💡 Todas las empresas ahora pueden ser scrapeadas de nuevo\n');

  } catch (error) {
    console.error('\n❌ Error fatal:', error.message);
    if (error.response?.data) {
      console.error('Detalles:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
};

// Ejecutar si se llama directamente
if (require.main === module) {
  main();
}

module.exports = { main, resetCompanyScrape, getAllCompanies };

