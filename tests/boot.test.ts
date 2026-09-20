// 启动路径不变量测试（真机事故驱动）。
// v2.9 我用行号 splice 改 App.vue 的权限块时，把 splashDone.value = true 连同
// if (left > 0) await ... 一起删掉了 —— 构建通过、类型通过、测试全绿，
// 但开屏永远关不掉，用户只能看到"启动失败"面板。这条测试就是为堵死这种"删掉出口"的事故。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(root, 'src', 'App.vue'), 'utf8');
const script = (app.match(/<script setup[^>]*>([\s\S]*?)<\/script>/) || ['', ''])[1];
const onMounted = (script.match(/onMounted\(async \(\) => \{([\s\S]*?)\n\}\);/) || [, ''])[1];

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
}

ok('确实取到了 onMounted 函数体', onMounted.length > 40, onMounted.length + ' 字符');
ok('开屏有正常出口（onMounted 里会置 splashDone=true）', onMounted.includes('splashDone.value = true'));
ok('最短展示时长仍然生效（left 有被 await）', /if \(left > 0\) await/.test(onMounted));
ok('先跑完 boot 再决定停留时长', onMounted.indexOf('db.boot()') < onMounted.indexOf('const left'));
ok('权限申请不挡在进入界面之前（用 void 发射后不管）', onMounted.includes('void postBootPermissions()'));
ok('postBootPermissions 在 onMounted 之后调用', onMounted.indexOf('void postBootPermissions') > onMounted.indexOf('splashDone.value = true'));

// 模板不变量：开屏的显示条件与主界面的显示条件必须互补
const tpl = (app.match(/<template>([\s\S]*)<\/template>/) || [, ''])[1];
ok('开屏显示条件仍看 splashDone 与 booted', tpl.includes('!splashDone || !db.booted'));
ok('主界面显示条件与之互补', tpl.includes('splashDone && db.booted'));
ok('卡住面板必须同时校验真实状态（防误报挡路）', tpl.includes('stuck && (!splashDone || !db.booted)'));

// 看门狗必须有解除路径，否则一旦触发就再也回不去
ok('看门狗在成功进入后会被解除', /watch\(\[splashDone, \(\) => db\.booted\]/.test(script));
ok('解除时会 clearTimeout', script.includes('clearTimeout(watchdog)'));

// 启动里不许有裸 await 的原生调用（都必须经 guard 限时）
const dbSrc = readFileSync(join(root, 'src', 'stores', 'db.ts'), 'utf8');
const bootBody = (dbSrc.match(/async function boot\(\): Promise<void> \{([\s\S]*?)\n  \}\n/) || [, ''])[1];
ok('取到 boot 函数体', bootBody.length > 100, bootBody.length + ' 字符');
const naked = bootBody.split('\n').filter((l) => /\bawait\s+(probeStorage|readJson|finishLogin|cancelAllScheduledOnBoot)\s*\(/.test(l) && !l.includes('guard('));
ok('boot 里没有未包超时的原生调用', naked.length === 0, naked.map((x) => x.trim()).join(' | '));

/*
 * 【v2.14 真机事故】提醒"重启后一条都不响"。
 * 原因是 boot() 把 cancelAllScheduledOnBoot() 写在 finishLogin() 之后：
 * finishLogin → loadUserData → rescheduleAll 刚把未来两周的提醒排进系统，
 * 紧接着的清理步骤就把它们**全部取消**了。必须是"先清（开机恢复的过期排期）后建"。
 */
const cancelAt = bootBody.indexOf('cancelAllScheduledOnBoot');
const loginAt = bootBody.indexOf('finishLogin(');
ok('冷启动先清空遗留排期、再重建（顺序反了等于把刚排好的提醒全删掉）',
  cancelAt >= 0 && loginAt >= 0 && cancelAt < loginAt,
  'cancelAllScheduledOnBoot@' + cancelAt + ' finishLogin@' + loginAt);

console.log('');
console.log('Boot Test: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
