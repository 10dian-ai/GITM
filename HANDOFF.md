# GITM 会话交接文档

> 交接日期：2026-11-21　·　上一会话因上下文混乱中止，本文档是新会话的唯一起点。
> 本仓库是**公开仓库**：令牌、root 密码、服务器 IP 一律不写在这里（Claude 的记忆里有，或由用户私下提供）。

## 1. 项目是什么

GITM（Give It To Me）是一个 WebUI 工具，部署在主服务器的 **10110 端口**。用户在 New API 类网关前面加了一个「注入酒馆（SillyTavern）预设」的中间件，GITM 用来**自测这个中间件**：从 API 调用侧能把注入的预设还原出多少。

流程：填 OpenAI / Anthropic / Gemini 格式 API → 自动识别端点 → 拉模型 → 选模型测试 → 探测注入（有无 / 位置 / 体量）→ 流式复述提取 → 多轮合并算置信度 → 与原始预设对照评分 → 导出可直接导入酒馆的预设 JSON（另有 TXT / MD）。

定位：面向**用户自己的中间件**做泄漏审计；不做隐蔽、规避检测或批量扫描他人服务之类的功能。

## 2. 当前状态（重要）

| 项 | 状态 |
|---|---|
| **线上运行版本** | **v1**（旧版），主服务器 `/opt/gitm`，容器 `gitm`，healthy，端口 10110 公网可达 |
| 访问令牌 | 在主服务器 `/opt/gitm/.env` 的 `GITM_TOKEN`（不要写进仓库） |
| **本仓库代码** | **v2（全面重写版）**，本地全部测试通过，**尚未部署** |
| 部署卡点 | 上一会话尝试用 base64 分块手抄传到服务器，多次出现字符损坏，未完成。**现在代码已在 GitHub，直接从这里拉即可** |

## 3. 服务器操作规则（用户定的，必须遵守）

1. **每次登录主服务器前先告诉用户**；在主服务器执行命令前先说明要做什么（用户同意后同类操作不必反复问）。
2. **绝不重启或中断生产容器 `new-api`**，只通过数据修改它。GITM 是独立容器，不与它共享卷或网络。
3. 主服务器上还有 cpa-nexus、epay、1Panel 等一堆容器，部署 GITM 时只动 `gitm` 这一个容器。
4. 访问路径：claude.ai 里的 “server control” 连接器（工具名 `mcp__server_contral__*`）在**跳板机**上执行命令，再从跳板机 `sshpass` SSH 到主服务器。跳板机上**没有 git / gh**，但能访问 github.com:443。

## 4. 下一步：把 v2 部署上线（推荐做法）

在主服务器上（经跳板机），**保留现有 `.env`**，用 GitHub 的 tarball 覆盖代码后重建：

```bash
# 在主服务器上执行（先告诉用户）
cd /opt/gitm
cp .env /tmp/gitm.env.bak                     # 备份令牌
curl -fsSL https://codeload.github.com/10dian-ai/gitm/tar.gz/refs/heads/main -o /tmp/gitm-v2.tgz
rm -rf /opt/gitm/src /opt/gitm/public          # v1 是扁平 src，v2 有子目录，先清掉旧源码
tar -xzf /tmp/gitm-v2.tgz -C /opt/gitm --strip-components=1
cp /tmp/gitm.env.bak /opt/gitm/.env            # 还原令牌
docker compose up -d --build                   # 只重建 gitm 容器
```

验证：

```bash
curl -s http://127.0.0.1:10110/healthz         # 应返回 version 2.0.0
curl -s -o /dev/null -w "%{http_code}\n" -XPOST http://127.0.0.1:10110/api/detect -H 'content-type: application/json' -d '{}'   # 应 401
docker ps --filter name=new-api                 # 确认 new-api 仍在运行、未被动过
```

如果主服务器访问 codeload 失败，备选：在跳板机下载后 `scp` 过去。**不要再用手抄 base64 的方式传文件。**

## 5. v2 相比 v1 改了什么

| 模块 | v1 | v2 |
|---|---|---|
| 提取 | 非流式 + 前端假进度条 | **SSE 真流式**，按真实 `finish_reason` 续拉长预设 |
| 注入量估算 | 两点差分 | **多点最小二乘回归**（输出 R²） |
| 置信度 | 整行多数表决 | **字符二元组 Dice 相似度**，连续 0~1，并标记“动态内容” |
| 对照评分 | 无 | **`/api/eval`**：粘贴原始预设，逐条算还原率（full / partial / missing） |
| 结构 | 扁平文件 | `providers/`、`probes/` 分层，`config.js` 集中配置 |
| 测试 | 无 | 9 个单元测试 + mock 上游端到端测试 |

## 6. 目录

```
src/
  server.js            入口：路由、令牌校验、SSE 接口 /api/extract-stream
  config.js            所有阈值与档位（quick/standard/deep）
  logger.js            分级日志 + 密钥脱敏
  providers/           base(HTTP/SSE/错误/地址规范化) + openai/anthropic/gemini + index(注册与自动识别)
  probes/              baseline(多点回归) structural(位置) extract(流式复述+续拉) index(管线)
  assemble.js          多轮合并、置信度、切条目（纯函数）
  eval.js              对照评分（纯函数）
  exporter.js          酒馆预设 JSON / TXT / MD
public/                白丝系前端（奶白+粉丝带+猫耳），fetch 流式读 SSE
test/                  单元测试；test/e2e/ 是模拟注入中间件 + 驱动脚本
```

## 7. 怎么测

```bash
npm install
npm test                                   # 9 个单元测试，应全过

# 端到端（两个终端或后台跑）
node test/e2e/mock.js                      # 模拟注入了预设的 OpenAI 兼容上游，端口 10210
GITM_TOKEN=smoke GITM_PORT=10199 node src/server.js
node test/e2e/drive.mjs                    # 期望：present=true, runs=4, entries=3, eval overall=100%, “✅ 端到端通过”
```

上一会话的端到端结果：注入量估算 126（真实 120），R²=1，位置 before_prompt，流式 28 段，4 轮，置信度 100%，还原率 100%。

## 8. 踩过的坑

- **手抄 base64 传文件会损坏**（6KB 一块就会错一两个字符）。用 GitHub 或 scp。
- `node -I` 不是 Node 的隔离参数（那是 Python 的），会直接退出。
- 合并多轮结果时按**值**过滤骨架会把相同副本全滤掉，导致置信度塌成 1/N——已改为按**下标**取骨架。
- `node --test test/` 会报 MODULE_NOT_FOUND，用 `node --test test/*.test.js`（已写进 `npm test`）。
- 结构探测（注入位置）靠关键词匹配模型的自述，准确度一般；真实中间件上需要验证。

## 9. 待办

- [ ] 把 v2 部署上线并验证（第 4 节）
- [ ] 用用户真实的中间件跑一遍，用对照评分看真实还原率
- [ ] Anthropic / Gemini 的流式解析只按协议写好，**尚未对真实端点测过**
- [ ] 补“动态内容”检测的单测（构造每轮变化一行的 mock）
- [ ] 可选：1Panel 反代挂域名 + HTTPS
