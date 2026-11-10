#!/usr/bin/env bash
# نسخة احتياطية كاملة: قاعدة البيانات (pg_dump بصيغة custom) + مجلد المستندات + ملف تحقق SHA-256.
# الاستخدام: DATABASE_URL=... STORAGE_DIR=./storage BACKUP_DIR=./backups scripts/backup.sh
# ملاحظة: خزّن النسخ خارج الخادم ومشفرة (انظر docs/DEPLOY_RENDER.md).
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL مطلوب}"
DB_URL="${DATABASE_URL%%\?*}"            # pg_dump لا يقبل معاملات Prisma مثل ?schema=
OUT="${BACKUP_DIR:-./backups}"
STORAGE="${STORAGE_DIR:-./storage}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$OUT"
DB_FILE="$OUT/zaki-db-$TS.dump"
pg_dump "$DB_URL" --format=custom --no-owner --no-privileges --file="$DB_FILE"
FILES=("$(basename "$DB_FILE")")
if [ -d "$STORAGE" ]; then
  ST_FILE="$OUT/zaki-storage-$TS.tgz"
  tar -czf "$ST_FILE" -C "$(dirname "$STORAGE")" "$(basename "$STORAGE")"
  FILES+=("$(basename "$ST_FILE")")
fi
( cd "$OUT" && sha256sum "${FILES[@]}" > "zaki-$TS.sha256" )
echo "✔ تمت النسخة: $OUT (${FILES[*]})"
