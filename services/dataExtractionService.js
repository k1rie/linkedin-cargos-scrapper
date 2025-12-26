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
          
          // Extract title and location using improved selectors
          let title = '';
          let location = '';
          
          // Try structured selectors first
          const titleElement = container.querySelector('.entity-result__primary-subtitle, .search-result__snippets, [class*="subtitle"]');
          if (titleElement) {
            title = titleElement.textContent.trim();
          }
          
          const locationElement = container.querySelector('.entity-result__secondary-subtitle, [class*="location"]');
          if (locationElement) {
            location = locationElement.textContent.trim();
          }
          
          // Fallback to text parsing
          if (!title || !location) {
            const allTextElements = container.querySelectorAll('p, div, span');
            const textElements = Array.from(allTextElements);
            
            for (const el of textElements) {
              const text = el.innerText.trim();
              if (!text || text.length < 5) continue;
              
              if (!location && (
                text.match(/^(Ciudad de México|México|Argentina|Colombia|España|Bogotá|Buenos Aires|Madrid|Barcelona|Lima|Santiago)/i) ||
                (text.includes(',') && text.length < 60 && text.match(/[A-Z][a-z]+,\s*[A-Z][a-z]+/))
              )) {
                location = text;
                continue;
              }
              
              if (!title && 
                  text.length > 10 && 
                  !text.includes('Anterior:') &&
                  !text.match(/^(Ciudad|México|Argentina|Colombia|España)/i) &&
                  !text.match(/^\d+\s*(conexión|conexiones|seguidor|seguidores)/i) &&
                  !text.match(/^Conectar|^Enviar mensaje/i) &&
                  text !== location) {
                title = text;
              }
            }
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

