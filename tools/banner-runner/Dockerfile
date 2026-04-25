FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY config ./config
COPY README.md ./
COPY .env.example ./

RUN npm install
RUN npx prisma generate

CMD ["npm", "run", "dev", "--", "--help"]
