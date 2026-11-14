FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node assets ./assets
COPY --chown=node:node config.json ./config.json
RUN mkdir -p data out && chown node:node data out
USER node
CMD ["node", "src/daemon.js"]
