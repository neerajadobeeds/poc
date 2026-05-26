import { readBlockConfig, createOptimizedPicture } from '../../scripts/aem.js';

const LUMA_BASE = 'https://enablementadobe.com';

/**
 * Client-side fallback: fetches a single product for local dev.
 */
async function fetchProductFallback(slug) {
  const apiUrl = `${LUMA_BASE}/js/products.js`;
  const fetchUrl = window.location.hostname === 'localhost'
    ? `/proxy?url=${encodeURIComponent(apiUrl)}`
    : apiUrl;
  const resp = await fetch(fetchUrl);
  const text = await resp.text();
  const start = text.indexOf('[');
  let depth = 0;
  let end = start;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') depth -= 1;
    if (depth === 0) { end = i; break; }
  }
  const products = JSON.parse(text.substring(start, end + 1));

  const seen = new Map();
  products.forEach((p) => {
    const s = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!seen.has(s)) seen.set(s, { ...p, slug: s });
  });

  return seen.get(slug) || null;
}

function renderProductFallback(product, block) {
  const imgSrc = product.image.startsWith('http') ? product.image : `${LUMA_BASE}/${product.image}`;
  
  block.innerHTML = `
    <div>
      <div class="product-details-image">
        <picture><img src="${imgSrc}" alt="${product.name}" loading="eager" width="600" height="450"></picture>
      </div>
      <div class="product-details-info">
        <p class="product-category">${product.category} / ${product.subcategory}</p>
        <h1>${product.name}</h1>
        <p class="product-price">$${product.price.toFixed(2)}</p>
        <div class="product-sizes">
          <h4>Size</h4>
          <ul>${product.sizes.map((s) => `<li><button class="product-size-btn" type="button">${s}</button></li>`).join('')}</ul>
        </div>
        <div class="product-colors">
          <h4>Color</h4>
          <ul>${product.colors.map((c) => `<li><button class="product-color-btn" type="button" style="background-color: ${c.hex}" title="${c.name}">${c.name}</button></li>`).join('')}</ul>
        </div>
        <p class="button-wrapper"><a class="button accent" href="#">Add to Cart</a></p>
        <div class="product-description-block">
          <h4>Description</h4>
          <p>${product.description}</p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Adds size and color selection interactivity.
 */
function addInteractivity(block) {
  // Size selection
  block.querySelectorAll('.product-size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      block.querySelectorAll('.product-size-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Color selection
  block.querySelectorAll('.product-color-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      block.querySelectorAll('.product-color-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
}

/**
 * Decorates the product-details block.
 * * If edge worker pre-rendered, just adds interactivity.
 * * Otherwise fetches product data client-side (local dev fallback).
 */
export default async function decorate(block) {
  const preRendered = block.querySelector('h1');

  if (preRendered) {
    // Edge-composed: optimize images and add interactivity
    block.querySelectorAll('picture > img').forEach((img) => {
      const optimized = createOptimizedPicture(img.src, img.alt, true, [{ width: '750' }]);
      img.closest('picture').replaceWith(optimized);
    });
    addInteractivity(block);
    return;
  }

  // Client-side fallback for local dev
  const config = readBlockConfig(block);
  const slug = config.slug || window.location.pathname.split('/').pop();
  block.textContent = '';

  const product = await fetchProductFallback(slug);
  if (!product) {
    block.innerHTML = '<p>Product not found.</p>';
    return;
  }

  renderProductFallback(product, block);
  addInteractivity(block);
}
