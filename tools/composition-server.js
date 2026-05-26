/**
 * Mimics the Cloudflare Worker logic (edge/worker.js) but runs
 * as a plain Node.js HTTP server for zero-dependency local testing.
 * 
 * Flow:
 * Browser -> localhost:8787 (this server, composition layer)
 * -> fetches raw CMS HTML from localhost:3000 (local-server.js)
 * -> finds dynamic blocks, fetches product data, renders HTML
 * -> returns fully composed page to browser
 * 
 * Usage: node tools/composition-server.js
 */

const http = require('http');
const https = require('https');

// Allow self-signed / corporate proxy certs for local dev only
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const COMPOSITION_PORT = 8787;
const CMS_ORIGIN = 'http://localhost:3000';
const PRODUCT_API_URL = 'https://enablementadobe.com';

// --- Product Data Adapter ---

let productCache = null;

function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https') ? https : http;
    getter.get(url, { headers: { 'User-Agent': 'CompositionServer/1.0' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function getAllProducts() {
  if (productCache) return productCache;

  const scriptText = await httpGet(PRODUCT_API_URL);
  const arrayStart = scriptText.indexOf('[');
  let depth = 0;
  let arrayEnd = arrayStart;
  for (let i = arrayStart; i < scriptText.length; i += 1) {
    if (scriptText[i] === '[') depth += 1;
    else if (scriptText[i] === ']') depth -= 1;
    if (depth === 0) { arrayEnd = i; break; }
  }

  const raw = JSON.parse(scriptText.substring(arrayStart, arrayEnd + 1));

  // Deduplicate by name
  const seen = new Map();
  raw.forEach((p) => {
    const slug = toSlug(p.name);
    if (!seen.has(slug)) {
      seen.set(slug, { ...p, slug });
    }
  });

  productCache = [...seen.values()];
  return productCache;
}

async function fetchProducts(options = {}) {
  let products = await getAllProducts();

  if (options.category) products = products.filter((p) => p.category === options.category);
  if (options.subcategory) products = products.filter((p) => p.subcategory === options.subcategory);
  if (options.featured) products = products.filter((p) => p.featured);

  if (options.sort === 'price-asc') products.sort((a, b) => a.price - b.price);
  else if (options.sort === 'price-desc') products.sort((a, b) => b.price - a.price);
  else if (options.sort === 'name') products.sort((a, b) => a.name.localeCompare(b.name));

  const limit = options.limit || products.length;
  return products.slice(0, limit);
}

async function fetchProductBySlug(slug) {
  const products = await getAllProducts();
  return products.find((p) => p.slug === slug) || null;
}

// --- HTML Templates ---

const IMAGE_BASE = 'https://enablementadobe.com';

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatPrice(price) {
  return `$${price.toFixed(2)}`;
}

function renderProductListHtml(products) {
  const rows = products.map((product) => {
    const name = escapeHtml(product.name);
    const desc = escapeHtml(product.description);
    const price = formatPrice(product.price);
    const imgSrc = product.image.startsWith('http') ? product.image : `${IMAGE_BASE}/${product.image}`;
    const slug = product.slug;

    return ` <div>
      <div><picture><img src="${escapeHtml(imgSrc)}" alt="${name}" loading="lazy" width="300" height="225"></picture></div>
      <div>
        <h3>${name}</h3>
        <p class="product-price">${price}</p>
        <p class="product-description">${desc}</p>
        <p><strong><a href="/products/${slug}">Shop Now</a></strong></p>
      </div>
    </div>`;
  });

  return `<div class="product-list">
${rows.join('\n')}
</div>`;
}

function renderProductDetailsHtml(product) {
  const name = escapeHtml(product.name);
  const desc = escapeHtml(product.description);
  const price = formatPrice(product.price);
  const imgSrc = product.image.startsWith('http') ? product.image : `${IMAGE_BASE}/${product.image}`;
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
        <h4>Size</h4>
        <ul>${sizesHtml}</ul>
      </div>
      <div class="product-colors">
        <h4>Color</h4>
        <ul>${colorsHtml}</ul>
      </div>
      <p class="product-add-to-cart">
        <strong><a href="#">Add to Cart</a></strong>
      </p>
      <div class="product-description-block">
        <h4>Description</h4>
        <p>${desc}</p>
      </div>
    </div>
  </div>
</div>`;
}

// --- Block Config Parser ---

function parseBlockConfig(blockHtml) {
  const config = {};
  const rowPattern = /<div>\s*<div>([\s\S]*?)<\/div>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let match = rowPattern.exec(blockHtml);
  while (match) {
    const key = match[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
    const value = match[2].replace(/<[^>]+>/g, '').trim();
    if (key) config[key] = value;
    match = rowPattern.exec(blockHtml);
  }
  return config;
}

// --- Composition Engine ---

async function renderProductListBlock(blockHtml) {
  const config = parseBlockConfig(blockHtml);
  const products = await fetchProducts({
    category: config.category,
    subcategory: config.subcategory,
    featured: config.featured === 'true',
    limit: parseInt(config.limit, 10) || 12,
    sort: config.sort,
  });
  return renderProductListHtml(products);
}

async function renderProductDetailsBlock(blockHtml) {
  const config = parseBlockConfig(blockHtml);
  const product = await fetchProductBySlug(config.slug);
  if (!product) {
    return '<div class="product-details"><div><p>Product not found.</p></div></div>';
  }
  return renderProductDetailsHtml(product);
}

const BLOCK_RENDERERS = {
  'product-list': renderProductListBlock,
  'product-details': renderProductDetailsBlock,
};

async function composePage(html) {
  let composed = html;

  for (const [blockName, renderer] of Object.entries(BLOCK_RENDERERS)) {
    // Match: <div class="product-list dynamic">...config rows...</div>
    // The block div contains nested row divs and is closed by its own </div>
    const regex = new RegExp(
      `<div class="${blockName} dynamic">([\\s\\S]*?)</div>\\s*(?:</div>\\s*)?`,
      'gi'
    );
    const matches = [...composed.matchAll(regex)];
    for (const match of matches) {
      const fullMatch = match[0];
      const innerHtml = match[1];
      // eslint-disable-next-line no-await-in-loop
      const rendered = await renderer(innerHtml);
      composed = composed.replace(fullMatch, rendered);
    }
  }

  return composed;
}

// --- Template-Based Routing ---

/**
 * Maps URL patterns to CMS template paths.
 * When a request matches a pattern, the composition server
 * fetches the TEMPLATE from the CMS (not a page per product).
 * 
 * The template is authored once in the CMS and reused for all matching URLs.
 * Placeholders like __SLUG__, __CATEGORY__, etc. are replaced with values extracted from the URL.
 */
const TEMPLATE_ROUTES = [
  {
    // /products/{slug} -> uses /products/template from CMS
    pattern: /^\/products\/([a-z0-9-]+)$/,
    templatePath: '/products/template',
    extractParams: (match) => ({ slug: match[1] }),
  },
  // Add more template routes here as needed, e.g.:
  // {
  // pattern: /^\/categories\/([a-z0-9-]+)$/,
  // templatePath: '/categories/template',
  // extractParams: (match) => ({ category: match[1] }),
  // },
];

/**
 * Check if a URL matches a template route.
 * Returns { templatePath, params } or null.
 */
function matchTemplateRoute(pathname) {
  for (const route of TEMPLATE_ROUTES) {
    const match = pathname.match(route.pattern);
    if (match) {
      return {
        templatePath: route.templatePath,
        params: route.extractParams(match),
      };
    }
  }
  return null;
}

/**
 * Inject URL-derived parameters into a CMS template.
 * Replaces __SLUG__, __CATEGORY__, etc. with real values.
 */
function injectParamsIntoTemplate(html, params) {
  let result = html;
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `__${key.toUpperCase()}__`;
    result = result.split(placeholder).join(value);
  }
  return result;
}

// --- HTTP Server ---

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${COMPOSITION_PORT}`);
  const pathname = decodeURIComponent(urlObj.pathname);
  // For static assets, proxy directly to the CMS origin
  if (/\.(js|css|json|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i.test(pathname)) {
    try {
      const assetHtml = await httpGet(`${CMS_ORIGIN}${pathname}`);
      const extMap = {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.ico': 'image/x-icon',
      };
      const ext = pathname.substring(pathname.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': extMap[ext] || 'application/octet-stream' });
      res.end(assetHtml);
    } catch {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Asset proxy error');
    }
    return;
  }

  // For .plain.html fragment requests, proxy directly (no composition needed)
  if (pathname.endsWith('.plain.html')) {
    try {
      const fragmentHtml = await httpGet(`${CMS_ORIGIN}${pathname}`);
      res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
      res.end(fragmentHtml);
    } catch {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Fragment proxy error');
    }
    return;
  }

  // For proxy endpoint, forward to CMS origin
  if (pathname === '/proxy' && urlObj.searchParams.get('url')) {
    try {
      const proxyData = await httpGet(urlObj.searchParams.get('url'));
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Access-Control-Allow-Origin': '*' });
      res.end(proxyData);
    } catch {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Proxy error');
    }
    return;
  }

  // Fetch raw CMS page HTML
  let rawHtml;
  let isTemplatePage = false;

  // Check if this URL matches a template route (e.g., /products/sylvia-capri)
  const templateRoute = matchTemplateRoute(pathname);

  if (templateRoute) {
    // Fetch the CMS TEMPLATE (authored once, reused for all matching URLs)
    try {
      rawHtml = await httpGet(`${CMS_ORIGIN}${templateRoute.templatePath}`);
    } catch {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('CMS template unreachable');
      return;
    }

    if (!rawHtml || rawHtml.includes('404 - Not Found')) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 - Template not found</h1>');
      return;
    }

    // Validate that the product exists before composing
    if (templateRoute.params.slug) {
      const product = await fetchProductBySlug(templateRoute.params.slug);
      if (!product) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - Product not found</h1>');
        return;
      }
    }

    // Inject URL params into template (e.g., __SLUG__ -> "sylvia-capri")
    rawHtml = injectParamsIntoTemplate(rawHtml, templateRoute.params);
    isTemplatePage = true;
  } else {
    // Regular CMS page - fetch the exact path
    try {
      rawHtml = await httpGet(`${CMS_ORIGIN}${pathname}`);
    } catch {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('CMS origin unreachable');
      return;
    }
  }

  if (!rawHtml || rawHtml.includes('404 - Not Found')) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 - Not Found</h1>');
    return;
  }

  // If no dynamic blocks, return page as-is
  if (!rawHtml.includes(' dynamic"')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
      'X-Composed': 'false',
      'X-Template': isTemplatePage ? templateRoute.templatePath : 'none',
    });
    res.end(rawHtml);
    return;
  }

  // Compose - replace dynamic block placeholders with rendered product HTML
  try {
    const composedHtml = await composePage(rawHtml);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
      'X-Composed': 'true',
      'X-Template': isTemplatePage ? templateRoute.templatePath : 'none',
    });
    res.end(composedHtml);
  } catch (err) {
    /* eslint-disable no-console */
    console.error('Composition error:', err.message);
    /* eslint-enable no-console */
    // Fallback: Return the raw page (client-side blocks will handle it)
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Composed': 'error',
    });
    res.end(rawHtml);
  }
});

server.listen(COMPOSITION_PORT, () => {
  /* eslint-disable no-console */
  console.log(`\nComposition server running at:`);
  console.log(` http://localhost:${COMPOSITION_PORT}\n`);
  console.log(` CMS origin: ${CMS_ORIGIN}`);
  console.log(` Product API: ${PRODUCT_API_URL}\n`);
  console.log(` Test pages (via composition):`);
  console.log(` http://localhost:${COMPOSITION_PORT}/products/`);
  console.log(` http://localhost:${COMPOSITION_PORT}/products/women`);
  console.log(` http://localhost:${COMPOSITION_PORT}/products/men`);
  console.log(` http://localhost:${COMPOSITION_PORT}/products/sylvia-capri\n`);
  console.log(` Compare with raw CMS pages (no composition):`);
  console.log(` http://localhost:3000/products/\n`);
  /* eslint-enable no-console */
});
