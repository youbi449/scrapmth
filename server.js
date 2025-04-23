const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const puppeteer_extra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');

// Système de limitation pour les visites Infonet (max 2 par minute)
const infonetVisits = [];
const MAX_INFONET_VISITS_PER_MINUTE = 2;
const MIN_DELAY_BETWEEN_VISITS = 500; // 0.5 seconde minimum entre chaque visite
const MAX_DELAY_BETWEEN_VISITS = 3000; // 3 secondes maximum entre chaque visite

// Appliquer le plugin stealth pour contourner les détections
puppeteer_extra.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 6000;

// Middleware pour parser le corps des requêtes
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Route principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API pour le scraping
app.post('/api/scrape', async (req, res) => {
  const { urls } = req.body;
  
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Au moins une URL est requise' });
  }

  try {
    let allLinks = [];
    
    // Traiter chaque URL séquentiellement
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`Traitement de l'URL ${i+1}/${urls.length}: ${url}`);
      
      // Scraper toutes les pages pour cette URL (jusqu'à 20 maximum)
      const urlLinks = await scrapeAllPages(url);
      allLinks = [...allLinks, ...urlLinks];
      
      // Attendre un délai entre chaque URL pour éviter la détection
      if (i < urls.length - 1) {
        const delay = Math.floor(Math.random() * (5000 - 2000 + 1) + 2000); // Entre 2 et 5 secondes
        console.log(`Attente de ${delay/1000} secondes avant de traiter l'URL suivante...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    res.json({ success: true, links: allLinks });
  } catch (error) {
    console.error('Erreur lors du scraping:', error);
    res.status(500).json({ error: 'Erreur lors du scraping', message: error.message });
  }
});

// Fonction pour scraper toutes les pages (jusqu'à 20)
async function scrapeAllPages(baseUrl) {
  const MAX_PAGES = 20;
  let allLinks = [];
  let currentPage = 1;
  // Pas de limite sur le nombre d'entreprises à traiter
  const MAX_COMPANY_PAGES = Infinity; // Traiter toutes les entreprises trouvées
  // Compteur d'échecs consécutifs pour détecter quand il n'y a plus de pages
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5; // Nombre maximum d'échecs consécutifs avant d'arrêter le scraping
  
  // Vérifier si l'URL contient déjà un paramètre de page
  const url = new URL(baseUrl);
  if (url.searchParams.has('page')) {
    // Si l'URL contient déjà un paramètre de page, le supprimer pour notre traitement
    url.searchParams.delete('page');
    baseUrl = url.toString();
  }
  
  // Variable pour stocker l'URL de la page en cours
  let currentUrl = baseUrl;
  
  console.log(`Début du scraping de ${MAX_PAGES} pages maximum à partir de ${baseUrl}`);
  
  // Lancer le navigateur une seule fois pour toutes les pages
  const browser = await puppeteer_extra.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-features=BlockInsecurePrivateNetworkRequests',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  
  try {
    const page = await browser.newPage();
    
    // Configurer le user-agent aléatoire
    const userAgent = getRandomUserAgent();
    await page.setUserAgent(userAgent);
    
    // Configurer des en-têtes supplémentaires pour paraître plus humain
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    });
    
    // Modifier les propriétés du navigateur pour éviter la détection
    await page.evaluateOnNewDocument(() => {
      // Supprimer les propriétés qui révèlent l'automatisation
      delete navigator.__proto__.webdriver;
      
      // Modifier les propriétés du navigateur
      window.navigator.chrome = {
        runtime: {}
      };
      
      // Ajouter des plugins factices
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5].map(() => ({
          length: 1,
          name: `Plugin ${Math.floor(Math.random() * 100)}`
        }))
      });
      
      // Ajouter des langues factices
      Object.defineProperty(navigator, 'languages', {
        get: () => ['fr-FR', 'fr', 'en-US', 'en']
      });
    });
    
    // Naviguer vers l'URL initiale
    console.log(`Navigation vers la page initiale: ${baseUrl}`);
    await page.goto(baseUrl, { 
      waitUntil: 'networkidle2',
      timeout: 60000 // 60 secondes de timeout
    });
    
    // Gérer le challenge Cloudflare si présent
    await handleCloudflare(page);
    
    while (currentPage <= MAX_PAGES) {
      console.log(`Scraping de la page ${currentPage}`);
      
      try {
        // Attendre un délai aléatoire entre chaque page pour éviter la détection
        if (currentPage > 1) {
          const pageDelay = Math.floor(Math.random() * (3000 - 500 + 1) + 500); // Entre 0.5 et 3 secondes
          console.log(`Attente de ${pageDelay/1000} secondes avant de scraper la page ${currentPage}...`);
          await new Promise(resolve => setTimeout(resolve, pageDelay));
        }
        
        // Réinitialiser le compteur d'échecs consécutifs car nous commençons une nouvelle tentative
        consecutiveFailures = 0;
        
        // Faire défiler la page pour simuler un comportement humain
        await autoScroll(page);
        
        // Attendre un peu plus après le défilement pour s'assurer que tout est chargé
        await randomDelay(500, 1000); // Entre 0.5 et 1 seconde
        
        // Extraire les liens de la page actuelle
        const pageLinks = await extractLinks(page);
        
        // Si aucun lien n'est trouvé, on continue quand même jusqu'à la page MAX_PAGES
        if (pageLinks.length === 0) {
          console.log(`Aucun lien trouvé sur la page ${currentPage}, mais on continue le scraping.`);
        }
        
        // Ajouter les liens de la page actuelle à la liste complète
        allLinks = [...allLinks, ...pageLinks];
        console.log(`${pageLinks.length} liens trouvés sur la page ${currentPage}. Total: ${allLinks.length} liens.`);
        
        // Si on a atteint le nombre maximum de pages, sortir de la boucle
        if (currentPage >= MAX_PAGES) {
          break;
        }
        
        // Chercher le bouton de pagination spécifique
        const paginationInfo = await page.evaluate(() => {
          // Utiliser XPath pour une sélection plus précise du bouton de pagination
          const xpath = '//DIV[contains(@class,"texte-droite desktop-only")]/A[@class="pagination pagination-image-right"]';
          const nextPageLink = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          
          // Vérifier si le bouton existe, est visible et n'est pas désactivé
          if (nextPageLink && window.getComputedStyle(nextPageLink).display !== 'none') {
            // Vérifier si le bouton est désactivé (grisé)
            const isDisabled = nextPageLink.classList.contains('disabled') || 
                              nextPageLink.hasAttribute('disabled') || 
                              nextPageLink.getAttribute('aria-disabled') === 'true' || 
                              window.getComputedStyle(nextPageLink).opacity === '0.5' || 
                              window.getComputedStyle(nextPageLink).cursor === 'not-allowed';
            
            if (!isDisabled) {
              console.log('Bouton de pagination trouvé avec XPath:', nextPageLink.href);
              return {
                hasNextPage: true,
                nextPageUrl: nextPageLink.href,
                xpath: xpath
              };
            } else {
              console.log('Bouton de pagination trouvé mais désactivé (grisé)');
              return {
                hasNextPage: false,
                nextPageUrl: null,
                reason: 'button-disabled'
              };
            }
          }
          
          // Si le bouton n'est pas trouvé ou n'est pas visible
          console.log('Bouton de pagination non trouvé avec le XPath spécifié');
          
          // Recherche alternative si le XPath principal ne fonctionne pas
          const alternativeXpaths = [
            '//a[contains(@class, "pagination-image-right")]',
            '//a[contains(@class, "pagination") and contains(@class, "pagination-image-right")]',
            '//div[contains(@class, "texte-droite")]/a[contains(@class, "pagination")]'
          ];
          
          for (const altXpath of alternativeXpaths) {
            const altLink = document.evaluate(altXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (altLink && window.getComputedStyle(altLink).display !== 'none') {
              // Vérifier si le bouton est désactivé (grisé)
              const isDisabled = altLink.classList.contains('disabled') || 
                                altLink.hasAttribute('disabled') || 
                                altLink.getAttribute('aria-disabled') === 'true' || 
                                window.getComputedStyle(altLink).opacity === '0.5' || 
                                window.getComputedStyle(altLink).cursor === 'not-allowed';
              
              if (!isDisabled) {
                console.log('Bouton de pagination trouvé avec XPath alternatif:', altXpath);
                return {
                  hasNextPage: true,
                  nextPageUrl: altLink.href,
                  xpath: altXpath
                };
              } else {
                console.log('Bouton de pagination trouvé avec XPath alternatif mais désactivé (grisé)');
                return {
                  hasNextPage: false,
                  nextPageUrl: null,
                  reason: 'button-disabled'
                };
              }
            }
          }
          
          // Recherche par mots-clés en dernier recours
          const allLinks = Array.from(document.querySelectorAll('a'));
          const paginationKeywords = ['suivant', 'next', 'page suivante', '»', '>'];
          let keywordLink = null;
          
          for (const link of allLinks) {
            const linkText = link.textContent.trim().toLowerCase();
            const hasKeyword = paginationKeywords.some(keyword => linkText.includes(keyword.toLowerCase()));
            
            if (hasKeyword) {
              keywordLink = link;
              console.log('Bouton de pagination trouvé par mot-clé:', link.textContent.trim());
              break;
            }
          }
          
          if (keywordLink) {
            // Vérifier si le bouton est désactivé (grisé)
            const isDisabled = keywordLink.classList.contains('disabled') || 
                              keywordLink.hasAttribute('disabled') || 
                              keywordLink.getAttribute('aria-disabled') === 'true' || 
                              window.getComputedStyle(keywordLink).opacity === '0.5' || 
                              window.getComputedStyle(keywordLink).cursor === 'not-allowed';
            
            if (!isDisabled) {
              console.log('Bouton de pagination trouvé par mot-clé:', keywordLink.textContent.trim());
              return {
                hasNextPage: true,
                nextPageUrl: keywordLink.href,
                selector: 'custom-text-match',
                linkText: keywordLink.textContent.trim()
              };
            } else {
              console.log('Bouton de pagination trouvé par mot-clé mais désactivé (grisé)');
              return {
                hasNextPage: false,
                nextPageUrl: null,
                reason: 'button-disabled'
              };
            }
          }
          
          return {
            hasNextPage: false,
            nextPageUrl: null,
            selector: null
          };
        });
        
        // Déboguer les informations de pagination
        console.log('Information de pagination:', JSON.stringify(paginationInfo, null, 2));
        
        console.log('Information de pagination:', paginationInfo);
        
        if (!paginationInfo.hasNextPage) {
          console.log('Aucun bouton de pagination trouvé. Fin du scraping.');
          break;
        }
        
        // Utiliser l'URL directe si disponible plutôt que de cliquer
        if (paginationInfo.linkHref && paginationInfo.linkHref !== currentUrl) {
          console.log(`Utilisation de l'URL directe pour la navigation: ${paginationInfo.linkHref}`);
          try {
            // Mettre à jour l'URL courante
            currentUrl = paginationInfo.linkHref;
            // Naviguer directement vers l'URL de la page suivante
            await page.goto(currentUrl, { 
              waitUntil: 'networkidle2',
              timeout: 1000 // 90 secondes de timeout
            });
            console.log(`Navigation réussie vers la page ${currentPage + 1} via URL directe`);
            // Gérer le challenge Cloudflare si présent après navigation
            await handleCloudflare(page);
            // Incrémenter le compteur de page
            currentPage++;
            continue; // Passer à l'itération suivante
          } catch (directNavError) {
            console.error(`Erreur lors de la navigation directe: ${directNavError.message}`);
            console.log('Tentative de navigation par clic après échec de la navigation directe...');
            // Continuer avec la méthode de clic si la navigation directe échoue
          }
        }
        
        // Cliquer sur le bouton de pagination pour aller à la page suivante
        console.log('Clic sur le bouton de pagination pour aller à la page suivante...');
        
        // Implémentation d'une navigation plus robuste avec retries
        let navigationSuccess = false;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (!navigationSuccess && retryCount < maxRetries) {
          try {
            // Utiliser Promise.all pour attendre à la fois le clic et la navigation
            // Cela évite les problèmes de timing entre le clic et l'attente de navigation
            const nextButton = await page.$x('//DIV[contains(@class,"texte-droite desktop-only")]/A[@class="pagination pagination-image-right"]');
            if (nextButton.length > 0) {
              await Promise.all([
                page.waitForNavigation({ 
                  waitUntil: 'networkidle2', 
                  timeout: 1000 // Augmenter le timeout à 90 secondes
                }),
                nextButton[0].click()
              ]);
            } else {
              throw new Error('Bouton de pagination non trouvé');
            };
            
            console.log(`Navigation réussie vers la page ${currentPage + 1}`);
            navigationSuccess = true;
          } catch (navigationError) {
            retryCount++;
            console.log(`Tentative ${retryCount}/${maxRetries} échouée: ${navigationError.message}`);
            
            if (retryCount >= maxRetries) {
              console.error('Nombre maximum de tentatives atteint. Abandon de la navigation.');
              throw navigationError;
            }
            
            // Attendre avant de réessayer (temps d'attente exponentiel mais limité)
            const waitTime = Math.min(3000, 500 * Math.pow(2, retryCount - 1)); // Limité à 3 secondes maximum
            console.log(`Attente de ${waitTime/1000} secondes avant nouvelle tentative...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // Vérifier si la page a quand même changé malgré l'erreur
            const currentUrl = page.url();
            console.log(`URL actuelle: ${currentUrl}`);
            
            // Si l'URL a changé, considérer que la navigation a réussi
            if (currentUrl.includes('page=') || currentUrl.includes('/page/')) {
              console.log('La page semble avoir changé malgré l\'erreur. Continuation du scraping.');
              
              // Extraire le numéro de page de l'URL pour synchroniser le compteur
              const actualPageNumber = extractPageNumber(currentUrl);
              if (actualPageNumber !== null) {
                // Ajuster le compteur de page pour qu'il corresponde à l'URL réelle
                console.log(`Compteur de page ajusté: ${currentPage} → ${actualPageNumber} d'après l'URL`);
                // Définir directement le compteur de page à la valeur actuelle (sans soustraire 1)
                // pour éviter les problèmes de synchronisation
                currentPage = actualPageNumber;
              }
              
              navigationSuccess = true;
            }
          }
        }
        
        // Gérer le challenge Cloudflare si présent après navigation
        await handleCloudflare(page);
        
        // Vérifier l'URL actuelle pour s'assurer que le compteur de page est synchronisé
        const finalUrl = page.url();
        const urlPageNumber = extractPageNumber(finalUrl);
        
        // Réinitialiser le compteur d'échecs consécutifs car la navigation a réussi
        consecutiveFailures = 0;
        
        if (urlPageNumber !== null) {
          // Si l'URL contient un numéro de page, l'utiliser directement au lieu d'incrémenter
          if (urlPageNumber !== currentPage + 1) {
            console.log(`Synchronisation du compteur de page: ${currentPage + 1} → ${urlPageNumber} d'après l'URL finale`);
            currentPage = urlPageNumber;
          } else {
            // Incrémenter normalement si le numéro de page correspond à ce qu'on attend
            currentPage++;
          }
        } else {
          // Si l'URL ne contient pas de numéro de page, incrémenter normalement
          currentPage++;
        }
      } catch (error) {
        console.error(`Erreur lors du scraping de la page ${currentPage}:`, error);
        
        // Incrémenter le compteur d'échecs consécutifs
        consecutiveFailures++;
        console.log(`Échec consécutif #${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`);
        
        // Vérifier si nous avons atteint le nombre maximum d'échecs consécutifs
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.log(`Nombre maximum d'échecs consécutifs atteint (${MAX_CONSECUTIVE_FAILURES}). Il n'y a probablement plus de pages à scraper.`);
          break; // Sortir de la boucle et terminer le scraping
        }
        
        // Vérifier si c'est une erreur de timeout ou une autre erreur
        if (error.name === 'TimeoutError') {
          console.log('Erreur de timeout détectée. Tentative de continuer avec la page suivante...');
          
          // Vérifier si nous sommes toujours sur la même URL ou si la navigation a partiellement réussi
          const currentUrl = page.url();
          console.log(`URL actuelle après erreur: ${currentUrl}`);
          
          // Vérifier si l'URL contient un numéro de page
          const actualPageNumber = extractPageNumber(currentUrl);
          if (actualPageNumber !== null) {
            // Ajuster le compteur de page pour qu'il corresponde à l'URL réelle
            console.log(`Ajustement du compteur de page: ${currentPage} → ${actualPageNumber} d'après l'URL`);
            // Définir directement le compteur de page à la valeur actuelle
            // pour garantir la synchronisation avec l'URL
            currentPage = actualPageNumber;
          }
          
          // Si nous avons déjà collecté des liens, continuer avec la page suivante
          if (allLinks.length > 0) {
            console.log('Des liens ont déjà été collectés. Tentative de continuer avec la page suivante...');
            currentPage++;
            continue; // Continuer avec la page suivante au lieu de sortir
          }
        }
        
        // Pour les autres types d'erreurs ou si aucun lien n'a été collecté, continuer avec la page suivante
        // au lieu d'arrêter complètement (nous utilisons maintenant le compteur d'échecs consécutifs)
        console.log('Erreur détectée, tentative de continuer avec la page suivante...');
        currentPage++;
        continue; // Continuer avec la page suivante
      }
    }
    
    // Éliminer les doublons potentiels
    const uniqueLinks = [];
    const seenUrls = new Set();
    
    for (const link of allLinks) {
      if (!seenUrls.has(link.href)) {
        seenUrls.add(link.href);
        uniqueLinks.push(link);
      }
    }
    
    console.log(`Scraping terminé. ${uniqueLinks.length} liens uniques trouvés au total.`);
    
    // Visiter chaque lien d'entreprise pour récupérer le numéro SIRET
    console.log('Début de la récupération des numéros SIRET...');
    
    // Visiter tous les liens d'entreprises
    const companiesToVisit = uniqueLinks;
    console.log(`Visite de ${companiesToVisit.length} pages d'entreprises.`);
    
    // Créer une nouvelle page pour visiter les entreprises
    const companyPage = await browser.newPage();
    
    // Configurer le user-agent aléatoire
    await companyPage.setUserAgent(getRandomUserAgent());
    
    // Configurer des en-têtes supplémentaires pour paraître plus humain
    await companyPage.setExtraHTTPHeaders({
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    });
    
    // Modifier les propriétés du navigateur pour éviter la détection
    await companyPage.evaluateOnNewDocument(() => {
      delete navigator.__proto__.webdriver;
      window.navigator.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5].map(() => ({
          length: 1,
          name: `Plugin ${Math.floor(Math.random() * 100)}`
        }))
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['fr-FR', 'fr', 'en-US', 'en']
      });
    });
    
    // Visiter chaque entreprise et récupérer son SIRET
    for (let i = 0; i < companiesToVisit.length; i++) {
      const company = companiesToVisit[i];
      try {
        // Attendre un délai aléatoire entre chaque visite (entre 0.5 et 5 secondes)
        const delay = Math.floor(Math.random() * (5000 - 500 + 1) + 500); // Entre 0.5 et 5 secondes
        console.log(`Attente de ${delay/1000} secondes avant de visiter l'entreprise ${i+1}/${companiesToVisit.length}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        console.log(`Visite de l'entreprise: ${company.text} (${company.href})`);
        
        // Naviguer vers la page de l'entreprise
        await companyPage.goto(company.href, { 
          waitUntil: 'networkidle2',
          timeout: 30000 // 30 secondes de timeout
        });
        
        // Gérer le challenge Cloudflare si présent
        await handleCloudflare(companyPage);
        
        // Faire défiler la page pour simuler un comportement humain
        await autoScroll(companyPage);
        
        // Extraire le numéro SIRET
        const siret = await extractSiret(companyPage);
        
        if (siret) {
          console.log(`SIRET trouvé: ${siret}`);
          company.siret = siret; // Ajouter le SIRET à l'objet entreprise
          
          // Créer l'URL Infonet
          const cleanSiret = siret.replace(/\s+/g, '');
          const companyName = extractCompanyNameFromUrl(company.href);
          const infonetUrl = `https://infonet.fr/entreprises/${cleanSiret}-${companyName}/`;
          company.infonetUrl = infonetUrl;
          
          // Stocker l'URL Infonet
          console.log(`URL Infonet générée: ${infonetUrl}`);
          company.infonetUrl = infonetUrl;
          
          // Ne pas visiter la page Infonet, juste stocker l'URL
          console.log(`Génération du lien Infonet: ${infonetUrl}`);
          
          // Ajouter des données vides pour maintenir la compatibilité avec le code existant
          company.infonetData = {
            contacts: [],
            dirigeant: 'Non visité',
            telephone: 'Non visité',
            email: 'Non visité',
            siteWeb: 'Non visité',
            linkedin: 'Non visité',
            twitter: 'Non visité'
          };
          
          console.log(`Lien Infonet généré avec succès pour ${company.text}`);
          
          // Prendre une capture d'écran pour déboguer (optionnel)
          try {
            await companyPage.screenshot({ path: 'infonet_debug.png' });
            console.log('Capture d\'écran de débogage enregistrée');
          } catch (screenshotError) {
            console.error('Erreur lors de la capture d\'écran:', screenshotError.message);
          }
        } else {
          console.log('Aucun SIRET trouvé pour cette entreprise');
          company.siret = 'Non trouvé';
        }
      } catch (error) {
        console.error(`Erreur lors de la visite de l'entreprise ${company.text}:`, error.message);
        company.siret = 'Erreur';
      }
    }
    
    // Fermer la page d'entreprise
    await companyPage.close();
    
    console.log('Récupération des numéros SIRET terminée.');
    return uniqueLinks;
  } finally {
    await browser.close();
  }
}

// Liste d'user-agents pour la rotation
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
];

// Fonction pour obtenir un user-agent aléatoire
function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Fonction pour attendre un temps aléatoire
function randomDelay(min, max) {
  const delay = Math.floor(Math.random() * (max - min + 1) + min);
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Fonction pour gérer la file d'attente des visites Infonet (max 2 par minute)
async function waitInInfonetQueue() {
  const now = Date.now();
  
  // Nettoyer les visites plus anciennes que 60 secondes
  const oneMinuteAgo = now - 60000;
  while (infonetVisits.length > 0 && infonetVisits[0] < oneMinuteAgo) {
    infonetVisits.shift();
  }
  
  // Vérifier si on a déjà atteint le nombre maximum de visites dans la dernière minute
  if (infonetVisits.length >= MAX_INFONET_VISITS_PER_MINUTE) {
    // Calculer le temps d'attente nécessaire
    const oldestVisit = infonetVisits[0];
    const timeToWait = Math.max(oldestVisit + 60000 - now, MIN_DELAY_BETWEEN_VISITS);
    
    console.log(`Limite de visites Infonet atteinte. Attente de ${timeToWait/1000} secondes...`);
    await new Promise(resolve => setTimeout(resolve, timeToWait));
    
    // Appel récursif pour vérifier à nouveau après l'attente
    return waitInInfonetQueue();
  }
  
  // Si ce n'est pas la première visite, attendre entre 30 et 45 secondes
  if (infonetVisits.length > 0) {
    // Générer un délai aléatoire entre MIN_DELAY_BETWEEN_VISITS et MAX_DELAY_BETWEEN_VISITS
    const delayBetweenVisits = Math.floor(Math.random() * (MAX_DELAY_BETWEEN_VISITS - MIN_DELAY_BETWEEN_VISITS + 1) + MIN_DELAY_BETWEEN_VISITS);
    console.log(`Attente de ${delayBetweenVisits/1000} secondes avant la prochaine visite Infonet...`);
    await new Promise(resolve => setTimeout(resolve, delayBetweenVisits));
  }
  
  // Ajouter un délai aléatoire supplémentaire (entre 0.5 et 2 secondes) pour paraître plus naturel
  const randomWait = Math.floor(Math.random() * (2000 - 500 + 1) + 500);
  await new Promise(resolve => setTimeout(resolve, randomWait));
  
  // Enregistrer cette visite
  infonetVisits.push(now);
  return true;
}

// Fonction pour faire défiler automatiquement la page
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

// Fonction pour gérer le challenge Cloudflare
async function handleCloudflare(page) {
  // Vérifier si on est face à un challenge Cloudflare
  const isCloudflareChallenge = await page.evaluate(() => {
    return document.title?.includes('Cloudflare') || 
           document.body.textContent.includes('Checking your browser') ||
           document.body.textContent.includes('DDoS protection by Cloudflare');
  });
  
  if (isCloudflareChallenge) {
    console.log('Cloudflare détecté, tentative de contournement...');
    // Attendre que le challenge soit résolu (30 secondes max)
    await page.waitForFunction(() => {
      return !document.title?.includes('Cloudflare') && 
             !document.body.textContent.includes('Checking your browser') &&
             !document.body.textContent.includes('DDoS protection by Cloudflare');
    }, { timeout: 30000 }).catch(e => console.log('Timeout en attendant la résolution du challenge Cloudflare'));
    
    // Attendre un peu plus après la résolution du challenge
    await randomDelay(500, 1500); // Entre 0.5 et 1.5 secondes
  }
}

// Fonction pour extraire les liens d'une page
async function extractLinks(page) {
  // Vérifier si nous sommes sur une page de résultats ou une page d'erreur
  const isErrorPage = await page.evaluate(() => {
    return document.body.textContent.includes('Aucun résultat') || 
           document.body.textContent.includes('Page non trouvée');
  });
  
  if (isErrorPage) {
    console.log('Page d\'erreur ou sans résultats détectée');
  }
  
  // Attendre un peu pour s'assurer que tous les éléments sont chargés
  await randomDelay(300, 800); // Entre 0.3 et 0.8 secondes
  
  // Extraire tous les liens de la page et filtrer pour ne garder que les liens d'entreprises
  const links = await page.evaluate(() => {
    // Sélectionner tous les liens de la page
    const anchors = Array.from(document.querySelectorAll('a'));
    console.log(`Nombre total de liens trouvés: ${anchors.length}`);
    
    // Déboguer: afficher quelques liens pour comprendre la structure
    const sampleLinks = anchors.slice(0, 5).map(a => a.href);
    console.log('Exemples de liens:', sampleLinks);
    
    // Déboguer: examiner les éléments de pagination pour mieux comprendre la structure
    const paginationElements = Array.from(document.querySelectorAll('.pagination, [class*="pagination"], [class*="pager"], [class*="page"]'));
    console.log(`Éléments de pagination trouvés: ${paginationElements.length}`);
    if (paginationElements.length > 0) {
      console.log('Classes des éléments de pagination:', paginationElements.map(el => el.className).join(', '));
    }
    
    const uniqueUrls = new Set();
    const result = anchors.map(anchor => {
      return {
        text: anchor.textContent.trim(),
        href: anchor.href,
        title: anchor.title || ''
      };
    })
    .filter(link => {
      // Vérifier si le lien est valide et pointe vers une entreprise
      return link.href && (
        link.href.startsWith('https://www.pappers.fr/entreprise/') ||
        link.href.includes('/entreprise/')
      );
    })
    .filter(link => {
      // Vérifier si ce lien a déjà été ajouté
      if (uniqueUrls.has(link.href)) {
        return false; // Ignorer les doublons
      }
      // Ajouter l'URL au Set pour éviter les futurs doublons
      uniqueUrls.add(link.href);
      return true;
    });
    
    console.log(`Nombre de liens d'entreprises trouvés: ${result.length}`);
    return result;
  });

  return links;
}

// Fonction pour extraire le numéro de page à partir d'une URL
function extractPageNumber(url) {
  if (!url) return null;
  
  try {
    // Essayer d'extraire le numéro de page du paramètre page=X
    const pageParamMatch = url.match(/[?&]page=([0-9]+)/);
    if (pageParamMatch && pageParamMatch[1]) {
      const pageNum = parseInt(pageParamMatch[1], 10);
      if (!isNaN(pageNum) && pageNum > 0) {
        return pageNum;
      }
    }
    
    // Essayer d'extraire le numéro de page du format /page/X/
    const pagePathMatch = url.match(/\/page\/([0-9]+)/);
    if (pagePathMatch && pagePathMatch[1]) {
      const pageNum = parseInt(pagePathMatch[1], 10);
      if (!isNaN(pageNum) && pageNum > 0) {
        return pageNum;
      }
    }
    
    // Rechercher d'autres formats possibles (p=X, etc.)
    const otherFormats = [
      /[?&]p=([0-9]+)/,
      /[?&]pg=([0-9]+)/,
      /\/p\/([0-9]+)/
    ];
    
    for (const regex of otherFormats) {
      const match = url.match(regex);
      if (match && match[1]) {
        const pageNum = parseInt(match[1], 10);
        if (!isNaN(pageNum) && pageNum > 0) {
          return pageNum;
        }
      }
    }
  } catch (error) {
    console.error('Erreur lors de l\'extraction du numéro de page:', error);
  }
  
  return null;
}

// Fonction pour extraire le numéro SIRET d'une page d'entreprise
async function extractSiret(page) {
  try {
    // Attendre que la page soit chargée
    await page.waitForSelector('td', { timeout: 10000 });
    
    // Extraire le numéro SIRET
    const siret = await page.evaluate(() => {
      // Rechercher tous les éléments td qui contiennent un numéro SIRET
      const tds = Array.from(document.querySelectorAll('td'));
      
      // Chercher le td qui contient un numéro SIRET (format: XXX XXX XXX XXXXX)
      for (const td of tds) {
        const text = td.textContent.trim();
        // Vérifier si le texte correspond au format d'un SIRET (14 chiffres, éventuellement avec des espaces)
        if (/^\d{3}\s?\d{3}\s?\d{3}\s?\d{5}$/.test(text.replace(/\D/g, '').trim())) {
          return text.replace(/\s+/g, ' ').trim(); // Normaliser les espaces
        }
      }
      
      return null; // Aucun SIRET trouvé
    });
    
    return siret;
  } catch (error) {
    console.error('Erreur lors de l\'extraction du SIRET:', error.message);
    return null;
  }
}

// Fonction pour générer des données Infonet vides (ne visite plus Infonet)
async function extractInfonetData() {
  // Retourner des données vides puisque nous ne visitons plus les sites Infonet
  return {
    contacts: [],
    dirigeant: 'Non visité',
    telephone: 'Non visité',
    email: 'Non visité',
    siteWeb: 'Non visité',
    linkedin: 'Non visité',
    twitter: 'Non visité'
  };
}

// Fonction pour extraire le nom de l'entreprise à partir de l'URL Pappers
function extractCompanyNameFromUrl(url) {
  if (!url || !url.includes('/entreprise/')) {
    return '';
  }
  
  try {
    // Extraire la partie après /entreprise/
    const urlParts = url.split('/entreprise/');
    if (urlParts.length > 1) {
      // Récupérer la partie après /entreprise/
      let namePart = urlParts[1];
      
      // Supprimer le SIREN à la fin (généralement les derniers 9 chiffres)
      namePart = namePart.replace(/-\d{9}$/, '');
      
      // Nettoyer le nom pour l'URL
      return namePart.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Supprimer les accents
        .replace(/[^a-z0-9]+/g, '-') // Remplacer les caractères non alphanumériques par des tirets
        .replace(/^-+|-+$/g, ''); // Supprimer les tirets au début et à la fin
    }
  } catch (error) {
    console.error('Erreur lors de l\'extraction du nom d\'entreprise:', error);
  }
  
  return '';
}

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});