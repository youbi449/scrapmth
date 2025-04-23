document.addEventListener('DOMContentLoaded', () => {
  // Éléments du DOM
  const scrapeForm = document.getElementById('scrapeForm');
  const urlInputsContainer = document.getElementById('urlInputsContainer');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const resultsContainer = document.getElementById('resultsContainer');
  const resultsTable = document.getElementById('resultsTable');
  const linksCount = document.getElementById('linksCount');
  const errorContainer = document.getElementById('errorContainer');
  const errorMessage = document.getElementById('errorMessage');
  const exportCSV = document.getElementById('exportCSV');
  const exportJSON = document.getElementById('exportJSON');
  const stopScraping = document.getElementById('stopScraping');
  
  // Gestion des champs d'URL multiples
  document.addEventListener('click', (e) => {
    // Ajouter un nouveau champ d'URL
    if (e.target.classList.contains('btn-add-url')) {
      const inputGroup = document.createElement('div');
      inputGroup.className = 'input-group mb-2';
      inputGroup.innerHTML = `
        <input type="url" class="form-control urlInput" name="url[]" placeholder="https://www.pappers.fr/recherche?activite=35.11Z..." required>
        <button type="button" class="btn btn-outline-secondary btn-add-url">+</button>
        <button type="button" class="btn btn-outline-danger btn-remove-url">-</button>
      `;
      urlInputsContainer.appendChild(inputGroup);
    }
    
    // Supprimer un champ d'URL
    if (e.target.classList.contains('btn-remove-url')) {
      e.target.closest('.input-group').remove();
    }
  });

  // Données des résultats
  let scrapedLinks = [];
  let currentPage = 1;
  const linksPerPage = 20;

  // Gestionnaire pour le bouton d'arrêt
  stopScraping.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/stop-scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      if (response.ok) {
        // Afficher un message indiquant que l'arrêt a été demandé
        showError('Arrêt du scraping demandé. Veuillez patienter pendant que les données déjà collectées sont traitées...');
      }
    } catch (error) {
      console.error('Erreur lors de la demande d\'arrêt:', error);
    }
  });

  // Gestionnaire de soumission du formulaire
  scrapeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Récupérer toutes les URLs
    const urlInputs = document.querySelectorAll('.urlInput');
    const urls = Array.from(urlInputs).map(input => input.value.trim()).filter(url => url !== '');
    
    if (urls.length === 0) return;

    // Réinitialiser et afficher le chargement
    resetUI();
    showLoading(true);

    try {
      // Appel à l'API de scraping avec plusieurs URLs
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ urls })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Erreur lors du scraping');
      }

      // Traiter et afficher les résultats
      scrapedLinks = data.links || [];
      currentPage = 1; // Réinitialiser à la première page
      displayResults();
      
      // Afficher un message si les résultats sont partiels
      if (data.partial) {
        showError('Le scraping a été arrêté manuellement. Les résultats affichés sont partiels.');
      }
      
      // Déclencher automatiquement l'export si des résultats sont disponibles
      if (scrapedLinks.length > 0) {
        // Exporter automatiquement en CSV et JSON
        triggerExport();
      }
    } catch (error) {
      showError(error.message);
    } finally {
      showLoading(false);
    }
  });

  // Fonction pour afficher les résultats avec pagination
  function displayResults() {
    if (scrapedLinks.length === 0) {
      showError('Aucun lien trouvé sur cette page');
      return;
    }

    // Calculer les liens à afficher pour la page actuelle
    const startIndex = (currentPage - 1) * linksPerPage;
    const endIndex = Math.min(startIndex + linksPerPage, scrapedLinks.length);
    const currentLinks = scrapedLinks.slice(startIndex, endIndex);

    // Vider la table
    resultsTable.innerHTML = '';
    
    // Ajouter les liens de la page actuelle
    currentLinks.forEach((link) => {
      const row = document.createElement('tr');
      
      // Texte du lien
      const textCell = document.createElement('td');
      textCell.textContent = link.text || '(Sans texte)';
      row.appendChild(textCell);
      
      // URL du lien
      const urlCell = document.createElement('td');
      const urlSpan = document.createElement('span');
      urlSpan.textContent = link.href;
      urlSpan.className = 'link-preview';
      urlSpan.title = link.href;
      urlCell.appendChild(urlSpan);
      row.appendChild(urlCell);
      
      // Titre du lien
      const titleCell = document.createElement('td');
      titleCell.textContent = link.title || '(Sans titre)';
      row.appendChild(titleCell);
      
      // SIRET
      const siretCell = document.createElement('td');
      siretCell.textContent = link.siret || 'En attente';
      row.appendChild(siretCell);
      
      // Lien Infonet
      const infonetCell = document.createElement('td');
      if (link.siret) {
        const infonetLink = document.createElement('a');
        // Utiliser l'URL Pappers pour extraire le nom de l'entreprise
        const infonetUrl = link.infonetUrl || createInfonetLink(link.siret, link.href);
        infonetLink.href = infonetUrl;
        infonetLink.target = '_blank';
        infonetLink.className = 'btn btn-sm btn-outline-success';
        infonetLink.textContent = 'Infonet';
        infonetLink.title = infonetUrl;
        infonetCell.appendChild(infonetLink);
        
        // Ajouter un bouton pour afficher les données Infonet
        if (link.infonetData) {
          const infoButton = document.createElement('button');
          infoButton.className = 'btn btn-sm btn-info ml-2';
          infoButton.textContent = 'Infos';
          infoButton.title = 'Afficher les informations Infonet';
          infoButton.addEventListener('click', () => {
            showInfonetData(link.infonetData, link.text);
          });
          infonetCell.appendChild(infoButton);
        }
      } else {
        infonetCell.textContent = 'Non disponible';
      }
      row.appendChild(infonetCell);
      
      // Actions
      const actionCell = document.createElement('td');
      const openButton = document.createElement('a');
      openButton.href = link.href;
      openButton.target = '_blank';
      openButton.className = 'btn btn-sm btn-outline-primary';
      openButton.textContent = 'Ouvrir';
      actionCell.appendChild(openButton);
      row.appendChild(actionCell);
      
      resultsTable.appendChild(row);
    });

    // Mettre à jour le compteur
    linksCount.textContent = scrapedLinks.length;
    resultsContainer.classList.remove('d-none');
    
    // Mettre à jour la pagination
    updatePagination();
  }

  // Fonction pour créer un lien Infonet à partir du SIRET et du nom de l'entreprise
  function createInfonetLink(siret, companyName) {
    // Nettoyer le SIRET (supprimer les espaces)
    const cleanSiret = siret ? siret.replace(/\s+/g, '') : '';
    
    // Extraire le nom de l'entreprise à partir de l'URL Pappers si disponible
    let cleanName = '';
    
    // Vérifier si companyName est une URL Pappers
    if (companyName && companyName.includes('/entreprise/')) {
      try {
        // Extraire le nom de l'entreprise à partir de l'URL Pappers
        // Format: https://www.pappers.fr/entreprise/nom-entreprise-siren
        const urlParts = companyName.split('/entreprise/');
        if (urlParts.length > 1) {
          // Récupérer la partie après /entreprise/
          let namePart = urlParts[1];
          
          // Supprimer le SIREN à la fin (généralement les derniers 9 chiffres)
          namePart = namePart.replace(/-\d{9}$/, '');
          
          // Nettoyer le nom pour l'URL
          cleanName = namePart.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Supprimer les accents
            .replace(/[^a-z0-9]+/g, '-') // Remplacer les caractères non alphanumériques par des tirets
            .replace(/^-+|-+$/g, ''); // Supprimer les tirets au début et à la fin
        }
      } catch (error) {
        console.error('Erreur lors de l\'extraction du nom d\'entreprise:', error);
      }
    } else if (companyName) {
      // Utiliser le texte du lien comme avant si ce n'est pas une URL Pappers
      cleanName = companyName.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Supprimer les accents
        .replace(/[^a-z0-9]+/g, '-') // Remplacer les caractères non alphanumériques par des tirets
        .replace(/^-+|-+$/g, ''); // Supprimer les tirets au début et à la fin
    }
    
    // Construire l'URL Infonet
    return `https://infonet.fr/entreprises/${cleanSiret}-${cleanName}/`;
  }

  // Fonction pour mettre à jour les contrôles de pagination
  function updatePagination() {
    // Supprimer la pagination existante si elle existe
    const existingPagination = document.getElementById('paginationControls');
    if (existingPagination) {
      existingPagination.remove();
    }
    
    // Créer les contrôles de pagination seulement s'il y a plus d'une page
    if (scrapedLinks.length <= linksPerPage) return;
    
    const totalPages = Math.ceil(scrapedLinks.length / linksPerPage);
    
    // Créer le conteneur de pagination
    const paginationDiv = document.createElement('div');
    paginationDiv.id = 'paginationControls';
    paginationDiv.className = 'mt-3 d-flex justify-content-center';
    
    // Créer la navigation de pagination
    const paginationNav = document.createElement('nav');
    const paginationUl = document.createElement('ul');
    paginationUl.className = 'pagination';
    
    // Bouton précédent
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
    const prevLink = document.createElement('a');
    prevLink.className = 'page-link';
    prevLink.href = '#';
    prevLink.textContent = 'Précédent';
    prevLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentPage > 1) {
        currentPage--;
        displayResults();
      }
    });
    prevLi.appendChild(prevLink);
    paginationUl.appendChild(prevLi);
    
    // Pages numérotées
    const maxVisiblePages = 400; // Nombre maximum de pages à afficher
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    // Ajuster si on est proche de la fin
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    // Ajouter les numéros de page
    for (let i = startPage; i <= endPage; i++) {
      const pageLi = document.createElement('li');
      pageLi.className = `page-item ${i === currentPage ? 'active' : ''}`;
      const pageLink = document.createElement('a');
      pageLink.className = 'page-link';
      pageLink.href = '#';
      pageLink.textContent = i;
      pageLink.addEventListener('click', (e) => {
        e.preventDefault();
        currentPage = i;
        displayResults();
      });
      pageLi.appendChild(pageLink);
      paginationUl.appendChild(pageLi);
    }
    
    // Bouton suivant
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    const nextLink = document.createElement('a');
    nextLink.className = 'page-link';
    nextLink.href = '#';
    nextLink.textContent = 'Suivant';
    nextLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentPage < totalPages) {
        currentPage++;
        displayResults();
      }
    });
    nextLi.appendChild(nextLink);
    paginationUl.appendChild(nextLi);
    
    // Ajouter la pagination au DOM
    paginationNav.appendChild(paginationUl);
    paginationDiv.appendChild(paginationNav);
    
    // Ajouter l'information sur la page actuelle
    const pageInfo = document.createElement('div');
    pageInfo.className = 'text-center mt-2';
    pageInfo.textContent = `Page ${currentPage} sur ${totalPages} (${scrapedLinks.length} liens au total)`;
    paginationDiv.appendChild(pageInfo);
    
    // Ajouter au conteneur de résultats
    resultsContainer.appendChild(paginationDiv);
  }
  
  // Fonction pour afficher les données Infonet dans une modal
  function showInfonetData(infonetData, companyName) {
    // Créer ou réutiliser la modal
    let modal = document.getElementById('infonetModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'infonetModal';
      modal.className = 'modal fade';
      modal.setAttribute('tabindex', '-1');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-labelledby', 'infonetModalLabel');
      modal.setAttribute('aria-hidden', 'true');
      
      modal.innerHTML = `
        <div class="modal-dialog modal-lg" role="document">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="infonetModalLabel">Informations Infonet</h5>
              <button type="button" class="close" data-dismiss="modal" aria-label="Fermer">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div class="modal-body" id="infonetModalBody">
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-dismiss="modal">Fermer</button>
            </div>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
    }
    
    // Mettre à jour le titre de la modal
    const modalTitle = modal.querySelector('.modal-title');
    modalTitle.textContent = `Informations Infonet - ${companyName || 'Entreprise'}`;
    
    // Mettre à jour le contenu de la modal
    const modalBody = modal.querySelector('#infonetModalBody');
    
    // Créer le contenu HTML pour les informations de l'entreprise
    let infonetHtml = '<div class="container">';
    
    // Informations principales
    infonetHtml += '<div class="row mb-4">';
    infonetHtml += '<div class="col-12">';
    infonetHtml += '<h6 class="border-bottom pb-2">Informations générales</h6>';
    infonetHtml += '<div class="table-responsive">';
    infonetHtml += '<table class="table table-sm">';
    infonetHtml += '<tbody>';
    
    // Ajouter chaque information disponible
    const infoFields = [
      { key: 'dirigeant', label: 'Dirigeant' },
      { key: 'telephone', label: 'Téléphone' },
      { key: 'email', label: 'Email' },
      { key: 'siteWeb', label: 'Site web' },
      { key: 'linkedin', label: 'LinkedIn' },
      { key: 'twitter', label: 'X' }
    ];
    
    infoFields.forEach(field => {
      const value = infonetData[field.key] || 'Non disponible';
      infonetHtml += `<tr>
        <th scope="row" style="width: 120px;">${field.label}</th>
        <td>${value}</td>
      </tr>`;
    });
    
    infonetHtml += '</tbody></table></div></div></div>';
    
    // Contacts si disponibles
    if (infonetData.contacts && infonetData.contacts.length > 0) {
      infonetHtml += '<div class="row mb-4">';
      infonetHtml += '<div class="col-12">';
      infonetHtml += '<h6 class="border-bottom pb-2">Contacts</h6>';
      infonetHtml += '<div class="table-responsive">';
      infonetHtml += '<table class="table table-sm">';
      infonetHtml += '<thead><tr><th>Nom</th><th>Fonction</th><th>Email</th><th>Téléphone</th></tr></thead>';
      infonetHtml += '<tbody>';
      
      infonetData.contacts.forEach(contact => {
        infonetHtml += `<tr>
          <td>${contact.name || 'Non disponible'}</td>
          <td>${contact.role || 'Non disponible'}</td>
          <td>${contact.email || 'Non disponible'}</td>
          <td>${contact.phone || 'Non disponible'}</td>
        </tr>`;
      });
      
      infonetHtml += '</tbody></table></div></div></div>';
    } else {
      infonetHtml += '<div class="row mb-4"><div class="col-12"><p>Aucun contact disponible</p></div></div>';
    }
    
    infonetHtml += '</div>'; // Fermer le container
    
    // Mettre à jour le contenu de la modal
    modalBody.innerHTML = infonetHtml;
    
    // Afficher la modal
    $(modal).modal('show');
  }

  // Gestionnaire pour l'export CSV
  exportCSV.addEventListener('click', () => {
    if (scrapedLinks.length === 0) return;
    
    const csvContent = 'data:text/csv;charset=utf-8,' + 
      'Texte,URL,Titre,SIRET\n' + 
      scrapedLinks.map(link => {
        return `"${escapeCSV(link.text)}","${escapeCSV(link.href)}","${escapeCSV(link.title)}","${escapeCSV(link.siret || '')}"`;
      }).join('\n');
    
    downloadFile(csvContent, 'liens_scrapes.csv');
  });

  // Gestionnaire pour l'export JSON
  exportJSON.addEventListener('click', () => {
    if (scrapedLinks.length === 0) return;
    
    const jsonContent = 'data:text/json;charset=utf-8,' + 
      encodeURIComponent(JSON.stringify(scrapedLinks, null, 2));
    
    downloadFile(jsonContent, 'liens_scrapes.json');
  });

  // Fonction pour échapper les caractères spéciaux dans le CSV
  function escapeCSV(str) {
    if (!str) return '';
    return str.replace(/\"/g, '""');
  }

  // Fonction pour télécharger un fichier
  function downloadFile(content, fileName) {
    const encodedUri = encodeURI(content);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  
  // Fonction pour déclencher l'export automatique des résultats
  function triggerExport() {
    // Générer un timestamp pour les noms de fichiers
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Exporter en CSV avec uniquement SIRET et lien Infonet
    const csvContent = 'data:text/csv;charset=utf-8,' + 
      'SIRET,Infonet\n' + 
      scrapedLinks.map(link => {
        // S'assurer que le SIRET est correctement formaté
        const cleanSiret = link.siret ? link.siret.replace(/\s+/g, '') : '';
        // Générer l'URL Infonet en utilisant le SIRET et l'URL de l'entreprise
        const infonetUrl = link.infonetUrl || createInfonetLink(link.siret, link.href);
        return `"${escapeCSV(link.siret || '')}","${escapeCSV(infonetUrl)}"`;
      }).join('\n');
    
    downloadFile(csvContent, `siret_infonet_${timestamp}.csv`);
    
    // Exporter en JSON après un court délai pour éviter les problèmes de téléchargement simultané
    setTimeout(() => {
      // Créer un nouvel array avec uniquement SIRET et Infonet pour chaque élément
      const simplifiedData = scrapedLinks.map(link => {
        const infonetUrl = link.infonetUrl || createInfonetLink(link.siret, link.href);
        return {
          siret: link.siret || '',
          infonet: infonetUrl
        };
      });
      
      const jsonContent = 'data:text/json;charset=utf-8,' + 
        encodeURIComponent(JSON.stringify(simplifiedData, null, 2));
      
      downloadFile(jsonContent, `siret_infonet_${timestamp}.json`);
    }, 1000);
  }

  // Fonction pour afficher/masquer le chargement
  function showLoading(show) {
    if (show) {
      loadingIndicator.classList.remove('d-none');
    } else {
      loadingIndicator.classList.add('d-none');
    }
  }

  // Fonction pour afficher une erreur
  function showError(message) {
    errorMessage.textContent = message;
    errorContainer.classList.remove('d-none');
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
  
  // Fonction pour réinitialiser l'interface
  function resetUI() {
    resultsTable.innerHTML = '';
    resultsContainer.classList.add('d-none');
    errorContainer.classList.add('d-none');
    scrapedLinks = [];
    
    // Supprimer la pagination existante si elle existe
    const existingPagination = document.getElementById('paginationControls');
    if (existingPagination) {
      existingPagination.remove();
    }
  }
});