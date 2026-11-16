FROM nginx:1.27-alpine

COPY infra/nginx/webgis.conf /etc/nginx/nginx.conf
COPY sites /srv/sites
