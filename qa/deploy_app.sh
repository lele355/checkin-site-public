#!/usr/bin/env bash
# 上线：把 /tmp/checkin-publish.tar.gz 换到 /var/www/checkin（保留线上 data/ 与站点专属配置）
set -e
TS=$(date +%Y%m%d-%H%M%S)

echo "=== 1. 停机前热备份数据库 ==="
mkdir -p /var/backups/checkin
sqlite3 /var/www/checkin/data/checkin.db ".backup /var/backups/checkin/pre-deploy-$TS.db"
ls -lh /var/backups/checkin/pre-deploy-$TS.db

echo "=== 2. 停服务 ==="
systemctl stop checkin
systemctl is-active checkin || true

echo "=== 3. 暂存线上数据与专属配置 ==="
rm -rf /tmp/checkin-keep
mkdir -p /tmp/checkin-keep
cp -a /var/www/checkin/data /tmp/checkin-keep/data
for f in /var/www/checkin/appsettings.Local.json /var/www/checkin/appsettings.Production.json; do
  [ -f "$f" ] && cp -a "$f" /tmp/checkin-keep/ || true
done
ls -la /tmp/checkin-keep

echo "=== 4. 解包新版本 ==="
rm -rf /var/www/checkin.new
mkdir -p /var/www/checkin.new
tar xzf /tmp/checkin-publish.tar.gz -C /var/www/checkin.new

echo "=== 5. 换目录（旧版留一份可回滚） ==="
mv /var/www/checkin /var/www/checkin.prev-$TS
mv /var/www/checkin.new /var/www/checkin

echo "=== 6. 回填数据与配置 ==="
rm -rf /var/www/checkin/data
cp -a /tmp/checkin-keep/data /var/www/checkin/data
for f in /tmp/checkin-keep/appsettings.Local.json /tmp/checkin-keep/appsettings.Production.json; do
  [ -f "$f" ] && cp -a "$f" /var/www/checkin/ || true
done
chown -R www-data:www-data /var/www/checkin

echo "=== 6.5 清 Python 编译产物 / 沙箱残留 ==="
# 发布包里不该有 __pycache__（沙箱已用 -B 压住，这里是兜历史残留）
find /var/www/checkin -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find /var/www/checkin -name '*.pyc' -type f -delete 2>/dev/null || true
echo "剩余 __pycache__ 目录数：$(find /var/www/checkin -name '__pycache__' -type d | wc -l)"

echo "=== 7. 起服务（启动时自动跑迁移） ==="
systemctl start checkin
sleep 6
systemctl is-active checkin
echo "=== 8. 迁移结果 ==="
sqlite3 /var/www/checkin/data/checkin.db "select MigrationId from __EFMigrationsHistory order by MigrationId desc limit 3;"
echo "--- Users 表列 ---"
sqlite3 /var/www/checkin/data/checkin.db "pragma table_info(Users);" | awk -F'|' '{printf "%s ", $2} END {print ""}'
echo "=== 9. 本地探活 ==="
curl -s -o /dev/null -w "127.0.0.1:5000/Login -> %{http_code}\n" http://127.0.0.1:5000/Login
echo "=== 10. 日志尾部 ==="
journalctl -u checkin -n 8 --no-pager | tail -8
echo "=== 11. 清理旧版（保留 1 份） ==="
ls -d /var/www/checkin.prev-* 2>/dev/null | head -n -1 | xargs -r rm -rf
ls -d /var/www/checkin.prev-* 2>/dev/null || true
