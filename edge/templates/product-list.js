/**
 * Renders the product-list block HTML.
 * Output follows EDS block markup conventions so the client-side
 * block JS/CSS can decorate it like any authored block.
 */

const CURRENCY = {
  'en-us': { code: 'USD', locale: 'en-US' },
  'en-gb': { code: 'GBP', locale: 'en-GB' },
  'fr-fr': { code: 'EUR', locale: 'fr-FR' },
  'de-de': { code: 'EUR', locale: 'de-DE' },
};

const LABELS = {
  'en-us': { shopNow: 'Shop Now' },
  'en-gb': { shopNow: 'Shop Now' },
  'fr-fr': { shopNow: 'Acheter' },
  'de-de': { shopNow: 'Jetzt kaufen' },
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

export function renderProductList(products, locale = 'en-us') {
  const imageBase = getImageBaseUrl();

  const rows = products.map((product) => {
    const name = escapeHtml(product.name);
    const desc = escapeHtml(product.description);
    const price = formatPrice(product.price, locale);
    const imgSrc = product.image.startsWith('http') ? product.image : `${imageBase}/${product.image}`;
    const slug = product.slug || product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const label = getLabel('shopNow', locale);

    return ` <div>
      <div><picture><img src="${escapeHtml(imgSrc)}" alt="${name}" loading="lazy" width="300" height="225"></picture></div>
      <div>
        <h3>${name}</h3>
        <p class="product-price">${price}</p>
        <p class="product-description">${desc}</p>
        <p><strong><a href="/products/${slug}">${label}</a></strong></p>
      </div>
    </div>`;
  });

  return `<div class="product-list">
${rows.join('\n')}
</div>`;
}
