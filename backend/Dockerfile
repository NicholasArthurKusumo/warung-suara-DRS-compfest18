# Dockerfile untuk backend (Express + Prisma)
FROM node:20-slim

WORKDIR /app

# Prisma schema/migration engine butuh OpenSSL - tanpa ini, container akan
# crash-loop dengan error "Schema engine error" karena engine binary gagal load.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Pakai npm install penuh (bukan --omit=dev) karena Prisma CLI (devDependency)
# dibutuhkan untuk generate client saat build image.
RUN npm install

COPY . .

# Generate Prisma client berdasarkan schema
RUN npx prisma generate

# Folder terpisah untuk file database SQLite, supaya bisa di-mount sebagai
# volume terpisah tanpa menimpa seluruh kode aplikasi saat container restart.
RUN mkdir -p /app/data

EXPOSE 3000

# Jalankan migration (apply migration yang sudah ada di /prisma/migrations)
# baru start server, setiap kali container start.
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]