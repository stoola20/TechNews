#!/bin/sh
# 設定 Homebrew 安裝的 Ollama 服務，讓它適合常駐的單工執行器：
# 只聽本機 loopback、一次只跑一份推論、只載入一個模型，並保留模型在記憶體中 30 分鐘。
# 注意：`brew services restart ollama` 會依 formula 重寫 plist，之後需要再執行一次這個腳本。
set -eu

PLIST="$HOME/Library/LaunchAgents/sh.brew.ollama.plist"
LABEL="sh.brew.ollama"
BUDDY=/usr/libexec/PlistBuddy

if [ ! -f "$PLIST" ]; then
  echo "找不到 $PLIST。請先用 'brew services start ollama' 啟動一次；若使用 Ollama.app，請改用 launchctl setenv 設定相同變數。" >&2
  exit 1
fi

set_env() {
  "$BUDDY" -c "Delete :EnvironmentVariables:$1" "$PLIST" 2>/dev/null || true
  "$BUDDY" -c "Add :EnvironmentVariables:$1 string $2" "$PLIST"
}
"$BUDDY" -c "Print :EnvironmentVariables" "$PLIST" >/dev/null 2>&1 || "$BUDDY" -c "Add :EnvironmentVariables dict" "$PLIST"
set_env OLLAMA_HOST 127.0.0.1:11434
set_env OLLAMA_NUM_PARALLEL 1
set_env OLLAMA_MAX_LOADED_MODELS 1
set_env OLLAMA_KEEP_ALIVE 30m

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# bootout 是非同步的：等舊服務完全卸載後再載入，否則 bootstrap 會回 I/O error。
for _ in 1 2 3 4 5 6 7 8 9 10; do
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break
  sleep 1
done
loaded=0
for _ in 1 2 3 4 5; do
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then loaded=1; break; fi
  sleep 2
done
if [ "$loaded" -ne 1 ]; then echo "無法載入 $LABEL，請改用 'brew services start ollama' 後再執行一次這個腳本。" >&2; exit 1; fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    echo "Ollama 已重新啟動，只在 127.0.0.1:11434 提供服務。"
    "$BUDDY" -c "Print :EnvironmentVariables" "$PLIST"
    exit 0
  fi
  sleep 1
done
echo "Ollama 沒有在 10 秒內回應，請查看 /opt/homebrew/var/log/ollama.log" >&2
exit 1
