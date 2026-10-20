#!/usr/bin/env python3
"""给 nginx 站点加 /PyLab 专用 location（放宽上传体积与读超时）。
幂等：已存在就跳过。改完自己跑 nginx -t，失败自动回滚。"""
import io, os, shutil, subprocess, sys

CONF = '/etc/nginx/sites-available/checkin'
BLOCK = '''
    # PyLab 课件上传：应用侧允许单份 60MB（PyLabModel.MaxDeckBytes），
    # 服务器级 client_max_body_size 是 12m（那是给 AI 传图用的），
    # 12~60MB 的 PPT 会被这里挡掉并回 413，所以这个路径单独放宽到 64m。
    # 另外转换是「同步」的：60 页纯文字约 14 秒，几十页带大图会更久，
    # 读超时从 90s 提到 300s，免得大课件传到一半被掐断。
    location = /PyLab {
        client_max_body_size 64m;
        proxy_pass http://checkin_app;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

'''

src = io.open(CONF, encoding='utf-8').read()
if 'location = /PyLab' in src:
    print('already patched')
    sys.exit(0)

anchor = '    location / {'
if anchor not in src:
    print('anchor not found')
    sys.exit(1)

backup = CONF + '.bak-pylab'
shutil.copy2(CONF, backup)
out = src.replace(anchor, BLOCK.lstrip('\n') + anchor, 1)
io.open(CONF, 'w', encoding='utf-8').write(out)

test = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
print(test.stderr.strip() or test.stdout.strip())
if test.returncode != 0:
    shutil.copy2(backup, CONF)
    print('nginx -t 失败，已回滚')
    sys.exit(1)

subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
print('patched + reloaded')
