# Usar imagen de Node.js con Playwright preinstalado
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# Copiar el resto de la aplicación
COPY . .

# Instalar navegadores de Playwright
RUN npx playwright install chromium

# Exponer el puerto
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["node", "server.js"]

