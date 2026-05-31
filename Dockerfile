FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN adduser -u 10001 -D appuser
USER appuser

EXPOSE 3000

CMD ["node", "server.js"]
