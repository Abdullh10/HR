#!/usr/bin/env bash
# نسخة احتياطية: قاعدة البيانات + المرفقات. الاحتفاظ 14 نسخة.
# الاستعادة:  gunzip -c db-XXXX.sql.gz | sudo -u postgres psql hr
#             sudo tar -xzf files-XXXX.tar.gz -C /
set -euo pipefail
cd /
BACKUP_DIR=/var/backups/hr
KEEP="${KEEP:-14}"
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"; chmod 750 "$BACKUP_DIR"; chgrp hr "$BACKUP_DIR" 2>/dev/null || true
sudo -u postgres pg_dump --clean --if-exists hr | gzip > "$BACKUP_DIR/db-$TS.sql.gz"
tar -czf "$BACKUP_DIR/files-$TS.tar.gz" -C / var/lib/hr etc/hr 2>/dev/null || true
chmod 640 "$BACKUP_DIR"/*-"$TS".*; chgrp hr "$BACKUP_DIR"/*-"$TS".* 2>/dev/null || true  # يقرأ النظام آخر نسخة لعرضها في صفحة النسخ
ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$BACKUP_DIR"/files-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "نسخة احتياطية: $BACKUP_DIR/db-$TS.sql.gz"
