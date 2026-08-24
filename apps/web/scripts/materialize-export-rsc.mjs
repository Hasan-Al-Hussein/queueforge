import { copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(appRoot, 'out');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

await stat(outputRoot);
const files = await walk(outputRoot);
let materialized = 0;

for (const source of files) {
  if (path.extname(source) !== '.txt') continue;
  const relativeSegments = path.relative(outputRoot, source).split(path.sep);
  const nextSegmentIndex = relativeSegments.findIndex(
    (segment, index) => index < relativeSegments.length - 1 && segment.startsWith('__next.'),
  );
  if (nextSegmentIndex < 0) continue;

  const pageDirectory = path.join(outputRoot, ...relativeSegments.slice(0, nextSegmentIndex));
  const flattenedName = relativeSegments.slice(nextSegmentIndex).join('.');
  const target = path.join(pageDirectory, flattenedName);
  if (target === source) continue;
  await copyFile(source, target);
  materialized += 1;
}

const routeDocuments = files.filter(
  (file) =>
    path.basename(file) === 'index.html' && path.relative(outputRoot, path.dirname(file)) !== '404',
);
const missingCompatibilityResources = [];
for (const document of routeDocuments) {
  const routeDirectory = path.dirname(document);
  const routeSegments = path.relative(outputRoot, routeDirectory).split(path.sep).filter(Boolean);
  const compatibilityName =
    routeSegments.length === 0
      ? '__next.__PAGE__.txt'
      : `__next.${routeSegments.join('.')}.__PAGE__.txt`;
  const compatibilityPath = path.join(routeDirectory, compatibilityName);
  try {
    await stat(compatibilityPath);
  } catch {
    missingCompatibilityResources.push(path.relative(outputRoot, compatibilityPath));
  }
}

if (missingCompatibilityResources.length > 0) {
  throw new Error(
    `Missing static-export RSC compatibility resources: ${missingCompatibilityResources.join(', ')}`,
  );
}

process.stdout.write(
  `Verified ${routeDocuments.length} static-export RSC compatibility resources; materialized ${materialized}.\n`,
);
