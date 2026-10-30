# Optional: run the built-in server (page + HTTP API) in a container (Docker Engine required).
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=3242
EXPOSE 3242
# --host 0.0.0.0: inside a container the server must listen on all interfaces so the port mapping reaches it.
CMD ["node", "tools/server.js", "--host", "0.0.0.0", "--mode", "overlay"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -q -O /dev/null http://127.0.0.1:3242/api/health || exit 1