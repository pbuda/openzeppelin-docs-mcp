import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';

const DOCS_REPO = 'https://github.com/OpenZeppelin/docs.git';
const CONTRACTS_REPO = 'https://github.com/OpenZeppelin/openzeppelin-contracts.git';

const V5_TAG = 'v5.3.0';
const V4_TAG = 'v4.9.6';

export interface FetchOptions {
  dataDir: string;
  force?: boolean;
}

export async function fetchDocs(options: FetchOptions): Promise<void> {
  const { dataDir, force = false } = options;
  const reposDir = path.join(dataDir, 'repos');

  // Create repos directory if it doesn't exist
  await fs.mkdir(reposDir, { recursive: true });

  const git: SimpleGit = simpleGit();

  // Clone docs repository
  const docsPath = path.join(reposDir, 'docs');
  await cloneRepo(git, DOCS_REPO, docsPath, undefined, force);

  // Clone contracts v5
  const contractsV5Path = path.join(reposDir, 'contracts-v5');
  await cloneRepo(git, CONTRACTS_REPO, contractsV5Path, V5_TAG, force);

  // Clone contracts v4
  const contractsV4Path = path.join(reposDir, 'contracts-v4');
  await cloneRepo(git, CONTRACTS_REPO, contractsV4Path, V4_TAG, force);

  console.log('All repositories fetched successfully');
}

async function cloneRepo(
  git: SimpleGit,
  repoUrl: string,
  targetPath: string,
  tag?: string,
  force?: boolean
): Promise<void> {
  const exists = await directoryExists(targetPath);

  if (exists && !force) {
    console.log(`Skipping ${path.basename(targetPath)} (already exists)`);
    return;
  }

  if (exists && force) {
    console.log(`Removing existing ${path.basename(targetPath)}...`);
    await fs.rm(targetPath, { recursive: true, force: true });
  }

  console.log(`Cloning ${repoUrl}${tag ? ` at ${tag}` : ''} to ${path.basename(targetPath)}...`);

  const cloneOptions: string[] = ['--depth', '1'];
  if (tag) {
    cloneOptions.push('--branch', tag);
  }

  await git.clone(repoUrl, targetPath, cloneOptions);
  console.log(`Successfully cloned ${path.basename(targetPath)}`);
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function getReposPaths(dataDir: string) {
  const reposDir = path.join(dataDir, 'repos');
  return {
    docs: path.join(reposDir, 'docs'),
    contractsV5: path.join(reposDir, 'contracts-v5'),
    contractsV4: path.join(reposDir, 'contracts-v4'),
  };
}
