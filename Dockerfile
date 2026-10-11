FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=8765 DATA_DIR=/data
VOLUME /data
EXPOSE 8765
CMD ["node", "server.js"]
