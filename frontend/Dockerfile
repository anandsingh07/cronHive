FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Next.js telemetry disable
ENV NEXT_TELEMETRY_DISABLED=1
ARG API_URL=http://api:4000
ENV API_URL=$API_URL

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
