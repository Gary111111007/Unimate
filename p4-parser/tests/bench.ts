import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExams, parseGrades, validateRulePack } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');
const bytes = (text: string): number => new TextEncoder().encode(text).length;
const pack = validateRulePack(JSON.parse(read('rules/buct.json')));
if (!pack.ok) throw new Error(pack.errors.join('；'));
const fixtures = {
  'grades.html': read('fixtures/grades.sample.html'),
  'grades.json': read('fixtures/grades.sample.json'),
  'exams.html': read('fixtures/exams.sample.html'),
  'exams.json': read('fixtures/exams.sample.json'),
  'jwglxt-exam.sample.html': read('../fixtures/jwglxt-exam.sample.html')
};
const iterations = 1000;

function measure(label: string, input: string, parse: (value: string) => unknown): number {
  for (let i = 0; i < 50; i++) parse(input);
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) parse(input);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(label + '：' + (ms / iterations).toFixed(4) + ' ms/次（' + iterations + ' 次）');
  return Math.round((ms / iterations) * 10000) / 10000;
}

console.log('规则包：' + bytes(read('rules/buct.json')) + ' B');
for (const [name, content] of Object.entries(fixtures)) console.log(name + '：' + bytes(content) + ' B');
console.log('');
const result = {
  iterations,
  gradesJsonMs: measure('成绩 JSON', fixtures['grades.json'], (value) => parseGrades(value, pack.pack)),
  gradesHtmlMs: measure('成绩 HTML', fixtures['grades.html'], (value) => parseGrades(value, pack.pack)),
  examsJsonMs: measure('考试 JSON', fixtures['exams.json'], (value) => parseExams(value, pack.pack)),
  examsHtmlMs: measure('考试 HTML', fixtures['exams.html'], (value) => parseExams(value, pack.pack)),
  legacyExamHtmlMs: measure('主工程脱敏考试 HTML', fixtures['jwglxt-exam.sample.html'], (value) => parseExams(value, pack.pack))
};
console.log('\nBENCH_JSON=' + JSON.stringify(result));
