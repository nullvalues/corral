import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { buildApp } from '../app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = await buildApp();
  await app.ready();
  const spec = JSON.stringify(app.swagger(), null, 2);
  const outPath = resolve(__dirname, '../../openapi.json');
  writeFileSync(outPath, spec + '\n');
  console.log(`OpenAPI spec written to ${outPath}`);
  await app.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
