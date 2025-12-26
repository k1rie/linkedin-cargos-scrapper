/**
 * DATA EXTRACTION LAYER
 * JSON-LD parsing and CSS selector fallback
 */

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
 * Extract search results from LinkedIn search page
 */
const extractSearchResults = async (page) => {
  try {
    const results = await page.evaluate(() => {
      const people = [];
      
      // Multiple selector strategies
      const selectors = [
        'a[href*="/in/"]',
        '[class*="search-result"]',
        '[data-view-name*="search"]',
        'li[class*="result"]',
        '.reusable-search__result-container',
      ];
      
      let resultElements = [];
      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        resultElements = Array.from(elements).filter(el => {
          const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
          return href.includes('/in/') && el.textContent.trim().length > 0;
        });
        if (resultElements.length > 0) break;
      }
      
      if (resultElements.length === 0) {
        const allLinks = document.querySelectorAll('a[href*="/in/"]');
        resultElements = Array.from(allLinks).filter(link => {
          const container = link.closest('[class*="result"], [class*="search"], li, div[role="listitem"]');
          return container && link.textContent.trim().length > 0;
        });
      }
      
      const processedContainers = new Set();
      
      resultElements.forEach((element) => {
        try {
          let container = element;
          if (element.tagName !== 'A' || !element.href.includes('/in/')) {
            container = element.closest('a[href*="/in/"]') || 
                       element.closest('[role="listitem"]') ||
                       element.closest('[class*="result"]') ||
                       element.parentElement;
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
            profileLink = container.querySelector('a[href*="/in/"]') ||
                         container.querySelector('a[data-view-name="search-result-lockup-title"]');
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
  extractSearchResults,
};

