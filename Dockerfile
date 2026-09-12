FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json rules.md ./
COPY src/ ./src/
COPY public/ ./public/
RUN node --check src/server.mjs
CMD ["node", "src/server.mjs"]
