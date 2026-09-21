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
 * 算法是 **ECDSA P-256 + SHA-256（ES256）**，公钥是 65 字节未压缩点（04||X||Y），签名 64 字节 r||s。
 * 为什么不是 Ed25519：它的 WebCrypto 要 Chrome 113+（2023-05），国产 ROM 的 WebView 普遍更旧，
 * 实测本项目的应用内浏览器就直接 `NotSupportedError` —— 那用户会"永远没有热更新"。
 * ECDSA P-256 从 Chrome 37（2014）起就支持，防投毒这件事完全一样：非对称签名 + 公钥内置 + 验签失败即拒收。
 */
export const SCHOOL_CATALOG_PUBKEY = 'BIDfBSJSe7L_slOhYdB8IMQQt4TAdyYqF6vPhpKr7bjmH31TbV9MIR3za5OynkRYNLWm4xWnRyaDqMlQAUqhvw0';
