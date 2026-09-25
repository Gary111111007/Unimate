// 契约用例：tool.weather.query.schema.json（主规划 §4.8）
// 【比赛口径】天气移出比赛 MVP；且 AGENTS.md 把它列为「产品负责人点头才做」——
// 本文件只冻结契约，不代表已开工。最要害的一条是 i-03：精确定位不在枚举内。

export const schemaFile = 'tool.weather.query.schema.json';

export const valid = [
  {
    id: 'v-01 只给必填（locationScope 默认 city）',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91' },
  },
  {
    id: 'v-02 指定日期与城市级定位',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      date: '2026-09-26',
      locationScope: 'city',
    },
  },
  {
    id: 'v-03 explicit（用户明确说了地点）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      locationScope: 'explicit',
    },
  },
];

export const invalid = [
  {
    id: 'i-01 locationScope 想开精确定位 —— 需单独授权，不在枚举内',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', locationScope: 'precise' },
    expect: '不在枚举内',
  },
  {
    id: 'i-02 缺 userId',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e' },
    expect: '缺少必填字段: userId',
  },
  {
    id: 'i-03 多出坐标字段（想直接传经纬度）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      lat: 39.9,
      lon: 116.4,
    },
    expect: '不允许的额外字段: lat',
  },
  {
    id: 'i-04 date 格式不对',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', date: '2026/09/26' },
    expect: '不匹配 pattern',
  },
];
