/**
 * 生成 Cloudflare Pages 上传目录（v2.39 起可复现，别再手工拷贝）。
 *
 *   node scripts/make-pages-package.mjs <版本号>   例：node scripts/make-pages-package.mjs v2.39
 *
 * 做三件事：
 *  1) 把 `dist/` 整个复制到 `artifacts/cloudflare/unimate-cloudflare-<版本>-upload/`（Pages 拖放页接受目录，不接受 ZIP）；
 *  2) 把 `cloudflare/pages/_worker.js` 放到该目录**根部** —— 这是 Pages 的 Advanced Mode 入口，
 *     `/health` 与 `/v1/presign` 由它转发给 Worker（因为 `*.workers.dev` 在大陆被 DNS 污染，见 PRD 11.47）；
 *  3) 顺手压一个 ZIP 归档（只作留档，Pages 网页用不上）。
 *
 * 为什么要有这个脚本：v2.36~v2.38 的 Pages 包是手工拷的，出包脚本里查不到痕迹，
 * 谁都不知道那个 `_worker.js` 该不该放、放哪儿 —— 这类"只有当事人记得"的步骤必须变成脚本。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] || '').trim();
if (!/^v[0-9]+\.[0-9]+$/.test(version)) {
  console.error('用法：node scripts/make-pages-package.mjs v2.39');
  process.exit(1);
}
const dist = join(root, 'dist');
const workerSrc = join(root, 'cloudflare', 'pages', '_worker.js');
if (!existsSync(dist)) { console.error('dist 不存在，先跑 npm run build'); process.exit(1); }
if (!existsSync(workerSrc)) { console.error('缺少 cloudflare/pages/_worker.js'); process.exit(1); }

const outDir = join(root, 'artifacts', 'cloudflare', 'unimate-cloudflare-' + version + '-upload');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(dist, outDir, { recursive: true });
cpSync(workerSrc, join(outDir, '_worker.js'));

const zipPath = join(root, 'artifacts', 'cloudflare', 'unimate-cloudflare-' + version + '.zip');
rmSync(zipPath, { force: true });
// 优先用 Windows 自带的 bsdtar（`-a` 按扩展名自动选 zip）：比 Compress-Archive 稳，
// 后者在某些环境下会 CouldNotAutoloadMatchingModule（本轮就踩到了）。
let zipped = false;
try {
  execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', outDir, '.'], { stdio: 'ignore' });
  zipped = existsSync(zipPath);
} catch { zipped = false; }
if (!zipped) {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      'Compress-Archive -Path "' + outDir + '\\*" -DestinationPath "' + zipPath + '" -Force'], { stdio: 'ignore' });
    zipped = existsSync(zipPath);
  } catch { zipped = false; }
}
if (!zipped) console.warn('（ZIP 归档失败，不影响拖放目录）');

function count(dir) {
  let n = 0, bytes = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { const r = count(p); n += r.n; bytes += r.bytes; }
    else { n++; bytes += st.size; }
  }
  return { n, bytes };
}
const c = count(outDir);
console.log('Pages 上传目录：' + outDir);
console.log('  文件 ' + c.n + ' 个 / ' + (c.bytes / 1024 / 1024).toFixed(1) + ' MB，根目录含 _worker.js');
if (existsSync(zipPath)) console.log('  ZIP 归档：' + zipPath);
console.log('上传要点：拖放**目录内容**（或整个目录）→ 选 Production；上传后核对 https://unimate3.pages.dev/health 返回 {"ok":true}。');
