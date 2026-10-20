#!/usr/bin/env bash
# mkthumbs.sh —— 给线上已有课件补生成缩略图 t1.png…（320px 宽）
# 一次性脚本：新上传的课件由 PyLabDeckConverter 直接生成，不用跑这个
set -e
for d in /var/www/checkin/data/pylab/*/deck_*; do
  [ -f "$d/deck.pdf" ] || continue
  if [ -f "$d/t1.png" ]; then echo "SKIP $d"; continue; fi
  cd "$d"
  pdftoppm -png -scale-to 320 deck.pdf _tb
  i=1
  for f in $(ls _tb-*.png | sort -t- -k2 -n); do mv "$f" "t$i.png"; i=$((i+1)); done
  echo "OK $d -> $((i-1)) 张缩略图"
  cd /
done
echo "--- 有缩略图的课件数 ---"
ls -1 /var/www/checkin/data/pylab/*/deck_*/t1.png 2>/dev/null | wc -l
