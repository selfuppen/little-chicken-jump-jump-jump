import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ['index.html', 'favicon.svg', 'src']) {
  await cp(new URL(path, root), new URL(path, output), { recursive: true });
}
await mkdir(new URL('node_modules/three/build/', output), { recursive: true });
for (const path of ['build/three.module.js', 'build/three.core.js', 'LICENSE']) {
  await cp(new URL(`node_modules/three/${path}`, root), new URL(`node_modules/three/${path}`, output));
}
await writeFile(new URL('.nojekyll', output), '');
console.log('Static site built in dist/');
