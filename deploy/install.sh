#!/usr/bin/env bash
# تثبيت نظام بدل الراحة على خادم Ubuntu (Oracle Cloud Always Free) بأمر واحد.
#
#   curl -fsSL https://raw.githubusercontent.com/Abdullh10/HR/main/deploy/install.sh | sudo bash
#   أو مع نطاق وشهادة HTTPS:
#   curl -fsSL https://raw.githubusercontent.com/Abdullh10/HR/main/deploy/install.sh | sudo DOMAIN=hr.example.com EMAIL=you@example.com bash
#
# يثبّت: PostgreSQL + Python + Nginx + خدمة systemd + نسخ احتياطي يومي + فتح المنافذ 80/443.
# آمن لإعادة التشغيل (لا يحذف البيانات).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Abdullh10/HR.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/hr
DATA_DIR=/var/lib/hr
ENV_DIR=/etc/hr
ENV_FILE=$ENV_DIR/hr.env
BACKUP_DIR=/var/backups/hr
DB_NAME=hr
DB_USER=hr
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "شغّل السكربت بصلاحية root (sudo)."; exit 1; }
cd /  # أوامر sudo -u postgres لا تستطيع دخول مجلد المستخدم الحالي؛ نبدأ من الجذر لتجنّب التحذيرات
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || echo "تحذير: السكربت مُختبر على Ubuntu 22.04/24.04 فقط."

log "تثبيت الحزم"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git python3 python3-venv python3-pip postgresql nginx curl ca-certificates \
  iptables-persistent netfilter-persistent openssl

log "مستخدم النظام والمجلدات"
id -u hr >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin hr
mkdir -p "$DATA_DIR" "$ENV_DIR" "$BACKUP_DIR"
chown hr:hr "$DATA_DIR"; chmod 750 "$DATA_DIR" "$BACKUP_DIR"

log "جلب الكود"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH" && git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
chown -R hr:hr "$APP_DIR"

log "بيئة Python"
sudo -u hr python3 -m venv "$APP_DIR/.venv"
sudo -u hr "$APP_DIR/.venv/bin/pip" install -q --upgrade pip
sudo -u hr "$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"

log "قاعدة البيانات PostgreSQL"
systemctl enable --now postgresql
if [ ! -f "$ENV_FILE" ]; then
  DB_PASS="$(openssl rand -hex 24)"
  SECRET="$(openssl rand -hex 32)"
  ADMIN_PASS="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)a1"
  sudo -u postgres psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
    && sudo -u postgres psql -q -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" \
    || sudo -u postgres psql -q -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  sudo -u postgres psql -qtAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
    || sudo -u postgres psql -q -c "CREATE DATABASE $DB_NAME OWNER $DB_USER ENCODING 'UTF8' TEMPLATE template0;"
  HTTPS=0; [ -n "$DOMAIN" ] && HTTPS=1
  umask 077
  cat > "$ENV_FILE" <<ENV
HR_DATABASE_URL=postgresql+psycopg://$DB_USER:$DB_PASS@localhost/$DB_NAME
HR_SECRET_KEY=$SECRET
HR_DATA_DIR=$DATA_DIR
HR_HTTPS=$HTTPS
HR_ADMIN_PASSWORD=$ADMIN_PASS
ENV
  chown root:hr "$ENV_FILE"; chmod 640 "$ENV_FILE"
  FIRST_INSTALL=1
else
  FIRST_INSTALL=0
  if [ -n "$DOMAIN" ]; then sed -i 's/^HR_HTTPS=.*/HR_HTTPS=1/' "$ENV_FILE"; fi
fi

log "خدمة systemd"
cat > /etc/systemd/system/hr.service <<UNIT
[Unit]
Description=HR rest-day allowance system
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=hr
Group=hr
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStartPre=$APP_DIR/.venv/bin/python -c "import app.main"
ExecStart=$APP_DIR/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2 --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable hr >/dev/null
systemctl restart hr

log "Nginx"
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/hr <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;
    client_max_body_size 10m;
    server_tokens off;

    location /static/ {
        alias $APP_DIR/app/static/;
        expires 7d;
        add_header Cache-Control "public";
    }
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/hr /etc/nginx/sites-enabled/hr
rm -f /etc/nginx/sites-enabled/default
usermod -aG hr www-data
chmod 750 "$APP_DIR"
nginx -t -q && systemctl reload nginx

log "فتح المنافذ 80 و443 في جدار حماية الخادم (صور Oracle تغلقها افتراضياً)"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp --dport "$p" -m state --state NEW -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true

if [ -n "$DOMAIN" ]; then
  log "شهادة HTTPS لـ $DOMAIN"
  apt-get install -y -q certbot python3-certbot-nginx
  if [ -n "$EMAIL" ]; then CERT_MAIL=(-m "$EMAIL"); else CERT_MAIL=(--register-unsafely-without-email); fi
  certbot --nginx -n --agree-tos --redirect -d "$DOMAIN" "${CERT_MAIL[@]}"
  systemctl restart hr
fi

log "النسخ الاحتياطي اليومي (3 فجراً، الاحتفاظ 14 يوماً)"
install -m 750 "$APP_DIR/deploy/backup.sh" /usr/local/bin/hr-backup
install -m 750 "$APP_DIR/deploy/update.sh" /usr/local/bin/hr-update
echo "0 3 * * * root /usr/local/bin/hr-backup >/var/log/hr-backup.log 2>&1" > /etc/cron.d/hr-backup

log "التحقق"
for i in $(seq 1 20); do curl -fsS -o /dev/null http://127.0.0.1:8000/healthz && break; sleep 1; done
curl -fsS http://127.0.0.1:8000/healthz >/dev/null && echo "الخدمة تعمل ✓" || { echo "تعذّر تشغيل الخدمة. راجع: journalctl -u hr -n 50"; exit 1; }

IP="$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo
echo "=============================================================="
if [ -n "$DOMAIN" ]; then echo " الرابط: https://$DOMAIN"; else echo " الرابط: http://$IP"; fi
if [ "$FIRST_INSTALL" = "1" ]; then
  echo " حساب الأدمن: admin"
  echo " كلمة المرور الأولى: $(grep '^HR_ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2)"
  echo " (يُطلب تغييرها عند أول دخول، وهي محفوظة في $ENV_FILE)"
fi
echo " التحديث لاحقاً:   sudo hr-update"
echo " نسخة احتياطية:    sudo hr-backup   (في $BACKUP_DIR)"
echo " السجلات:          journalctl -u hr -f"
echo "=============================================================="
[ -z "$DOMAIN" ] && echo "تنبيه: بدون نطاق وHTTPS تُرسل كلمات المرور دون تشفير. أضف نطاقاً بإعادة التشغيل مع DOMAIN=..."
exit 0
