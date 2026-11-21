FROM node:20-alpine
WORKDIR /app
# 先装依赖，利用缓存层
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
# 再拷源码
COPY src ./src
COPY public ./public
ENV GITM_PORT=10110
EXPOSE 10110
# 简单健康检查
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:10110/healthz || exit 1
CMD ["node", "src/server.js"]
