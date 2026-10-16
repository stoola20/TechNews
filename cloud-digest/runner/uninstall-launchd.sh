#!/bin/sh
# 停止並移除 Mac 執行器的 launchd 使用者代理。雲端工作會在 lease 到期後交回佇列。
set -eu
LABEL="io.github.technews.runner"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "已停止並移除 $LABEL"
