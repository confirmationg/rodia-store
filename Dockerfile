FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/rodia.db
EXPOSE 3000
CMD ["node", "server.js"]
