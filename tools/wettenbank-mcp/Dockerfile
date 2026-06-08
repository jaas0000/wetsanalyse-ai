# Dockerfile voor de Wettenbank MCP Server

# Stap 1: Build fase
FROM node:20-slim AS builder

WORKDIR /app

# Kopieer package files
COPY tools/wettenbank-mcp/package*.json ./
COPY tools/wettenbank-mcp/tsconfig.json ./

# Installeer alle dependencies (inclusief dev)
RUN npm install

# Kopieer de broncode
COPY tools/wettenbank-mcp/src ./src

# Bouw de TypeScript code naar Javascript (dist/)
RUN npm run build

# Stap 2: Runtime fase
FROM node:20-slim

WORKDIR /app

# Kopieer alleen de noodzakelijke runtime files
COPY tools/wettenbank-mcp/package*.json ./
RUN npm install --omit=dev

# Kopieer de gebouwde code van de builder fase
COPY --from=builder /app/dist ./dist

# De MCP server communiceert via StdIO (standaard) of kan worden 
# geconfigureerd voor SSE (HTTP). Docker containers gebruiken vaak SSE
# als ze als cloud-service draaien.
# Voor StdIO gebruik:
ENTRYPOINT ["node", "dist/index.js"]

# Voor HTTP/SSE (als de server dat ondersteunt):
# EXPOSE 3000
# CMD ["node", "dist/index.js", "--transport", "sse", "--port", "3000"]
