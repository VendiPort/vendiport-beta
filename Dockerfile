FROM node:20-alpine
WORKDIR /app

# Zero runtime deps — copy app + seed data
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY data ./data

ENV NODE_ENV=production
ENV PORT=3847
ENV HOST=0.0.0.0
# Optional: mount a volume at /data and set DATA_DIR=/data
ENV DATA_DIR=/app/data

EXPOSE 3847
CMD ["node", "server.js"]
