/**
 * Local development server for testing EDS pages with draft HTML content.
 * This serves as a lightweight alternative to 'aem up' when the AEM backend
 * is unreachable (e.g., corporate proxy/SSL issues, no AEM license).
 * 
 * Usage: node tools/local-server.js
 * Server runs at http://localhost:3000
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Allow self-signed / corporate proxy certs for local dev only
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PORT = 3000;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DRAFTS_DIR = path.join(PROJECT_ROOT, 'drafts');

const MIME_TYPES = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ico: 'image/x-icon',
};

const PAGE_SHELL = fs.readFileSync(path.join(PROJECT_ROOT, 'head.html'), 'utf-8');

/**
 * Proxy external URLs to avoid CORS issues in local dev.
 * Matches /proxy?url=https://...
 */
function handleProxy(proxyUrl, res) {
  const parsed = new URL(proxyUrl);
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    rejectUnauthorized: false,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  };

  const getter = parsed.protocol === 'https:' ? https : http;
  const proxyReq = getter.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
    });
  });

  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Proxy error');
  });

  proxyReq.end();
}

function wrapInPageShell(bodyContent, pagePath) {
  const title = pagePath.replace(/\//g, ' ').trim() || 'Home';
  return `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  ${PAGE_SHELL}
</head>
<body>
${bodyContent}
</body>
</html>`;
}

function resolveFilePath(urlPath) {
  // Serve project static assets (scripts, styles, blocks, icons, fonts)
  const projectFile = path.join(PROJECT_ROOT, urlPath);
  if (fs.existsSync(projectFile) && fs.statSync(projectFile).isFile()) {
    return projectFile;
  }

  // Serve draft pages
  // Try exact path as .html
  const draftExact = path.join(DRAFTS_DIR, urlPath);
  if (fs.existsSync(draftExact) && fs.statSync(draftExact).isFile()) {
    return draftExact;
  }

  // Try with .html extension
  const draftHtml = path.join(DRAFTS_DIR, `${urlPath}.html`);
  if (fs.existsSync(draftHtml)) {
    return draftHtml;
  }

  // Try as directory with index.html
  const draftIndex = path.join(DRAFTS_DIR, urlPath, 'index.html');
  if (fs.existsSync(draftIndex)) {
    return draftIndex;
  }

  return null;
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const urlPath = decodeURIComponent(urlObj.pathname);

  // Handle CORS proxy requests: /proxy?url=https://...
  if (urlPath === '/proxy' && urlObj.searchParams.get('url')) {
    handleProxy(urlObj.searchParams.get('url'), res);
    return;
  }

  // Handle .plain.html fragment requests (used by header/footer loading)
  const isPlainHtml = urlPath.endsWith('.plain.html');
  let lookupPath = urlPath;
  if (isPlainHtml) {
    lookupPath = urlPath.replace('.plain.html', '');
  }

  // Resolve the file
  const filePath = resolveFilePath(lookupPath);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 - Not Found</h1>');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // For draft HTML files
  if (filePath.startsWith(DRAFTS_DIR) && ext === '.html') {
    const content = fs.readFileSync(filePath, 'utf-8');
    const bodyMatch = content.match(/<body>([\s\S]*)<\/body>/i);
    const bodyInner = bodyMatch ? bodyMatch[1] : content;

    // .plain.html returns just the <main> content (no page shell)
    if (isPlainHtml) {
      const mainMatch = bodyInner.match(/<main>([\s\S]*)<\/main>/i);
      const mainContent = mainMatch ? mainMatch[1] : bodyInner;
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(mainContent);
      return;
    }

    // Full page with shell
    const fullPage = wrapInPageShell(`<body>${bodyInner}</body>`, urlPath);
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(fullPage);
    return;
  }

  // Serve static files
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(content);
});

server.listen(PORT, () => {
  /* eslint-disable no-console */
  console.log(`\n Local EDS dev server running at:`);
  console.log(` http://localhost:${PORT}\n`);
  console.log(` Serving project files from: ${PROJECT_ROOT}`);
  console.log(` Serving draft pages from: ${DRAFTS_DIR}\n`);
  console.log(` Test pages:`);
  console.log(` http://localhost:${PORT}/products/`);
  console.log(` http://localhost:${PORT}/products/women`);
  console.log(` http://localhost:${PORT}/products/men`);
  console.log(` http://localhost:${PORT}/products/sylvia-capri\n`);
  /* eslint-enable no-console */
});
