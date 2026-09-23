#!/usr/bin/env bash
# RetroGameHackers の戦闘解説記事をローカルに取得してテキスト化する。
# 記事は著作物のためリポジトリには含めず、解析作業者が各自で取得する運用にしている。
set -euo pipefail
cd "$(dirname "$0")/../research"
mkdir -p rgh
for i in $(seq 1 26); do
  n=$(printf "%03d" "$i")
  curl -fsS "https://retrogamehackers.net/dq3-battlesystem-$n/" -o "rgh/$n.html"
done
python3 - <<'PY'
import re, html, glob
for f in sorted(glob.glob('rgh/*.html')):
    s = open(f, encoding='utf-8').read()
    m = re.search(r'<div class="entry-content[^"]*"[^>]*>(.*?)<footer', s, re.S)
    body = m.group(1) if m else s
    body = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', body, flags=re.S)
    body = re.sub(r'<br\s*/?>|</p>|</tr>|</li>|</h\d>|</pre>', '\n', body)
    body = re.sub(r'</td>|</th>', '\t', body)
    body = html.unescape(re.sub(r'<[^>]+>', '', body))
    open(f[:-5] + '.txt', 'w').write(re.sub(r'\n\s*\n+', '\n\n', body))
PY
rm rgh/*.html
