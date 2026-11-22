# japan-utils — zero-dependency Node service.
# Works on Koyeb (primary), Render (Docker), Fly.io, or any container host.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000

# No `npm install` step: the service has zero runtime dependencies.
COPY package.json ./
COPY src ./src
COPY data ./data
COPY openapi.json ./openapi.json

EXPOSE 8000
USER node
CMD ["node", "src/server.js"]
