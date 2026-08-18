import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('.');
const out = resolve('www');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await cp(resolve(root, 'index.html'), resolve(out, 'index.html'));
await cp(resolve(root, 'manifest.json'), resolve(out, 'manifest.json'));
await cp(resolve(root, 'service-worker.js'), resolve(out, 'service-worker.js'));
await cp(resolve(root, 'src'), resolve(out, 'src'), { recursive: true });
await cp(resolve(root, 'icons'), resolve(out, 'icons'), { recursive: true });

console.log('Trade Manager V2 web build created at ./www');
