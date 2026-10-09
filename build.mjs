import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'engine-client.js', 'engine-ui.js']) copyFileSync(file, `dist/${file}`);
console.log('Static build ready: dist/');
