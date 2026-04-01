import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const releaseDir = path.join(projectRoot, 'release');
const artifactRootDir = path.join(projectRoot, 'artifacts', 'github-actions');
const artifactDir = path.join(
  artifactRootDir,
  `${process.platform}-${process.arch}`,
);

const packageFileSuffixes = [
  '.appimage',
  '.deb',
  '.dmg',
  '.exe',
  '.msi',
  '.pkg',
  '.rpm',
  '.tar.gz',
  '.zip',
];

function collectFiles(targetDir, files = []) {
  for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
    const fullPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, files);
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function shouldStageArtifact(filePath) {
  const relativePath = path.relative(releaseDir, filePath);
  const fileName = path.basename(filePath);
  const lowerRelativePath = relativePath.toLowerCase();
  const lowerFileName = fileName.toLowerCase();

  if (lowerFileName.endsWith('.blockmap')) {
    return true;
  }

  if (
    lowerFileName.startsWith('latest') &&
    (lowerFileName.endsWith('.yml') || lowerFileName.endsWith('.yaml'))
  ) {
    return true;
  }

  return packageFileSuffixes.some((suffix) =>
    lowerRelativePath.endsWith(suffix),
  );
}

if (!existsSync(releaseDir)) {
  throw new Error(`Electron output directory does not exist: ${releaseDir}`);
}

const stagedFiles = collectFiles(releaseDir).filter(shouldStageArtifact).sort();

if (stagedFiles.length === 0) {
  throw new Error(`No packaged Electron artifacts were found in ${releaseDir}`);
}

rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(artifactDir, { recursive: true });

const manifest = {
  platform: process.platform,
  arch: process.arch,
  stagedAt: new Date().toISOString(),
  files: [],
};

for (const filePath of stagedFiles) {
  const relativePath = path.relative(releaseDir, filePath);
  const destinationPath = path.join(artifactDir, relativePath);

  mkdirSync(path.dirname(destinationPath), { recursive: true });
  cpSync(filePath, destinationPath);

  manifest.files.push({
    path: relativePath,
    size: statSync(filePath).size,
  });
}

writeFileSync(
  path.join(artifactDir, 'artifact-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(
  `[stage-electron-artifacts] Staged ${stagedFiles.length} files into ${artifactDir}`,
);
