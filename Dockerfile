FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci || true
COPY . .
CMD ["npm","run","health"]
