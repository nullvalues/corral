import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const API_SRC = new URL('../src', import.meta.url).pathname;

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((e) =>
    e.isDirectory()
      ? collectFiles(join(dir, e.name))
      : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

function importsFrom(filePath: string, pattern: string): string[] {
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  return lines.filter(
    (l) => (l.includes("from '") || l.includes('from "')) && l.includes(pattern),
  );
}

describe('Layer model: one-directional import constraints', () => {
  it('routes/ must not import from db/', () => {
    const routeFiles = collectFiles(join(API_SRC, 'routes'));
    const violations: string[] = [];
    for (const file of routeFiles) {
      const hits = importsFrom(file, '/db/');
      hits.forEach((l) => violations.push(`${relative(API_SRC, file)}: ${l.trim()}`));
    }
    expect(violations, `routes/ → db/ violations:\n${violations.join('\n')}`).toHaveLength(0);
  });

  it('services/ must not import from routes/', () => {
    const serviceFiles = collectFiles(join(API_SRC, 'services'));
    const violations: string[] = [];
    for (const file of serviceFiles) {
      const hits = importsFrom(file, '/routes/');
      hits.forEach((l) => violations.push(`${relative(API_SRC, file)}: ${l.trim()}`));
    }
    expect(violations, `services/ → routes/ violations:\n${violations.join('\n')}`).toHaveLength(0);
  });

  it('db/ must not import from routes/ or services/', () => {
    const dbFiles = collectFiles(join(API_SRC, 'db'));
    const violations: string[] = [];
    for (const file of dbFiles) {
      const routeHits = importsFrom(file, '/routes/');
      const serviceHits = importsFrom(file, '/services/');
      [...routeHits, ...serviceHits].forEach((l) =>
        violations.push(`${relative(API_SRC, file)}: ${l.trim()}`),
      );
    }
    expect(violations, `db/ → routes/services/ violations:\n${violations.join('\n')}`).toHaveLength(0);
  });

  it('plugins/ must not import directly from services/ or db/', () => {
    const pluginFiles = collectFiles(join(API_SRC, 'plugins'));
    const violations: string[] = [];
    for (const file of pluginFiles) {
      const serviceHits = importsFrom(file, '/services/');
      const dbHits = importsFrom(file, '/db/');
      [...serviceHits, ...dbHits].forEach((l) =>
        violations.push(`${relative(API_SRC, file)}: ${l.trim()}`),
      );
    }
    expect(violations, `plugins/ → services/db/ violations:\n${violations.join('\n')}`).toHaveLength(0);
  });

  it('lib/ does not import from routes/, services/, or db/', () => {
    const libFiles = collectFiles(join(API_SRC, 'lib'));
    const violations: string[] = [];
    for (const file of libFiles) {
      const routeHits = importsFrom(file, '/routes/');
      const serviceHits = importsFrom(file, '/services/');
      const dbHits = importsFrom(file, '/db/');
      [...routeHits, ...serviceHits, ...dbHits].forEach((l) =>
        violations.push(`${relative(API_SRC, file)}: ${l.trim()}`),
      );
    }
    expect(violations, `lib/ → routes/services/db/ violations:\n${violations.join('\n')}`).toHaveLength(0);
  });
});
