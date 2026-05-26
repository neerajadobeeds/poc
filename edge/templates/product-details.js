/**
 * Renders the product-details block HTML.
 * Output follows EDS block markup for client-side decoration.
 */

const CURRENCY = {
  'en-us': { code: 'USD', locale: 'en-US' },
  'en-gb': { code: 'GBP', locale: 'en-GB' },
  'fr-fr': { code: 'EUR', locale: 'fr-FR' },
  'de-de': { code: 'EUR', locale: 'de-DE' },
};

const LABELS = {
  'en-us': {
    addToCart: 'Add to Cart', size: 'Size', color: 'Color', description: 'Description',
  },
  'en-gb': {
    addToCart: 'Add to Basket', size: 'Size', color: 'Colour', description: 'Description',
  },
  'fr-fr': {
    addToCart: 'Ajouter au panier', size: 'Taille', color: 'Couleur', description: 'Description',
  },
  'de-de': {
    addToCart: 'In den Warenkorb', size: 'Größe', color: 'Farbe', description: 'Beschreibung',
  },
};

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(price, locale) {
  const config = CURRENCY[locale] || CURRENCY['en-us'];
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.code,
  }).format(price);
}

function getLabel(key, locale) {
  const labels = LABELS[locale] || LABELS['en-us'];
  return labels[key] || LABELS['en-us'][key];
}

function getImageBaseUrl() {
  return 'https://enablementadobe.com';
}

export function renderProductDetails(product, locale = 'en-us') {
  const imageBase = getImageBaseUrl();
  const name = escapeHtml(product.name);
  const desc = escapeHtml(product.description);
  const price = formatPrice(product.price, locale);
  const imgSrc = product.image.startsWith('http') ? product.image : `${imageBase}/${product.image}`;
  const category = escapeHtml(product.category || '');
  const subcategory = escapeHtml(product.subcategory || '');

  const sizesHtml = (product.sizes || [])
    .map((s) => `<li><button class="product-size-btn" type="button">${escapeHtml(s)}</button></li>`)
    .join('\n ');

  const colorsHtml = (product.colors || [])
    .map((c) => `<li><button class="product-color-btn" type="button" style="background-color: ${escapeHtml(c.hex)}" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button></li>`)
    .join('\n ');

  return `<div class="product-details">
  <div>
    <div class="product-details-image">
      <picture><img src="${escapeHtml(imgSrc)}" alt="${name}" loading="eager" width="600" height="450"></picture>
    </div>
    <div class="product-details-info">
      <p class="product-category">${category} / ${subcategory}</p>
      <h1>${name}</h1>
      <p class="product-price">${price}</p>
      <div class="product-sizes">
        <h4>${getLabel('size', locale)}</h4>
        <ul>
          ${sizesHtml}
        </ul>
      </div>
      <div class="product-colors">
        <h4>${getLabel('color', locale)}</h4>
        <ul>
          ${colorsHtml}
        </ul>
      </div>
      <p class="product-add-to-cart">
        <strong><a href="#">${getLabel('addToCart', locale)}</a></strong>
      </p>
      <div class="product-description-block">
        <h4>${getLabel('description', locale)}</h4>
        <p>${desc}</p>
      </div>
    </div>
  </div>
</div>`;
}
