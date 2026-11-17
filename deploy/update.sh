#!/usr/bin/env bash
# تحديث النظام إلى آخر نسخة من GitHub (مع نسخة احتياطية قبل التحديث).
set -euo pipefail
APP_DIR=/opt/hr
BRANCH="${BRANCH:-main}"
[ "$(id -u)" -eq 0 ] || { echo "استخدم sudo"; exit 1; }
/usr/local/bin/hr-backup
git -C "$APP_DIR" fetch -q origin "$BRANCH"
git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
chown -R hr:hr "$APP_DIR"
sudo -u hr "$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"
install -m 750 "$APP_DIR/deploy/backup.sh" /usr/local/bin/hr-backup
install -m 750 "$APP_DIR/deploy/update.sh" /usr/local/bin/hr-update
systemctl restart hr
sleep 3
curl -fsS http://127.0.0.1:8000/healthz >/dev/null && echo "تم التحديث ✓ ($(git -C "$APP_DIR" log --oneline -1))" \
  || { echo "الخدمة لا تعمل بعد التحديث. راجع: journalctl -u hr -n 50"; exit 1; }
