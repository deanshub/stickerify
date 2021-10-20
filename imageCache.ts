import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { srcDir, outputDir } from './constants';

const cache = new Map<string, string>();

function hashIt(content: Buffer) {
  return crypto.createHash('md5').update(content).digest('hex');
}

export async function set(imageName: string) {
  const content = await fs.readFile(path.join(srcDir, imageName));
  const hash = hashIt(content);
  cache.set(hash, path.join(outputDir, imageName));
}

export async function get(imageName: string) {
  const content = await fs.readFile(path.join(srcDir, imageName));
  const hash = hashIt(content);
  return cache.get(hash);
}

export async function loadImageCache() {
  const [inputFiles, outputFiles] = await Promise.all([
    fs.readdir(srcDir),
    fs.readdir(outputDir),
  ]);
  return Promise.all(
    inputFiles.map((inFile: string) => {
      const match = outputFiles.find((outFile: string) => inFile === outFile);
      if (match) {
        return set(inFile);
      }
    }),
  ).then(() => console.log('Cache loaded successfully'));
}
