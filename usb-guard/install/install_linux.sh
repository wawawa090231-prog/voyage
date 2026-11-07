#!/usr/bin/env bash
# 安裝 USB Guard 為使用者層級的 systemd 服務（登入後自動常駐監看）
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="$HOME/.local/share/usb-guard"
mkdir -p "$dest" "$HOME/.config/systemd/user"
install -m 0755 "$here/usb_guard.py" "$dest/usb_guard.py"
install -m 0644 "$here/install/usb-guard.service" "$HOME/.config/systemd/user/usb-guard.service"
systemctl --user daemon-reload
systemctl --user enable --now usb-guard.service
echo "已安裝並啟動。查看狀態：systemctl --user status usb-guard"
echo "查看紀錄：python3 $dest/usb_guard.py report"
