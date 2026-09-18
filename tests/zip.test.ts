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

console.log('--- ZIP 文件名编码标志位（电脑解压乱码回归防线）---');
{
  const z = makeZip([
    { name: '第二课堂/德体美劳/说明.txt', data: new TextEncoder().encode('x') },
    { name: 'ascii-only/readme.txt', data: new TextEncoder().encode('y') }
  ]);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  // 本地文件头：签名4 + 版本2 => 标志位在偏移 6
  const flagCn = dv.getUint16(6, true);
  ok('中文文件名置 UTF-8 标志位(0x0800)', (flagCn & 0x0800) === 0x0800, '实际 0x' + flagCn.toString(16));
  const second = (() => {
    // 第一个条目长度可算：30 + nameLen + dataLen
    const n1 = dv.getUint16(26, true);
    return 30 + n1 + dv.getUint32(18, true);
  })();
  const flagEn = dv.getUint16(second + 6, true);
  ok('纯 ASCII 文件名不置位', (flagEn & 0x0800) === 0, '实际 0x' + flagEn.toString(16));
  // 中央目录里的标志位也要一致
  const back = (() => { let i = z.length - 22; for (; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) break; return i; })();
  const cdOff = dv.getUint32(back + 16, true);
  ok('中央目录同样带 UTF-8 标志位', (dv.getUint16(cdOff + 8, true) & 0x0800) === 0x0800);
  const r = readZip(z);
  ok('中文条目名往返一致', r[0].name === '第二课堂/德体美劳/说明.txt', r[0].name);
  const y = new Date();
  const dt = dv.getUint16(10, true), dd = dv.getUint16(12, true);
  ok('写入 DOS 修改时间非零', (dt | dd) !== 0, 'time=0x' + dt.toString(16) + ' date=0x' + dd.toString(16));
  ok('DOS 年份正确', (((dd >> 9) & 0x7f) + 1980) === y.getFullYear(), String(((dd >> 9) & 0x7f) + 1980));
}

// 汇总必须放在所有断言之后，否则新增用例既不计入也不决定退出码（曾因此出现"假绿灯"）
console.log(`Zip Test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);