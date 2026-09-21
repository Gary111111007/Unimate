/**
 * 学校档案下发的验签公钥（Net.md P2 / PRD 5.14）。
 *
 * 这一行是把关的唯一依据：**公钥硬编码进 APK**，远端 `catalog/index.json` 必须用配对的私钥签名，
 * 验签不过一律拒收（否则"热更新"就成了别人给你换钓鱼域名的通道）。
 *
 * 规矩：
 *  - 私钥在 `keys/school-signing.key`（**已 gitignore，绝不入库、绝不外发**）；
 *  - 换密钥 = 重新 keygen + 改这一行 + 重新出包；**旧 APK 不会认新私钥的签名**（这是特性，不是 bug）；
 *  - 真上线时把私钥放 CI secrets（见 `docs/school-pack.md`）。
 *
 * 算法是 **Ed25519**（Net.md 2.3 原本的写法）：公钥 32 字节、签名 64 字节。
 * 客户端**用纯 JS 验签**（@noble/ed25519），**不依赖 WebCrypto** —— 第一版用平台密码学实现，
 * 真机上直接报"当前系统的 WebCrypto 用不了"（安卓 WebView 实现差异）。平台做不到的事，
 * 就用纯 JS 自己做，这样在任何机型上行为一致：能验就是能验，验不过就是拒收。
 */
export const SCHOOL_CATALOG_PUBKEY = 'tPgrAT79KTA-vOQ8TRSwsI5VE72qK9tWT_WuyniIlj8';
