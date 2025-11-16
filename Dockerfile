FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci || true
COPY . .
EXPOSE 3000
CMD ["npm","start"]
