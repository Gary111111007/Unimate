/**
 * 大学生体测本机估算。
 * 评分表改写自 THEIA v0.7.7（MIT），完整许可见 THIRD_PARTY_NOTICES.md。
 * 结果只用于自查，不替代学校或国家学生体质健康标准的正式认定。
 */
export type FitnessGender = 'male' | 'female';
export type FitnessGrade = '12' | '34';

export interface FitnessInput {
  gender: FitnessGender;
  grade: FitnessGrade;
  heightCm: number;
  weightKg: number;
  vitality: number;
  run50: number;
  flex: number;
  jump: number;
  strength: number;
  enduranceSeconds: number;
}

export interface FitnessScore {
  bmiValue: number;
  bmi: number;
  vitality: number;
  run50: number;
  flex: number;
  jump: number;
  strength: number;
  endurance: number;
  standard: number;
  bonus: number;
  total: number;
  level: '优秀' | '良好' | '及格' | '不及格';
}

const LEVELS = [100,95,90,85,80,78,76,74,72,70,68,66,64,62,60,50,40,30,20,10];
const TABLES = {
  vital: {
    m12: [5040,4920,4800,4550,4300,4180,4060,3940,3820,3700,3580,3460,3340,3220,3100,2940,2780,2620,2460,2300],
    f12: [3400,3350,3300,3150,3000,2900,2800,2700,2600,2500,2400,2300,2200,2100,2000,1960,1920,1880,1840,1800],
    m34: [5140,5020,4900,4650,4400,4280,4160,4040,3920,3800,3680,3560,3440,3320,3200,3030,2860,2690,2520,2350],
    f34: [3450,3400,3350,3200,3050,2950,2850,2750,2650,2550,2450,2350,2250,2150,2050,2010,1970,1930,1890,1850]
  },
  run50: {
    m12: [6.7,6.8,6.9,7.0,7.1,7.3,7.5,7.7,7.9,8.1,8.3,8.5,8.7,8.9,9.1,9.3,9.5,9.7,9.9,10.1],
    f12: [7.5,7.6,7.7,8.0,8.3,8.5,8.7,8.9,9.1,9.3,9.5,9.7,9.9,10.1,10.3,10.5,10.7,10.9,11.1,11.3],
    m34: [6.6,6.7,6.8,6.9,7.0,7.2,7.4,7.6,7.8,8.0,8.2,8.4,8.6,8.8,9.0,9.2,9.4,9.6,9.8,10.0],
    f34: [7.4,7.5,7.6,7.9,8.2,8.4,8.6,8.8,9.0,9.2,9.4,9.6,9.8,10.0,10.2,10.4,10.6,10.8,11.0,11.2]
  },
  flex: {
    m12: [24.9,23.1,21.3,19.5,17.7,16.3,14.9,13.5,12.1,10.7,9.3,7.9,6.5,5.1,3.7,2.7,1.7,0.7,-0.3,-1.3],
    f12: [25.8,24.0,22.2,20.6,19.0,17.7,16.4,15.1,13.8,12.5,11.2,9.9,8.6,7.3,6.0,5.2,4.4,3.6,2.8,2.0],
    m34: [25.1,23.3,21.5,19.9,18.2,16.8,15.4,14.0,12.6,11.2,9.8,8.4,7.0,5.6,4.2,3.2,2.2,1.2,0.2,-0.8],
    f34: [26.3,24.4,22.4,21.0,19.5,18.2,16.9,15.6,14.3,13.0,11.7,10.4,9.1,7.8,6.5,5.7,4.9,4.1,3.3,2.5]
  },
  jump: {
    m12: [273,268,263,256,248,244,240,236,232,228,224,220,216,212,208,203,198,193,188,183],
    f12: [207,201,195,188,181,178,175,172,169,166,163,160,157,154,151,146,141,136,131,126],
    m34: [275,270,265,258,250,246,242,238,234,230,226,222,218,214,210,205,200,195,190,185],
    f34: [208,202,196,189,182,179,176,173,170,167,164,161,158,155,152,147,142,137,132,127]
  },
  strength: {
    m12: [19,18,17,16,15,14,14,13,13,12,12,11,11,10,10,9,8,7,6,5],
    f12: [56,54,52,49,46,44,42,40,38,36,34,32,30,28,26,24,22,20,18,16],
    m34: [20,19,18,17,16,15,15,14,14,13,13,12,12,11,11,10,9,8,7,6],
    f34: [57,55,53,50,47,45,43,41,39,37,35,33,31,29,27,25,23,21,19,17]
  },
  endurance: {
    m12: [197,202,207,214,222,227,232,237,242,247,252,257,262,267,272,292,312,332,352,372],
    f12: [198,204,210,217,224,229,234,239,244,249,254,259,264,269,274,284,294,304,314,324],
    m34: [195,200,205,212,220,225,230,235,240,245,250,255,260,265,270,285,310,330,350,370],
    f34: [196,202,208,215,222,227,232,237,242,247,252,257,262,267,272,282,292,302,312,322]
  }
} as const;

type TableKey = 'm12' | 'f12' | 'm34' | 'f34';
const weights = { bmi: .15, vitality: .15, run50: .20, flex: .10, jump: .10, strength: .10, endurance: .20 };

function tableKey(gender: FitnessGender, grade: FitnessGrade): TableKey {
  return ((gender === 'male' ? 'm' : 'f') + grade) as TableKey;
}
function high(value: number, thresholds: readonly number[]): number {
  const index = thresholds.findIndex((threshold) => value >= threshold);
  return index < 0 ? 10 : LEVELS[index];
}
function low(value: number, thresholds: readonly number[]): number {
  const index = thresholds.findIndex((threshold) => value <= threshold);
  return index < 0 ? 10 : LEVELS[index];
}
function bmiScore(value: number, gender: FitnessGender): number {
  if (value >= (gender === 'male' ? 17.9 : 17.2) && value <= 23.9) return 100;
  return value >= 28 ? 60 : 80;
}
function bonus(value: number, baseline: number, thresholds: readonly number[], lower: boolean): number {
  const index = thresholds.findIndex((threshold) => lower ? baseline - value >= threshold : value - baseline >= threshold);
  return index < 0 ? 0 : 10 - index;
}

export function calculateFitness(input: FitnessInput): FitnessScore | null {
  const values = [input.heightCm, input.weightKg, input.vitality, input.run50, input.flex, input.jump, input.strength, input.enduranceSeconds];
  if (values.some((value) => !Number.isFinite(value)) || input.heightCm <= 0 || input.weightKg <= 0
    || input.vitality <= 0 || input.run50 <= 0 || input.jump <= 0 || input.strength < 0 || input.enduranceSeconds <= 0) return null;
  const key = tableKey(input.gender, input.grade);
  const bmiValue = input.weightKg / Math.pow(input.heightCm / 100, 2);
  const result = {
    bmi: bmiScore(bmiValue, input.gender),
    vitality: high(input.vitality, TABLES.vital[key]),
    run50: low(input.run50, TABLES.run50[key]),
    flex: high(input.flex, TABLES.flex[key]),
    jump: high(input.jump, TABLES.jump[key]),
    strength: high(input.strength, TABLES.strength[key]),
    endurance: low(input.enduranceSeconds, TABLES.endurance[key])
  };
  const standard = result.bmi * weights.bmi + result.vitality * weights.vitality + result.run50 * weights.run50
    + result.flex * weights.flex + result.jump * weights.jump + result.strength * weights.strength + result.endurance * weights.endurance;
  const baseStrength = input.gender === 'male' ? (input.grade === '12' ? 19 : 20) : (input.grade === '12' ? 56 : 57);
  const strengthBonus = bonus(input.strength, baseStrength, input.gender === 'male' ? [10,9,8,7,6,5,4,3,2,1] : [13,12,11,10,9,8,7,6,4,2], false);
  const runThresholds = input.gender === 'male' ? [35,32,29,26,23,20,16,12,8,4] : [50,45,40,35,30,25,20,15,10,5];
  const runBonus = bonus(input.enduranceSeconds, TABLES.endurance[key][0], runThresholds, true);
  const extra = Math.min(20, strengthBonus + runBonus);
  const total = Math.min(120, standard + extra);
  return {
    bmiValue, ...result, standard, bonus: extra, total,
    level: total >= 90 ? '优秀' : total >= 80 ? '良好' : total >= 60 ? '及格' : '不及格'
  };
}
