# 精英敌人动作素材

素材从项目参考目录 `reference/精英敌人素材/` 接入，逐帧独立保存为透明 RGBA PNG，统一 96×112 px，未将预览图或合成图直接作为游戏帧。

| 游戏资源 | 参考源文件 | 用途 |
|---|---|---|
| `mahito_idle.png` | `真人形态1.png` | 真人战斗基础形象 |
| `mahito_domain.png` | `真人形态2.png` | 真人被动触发时短暂切换的领域姿态 |
| `bomb_demon_idle.png` | `炸弹恶魔形态1.png` | 炸弹恶魔战斗基础形象 |
| `bomb_demon_escape.png` | `炸弹恶魔形态2.png` | 炸弹恶魔被击败后的离场姿态 |
| `bomb_demon_boom_1.png` | `炸弹恶魔技能1-1.png` | Boom 起手帧，900 ms |
| `bomb_demon_boom_2.png` | `炸弹恶魔技能1-2.png` | Boom 发射帧，300 ms |

两张 Boom 原图为 1254×1254 RGB，棋盘格背景已按边缘连通区域去除，再保持宽高比例缩放并按脚底/构图置入 96×112 RGBA 帧。技能动画映射为 `bomb-demon-boom → boom`，触发概率为 50%，仍使用原有 2.5× 远程伤害结算；两帧合计 1.2 秒，伤害数字与动作结束帧同步显示，帧只在回放中显示，不重新结算伤害。

实际属性、精英步数成长、技能和被动配置集中在 `characters.js`、`skills.js` 与 `campaign.js`。战斗结果仍由 `battle.js` 预先结算，图像动画只回放结果。
