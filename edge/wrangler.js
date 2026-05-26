import { fetchProducts, fetchProductBySlug } from './adapters/products.js';
import { renderProductList } from './templates/product-list.js';
import { renderProductDetails } from './templates/product-details.js';

const DYNAMIC_BLOCK_RENDERERS = {
  'product-list': renderProductListBlock,
  'product-details': renderProductDetailsBlock,
};

// --- Template-Based Routing ---

const TEMPLATE_ROUTES = [
  {
    // /products/{slug} -> uses /products/template from CMS
    pattern: /^\/products\/([a-z0-9-]+)$/,
    templatePath: '/products/template',
    extractParams: (match) => ({ slug: match[1] }),
  },
];

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

function injectParamsIntoTemplate(html, params) {
  let result = html;
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `__${key.toUpperCase()}__`;
    result = result.split(placeholder).join(value);
  }
  return result;
}

// --- Block Config Parser ---

/**
 * Extract key-value config from an EDS block's row structure.
 * Each row has two cells: <div>key</div><div>value</div>
 */
function parseBlockConfig(blockHtml) {
  const config = {};
  const rowPattern = /<div>[^>]*?>\s**<div>[^>]*?>([\s\S]*?)<\/div>\s**<div>[^>]*?>([\s\S]*?)<\/div>\s*?<\/div>/gi;
  let match = rowPattern.exec(blockHtml);
  while (match) {
    const key = match[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
    const value = match[2].replace(/<[^>]+>/g, '').trim();
    if (key) config[key] = value;
    match = rowPattern.exec(blockHtml);
  }
  return config;
}
/**
 * Render a product-list dynamic block with real product data.
 */
async function renderProductListBlock(blockHtml, env) {
  const config = parseBlockConfig(blockHtml);
  const products = await fetchProducts(env, {
    category: config.category,
    subcategory: config.subcategory,
    featured: config.featured === 'true',
    limit: parseInt(config.limit, 10) || 12,
    sort: config.sort,
  });
  const locale = config.locale || 'en-us';
  return renderProductList(products, locale);
}

/**
 * Render a product-details dynamic block with real product data.
 */
async function renderProductDetailsBlock(blockHtml, env) {
  const config = parseBlockConfig(blockHtml);
  const product = await fetchProductBySlug(env, config.slug);
  if (!product) {
    return '<div class="product-details"><div><p>Product not found.</p></div></div>';
  }
  const locale = config.locale || 'en-us';
  return renderProductDetails(product, locale);
}

/**
 * Find all dynamic blocks in the HTML, compose them with real data,
 * and return the fully-rendered page.
 */
async function composePage(html, env) {
  let composed = html;

  for (const [blockName, renderer] of Object.entries(DYNAMIC_BLOCK_RENDERERS)) {
    // Match blocks marked with the "dynamic" class variant
    const pattern = new RegExp(
      `<div class="${blockName} dynamic">(<[\\s\\S]*?></div>\\s*(?:</div>\\s*)?)?(?=<div class="|</main>)`,
      'gi',
    );

    // Use a simpler, more reliable approach: find and replace each dynamic block
    const blockPattern = new RegExp(
      `(<div class="${blockName} dynamic">)([\\s\\S]*?)(<\\/div>\\s*<\\/div>|\\s*<\\/div>)`,
      'gi',
    );

    const matches = [...composed.matchAll(blockPattern)];
    for (const match of matches) {
      const fullMatch = match[0];
      const innerHtml = match[2];
      // eslint-disable-next-line no-await-in-loop
      const rendered = await renderer(innerHtml, env);
      composed = composed.replace(fullMatch, rendered);
    }
  }

  return composed;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const origin = env.EDS_ORIGIN || 'http://localhost:3000';

    // Static assets - proxy directly to CMS origin
    if (/\.(js|css|json|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i.test(pathname)) {
      return fetch(`${origin}${pathname}`, { headers: request.headers });
    }

    // .plain.html fragment requests - proxy directly (no composition)
    if (pathname.endsWith('.plain.html')) {
      const fragResp = await fetch(`${origin}${pathname}`);
      return new Response(fragResp.body, {
        status: fragResp.status,
        headers: {
          'content-type': 'text/html',
          'access-control-allow-origin': '*',
        },
      });
    }

    // /proxy endpoint - forward external URL (for CORS bypass in local dev)
    if (pathname === '/proxy' && url.searchParams.get('url')) {
      const proxyResp = await fetch(url.searchParams.get('url'));
      return new Response(proxyResp.body, {
        status: proxyResp.status,
        headers: {
          'content-type': proxyResp.headers.get('content-type') || 'text/plain',
          'access-control-allow-origin': '*',
        },
      });
    }

    let rawHtml;
    let isTemplatePage = false;
    let templateRoute = null;

    // Check if this URL matches a template route (e.g., /products/sylvia-capri)
    templateRoute = matchTemplateRoute(pathname);

    if (templateRoute) {
      // Fetch the CMS TEMPLATE (authored once, reused for all matching URLs)
      const templateResp = await fetch(`${origin}${templateRoute.templatePath}`);
      if (!templateResp.ok) {
        return new Response('Template not found', { status: 404 });
      }
      rawHtml = await templateResp.text();

      // Validate that the product exists before composing
      if (templateRoute.params.slug) {
        const product = await fetchProductBySlug(env, templateRoute.params.slug);
        if (!product) {
          return new Response('Product not found', { status: 404 });
        }
      }

      // Inject URL params into template (e.g., __SLUG__ -> "sylvia-capri")
      rawHtml = injectParamsIntoTemplate(rawHtml, templateRoute.params);
      isTemplatePage = true;
    } else {
      // Regular CMS page - fetch the exact path
      const cmsResp = await fetch(`${origin}${pathname}`);
      if (!cmsResp.ok) {
      return new Response('Page not found', { status: 404 });
    }
    rawHtml = await cmsResp.text();
  }

  // If page has no dynamic blocks, return as-is
  if (!rawHtml.includes(' dynamic"')) {
    return new Response(rawHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
        'x-composed': 'false',
        'x-template': isTemplatePage ? templateRoute.templatePath : 'none',
      },
    });
  }

  // Compose dynamic blocks with real data
  const composedHtml = await composePage(rawHtml, env);

  return new Response(composedHtml, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
      'x-composed': 'true',
      'x-template': isTemplatePage ? templateRoute.templatePath : 'none',
    },
  });
};
