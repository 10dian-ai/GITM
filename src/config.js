// config.js —— 集中配置，所有可调参数一处定义（配置分离）
export const config = {
  port: Number(process.env.GITM_PORT || 10110),
  token: process.env.GITM_TOKEN || '',
  logLevel: process.env.GITM_LOG_LEVEL || 'info',
  upstreamTimeout: Number(process.env.GITM_UPSTREAM_TIMEOUT || 90000),

  // 探测阈值
  presenceThreshold: Number(process.env.GITM_PRESENCE_TOKENS || 60), // 常数项 > 此值判定存在预设
  maxSegments: Number(process.env.GITM_MAX_SEGMENTS || 8),           // 长预设最多续拉段数
  lowConfidence: 0.6,                                                // 低于此标记低置信

  // 档位：轮数 / 使用的模板索引 / 是否结构探测
  modes: {
    quick:    { rounds: 1, templates: [0],       structural: false },
    standard: { rounds: 2, templates: [0, 1],    structural: true  },
    deep:     { rounds: 3, templates: [0, 1, 2], structural: true  },
  },
};

export function requireToken() {
  return config.token;
}
