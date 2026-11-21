# GITM · Give It To Me

从 API 调用侧还原中间件注入的 SillyTavern 预设，用于给**你自己的**预设注入中间件做泄漏自测。支持 OpenAI / Anthropic / Gemini 三种格式，可以自动识别端点、流式提取、对照评分，也能导出酒馆预设 JSON。

接手开发请先读 **[HANDOFF.md](./HANDOFF.md)**。

## 快速运行

```bash
cp .env.example .env        # 填 GITM_TOKEN（强随机值）
docker compose up -d --build
# 打开 http://<host>:10110 ，进入时填 GITM_TOKEN
```

## 测试

```bash
npm install && npm test
```

## 能拿到 / 拿不到

- 能拿到：模型实际看到的注入文本，以及它的位置和角色。
- 拿不到：未启用的条目、正则脚本、宏的原始写法（这些都没进上下文）。采样参数读不出来，导出时标为 `unverified`。
- 模型是复述而不是逐字拷贝，预设越长越可能漂移，所以用多轮合并加置信度来兜底。
