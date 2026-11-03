# Aadi CRM web image (Linux). Build context is ./frontend:
#   docker build -t aadi-crm-web frontend
# Serves the built single-page app and forwards /api to the API container.
FROM node:22-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Empty = same-origin /api (nginx forwards it), which keeps the CSRF cookies first-party.
ENV VITE_API_BASE_URL=""
RUN npx vite build

FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV NGINX_MAX_BODY=25m \
    API_UPSTREAM=http://api:8000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
