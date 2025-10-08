#!/usr/bin/env bash
set -euo pipefail

ZIP_PATH="${1:-}"
BRANCH="${2:-}"
WORKDIR="$(pwd)"

die(){ echo "❌ $*" >&2; exit 1; }

# --- 0) 前置校验 ---
[ -n "$ZIP_PATH" ] || die "用法：bash scripts/restore_homepage.sh /path/to/site.zip [branch]"
[ -f "$ZIP_PATH" ] || die "找不到 ZIP：$ZIP_PATH"
[ -d ".git" ] || die "请在仓库根运行（这里没有 .git）"
command -v unzip >/dev/null || die "缺 unzip"
# rsync 可选；没有就用 cp
if ! command -v rsync >/dev/null; then RSYNC=0; else RSYNC=1; fi

# --- 1) 可选创建分支 ---
if [ -n "$BRANCH" ]; then
  git checkout -b "$BRANCH" || git checkout "$BRANCH"
fi

# --- 2) 解压到临时目录 ---
TMPDIR="$(mktemp -d -t cgzip.XXXXXX)"
unzip -q "$ZIP_PATH" -d "$TMPDIR"

# --- 3) 白名单拷贝：index.html + 常见静态目录 ---
copy_dir(){
  local src="$1"; local dst="$2"
  if [ -d "$src" ]; then
    mkdir -p "$dst"
    if [ "$RSYNC" -eq 1 ]; then
      rsync -a --delete "$src"/ "$dst"/
    else
      rm -rf "$dst"/* 2>/dev/null || true
      cp -R "$src"/. "$dst"/
    fi
    echo "→ 拷贝 $src → $dst"
  fi
}

# index.html
if [ -f "$TMPDIR/index.html" ]; then
  cp -f "$TMPDIR/index.html" "$WORKDIR/index.html"
  echo "→ 拷贝 index.html"
else
  # 有些 ZIP 会把文件放在下一级目录，尝试搜寻
  IDX="$(find "$TMPDIR" -maxdepth 2 -name index.html | head -n1 || true)"
  [ -n "$IDX" ] || die "ZIP 里未找到 index.html"
  cp -f "$IDX" "$WORKDIR/index.html"
  echo "→ 拷贝 $IDX → index.html"
fi

# 静态资源目录（存在才拷）
for d in css js img images assets fonts; do
  SRC_DIR="$(find "$TMPDIR" -maxdepth 2 -type d -name "$d" | head -n1 || true)"
  [ -n "$SRC_DIR" ] && copy_dir "$SRC_DIR" "$WORKDIR/$d"
done

# --- 4) 移除根路径重定向（/ -> /updates）---
if [ -f "_redirects" ]; then
  # 删除以 / 开头且指向 /updates/ 的 302 行（宽松匹配空白）
  sed -i.bak -E '/^\/[[:space:]]+\/updates\/[[:space:]]+302[[:space:]]*$/d' _redirects || true
  # 兼容严格写法
  sed -i.bak -E '/^\/[[:space:]]+\/updates\/[[:space:]]+302$/d' _redirects || true
  rm -f _redirects.bak
fi

# --- 5) 为 /index.html 自动生成“专属 CSP”块（不放宽全站）---
# 解析 index.html 的外部域名
HOSTS=$(grep -Eo 'https?://[^"'\'' )]+' index.html | sed -E 's#https?://##; s#/.*##' | sort -u | tr '\n' ' ')
# 组装 CSP 白名单（全部挂到 img/style/script/font，限定于 /index.html）
CSP_IMG="img-src 'self' data:"
CSP_STYLE="style-src 'self' 'unsafe-inline'"
CSP_SCRIPT="script-src 'self'"
CSP_FONT="font-src 'self' data:"
for h in $HOSTS; do
  [ -z "$h" ] && continue
  CSP_IMG="$CSP_IMG https://$h"
  CSP_STYLE="$CSP_STYLE https://$h"
  CSP_SCRIPT="$CSP_SCRIPT https://$h"
  CSP_FONT="$CSP_FONT https://$h"
done

mkdir -p "$(dirname "_headers")"
touch "_headers"

# 先清掉旧的同名块（若存在）
awk '
  BEGIN{skip=0}
  /^# BEGIN restore_homepage_csp$/ {skip=1; next}
  /^# END restore_homepage_csp$/ {skip=0; next}
  skip==0 {print}
' _headers > _headers.tmp && mv _headers.tmp _headers

cat >> _headers <<EOF

# BEGIN restore_homepage_csp
/index.html
  Content-Security-Policy: default-src '"'"'self'"'"'; ${CSP_IMG}; ${CSP_STYLE}; ${CSP_SCRIPT}; ${CSP_FONT}; connect-src '"'"'self'"'"'
# END restore_homepage_csp
EOF

echo "→ 已为 /index.html 生成专属 CSP（外链域：$HOSTS）"

# --- 6) 提交 ---
git add index.html _redirects _headers css js img images assets fonts 2>/dev/null || true
if git diff --cached --quiet; then
  echo "ℹ️ 无文件变化需要提交。"
else
  git commit -m "restore: legacy homepage + keep new features; add per-page CSP for /index.html"
  echo "✅ 已提交。请 git push 推送到远端。"
fi

echo
echo "=== 下一步 ==="
echo "1) git push${BRANCH:+ origin $BRANCH}"
echo "2) Cloudflare Pages 会自动构建；完成后验证："
echo "   - /            → 原来的主页"
echo "   - /updates/    → 200"
echo "   - /vendors/    → 200（或按现状显示）"
echo "   - /categories/ → 200"
echo "   - /updates/rss.xml & /vendors/<vendor>/feed.xml → Content-Type 为 application/rss+xml"
