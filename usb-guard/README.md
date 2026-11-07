# USB Guard — 接上手機充電線時，自動檢查是否有資料外傳

每次在電腦上插入手機或充電線，USB Guard 會自動檢查這條連線**是否只是在充電**，還是已經開放了可讀取資料的通道，並**只在本機**安全地留下報告、跳出通知。

> 適用情境：在電腦上替手機充電、使用來路不明的充電線，或擔心「充電線偷傳資料（Juice Jacking）」與惡意充電線（BadUSB / O.MG cable）。

## 會檢查什麼

| 檢查項目 | 代表意義 | 風險 |
|---|---|---|
| 沒有任何資料介面 | 只在充電 | 安全 |
| MTP / PTP 介面 | 手機檔案或相片可被電腦讀取 | 注意 |
| iPhone usbmux 通道 | 已「信任這部電腦」，可備份／同步 | 注意 |
| ADB（USB 偵錯） | 可完整讀取手機資料、安裝 App | 高風險 |
| USB 大量儲存 | 手機儲存空間以隨身碟形式開放 | 高風險 |
| USB 網路分享（RNDIS/NCM） | 手機與電腦之間有網路連線 | 高風險 |
| Android 配件模式 (AOA) | 外部裝置可與手機 App 交換資料 | 高風險 |
| 「充電線」宣告為鍵盤／滑鼠 | 可能是惡意充電線，可自動輸入指令 | 高風險 |
| 有程式接管／開啟裝置 | 有程式正在存取手機（如 adb、gvfsd-mtp） | 高風險 |
| 實際資料流量 | 取樣 5 秒內磁碟或網路位元組數有增加 | 高風險 |

（流量取樣與「誰在存取」在 Linux 上可用；Windows 依裝置類別判斷，並檢查 adb、iTunes 等程式是否在執行。）

## 「安全回報」怎麼做到的

- **不連網、不上傳**：所有結果只存在你自己的電腦上，程式只使用 Python 標準函式庫。
- **只有你能讀**：紀錄目錄權限 `700`、檔案 `600`（Linux：`~/.local/state/usb-guard/`；Windows：`%LOCALAPPDATA%\usb-guard\`）。
- **防竄改**：每一筆紀錄都以 HMAC-SHA256 簽章並串成雜湊鏈，任何一筆被修改、刪除或插入，`verify` 都會發現。
- **保護隱私**：手機序號只存雜湊值，不存原文。
- **即時通知**：發現「注意」或「高風險」時跳出桌面通知，並附上處理建議。

## 安裝（開機／登入後自動監看）

需要 Python 3.8 以上。

**Linux**
```bash
./install/install_linux.sh
```

**Windows**（PowerShell，不需系統管理員權限）
```powershell
powershell -ExecutionPolicy Bypass -File .\install\install_windows.ps1
```

## 手動使用

```bash
python3 usb_guard.py watch           # 常駐監看新接上的裝置
python3 usb_guard.py check           # 立即檢查目前所有 USB 裝置
python3 usb_guard.py report          # 看最近 20 筆紀錄（並驗證完整性）
python3 usb_guard.py report --min-risk WARN
python3 usb_guard.py verify          # 驗證紀錄是否遭竄改
```

`check` 的結束碼：`0` 安全、`1` 注意、`2` 高風險，可用於其他腳本。

## 發現風險時怎麼辦

1. 立即拔除連接線。
2. Android：下拉通知 → USB 用途改為「**僅充電**」；到「開發人員選項」關閉「**USB 偵錯**」。
3. iPhone：跳出「要信任這部電腦嗎？」請選「**不信任**」；可在「設定 → 一般 → 移轉或重置 → 重置位置與隱私」清除已信任的電腦。
4. 公共場所充電請用自己的充電頭插插座，或使用 **USB 資料阻隔器（data blocker）**／純充電線。

## 限制

- 本工具在**電腦端**檢查。若手機插在公共充電站（不是你的電腦），請依上面第 2～4 點保護手機。
- 非 root 執行時，Linux 只能看到自己帳號的程式是否開啟裝置。
- 目前支援 Linux 與 Windows；macOS 尚未支援。

## 測試

```bash
python3 -m unittest discover -s tests -v
```
