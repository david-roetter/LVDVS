FROM node:24-alpine
WORKDIR /app
COPY backend/package.json ./backend/package.json
WORKDIR /app/backend
COPY backend/src ./src
COPY backend/public ./public
ENV NODE_ENV=production
ENV LUDUS_DATA_DIR=/data
EXPOSE 3000
CMD ["npm", "start"]
