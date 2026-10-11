FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4174
ENV ISCHEDULE_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 4174
CMD ["node", "dist-server/index.mjs"]
