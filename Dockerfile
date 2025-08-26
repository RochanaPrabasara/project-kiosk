# Stage 1: Build Angular app
FROM node:latest AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --network-timeout=100000 --retry=5
COPY . .
RUN npm run build --configuration=production

# Stage 2: Serve with Node.js for SSR
FROM node:18.20.4-alpine
WORKDIR /app
COPY --from=build /app/dist/frontend-kiosk /app/dist/frontend-kiosk
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 80
ENV PORT=80
CMD ["node", "dist/frontend-kiosk/server/server.mjs"]
