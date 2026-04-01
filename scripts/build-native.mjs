import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(projectRoot, 'src-native', 'scancpp');
const artifactDir = `${process.platform}-${process.arch}`;
const buildDir = path.join(sourceDir, 'build', 'node-addon', artifactDir);
const outputDir = path.join(projectRoot, 'build', 'native', artifactDir);
const outputAddonPath = path.join(outputDir, 'scancpp_node.node');
const buildStatePath = path.join(outputDir, 'build-state.json');
const lockDirPath = path.join(outputDir, '.build-lock');
const lockMetadataPath = path.join(lockDirPath, 'owner.json');

function resolveNodeHeadersDir() {
  const candidates = [
    process.env.npm_config_nodedir,
    path.dirname(process.execPath),
    path.dirname(path.dirname(process.execPath)),
    path.dirname(path.dirname(path.dirname(process.execPath))),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalizedCandidate = path.resolve(candidate);
    const headerCandidates = [
      path.join(normalizedCandidate, 'include', 'node', 'node_api.h'),
      path.join(normalizedCandidate, 'node_api.h'),
    ];

    if (headerCandidates.some((headerPath) => existsSync(headerPath))) {
      return normalizedCandidate;
    }
  }

  return null;
}

function run(command, args) {
  const env = { ...process.env };
  const nodeHeadersDir = resolveNodeHeadersDir();
  if (nodeHeadersDir && !env.npm_config_nodedir) {
    env.npm_config_nodedir = nodeHeadersDir;
  }

  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveBuiltAddonPath() {
  const candidates = [
    path.join(buildDir, 'scancpp_node.node'),
    path.join(buildDir, 'Release', 'scancpp_node.node'),
    path.join(buildDir, 'RelWithDebInfo', 'scancpp_node.node'),
    path.join(buildDir, 'Debug', 'scancpp_node.node'),
  ];

  const matched = candidates.find((candidate) => existsSync(candidate));
  if (!matched) {
    throw new Error(`Native addon build succeeded but output was not found in ${buildDir}`);
  }

  return matched;
}

function walkFiles(targetPath, files = []) {
  const entries = readdirSync(targetPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'build' || entry.name === 'example_input') {
        continue;
      }

      walkFiles(fullPath, files);
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function getTrackedInputs() {
  return [
    path.join(projectRoot, 'package.json'),
    path.join(projectRoot, 'package-lock.json'),
    path.join(projectRoot, 'scripts', 'build-native.mjs'),
    path.join(sourceDir, 'CMakeLists.txt'),
    path.join(sourceDir, 'models', 'u2netp.onnx'),
    ...walkFiles(path.join(sourceDir, 'src')),
    ...walkFiles(path.join(sourceDir, 'third_party', 'opencv', 'cmake')),
    path.join(sourceDir, 'third_party', 'opencv', 'CMakeLists.txt'),
  ];
}

function createStateSnapshot() {
  const files = getTrackedInputs()
    .filter((filePath) => existsSync(filePath))
    .sort();

  return {
    artifactDir,
    node: process.version,
    files: files.map((filePath) => {
      const stats = statSync(filePath);
      return {
        path: path.relative(projectRoot, filePath),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      };
    }),
  };
}

function loadPreviousSnapshot() {
  if (!existsSync(buildStatePath)) {
    return null;
  }

  return JSON.parse(readFileSync(buildStatePath, 'utf8'));
}

function snapshotsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shouldSkipBuild(snapshot) {
  if (process.env.FORCE_NATIVE_REBUILD === '1') {
    return false;
  }

  if (!existsSync(outputAddonPath)) {
    return false;
  }

  const previousSnapshot = loadPreviousSnapshot();
  return previousSnapshot && snapshotsEqual(previousSnapshot, snapshot);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function readLockMetadata() {
  if (!existsSync(lockMetadataPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(lockMetadataPath, 'utf8'));
  } catch {
    return null;
  }
}

function clearStaleLockIfNeeded() {
  if (!existsSync(lockDirPath)) {
    return;
  }

  const metadata = readLockMetadata();
  if (metadata && isProcessAlive(metadata.pid)) {
    return;
  }

  rmSync(lockDirPath, { recursive: true, force: true });
}

function acquireBuildLock() {
  clearStaleLockIfNeeded();

  try {
    mkdirSync(lockDirPath);
    writeFileSync(
      lockMetadataPath,
      `${JSON.stringify(
        {
          pid: process.pid,
          createdAt: new Date().toISOString(),
          artifactDir,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    throw new Error(
      `Native addon is already being built for ${artifactDir}. If no build is running, delete ${lockDirPath}.`,
      { cause: error },
    );
  }
}

function releaseBuildLock() {
  if (existsSync(lockDirPath)) {
    rmSync(lockDirPath, { recursive: true, force: true });
  }
}

mkdirSync(outputDir, { recursive: true });

const snapshot = createStateSnapshot();
if (shouldSkipBuild(snapshot)) {
  console.log(`[build-native] Native addon is up to date: ${path.relative(projectRoot, outputAddonPath)}`);
  process.exit(0);
}

acquireBuildLock();

try {
  run('cmake', [
    '-S',
    sourceDir,
    '-B',
    buildDir,
    '-DSCANCPP_BUILD_CLI=OFF',
    '-DSCANCPP_BUILD_NODE_ADDON=ON',
    '-DSCANCPP_OPENCV_PROVIDER=bundled-static',
    `-DSCANCPP_OPENCV_SOURCE_DIR=${path.join(sourceDir, 'third_party', 'opencv')}`,
    `-DNODEJS_EXECUTABLE=${process.execPath}`,
  ]);

  run('cmake', ['--build', buildDir, '--config', 'Release', '--target', 'scancpp_node']);

  cpSync(resolveBuiltAddonPath(), outputAddonPath);
  writeFileSync(buildStatePath, `${JSON.stringify(snapshot, null, 2)}\n`);
} finally {
  releaseBuildLock();
}
