import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

interface ArtifactViolation {
  readonly file: string;
  readonly rule: string;
}

interface ContentRule {
  readonly name: string;
  readonly pattern: RegExp;
}

const repositoryRoot = process.cwd();
const artifactRoot = resolve(repositoryRoot, process.argv[2] ?? 'apps/web/out');
const vercelOutputRoot = resolve(repositoryRoot, process.argv[3] ?? '.vercel/output');
const binaryExtensions = new Set([
  '.avif',
  '.gif',
  '.glb',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.ogg',
  '.otf',
  '.pdf',
  '.png',
  '.ttf',
  '.wasm',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
]);
const contentRules: readonly ContentRule[] = [
  {
    name: 'source map reference',
    pattern: /(?:sourceMappingURL|sourceURL)\s*=/iu,
  },
  {
    name: 'loopback or localhost origin',
    pattern:
      /(?:https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d{1,5})?|(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?):\d{1,5})/iu,
  },
  {
    name: 'API or GraphQL origin configuration',
    pattern:
      /(?:NEXT_PUBLIC_(?:API|GRAPHQL)_(?:URL|ORIGIN)|(?:API|GRAPHQL)_(?:BASE_)?(?:URL|ORIGIN|ENDPOINT))/u,
  },
  {
    name: 'absolute API or GraphQL endpoint',
    pattern: /https?:\/\/(?:api\.|graphql\.|[^\s"'`/]+\/(?:api|graphql)(?:[/?#]|$))/iu,
  },
  {
    name: 'WebSocket origin',
    pattern: /wss?:\/\//iu,
  },
  {
    name: 'absolute network request',
    pattern: /(?:fetch|EventSource)\s*\(\s*["'`]https?:\/\//iu,
  },
  {
    name: 'private Windows filesystem path',
    pattern: /[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\s"'`\\/]+/u,
  },
  {
    name: 'private POSIX filesystem path',
    pattern: /\/(?:Users|home)\/[^\s"'`/]+\/|\/root\//u,
  },
  {
    name: 'private workspace path marker',
    pattern: /(?:AppData[\\/]|OneDrive(?:\s+-\s+[^\\/]+)?[\\/]|[\\/]\.codex[\\/])/iu,
  },
  {
    name: 'private key material',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u,
  },
  {
    name: 'cloud or source-control access token',
    pattern: /(?:AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}/u,
  },
  {
    name: 'service API key',
    pattern:
      /(?:^|[^A-Za-z0-9_-])(?:sk-proj-[A-Za-z0-9_-]{40,}|sk-[A-Za-z0-9]{48}|xox[baprs]-[A-Za-z0-9-]{20,})(?=[^A-Za-z0-9_-]|$)/u,
  },
  {
    name: 'JSON Web Token',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u,
  },
  {
    name: 'embedded credential assignment',
    pattern:
      /(?:api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["'`][^"'`\r\n]{8,}["'`]/iu,
  },
  {
    name: 'credential-bearing URL',
    pattern: /https?:\/\/[^\s"'`/:@]+:[^\s"'`/@]+@/iu,
  },
  {
    name: 'embedded bearer credential',
    pattern: /authorization\s*[:=]\s*["'`]Bearer\s+[A-Za-z0-9._~-]{12,}/iu,
  },
];

const violations: ArtifactViolation[] = [];
let scannedFiles = 0;
let scannedBytes = 0;

function displayPath(filePath: string): string {
  const repositoryRelative = relative(repositoryRoot, filePath).replaceAll('\\', '/');
  return repositoryRelative.length > 0 ? repositoryRelative : '.';
}

function recordViolation(filePath: string, rule: string): void {
  violations.push({ file: displayPath(filePath), rule });
}

function collectFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      recordViolation(entryPath, 'symbolic links are not allowed in the public artifact');
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
      continue;
    }
    if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function isEnvironmentFile(filePath: string): boolean {
  return relative(artifactRoot, filePath)
    .split(/[\\/]/u)
    .some((segment) => segment === '.env' || segment.startsWith('.env.'));
}

function readText(filePath: string): string | null {
  if (binaryExtensions.has(extname(filePath).toLowerCase())) return null;
  const content = readFileSync(filePath);
  const sample = content.subarray(0, Math.min(content.length, 4_096));
  if (sample.includes(0)) return null;
  scannedBytes += content.length;
  return content.toString('utf8');
}

function verifyStaticArtifact(): void {
  if (!existsSync(artifactRoot) || !lstatSync(artifactRoot).isDirectory()) {
    recordViolation(artifactRoot, 'static artifact directory is missing');
    return;
  }

  const indexPath = resolve(artifactRoot, 'index.html');
  if (!existsSync(indexPath)) recordViolation(indexPath, 'static entry point is missing');

  for (const filePath of collectFiles(artifactRoot)) {
    scannedFiles += 1;
    if (isEnvironmentFile(filePath)) recordViolation(filePath, 'environment file');
    if (extname(filePath).toLowerCase() === '.map') recordViolation(filePath, 'source map file');

    const content = readText(filePath);
    if (content === null) continue;
    for (const rule of contentRules) {
      if (rule.pattern.test(content)) recordViolation(filePath, rule.name);
    }
  }
}

function verifyNoVercelFunctions(): void {
  const functionsDirectory = resolve(vercelOutputRoot, 'functions');
  if (existsSync(functionsDirectory)) {
    recordViolation(functionsDirectory, 'Vercel function output is forbidden');
  }

  if (!existsSync(vercelOutputRoot)) return;
  for (const filePath of collectFiles(vercelOutputRoot)) {
    const outputPath = relative(vercelOutputRoot, filePath).replaceAll('\\', '/');
    if (
      outputPath.startsWith('functions/') ||
      outputPath.includes('/functions/') ||
      outputPath.endsWith('.func')
    ) {
      recordViolation(filePath, 'Vercel function output is forbidden');
    }
  }
}

verifyStaticArtifact();
verifyNoVercelFunctions();

if (violations.length > 0) {
  console.error('QueueForge public artifact verification failed:');
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.rule}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `QueueForge public artifact verified: ${String(scannedFiles)} files, ${String(scannedBytes)} text bytes, zero deployable functions.`,
  );
}
