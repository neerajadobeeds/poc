import { readBlockConfig, createOptimizedPicture } from '../../scripts/aem.js';

const LUMA_BASE = 'https://enablementadobe.com';

/**
 * Fetches products client-side (local dev fallback only).
 * In production the edge composition worker pre-renders the product HTML,
 * so this code path is never reached.
 */
async function fetchProductsFallback(config) {
  const apiUrl = `${LUMA_BASE}/js/products.js`;
  const fetchUrl = window.location.hostname === 'localhost'
    ? `/proxy?url=${encodeURIComponent(apiUrl)}`
    : apiUrl;
  const resp = await fetch(fetchUrl);
  const text = await resp.text();
  // Find the PRODUCTS array: match the first '[' and its closing ']'
  const start = text.indexOf('[');
  let depth = 0;
  let end = start;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') depth -= 1;
    if (depth === 0) { end = i; break; }
  }
  let products = JSON.parse(text.substring(start, end + 1));

  // deduplicate by name
  const seen = new Map();
  products.forEach((p) => {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!seen.has(slug)) seen.set(slug, { ...p, slug });
  });
  products = [...seen.values()];

  if (config.category) products = products.filter((p) => p.category === config.category);
  if (config.subcategory) products = products.filter((p) => p.subcategory === config.subcategory);
  if (config.featured === 'true') products = products.filter((p) => p.featured);
  if (config.sort === 'price-asc') products.sort((a, b) => a.price - b.price);
  else if (config.sort === 'price-desc') products.sort((a, b) => b.price - a.price);
  else if (config.sort === 'name') products.sort((a, b) => a.name.localeCompare(b.name));

  const limit = parseInt(config.limit, 10) || 12;
  return products.slice(0, limit);
}

function renderCard(product) {
  const imgSrc = product.image.startsWith('http') ? product.image : `${LUMA_BASE}/${product.image}`;
  const li = document.createElement('li');
  li.innerHTML = `
    <div class="product-list-card-image">
      <picture><img src="${imgSrc}" alt="${product.name}" loading="lazy" width="300" height="225"></picture>
    </div>
    <div class="product-list-card-body">
      <h3>${product.name}</h3>
      <p class="product-price">$${product.price.toFixed(2)}</p>
  <p class="product-description">${product.description}</p>
  <p class="button-wrapper"><a class="button primary" href="/products/${product.slug}">Shop Now</a></p>
</div>`;
  return li;
}

/**
 * Decorates the product-list block.
 * If the edge worker has already rendered products, this just
 * transforms the markup into an accessible list. Otherwise it
 * fetches data client-side as a local dev fallback.
 */
export default async function decorate(block) {
  // Check if the edge worker already rendered product cards
  const preRendered = block.querySelector('h3');
  if (preRendered) {
    // Edge-composed path: transform rows into an <ul>
    const ul = document.createElement('ul');
    [...block.children].forEach((row) => {
      const li = document.createElement('li');
      while (row.firstElementChild) li.append(row.firstElementChild);
      [...li.children].forEach((div) => {
        if (div.children.length === 1 && div.querySelector('picture')) {
          div.className = 'product-list-card-image';
        } else {
          div.className = 'product-list-card-body';
        }
      });
      ul.append(li);
    });

    // Optimize images
    ul.querySelectorAll('picture > img').forEach((img) => {
      const optimized = createOptimizedPicture(img.src, img.alt, false, [{ width: '400' }]);
      img.closest('picture').replaceWith(optimized);
    });

    block.replaceChildren(ul);
    return;
  }

  // Client-side fallback for local dev (no edge worker)
  const config = readBlockConfig(block);
  block.textContent = '';

  const products = await fetchProductsFallback(config);
  const ul = document.createElement('ul');
  products.forEach((product) => ul.append(renderCard(product)));
  block.append(ul);
}
