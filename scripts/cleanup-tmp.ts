import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from '@payclinic/core';

const rootDir = resolve(fileURLToPath(import.meta.url), '../..');
cleanupTmp(rootDir);
