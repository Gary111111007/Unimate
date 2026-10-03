// 版权署名（水印）防复发测试。
// 规矩（AGENTS.md 第 2 条硬规则）：**真实姓名只允许出现在版权水印里**，
// UI、示例数据、导出材料一律用脱敏名（学生"智小汇"、学号 2025040999）。
// 这条测试同时守住两件事：① 水印别被误删；② 真名别从水印漏进界面/数据。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = ['果崇舜', '刘佳乐', '赵梓缘'];
const NOTICE = '本app为果崇舜，刘佳乐，赵梓缘三人共同开发，未经允许，不得擅自使用。';

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}
function read(p: string): string { return readFileSync(join(root, p), 'utf8'); }
function has(p: string, s: string): boolean { return existsSync(join(root, p)) && read(p).includes(s); }

console.log('--- 第一层：打包器注入的 banner / footer（JS chunk + index.html）---');
const vite = read('vite.config.ts');
ok('vite 配置里有 banner', /banner:\s*BANNER/.test(vite));
ok('vite 配置里有 footer', /footer:\s*FOOTER/.test(vite));
ok('banner 含三人姓名', NAMES.every((n) => vite.includes(n)), '');
ok('banner/footer 用的是原句', vite.includes(NOTICE), '');
ok('index.html 里有署名注释', has('index.html', NOTICE), '');

console.log('\n--- 第二层：Android 字符串资源（resources.arsc，换掉前端也还在）---');
const strings = read('android/app/src/main/res/values/strings.xml');
ok('strings.xml 有 app_authors', /<string name="app_authors">/.test(strings));
ok('strings.xml 有 app_copyright', /<string name="app_copyright">/.test(strings));
ok('两个资源都含三人姓名', NAMES.every((n) => strings.includes(n)), '');
ok('app_copyright 是原句', strings.includes(NOTICE), '');

console.log('\n--- 第三层：assets 根目录的独立声明文件（cap sync 不会覆盖）---');
const notice = 'android/app/src/main/assets/COPYRIGHT.txt';
ok('COPYRIGHT.txt 存在', existsSync(join(root, notice)));
ok('COPYRIGHT.txt 含三人姓名与原句', has(notice, NOTICE) && NAMES.every((n) => has(notice, n)), '');
ok('COPYRIGHT.txt 不放在会被 cap sync 清空的 assets/public 下', !existsSync(join(root, 'android/app/src/main/assets/public/COPYRIGHT.txt')));

console.log('\n--- 反向检查：真名不许出现在界面与数据里 ---');
const uiFiles: string[] = [];
(function walk(d: string): void {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(vue|ts)$/.test(e.name)) uiFiles.push(f);
  }
})(join(root, 'src'));
const leaked: string[] = [];
for (const f of uiFiles) {
  /*
   * 规矩的原话是"真实姓名只能出现在**版权水印**里（源码注释 + vite banner/footer）"，
   * 所以源码注释里出现是允许的、也是有意留痕的；不允许的是它出现在**代码/文案/模板**里。
   * 因此这里先剥掉所有注释，再查真名 —— 剥完还有就是漏进了界面文案或数据。
   */
  const src = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
  for (const n of NAMES) if (src.includes(n)) leaked.push(relative(root, f) + ' 含 ' + n);
}
ok('src/ 下真名只出现在注释里（剥掉注释后为 0）', leaked.length === 0, leaked.join('; '));
ok('扫到了界面源码文件', uiFiles.length >= 15, uiFiles.length + ' 个');
ok('源码里确实保留了水印注释（不是被顺手删光）',
  NAMES.every((n) => read('src/main.ts').includes(n)), '');

const demoSrc = read('src/services/demo.ts') + read('src/catalog/secondClass.ts');
ok('演示数据里没有真实姓名', NAMES.every((n) => !demoSrc.includes(n)), '');
ok('演示数据用的是脱敏名"智小汇"', demoSrc.includes('智小汇') || read('src/stores/db.ts').includes('智小汇'), '');

console.log('\n--- 开发者联系方式（产品负责人指定，仅此一处）---');
const me = read('src/views/MeView.vue');
ok('意向清单里有联系方式', me.includes('2025040140'), '');
ok('联系方式只写在意向清单这一个面板里', (me.match(/2025040140/g) || []).length === 1, String((me.match(/2025040140/g) || []).length));

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
