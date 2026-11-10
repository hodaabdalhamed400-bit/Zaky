#!/usr/bin/env bash
# استعادة نسخة احتياطية إلى قاعدة فارغة (لا يكتب فوق قاعدة بها بيانات).
# الاستخدام: TARGET_DATABASE_URL=... scripts/restore.sh backups/zaki-db-XXXX.dump [backups/zaki-storage-XXXX.tgz] [مجلد_استعادة_المستندات]
set -euo pipefail
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL مطلوب}"
DUMP="${1:?مسار ملف قاعدة البيانات مطلوب}"
TARGET="${TARGET_DATABASE_URL%%\?*}"
DIR="$(dirname "$DUMP")"
STAMP="$(basename "$DUMP" .dump | sed 's/^zaki-db-//')"
if [ -f "$DIR/zaki-$STAMP.sha256" ]; then
  ( cd "$DIR" && sha256sum --check --quiet "zaki-$STAMP.sha256" ) || { echo "✖ فشل التحقق من سلامة ملفات النسخة"; exit 1; }
  echo "✔ سلامة الملفات مؤكدة (SHA-256)"
fi
TABLES="$(psql "$TARGET" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [ "$TABLES" != "0" ]; then echo "✖ القاعدة الهدف ليست فارغة ($TABLES جدول). أنشئ قاعدة جديدة للاستعادة."; exit 1; fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET" "$DUMP"
echo "✔ استُعيدت قاعدة البيانات"
if [ "${2:-}" != "" ]; then
  DEST="${3:-./storage-restored}"
  mkdir -p "$DEST"
  tar -xzf "$2" -C "$DEST"
  echo "✔ استُعيدت المستندات إلى $DEST"
fi
