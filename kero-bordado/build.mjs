import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2019' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync('src/index.html', 'utf8').replace('<script type="module">/*APP*/</script>', () => `<script>${js}</script>`);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
const worker = `const HTML = ${JSON.stringify(html)};
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/index.html') return new Response('Não encontrado', { status: 404 });
    return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
  },
};
`;
fs.writeFileSync('dist/worker.js', worker);
console.log('html', (html.length / 1024).toFixed(0), 'KB; worker', (worker.length / 1024).toFixed(0), 'KB');
