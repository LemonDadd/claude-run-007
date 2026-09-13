# 笔顺字帖 —— 纯静态站点，nginx 托管
# 一键运行：docker compose up --build  →  http://localhost:8080
#
# 字形数据（web/data，约 6900 常用字）已预构建进仓库，镜像构建无需联网。
# 若需从源数据重新生成（本机操作，需要联网）：npm install && npm run build-data

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s CMD wget -qO- http://localhost/ >/dev/null || exit 1
