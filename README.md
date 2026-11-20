# dsh-token-insights

DeepSeek Harness 的 Token 用量统计：对话视图顶部多一个「用量」标签，按区间显示 DeepSeek Harness 记录的每一次模型调用的 Token 用量。只做显示，没有设置项。

## 功能

- **区间**：今日 / 7 天 / 30 天 / 90 天 / 全部
- **概览**：Token 总量（与上一个同长度周期对比）、请求次数、缓存命中率、日均 Token
- **Token 构成**：缓存读取、未缓存输入、缓存写入、输出（含推理）
- **每日用量**：最近 53 周的日历热力图，可向前翻看；活跃天数、当前连续、最长连续、单日最高
- **趋势**：每日柱状图，按类型或按服务商堆叠；90 天以上按周汇总，「今日」按小时
- **按服务商**：服务商及其模型的 Token、请求次数与占比
- **活跃时段**：一天 24 小时的平均 Token、最活跃的小时、工作日与周末的比例
- 页面宽度跟随 DeepSeek Harness 的对话内容宽度，配色使用 DeepSeek Harness 自带的蓝色系，支持浅色 / 深色主题和中英文

## 统计方式

- **来源**：DeepSeek Harness 的对话记录。每次模型调用完成后，DeepSeek Harness 会把该次调用的用量写进记录，本插件读取并计数；**子智能体对话和上下文压缩的摘要调用都计入**；调用失败但已计费的（例如内容审核拒答）同样计入。
- **口径**：与 DeepSeek Harness 的 `TokenUsage` 一致：总量 = 未缓存输入 + 缓存读取 + 缓存写入 + 输出，推理 Token 已含在输出中。缓存命中率 = 缓存读取 ÷ 全部输入。
- **实时与历史**：对话进行时逐条计入；首次启用时自动导入已有对话的用量，之后每次启动只读取有变化的对话。
- **不重复计数**：每条记录按对话和序号只计一次；分叉对话继承的部分、多个进程同时运行都不会重复计算。
- **已删除的内容**：删除的对话、移除的服务商，其用量仍计入总量，不在服务商列表中显示，只在列表下方注明合计。
- **不统计**：不在对话记录里的请求（例如其他插件自己的检测请求）。
- **不显示费用**：各服务商的价格与计费方式差异很大，按 Token 估算的费用并不可靠。

## 数据

用量记录保存在 `$DSH_HOME/storages/token-insights.json`（默认 `~/.dsh/storages/token-insights.json`），只含按天、按服务商、按模型的合计与每小时的 Token 合计，不保存对话内容；只在本机读写，不联网。删除该文件后，下次启动会从现有对话重新导入。

## 安装

### 通过插件索引安装（推荐）

1. 在 DeepSeek Harness 的**插件**页，于**实验性插件**中打开**自定义插件索引**。
2. 切换到**发现**，点击**添加索引源**，填入：

   ```
   https://raw.githubusercontent.com/JioJioStudio404/dsh-jiojiostudio404-index/main/index.json
   ```

3. 在列表中找到本插件并确认安装，安装后重启 DeepSeek Harness。之后发布的新版本会显示**有新版本**，可在应用内更新。

### 从源码安装

需要 DeepSeek Harness 0.2.2-rc.1 或更高版本、Node.js 24.9 或更高版本。

```bash
git clone https://github.com/JioJioStudio404/dsh-token-insights.git
dsh plugin --profile desktop add "/path/to/dsh-token-insights"
```

安装后重启 DeepSeek Harness，首次启动约 5 秒后开始导入历史记录。

## 许可证

MIT
