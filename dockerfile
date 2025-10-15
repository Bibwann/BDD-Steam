# Dockerfile
FROM node:20-alpine

# ------------- Base -----------------
WORKDIR /app

# Déclare l'environnement (utile si ton code lit PORT/HOST)
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copie des manifestes pour un cache de build optimal
COPY package*.json ./

# Install deps prod uniquement, reproductible
RUN npm ci --omit=dev

# Copie stricte du code nécessaire (évite les surprises)
COPY public ./public
COPY src ./src
# (copie optionnelle d'autres fichiers utiles en prod)
# COPY .env ./.env

# Sécurité: drop root (l'image a l'user "node")
USER node

EXPOSE 3000

# Healthcheck (nécessite wget présent sur alpine)
USER root
RUN apk add --no-cache wget
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/ || exit 1

CMD ["node", "src/server.js"]
