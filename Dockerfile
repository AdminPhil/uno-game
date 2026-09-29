FROM node:24-alpine
WORKDIR /app

# Production needs only ws. Keep tooling and development dependencies out.
COPY deploy/package.json deploy/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.js hosting.js ./
# These are already browser-native modules; bundling is optional.
COPY index.html client.js style.css ./dist/

ENV NODE_ENV=production
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "hosting.js"]
