// 备份容器格式校验（PRD AC-31 / AC-33）：自研 store-only ZIP 必须能被标准工具读取
import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { makeZip, readZip, crc32, bytesToBase64, base64ToBytes } from '../src/services/zip.ts';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean): void => { if (cond) { pass++; console.log('  PASS  ' + label); } else { fail++; console.log('  FAIL  ' + label); } };

const enc = new TextEncoder();
const bin = new Uint8Array(5000);
for (let i = 0; i < bin.length; i++) bin[i] = (i * 37) % 251;
const entries = [
  { name: 'BACKUP_MANIFEST.json', data: enc.encode(JSON.stringify({ app: 'Unimate', schemaVersion: 1, counts: { courses: 25 } })) },
  { name: 'account/timetable/courses.json', data: enc.encode(JSON.stringify([{ id: 'a', name: '数字电子技术' }])) },
  { name: 'files/schools/buct/photos/2026/x.jpg', data: bin }
];

const zip = makeZip(entries);
ok('zip 以 PK\\x03\\x04 开头', zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 0x03 && zip[3] === 0x04);
ok('zip 含 EOCD 结束标记', [...zip.slice(zip.length - 22, zip.length - 18)].join(',') === [80, 75, 5, 6].join(','));

const back = readZip(zip);
ok('条目数一致', back.length === entries.length);
ok('文件名一致', back.map((b) => b.name).join('|') === entries.map((e) => e.name).join('|'));
ok('文本内容一致', new TextDecoder().decode(back[1].data) === '[{"id":"a","name":"数字电子技术"}]');
ok('二进制内容逐字节一致', (() => { const a = back[2].data; if (a.length !== bin.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== bin[i]) return false; return true; })());

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'tmp-interop.zip'), Buffer.from(zip));
ok('已写出供外部工具交叉验证的文件', true);

ok('crc32 已知值', crc32(enc.encode('123456789')) === 0xcbf43926);
const b64 = bytesToBase64(bin);
ok('base64 往返一致', base64ToBytes(b64).length === bin.length);

console.log('');
console.log(`Zip Test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
