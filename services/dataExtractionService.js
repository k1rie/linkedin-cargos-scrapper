/**
 * DATA EXTRACTION LAYER
 * JSON-LD parsing and CSS selector fallback with Cheerio
 */

const cheerio = require('cheerio');

/**
 * Extract data from JSON-LD script tags
 */
const extractJSONLD = (pageContent) => {
  try {
    const jsonLdScripts = pageContent.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
    
    if (!jsonLdScripts || jsonLdScripts.length === 0) {
      return null;
    }
    
    const extractedData = [];
    
    for (const script of jsonLdScripts) {
      try {
        const jsonMatch = script.match(/<script[^>]*>(.*?)<\/script>/is);
        if (jsonMatch && jsonMatch[1]) {
          const jsonData = JSON.parse(jsonMatch[1]);
          
          // Look for Person schema
          if (jsonData['@type'] === 'Person' || jsonData['@type'] === 'http://schema.org/Person') {
            extractedData.push({
              type: 'Person',
              name: jsonData.name,
              jobTitle: jsonData.jobTitle,
              worksFor: jsonData.worksFor,
              address: jsonData.address,
              url: jsonData.url,
              image: jsonData.image,
              sameAs: jsonData.sameAs,
            });
          }
          
          // Look for Organization schema (company info)
          if (jsonData['@type'] === 'Organization' || jsonData['@type'] === 'http://schema.org/Organization') {
            extractedData.push({
              type: 'Organization',
              name: jsonData.name,
              url: jsonData.url,
            });
          }
        }
      } catch (e) {
        // Skip invalid JSON
        continue;
      }
    }
    
    return extractedData.length > 0 ? extractedData : null;
  } catch (error) {
    return null;
  }
};

/**
 * Extract profile data using CSS selectors (fallback)
 */
const extractWithSelectors = async (page) => {
  try {
    const profileData = await page.evaluate(() => {
      const data = {
        name: '',
        title: '',
        location: '',
        company: '',
        experience: [],
        education: [],
        skills: [],
        profileUrl: window.location.href,
      };
      
      // Extract name
      const nameSelectors = [
        'h1.text-heading-xlarge',
        'h1[class*="text-heading"]',
        'h1',
        '.pv-text-details__left-panel h1',
        '[data-view-name="profile-top-card"] h1',
      ];
      
      for (const selector of nameSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          data.name = element.textContent.trim();
          break;
        }
      }
      
      // Extract title/headline
      const titleSelectors = [
        '.text-body-medium.break-words',
        '[data-view-name="profile-top-card"] .text-body-medium',
        '.pv-text-details__left-panel .text-body-medium',
        '.top-card-layout__headline',
      ];
      
      for (const selector of titleSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          data.title = element.textContent.trim();
          break;
        }
      }
      
      // Extract location
      const locationSelectors = [
        '.text-body-small.inline.t-black--light.break-words',
        '[data-view-name="profile-top-card"] .text-body-small',
        '.pv-text-details__left-panel .text-body-small',
        '.top-card-layout__first-subline',
      ];
      
      for (const selector of locationSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          const text = element.textContent.trim();
          // Check if it looks like a location
          if (text.includes(',') || text.match(/^[A-Z][a-z]+/)) {
            data.location = text;
            break;
          }
        }
      }
      
      // Extract job criteria (from job postings)
      const jobCriteria = document.querySelectorAll('.description__job-criteria-list li');
      if (jobCriteria.length > 0) {
        jobCriteria.forEach(li => {
          const label = li.querySelector('.description__job-criteria-text--criteria')?.textContent.trim();
          const value = li.querySelector('.description__job-criteria-text')?.textContent.trim();
          if (label && value) {
            data.jobCriteria = data.jobCriteria || {};
            data.jobCriteria[label] = value;
          }
        });
      }
      
      // Extract experience (simplified)
      const experienceSections = document.querySelectorAll('[data-view-name="profile-components-entity"]');
      experienceSections.forEach(section => {
        const title = section.querySelector('h3')?.textContent.trim();
        const company = section.querySelector('.pvs-entity__sub-title')?.textContent.trim();
        const duration = section.querySelector('.pvs-entity__caption')?.textContent.trim();
        
        if (title || company) {
          data.experience.push({
            title,
            company,
            duration,
          });
        }
      });
      
      return data;
    });
    
    return profileData;
  } catch (error) {
    console.error('Error extracting with selectors:', error.message);
    return null;
  }
};

/**
 * Extract profile data from LinkedIn profile page
 */
const extractProfileData = async (page, profileUrl) => {
  try {
    // Wait for page to load
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    
    // Try JSON-LD first
    const pageContent = await page.content();
    const jsonLdData = extractJSONLD(pageContent);
    
    if (jsonLdData && jsonLdData.length > 0) {
      const personData = jsonLdData.find(d => d.type === 'Person');
      if (personData) {
        return {
          name: personData.name,
          title: personData.jobTitle,
          company: personData.worksFor?.name || personData.worksFor,
          location: personData.address?.addressLocality || personData.address,
          profileUrl: personData.url || profileUrl,
          source: 'json-ld',
        };
      }
    }
    
    // Fallback to CSS selectors
    const selectorData = await extractWithSelectors(page);
    if (selectorData) {
      return {
        ...selectorData,
        source: 'css-selectors',
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting profile data:', error.message);
    return null;
  }
};

/**
 * Extract search results from LinkedIn search page using Cheerio
 */
const extractSearchResultsWithCheerio = async (page) => {
  try {
    // Obtener el HTML de la página
    const html = await page.content();
    const $ = cheerio.load(html);
    
    const people = [];
    const seenUrls = new Set();
    
    // Estrategia 1: Buscar todos los links a perfiles
    const profileLinks = $('a[href*="/in/"]').filter((i, el) => {
      const href = $(el).attr('href');
      return href && href.includes('/in/') && !href.includes('/company/');
    });
    
    console.log(`Found ${profileLinks.length} profile links`);
    
    profileLinks.each((i, linkEl) => {
      try {
        const $link = $(linkEl);
        const profileUrl = $link.attr('href');
        
        if (!profileUrl || seenUrls.has(profileUrl)) return;
        
        // Buscar el contenedor padre más relevante
        const $container = $link.closest('[role="listitem"], li, div[class*="search-result"], div[class*="entity-result"]') || 
                          $link.parent().parent().parent();
        
        if (!$container || $container.length === 0) return;
        
        const containerText = $container.text();
        
        // Verificar que no sea navegación
        if (containerText.includes('Sign in') || containerText.includes('Join now')) return;
        
        // Extraer información del contenedor
        let name = '';
        let title = '';
        let location = '';
        let currentPosition = '';
        let company = '';
        
        // Estrategia de extracción basada en texto
        // El texto puede venir todo junto, necesitamos parsearlo mejor
        let lines = containerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        // Si hay muy pocas líneas, intentar dividir por patrones comunes
        if (lines.length <= 2) {
          // Buscar patrones como "Nombre • 3rd+TítuloUbicaciónCurrent:"
          const text = containerText.trim();
          const parts = [];
          
          // Extraer nombre (antes de • o 3rd+ o 1st o 2nd)
          const nameMatch = text.match(/^(.+?)(?:\s*•\s*|\s*3rd\+|\s*2nd|\s*1st)/);
          if (nameMatch) {
            parts.push(nameMatch[1].trim());
            
            // Extraer el resto del texto después del separador
            const separatorMatch = text.match(/(?:\s*•\s*|\s*3rd\+|\s*2nd|\s*1st)/);
            if (separatorMatch) {
              const afterSeparator = text.substring(nameMatch[0].length).trim();
              
              // Buscar Current: o Actual: o Past:
              const currentMatch = afterSeparator.match(/(Current|Actual):\s*(.+?)(?=\s*Past:|$)/i);
              const pastMatch = afterSeparator.match(/(Past|Pasado):\s*(.+?)$/i);
              
              if (currentMatch || pastMatch) {
                // Extraer lo que está antes de Current/Past (título y ubicación)
                const beforePosition = afterSeparator.split(/(?:Current|Actual|Past|Pasado):/i)[0].trim();
                
                if (beforePosition) {
                  // Buscar keywords de México de forma simple
                  const mexicoKeywords = ['méxico', 'mexico', 'mex', 'cdmx', 'ciudad de méxico', 'ciudad de mexico'];
                  const beforePositionLower = beforePosition.toLowerCase();
                  
                  let foundMexico = false;
                  for (const keyword of mexicoKeywords) {
                    if (beforePositionLower.includes(keyword)) {
                      // Encontrar la posición de la keyword
                      const keywordIndex = beforePositionLower.indexOf(keyword);
                      
                      // Buscar hacia atrás para encontrar el inicio de la ubicación (buscar coma o inicio)
                      let locationStart = keywordIndex;
                      while (locationStart > 0 && beforePosition[locationStart - 1] !== ',') {
                        locationStart--;
                      }
                      if (locationStart > 0 && beforePosition[locationStart - 1] === ',') {
                        locationStart--; // Incluir la coma
                      }
                      
                      // Buscar hacia adelante para encontrar el final (antes de "Message", "followers", etc.)
                      let locationEnd = keywordIndex + keyword.length;
                      const endMatch = beforePosition.substring(locationEnd).match(/^([^message]*?)(?:\s*message|\s*\d+\s*(?:followers?|conexiones?|seguidores?)|$)/i);
                      if (endMatch) {
                        locationEnd = locationEnd + endMatch[1].length;
                      }
                      
                      const titlePart = beforePosition.substring(0, locationStart).trim();
                      const locationPart = beforePosition.substring(locationStart, locationEnd).trim()
                        .replace(/\s*message\s*$/i, '')
                        .replace(/\s*\d+\s*(followers?|conexiones?|seguidores?)\s*$/i, '')
                        .trim();
                      
                      if (titlePart) parts.push(titlePart);
                      if (locationPart) parts.push(locationPart);
                      
                      foundMexico = true;
                      break;
                    }
                  }
                  
                  if (!foundMexico) {
                    // No se encontró México, todo es título
                    parts.push(beforePosition);
                  }
                }
                
                // Agregar Current: o Past:
                if (currentMatch) parts.push(currentMatch[0].trim());
                if (pastMatch && !currentMatch) parts.push(pastMatch[0].trim());
              } else {
                // No hay Current/Past, intentar dividir por ubicación (búsqueda simple de México)
                const mexicoKeywords = ['méxico', 'mexico', 'mex', 'cdmx', 'ciudad de méxico', 'ciudad de mexico'];
                const afterSeparatorLower = afterSeparator.toLowerCase();
                
                let foundMexico = false;
                for (const keyword of mexicoKeywords) {
                  if (afterSeparatorLower.includes(keyword)) {
                    const keywordIndex = afterSeparatorLower.indexOf(keyword);
                    
                    // Buscar inicio de ubicación
                    let locationStart = keywordIndex;
                    while (locationStart > 0 && afterSeparator[locationStart - 1] !== ',') {
                      locationStart--;
                    }
                    if (locationStart > 0 && afterSeparator[locationStart - 1] === ',') {
                      locationStart--;
                    }
                    
                    // Buscar final de ubicación
                    let locationEnd = keywordIndex + keyword.length;
                    const endMatch = afterSeparator.substring(locationEnd).match(/^([^message]*?)(?:\s*message|\s*\d+\s*(?:followers?|conexiones?|seguidores?)|$)/i);
                    if (endMatch) {
                      locationEnd = locationEnd + endMatch[1].length;
                    }
                    
                    const titlePart = afterSeparator.substring(0, locationStart).trim();
                    const locationPart = afterSeparator.substring(locationStart, locationEnd).trim()
                      .replace(/\s*message\s*$/i, '')
                      .replace(/\s*\d+\s*(followers?|conexiones?|seguidores?)\s*$/i, '')
                      .trim();
                    
                    if (titlePart) parts.push(titlePart);
                    if (locationPart) parts.push(locationPart);
                    
                    foundMexico = true;
                    break;
                  }
                }
                
                if (!foundMexico && afterSeparator) {
                  // No se encontró México, todo es título
                  parts.push(afterSeparator);
                }
              }
            }
          } else {
            // No se pudo extraer nombre con el patrón, usar el texto completo
            if (text) parts.push(text);
          }
          
          if (parts.length > 0) {
            lines = parts;
          }
        }
        
        // Debug: mostrar las líneas parseadas
        if (lines.length > 0) {
          console.log(`Container lines (parsed):`, lines.slice(0, 5));
        }
        
        // El primer elemento suele ser el nombre (o "LinkedIn Member")
        if (lines.length > 0) {
          name = lines[0];
          // Si es "LinkedIn Member", mantenerlo pero intentar extraer más info
          if (name === 'LinkedIn Member') {
            const linkText = $link.text().trim();
            if (linkText && linkText !== 'LinkedIn Member' && linkText.length > 2) {
              name = linkText;
            }
            // Si aún es "LinkedIn Member", buscar en líneas siguientes
            if (name === 'LinkedIn Member' && lines.length > 1) {
              // A veces el nombre real está después
              for (let i = 1; i < Math.min(3, lines.length); i++) {
                const line = lines[i];
                // Si la línea parece un nombre (no tiene keywords de cargo)
                if (line.length > 2 && line.length < 50 && 
                    !line.match(/Manager|Director|Coordinator|Engineer|3rd\+|Message|Conectar/i)) {
                  name = line;
                  break;
                }
              }
            }
          }
        }
        
        // Buscar título/posición actual
        // Buscar líneas que contengan palabras clave de cargos
        const jobKeywords = ['Manager', 'Director', 'Coordinator', 'Coordinador', 'Head', 'Lead', 'Senior', 
                            'Junior', 'Analyst', 'Specialist', 'Executive', 'Chief', 'VP', 'President',
                            'Engineer', 'Developer', 'Designer', 'Jefe', 'Gerente', 'Asistente',
                            'Planner', 'Project', 'Product', 'Business', 'Events', 'Eventos', 'Officer',
                            'Supervisor', 'Administrator', 'Administrador', 'Consultant', 'Consultor'];
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          
          // Skip líneas obvias que no son títulos
          if (line.includes('conexión') || line.includes('seguidor') || 
              line.includes('Message') || line.includes('Conectar') ||
              line.match(/^\d+\s*(conexión|seguidor)/i) ||
              line.match(/^3rd\+|2nd|1st/)) {
            continue;
          }
          
          // Buscar "Current:" o "Actual:"
          if (line.match(/^(Current|Actual):/i)) {
            currentPosition = line.replace(/^(Current|Actual):\s*/i, '').trim();
            
            // Extraer el cargo y la empresa
            // Formato: "Jefe de eventos y reuniones at Leonardo Royal Barcelona Hotel Fira"
            // Formato: "Community manager y creador de contenido at Autónomo"
            const atMatch = currentPosition.match(/^(.+?)\s+(?:at|en)\s+(.+)$/i);
            if (atMatch) {
              title = atMatch[1].trim();
              company = atMatch[2].trim();
            } else {
              // Si no hay "at/en", toda la línea es el título
              title = currentPosition;
            }
            break;
          }
          
          // Buscar "Past:" (saltar, pero extraer si menciona el cargo buscado)
          if (line.match(/^(Past|Pasado):/i)) {
            const pastPosition = line.replace(/^(Past|Pasado):\s*/i, '').trim();
            // Solo usar Past si no tenemos título aún y contiene keywords relevantes
            if (!title && jobKeywords.some(keyword => pastPosition.toLowerCase().includes(keyword.toLowerCase()))) {
              const atMatch = pastPosition.match(/^(.+?)\s+(?:at|en)\s+(.+)$/i);
              if (atMatch) {
                title = atMatch[1].trim() + ' (Past)';
                company = atMatch[2].trim();
              }
            }
            continue;
          }
          
          // Si la línea contiene palabras clave de cargo y no es muy larga
          if (line.length < 150 && jobKeywords.some(keyword => line.toLowerCase().includes(keyword.toLowerCase()))) {
            // Verificar que no sea una ubicación
            if (!line.match(/Greater|Metropolitan|Area|Área/i)) {
              title = line;
              break;
            }
          }
        }
        
        // Buscar ubicación: SIMPLIFICADO - solo buscar keywords de México
        // Keywords que indican México (case-insensitive)
        const mexicoKeywords = [
          'méxico', 'mexico', 'mex', 
          'cdmx', 'ciudad de méxico', 'ciudad de mexico',
          'mexico city', 'méxico df', 'mexico df', 'df'
        ];
        
        // Buscar en todas las líneas y en el texto completo
        const allText = lines.join(' ').toLowerCase();
        
        // Buscar cualquier keyword de México
        for (const keyword of mexicoKeywords) {
          const keywordIndex = allText.indexOf(keyword);
          if (keywordIndex !== -1) {
            // Encontrar el contexto alrededor de la keyword para extraer la ubicación completa
            // Buscar hacia atrás hasta encontrar el inicio de una palabra (mayúscula o número)
            let start = keywordIndex;
            while (start > 0) {
              const char = allText[start - 1];
              // Si encontramos una coma o espacio, podría ser el inicio de la ubicación
              if (char === ',' || char === ' ') {
                // Verificar si hay una ciudad antes (palabra con mayúscula)
                const beforeComma = allText.substring(Math.max(0, start - 50), start).trim();
                if (beforeComma.length > 0) {
                  // Buscar el inicio real de la ubicación (buscar hacia atrás desde la coma)
                  let locationStart = start;
                  while (locationStart > 0 && allText[locationStart - 1] !== ' ' && 
                         !/[A-Z]/.test(allText[locationStart - 1])) {
                    locationStart--;
                  }
                  start = Math.max(0, locationStart - 50); // Incluir hasta 50 chars antes
                  break;
                }
              }
              start--;
              if (start < keywordIndex - 100) break; // Limitar búsqueda hacia atrás
            }
            
            // Buscar hacia adelante hasta encontrar "Message", "followers", números, o fin
            let end = keywordIndex + keyword.length;
            const endMatch = allText.substring(end).match(/^([^message]*?)(?:\s*message|\s*\d+\s*(?:followers?|conexiones?|seguidores?)|$)/i);
            if (endMatch) {
              end = end + endMatch[1].length;
            } else {
              // Si no hay match, incluir hasta 30 caracteres después
              end = Math.min(end + 30, allText.length);
            }
            
            // Extraer la ubicación del texto original (no lowercase)
            const originalText = lines.join(' ');
            const extracted = originalText.substring(
              Math.max(0, start),
              Math.min(originalText.length, end)
            ).trim();
            
            // Limpiar: remover palabras que no son parte de la ubicación
            let cleanLocation = extracted
              .replace(/\s*message\s*$/i, '')
              .replace(/\s*\d+\s*(followers?|conexiones?|seguidores?)\s*$/i, '')
              .replace(/\s*visit\s+my\s+website\s*$/i, '')
              .replace(/^[^a-záéíóúñ]*/i, '') // Remover caracteres no alfabéticos al inicio
              .trim();
            
            // Si la ubicación es muy larga, intentar extraer solo la parte relevante
            if (cleanLocation.length > 150) {
              // Buscar el patrón "City, State, Mexico" o "City, Mexico"
              const locationMatch = cleanLocation.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*,\s*(?:[A-Z][a-z]+\s*,\s*)?(?:México|Mexico|CDMX|Ciudad de México))/i);
              if (locationMatch) {
                cleanLocation = locationMatch[0].trim();
              } else {
                // Extraer solo los últimos 80 caracteres (donde suele estar la ubicación)
                cleanLocation = cleanLocation.substring(cleanLocation.length - 80).trim();
              }
            }
            
            if (cleanLocation.length > 3 && cleanLocation.length < 150) {
              location = cleanLocation;
              break;
            }
          }
        }
        
        // Si encontramos un perfil válido
        if (profileUrl && (name || title)) {
          seenUrls.add(profileUrl);
          
          // Limpiar nombre
          name = name.replace(/•.*$/, '').replace(/·.*$/, '').trim();
          
          // Limpiar título (remover 3rd+, 2nd, 1st, etc.)
          title = title.replace(/^(3rd\+|2nd|1st)\s*/i, '').trim();
          
          // Limpiar empresa (remover "X followers", "X conexiones", etc.)
          company = company.replace(/\d+\s*(followers?|conexiones?|seguidores?)/gi, '').trim();
          
          // Construir URL completa si es relativa
          const fullUrl = profileUrl.startsWith('http') ? 
                         profileUrl : 
                         `https://www.linkedin.com${profileUrl}`;
          
          people.push({
            name: name || 'LinkedIn Member',
            profileUrl: fullUrl,
            title: title || '',
            location: location || '',
            company: company || '', // Empresa extraída de "Current: X at Y"
            rawText: containerText.substring(0, 300), // Para debugging
          });
          
          console.log(`Extracted: ${name} - ${title || 'N/A'} [Location: ${location || 'N/A'}]`);
        }
      } catch (error) {
        console.error('Error extracting individual result:', error.message);
      }
    });
    
    return people;
  } catch (error) {
    console.error('Error in Cheerio extraction:', error.message);
    return [];
  }
};

/**
 * Extract search results from LinkedIn search page (fallback method)
 */
const extractSearchResults = async (page) => {
  try {
    // Esperar un poco más para asegurar que el contenido esté renderizado
    await page.waitForTimeout(1000);
    
    const results = await page.evaluate(() => {
      const people = [];
      
      // Verificar si hay mensaje de "No results found"
      const noResultsMessage = document.body.textContent.includes('No results found') ||
                               document.body.textContent.includes('No se encontraron resultados');
      
      // Aún así intentar extraer si hay links a perfiles
      // Multiple selector strategies - más agresivo
      const selectors = [
        'a[href*="/in/"]',
        '[role="listitem"]',
        '[class*="search-result"]',
        '[data-view-name*="search"]',
        'li[class*="result"]',
        '.reusable-search__result-container',
        '[class*="_3295e248"]', // Clase común en resultados de LinkedIn
        '[class*="entity-result"]',
      ];
      
      let resultElements = [];
      for (const sel of selectors) {
        try {
          const elements = document.querySelectorAll(sel);
          resultElements = Array.from(elements).filter(el => {
            const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
            const hasProfileLink = href.includes('/in/');
            const hasContent = el.textContent.trim().length > 10; // Al menos algo de contenido
            return hasProfileLink && hasContent;
          });
          if (resultElements.length > 0) break;
        } catch (e) {
          continue;
        }
      }
      
      // Si aún no hay resultados, buscar todos los links a perfiles y sus contenedores
      if (resultElements.length === 0) {
        const allLinks = document.querySelectorAll('a[href*="/in/"]');
        resultElements = Array.from(allLinks).filter(link => {
          // Verificar que el link tenga contenido relevante
          const linkText = link.textContent.trim();
          const hasName = linkText.length > 2 && linkText.length < 100; // Probablemente un nombre
          
          // Buscar contenedor padre que tenga más información
          const container = link.closest('[class*="result"], [class*="search"], li, div[role="listitem"], div[class*="_3295e248"], div[class*="entity-result"]') ||
                           link.parentElement?.parentElement;
          
          return container && hasName && container.textContent.trim().length > 20;
        });
      }
      
      // Si aún no hay resultados pero hay contenido en la página, intentar extraer de cualquier contenedor
      if (resultElements.length === 0 && !noResultsMessage) {
        // Buscar cualquier div que contenga un link a perfil y tenga estructura de resultado
        const allDivs = document.querySelectorAll('div[class*="_3295e248"], div[role="listitem"], div[class*="entity-result"]');
        resultElements = Array.from(allDivs).filter(div => {
          const link = div.querySelector('a[href*="/in/"]');
          return link && div.textContent.trim().length > 30;
        });
      }
      
      // Última estrategia: buscar cualquier link a perfil y construir resultado desde ahí
      if (resultElements.length === 0) {
        const allProfileLinks = document.querySelectorAll('a[href*="/in/"]');
        const uniqueLinks = new Set();
        resultElements = Array.from(allProfileLinks).filter(link => {
          const href = link.href || link.getAttribute('href');
          if (!href || uniqueLinks.has(href)) return false;
          
          // Verificar que no sea un link de navegación o footer
          const isNavigationLink = link.closest('nav, footer, header, [role="navigation"]');
          if (isNavigationLink) return false;
          
          // Verificar que tenga contenido de perfil (nombre)
          const linkText = link.textContent.trim();
          const looksLikeName = linkText.length > 2 && 
                               linkText.length < 100 && 
                               !linkText.includes('LinkedIn') &&
                               !linkText.includes('Sign') &&
                               !linkText.match(/^\d+$/); // No es solo un número
          
          if (looksLikeName) {
            uniqueLinks.add(href);
            return true;
          }
          return false;
        });
      }
      
      const processedContainers = new Set();
      
      resultElements.forEach((element) => {
        try {
          let container = element;
          if (element.tagName !== 'A' || !element.href.includes('/in/')) {
            // Buscar contenedor más cercano con estructura de resultado
            container = element.closest('a[href*="/in/"]') || 
                       element.closest('[role="listitem"]') ||
                       element.closest('[class*="_3295e248"]') ||
                       element.closest('[class*="entity-result"]') ||
                       element.closest('[class*="result"]') ||
                       element.closest('div[class*="_596d9cd3"]') || // Contenedor común de resultados
                       element.parentElement?.parentElement ||
                       element.parentElement;
          }
          
          // Si el elemento es directamente un link, usar su contenedor padre para obtener más contexto
          if (container.tagName === 'A' && container.href.includes('/in/')) {
            const parentContainer = container.closest('[role="listitem"], div[class*="_3295e248"], div[class*="entity-result"], div[class*="_596d9cd3"], div[class*="search-result"]');
            if (parentContainer && parentContainer !== container) {
              container = parentContainer;
            }
          }
          
          const containerId = container.getAttribute('href') || 
                            container.textContent.substring(0, 50) || 
                            container.outerHTML.substring(0, 100);
          
          if (processedContainers.has(containerId)) {
            return;
          }
          processedContainers.add(containerId);
          
          let profileLink = null;
          if (container.tagName === 'A' && container.href.includes('/in/')) {
            profileLink = container;
          } else {
            // Buscar link de perfil con múltiples estrategias
            profileLink = container.querySelector('a[href*="/in/"]') ||
                         container.querySelector('a[data-view-name="search-result-lockup-title"]') ||
                         container.querySelector('a[data-view-name*="lockup-title"]') ||
                         container.querySelector('a._52c6d0b5'); // Clase común de links de perfil
          }
          
          if (!profileLink) return;
          
          const profileUrl = profileLink.href || profileLink.getAttribute('href');
          if (!profileUrl || !profileUrl.includes('/in/')) return;
          
          // Extract name
          let name = profileLink.innerText.trim() || profileLink.textContent.trim();
          name = name.replace(/•.*$/, '').trim();
          name = name.replace(/·.*$/, '').trim();
          name = name.replace(/\s+/g, ' ').trim();
          
          if (!name || name.length < 2) {
            const nameFromContainer = container.textContent.trim().split('\n')[0].trim();
            if (nameFromContainer.length > 2) {
              name = nameFromContainer.split('•')[0].split('·')[0].trim();
            }
          }
          
          // Extract title and location using improved selectors based on LinkedIn's current structure
          let title = '';
          let location = '';
          let currentPosition = '';
          
          // Strategy 1: Look for the main title (headline) - usually the first subtitle after name
          // Selector based on LinkedIn's current structure: p with specific classes containing job title
          const titleSelectors = [
            'p._57a34c9c._8d21dacf._0da3dbae._1ae18243._82bb3271', // Main title class pattern
            'p[class*="_65b5d50b"][class*="cc34e8bb"]:not([class*="_85a7250b"])', // Title pattern
            '.entity-result__primary-subtitle',
            '[class*="search-result"] [class*="subtitle"]',
            'p._57a34c9c._8d21dacf', // Simplified pattern
          ];
          
          for (const selector of titleSelectors) {
            const elements = container.querySelectorAll(selector);
            for (const el of elements) {
              const text = el.textContent.trim();
              // Skip if it's location or connection count
              if (text.match(/^\d+\s*(conexión|conexiones|seguidor|seguidores)/i) ||
                  text.match(/^(Ciudad|México|Argentina|Colombia|España|Bogotá|Buenos Aires|Madrid|Barcelona|Lima|Santiago|Nuevo León)/i) ||
                  text.includes('Conectar') || text.includes('Enviar mensaje')) {
                continue;
              }
              // If it looks like a job title (has | or common job words)
              if (text.length > 5 && (text.includes('|') || text.match(/\b(Head|Manager|Director|Coordinator|Lead|Senior|Junior|Analyst|Specialist|Executive|Chief|VP|President)\b/i))) {
                title = text;
                break;
              }
            }
            if (title) break;
          }
          
          // Strategy 2: Look for "Actual:" prefix (current position)
          const currentPositionSelectors = [
            'p._57a34c9c._3f883ddb', // Current position pattern
            'p[class*="_3f883ddb"]', // Alternative pattern
            'p:contains("Actual:")',
          ];
          
          for (const selector of currentPositionSelectors) {
            const elements = container.querySelectorAll(selector);
            for (const el of elements) {
              const text = el.textContent.trim();
              if (text.includes('Actual:') || text.includes('Actual ')) {
                // Extract job title from "Actual: Job Title at Company"
                const match = text.match(/Actual[:\s]+(.+?)(?:\s+en\s+|\s+at\s+|$)/i);
                if (match && match[1]) {
                  currentPosition = match[1].trim();
                  // Use current position as title if we don't have one
                  if (!title) {
                    title = currentPosition;
                  }
                }
                break;
              }
            }
            if (currentPosition) break;
          }
          
          // Strategy 3: Extract location
          const locationSelectors = [
            'p._57a34c9c._8d21dacf._65b5d50b._85a7250b', // Location pattern
            'p[class*="_85a7250b"]', // Location class pattern
            '.entity-result__secondary-subtitle',
            'p:contains("México"), p:contains("Argentina"), p:contains("Colombia")',
          ];
          
          for (const selector of locationSelectors) {
            const elements = container.querySelectorAll(selector);
            for (const el of elements) {
              const text = el.textContent.trim();
              if (text.match(/^(Ciudad de México|México|Argentina|Colombia|España|Bogotá|Buenos Aires|Madrid|Barcelona|Lima|Santiago|Nuevo León|Monterrey|Guadalajara)/i) ||
                  (text.includes(',') && text.length < 80 && text.match(/[A-Z][a-z]+,\s*[A-Z][a-z]+/))) {
                location = text;
                break;
              }
            }
            if (location) break;
          }
          
          // Fallback: Parse all text elements if we still don't have title/location
          if (!title || !location) {
            const allTextElements = container.querySelectorAll('p, div, span');
            const textElements = Array.from(allTextElements);
            
            for (const el of textElements) {
              const text = el.innerText.trim();
              if (!text || text.length < 5) continue;
              
              // Location detection
              if (!location && (
                text.match(/^(Ciudad de México|México|Argentina|Colombia|España|Bogotá|Buenos Aires|Madrid|Barcelona|Lima|Santiago|Nuevo León|Monterrey|Guadalajara)/i) ||
                (text.includes(',') && text.length < 80 && text.match(/[A-Z][a-z]+,\s*[A-Z][a-z]+/))
              )) {
                location = text;
                continue;
              }
              
              // Title detection - look for job-related keywords
              if (!title && 
                  text.length > 5 && 
                  !text.includes('Anterior:') &&
                  !text.match(/^(Ciudad|México|Argentina|Colombia|España)/i) &&
                  !text.match(/^\d+\s*(conexión|conexiones|seguidor|seguidores)/i) &&
                  !text.match(/^Conectar|^Enviar mensaje/i) &&
                  text !== location &&
                  (text.includes('|') || text.match(/\b(Head|Manager|Director|Coordinator|Lead|Senior|Junior|Analyst|Specialist|Executive|Chief|VP|President|Coordinador|Gerente|Director|Líder)\b/i))) {
                title = text;
              }
            }
          }
          
          // Combine title and current position if both exist
          if (title && currentPosition && title !== currentPosition) {
            title = `${title} | ${currentPosition}`;
          }
          
          if (name && profileUrl) {
            people.push({
              name: name,
              profileUrl: profileUrl,
              title: title,
              location: location,
            });
          }
        } catch (error) {
          // Silently skip errors
        }
      });
      
      // Remove duplicates
      const uniquePeople = [];
      const seenUrls = new Set();
      for (const person of people) {
        if (!seenUrls.has(person.profileUrl)) {
          seenUrls.add(person.profileUrl);
          uniquePeople.push(person);
        }
      }
      
      return uniquePeople;
    });
    
    return results;
  } catch (error) {
    console.error('Error extracting search results:', error.message);
    return [];
  }
};

module.exports = {
  extractJSONLD,
  extractWithSelectors,
  extractProfileData,
  extractSearchResults: extractSearchResultsWithCheerio, // Usar Cheerio como método principal
  extractSearchResultsFallback: extractSearchResults, // Mantener el método anterior como fallback
};

