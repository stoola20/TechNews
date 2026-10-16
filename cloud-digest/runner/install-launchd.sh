#!/bin/sh
# 安裝或更新 Mac 執行器的 launchd 使用者代理：登入後自動啟動，結束後由 launchd 重新啟動。
# 用法：runner/install-launchd.sh [設定檔路徑]
set -eu

LABEL="io.github.technews.runner"
RUNNER_DIR=$(cd "$(dirname "$0")" && pwd)
ENV_FILE=${1:-"$HOME/.config/technews-runner/runner.env"}
NODE=$(command -v node || true)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/technews-runner.log"

if [ -z "$NODE" ]; then echo "找不到 node，請先安裝 Node.js 22.13 以上。" >&2; exit 1; fi
if [ ! -f "$ENV_FILE" ]; then echo "找不到設定檔：$ENV_FILE（可從 runner/runner.env.example 複製）" >&2; exit 1; fi
chmod 600 "$ENV_FILE"

# 先確認 Ollama、模型與文章庫都可連線，避免 launchd 反覆重啟一個設定錯誤的執行器。
"$NODE" --env-file="$ENV_FILE" "$RUNNER_DIR/runner.mjs" --check

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--env-file=$ENV_FILE</string>
    <string>$RUNNER_DIR/runner.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>ProcessType</key><string>Adaptive</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "已啟動 $LABEL，紀錄檔：$LOG"
