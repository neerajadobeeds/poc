/**
 * Product data adapter.
 * Fetches product data from the Luma endpoint with authentication headers.
 * In production, replace the parsing logic with your real commerce API client.
 */

/**
 * Fetch and parse the raw product JS file into a usable array.
 * The Luma endpoint returns a JS file with a PRODUCTS const, not pure JSON.
 * We extract the JSON array from the script content.
 */
async function fetchRawProducts(env) {
  const baseUrl = env.PRODUCT_API_BASE_URL || 'https://enablementadobe.com';
  const apikey = env.PRODUCT_API_KEY || '';
  const apiSecret = env.PRODUCT_API_SECRET || '';

  const response = await fetch(`${baseUrl}/js/products.js`, {
    headers: {
      Authorization: `Bearer ${apikey}`,
      'X-Api-Secret': apiSecret,
      Accept: 'application/javascript',
    },
  });

  if (!response.ok) {
    throw new Error(`Product API returned ${response.status}`);
  }

  const scriptText = await response.text();

  // Extract the PRODUCTS array from the JS file using bracket-depth matching
  // (lastIndexOf fails because ProductManager code also contains brackets)
  const arrayStart = scriptText.indexOf('[');
  if (arrayStart === -1) {
    throw new Error('Could not parse product data from API response');
  }
  let depth = 0;
  let arrayEnd = arrayStart;
  for (let i = arrayStart; i < scriptText.length; i += 1) {
    if (scriptText[i] === '[') depth += 1;
    else if (scriptText[i] === ']') depth -= 1;
    if (depth === 0) { arrayEnd = i; break; }
  }

  return JSON.parse(scriptText.substring(arrayStart, arrayEnd + 1));
}

/**
 * Convert a product name to a URL-safe slug.
 */
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
/**
 * Deduplicate products by name (the Luma data has size/color variants as separate entries).
 */
function deduplicateProducts(products) {
  const seen = new Map();
  for (const product of products) {
    const slug = toSlug(product.name);
    if (!seen.has(slug)) {
      seen.set(slug, { ...product, slug });
    }
  }
  return [...seen.values()];
}

/**
 * Fetch products with optional filtering and sorting.
 */
export async function fetchProducts(env, options = {}) {
  const raw = await fetchRawProducts(env);
  let products = deduplicateProducts(raw);

  if (options.category) {
    products = products.filter((p) => p.category === options.category);
  }
  if (options.subcategory) {
    products = products.filter((p) => p.subcategory === options.subcategory);
  }
  if (options.featured) {
    products = products.filter((p) => p.featured);
  }

  if (options.sort === 'price-asc') {
    products.sort((a, b) => a.price - b.price);
  } else if (options.sort === 'price-desc') {
    products.sort((a, b) => b.price - a.price);
  } else if (options.sort === 'name') {
    products.sort((a, b) => a.name.localeCompare(b.name));
  }

  const limit = options.limit || products.length;
  return products.slice(0, limit);
}

/**
 * Fetch a single product by its URL slug.
 */
export async function fetchProductBySlug(env, slug) {
  const raw = await fetchRawProducts(env);
  const products = deduplicateProducts(raw);
  return products.find((p) => p.slug === slug) || null;
}
