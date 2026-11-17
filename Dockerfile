FROM node:20-slim

# Set environment produksi, port default Koyeb, dan zona waktu WIB
ENV NODE_ENV=production \
    PORT=8000 \
    TZ=Asia/Jakarta

# Pastikan sertifikat SSL (CA) lengkap agar request HTTPS ke berbagai sumber tidak gagal
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Salin manifest dependensi lebih dulu agar layer cache Docker tetap optimal
COPY package*.json ./

# Gunakan npm ci jika package-lock.json tersedia, atau npm install jika upload manual via web GitHub
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi

# Salin seluruh kode aplikasi
COPY . .

# Jalankan sebagai user non-root demi keamanan container
USER node

EXPOSE 8000

# Eksekusi langsung dengan node (bukan npm start) agar sinyal stop/SIGTERM dari Koyeb ditangani bersih
CMD ["node", "index.js"]
