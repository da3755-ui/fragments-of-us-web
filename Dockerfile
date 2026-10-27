# For Railway, Fly.io, a VPS, or anywhere that runs containers.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production \
    PORT=3000 \
    DB_FILE=/data/memory.db \
    TRUST_PROXY=1
# Mount a persistent volume here, or the memory resets on every deploy.
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
