FROM node:24-alpine
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/public ./public
ENV NODE_ENV=production
ENV LUDUS_DATA_DIR=/data
EXPOSE 3000
CMD ["npm", "start"]
