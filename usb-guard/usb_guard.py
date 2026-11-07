#!/usr/bin/env python3
"""USB Guard — 每次接上手機／充電線時，自動檢查是否有資料外傳，並安全地在本機回報。

只用 Python 標準函式庫，不連網、不上傳任何資料。

指令：
  python3 usb_guard.py watch      常駐監看，偵測到新 USB 裝置就自動檢查（建議設為開機自動執行）
  python3 usb_guard.py check      立即檢查目前所有已連接的 USB 裝置
  python3 usb_guard.py report     顯示最近的檢查紀錄
  python3 usb_guard.py verify     驗證紀錄檔是否遭竄改（HMAC 雜湊鏈）

支援平台：Linux（完整檢查）、Windows（以 PnP 裝置類別判斷）。
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import platform
import secrets
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path

VERSION = "1.0.0"

# 風險等級
OK, INFO, WARN, HIGH = "OK", "INFO", "WARN", "HIGH"
RISK_ORDER = {OK: 0, INFO: 1, WARN: 2, HIGH: 3}
RISK_LABEL = {OK: "安全", INFO: "提醒", WARN: "注意", HIGH: "高風險"}

# 常見手機廠商 USB Vendor ID（用來標示「這是手機」）
PHONE_VENDORS = {
    "05ac": "Apple", "18d1": "Google", "04e8": "Samsung", "2717": "Xiaomi",
    "12d1": "Huawei", "22b8": "Motorola", "0bb4": "HTC", "2a70": "OnePlus",
    "22d9": "OPPO", "2d95": "vivo", "0fce": "Sony", "1004": "LG",
    "0b05": "ASUS", "2ae5": "Fairphone", "17ef": "Lenovo", "1949": "Amazon",
    "2a45": "Meizu", "19d2": "ZTE", "2e04": "HMD/Nokia", "0421": "Nokia",
    "1ebf": "Realme", "2b0e": "LeEco", "29a9": "Sharp",
}

# 會存取手機資料的常見程式（Linux 行程名稱）
DATA_ACCESS_PROCS = {
    "adb": "Android 偵錯橋接 (ADB)",
    "usbmuxd": "iPhone 連線服務 (usbmuxd)",
    "gvfsd-mtp": "MTP 檔案存取 (GNOME)",
    "gvfsd-gphoto2": "PTP 相片存取 (GNOME)",
    "kiod5": "KDE 檔案存取",
    "kiod6": "KDE 檔案存取",
    "jmtpfs": "MTP 檔案掛載",
    "simple-mtpfs": "MTP 檔案掛載",
    "go-mtpfs": "MTP 檔案掛載",
    "gphoto2": "相片匯出 (gphoto2)",
    "ifuse": "iPhone 檔案掛載",
    "idevicebackup2": "iPhone 備份",
    "idevicesyslog": "iPhone 系統日誌讀取",
    "kdeconnectd": "KDE Connect",
    "scrcpy": "螢幕鏡像 (scrcpy)",
}


# ---------------------------------------------------------------------------
# 資料結構
# ---------------------------------------------------------------------------

@dataclass
class Finding:
    risk: str
    code: str
    message: str


@dataclass
class Device:
    key: str                     # 唯一識別（Linux: sysfs 名稱；Windows: VID&PID+序號）
    vendor_id: str = ""
    product_id: str = ""
    manufacturer: str = ""
    product: str = ""
    serial_hash: str = ""        # 序號只存雜湊值，保護隱私
    interfaces: list = field(default_factory=list)   # [{"cls","sub","proto","name","driver"}]
    extra: dict = field(default_factory=dict)        # 平台特有資訊

    @property
    def vendor_name(self) -> str:
        return PHONE_VENDORS.get(self.vendor_id.lower(), "")

    @property
    def is_phone(self) -> bool:
        return bool(self.vendor_name)

    def label(self) -> str:
        name = " ".join(x for x in (self.manufacturer or self.vendor_name, self.product) if x)
        return f"{name or '未知裝置'} [{self.vendor_id}:{self.product_id}]"


def hash_serial(serial: str) -> str:
    if not serial:
        return ""
    return hashlib.sha256(("usb-guard:" + serial).encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# 介面分類（依 USB-IF 類別碼）
# ---------------------------------------------------------------------------

def classify_interface(cls: int, sub: int, proto: int, name: str = "") -> tuple[str, str] | None:
    """回傳 (類型代碼, 說明)；None 代表與資料傳輸無關。"""
    n = (name or "").lower()
    if cls == 0xFF and sub == 0x42 and proto == 0x01:
        return "adb", "Android USB 偵錯 (ADB) — 可完整讀取手機資料"
    if cls == 0xFF and sub == 0xFE and proto == 0x02:
        return "usbmux", "iPhone 資料通道 (usbmux) — 可備份／同步手機"
    if cls == 0xFF and "mtp" in n:
        return "mtp", "MTP 檔案傳輸 — 可讀寫手機檔案"
    if cls == 0x06:
        if "mtp" in n:
            return "mtp", "MTP 檔案傳輸 — 可讀寫手機檔案"
        return "ptp", "PTP 相片傳輸 — 可讀取手機相片"
    if cls == 0x08:
        return "storage", "USB 大量儲存 — 手機儲存空間以隨身碟形式開放"
    if cls == 0xE0 and sub == 0x01 and proto == 0x03:
        return "tether", "USB 網路分享 (RNDIS) — 手機與電腦間有網路連線"
    if cls == 0x02 and sub in (0x06, 0x0D, 0x0A):
        return "tether", "USB 網路介面 (CDC ECM/NCM) — 手機與電腦間有網路連線"
    if cls == 0xEF and sub == 0x04 and proto == 0x01:
        return "tether", "USB 網路分享 (RNDIS) — 手機與電腦間有網路連線"
    if cls == 0x03:
        return "hid", "鍵盤／滑鼠類 HID 裝置 — 可對電腦輸入按鍵"
    if cls == 0x01:
        return "audio", "USB 音訊"
    if cls == 0xFF and "accessory" in n:
        return "aoa", "Android 配件模式 (AOA) — 外部裝置可與手機 App 交換資料"
    return None


# ---------------------------------------------------------------------------
# Linux 掃描
# ---------------------------------------------------------------------------

class LinuxScanner:
    def __init__(self, sys_root: str = "/sys", proc_root: str = "/proc"):
        self.sys = Path(sys_root)
        self.proc = Path(proc_root)
        self.usb_dir = self.sys / "bus/usb/devices"

    @staticmethod
    def _read(p: Path) -> str:
        try:
            return p.read_text(errors="replace").strip()
        except OSError:
            return ""

    def list_devices(self) -> dict[str, Device]:
        devices: dict[str, Device] = {}
        if not self.usb_dir.is_dir():
            return devices
        for d in sorted(self.usb_dir.iterdir()):
            if ":" in d.name or d.name.startswith("usb"):
                continue  # 介面節點或 root hub
            vid = self._read(d / "idVendor")
            if not vid:
                continue
            dev = Device(
                key=d.name,
                vendor_id=vid,
                product_id=self._read(d / "idProduct"),
                manufacturer=self._read(d / "manufacturer"),
                product=self._read(d / "product"),
                serial_hash=hash_serial(self._read(d / "serial")),
            )
            dev.extra["busnum"] = self._read(d / "busnum")
            dev.extra["devnum"] = self._read(d / "devnum")
            for itf in sorted(d.glob(f"{d.name}:*")):
                try:
                    cls = int(self._read(itf / "bInterfaceClass") or "0", 16)
                    sub = int(self._read(itf / "bInterfaceSubClass") or "0", 16)
                    proto = int(self._read(itf / "bInterfaceProtocol") or "0", 16)
                except ValueError:
                    continue
                drv_link = itf / "driver"
                driver = os.path.basename(os.readlink(drv_link)) if drv_link.is_symlink() else ""
                dev.interfaces.append({
                    "cls": cls, "sub": sub, "proto": proto,
                    "name": self._read(itf / "interface"), "driver": driver,
                })
            devices[dev.key] = dev
        return devices

    # --- 流量 -------------------------------------------------------------
    def _device_real(self, dev: Device) -> str:
        return os.path.realpath(self.usb_dir / dev.key)

    def io_counters(self, dev: Device) -> dict[str, int]:
        """回傳屬於此裝置的磁碟／網路介面累計位元組數。"""
        base = self._device_real(dev) + os.sep
        out: dict[str, int] = {}
        block = self.sys / "block"
        if block.is_dir():
            for b in block.iterdir():
                if not os.path.realpath(b).startswith(base):
                    continue
                parts = self._read(b / "stat").split()
                if len(parts) >= 7:
                    out[f"disk:{b.name}:read"] = int(parts[2]) * 512
                    out[f"disk:{b.name}:write"] = int(parts[6]) * 512
        net = self.sys / "class/net"
        if net.is_dir():
            for n in net.iterdir():
                if not os.path.realpath(n / "device").startswith(base):
                    continue
                for k in ("rx_bytes", "tx_bytes"):
                    v = self._read(n / "statistics" / k)
                    if v.isdigit():
                        out[f"net:{n.name}:{k}"] = int(v)
        return out

    # --- 誰在存取 ---------------------------------------------------------
    def accessing_processes(self, dev: Device) -> list[str]:
        """找出開啟此裝置 /dev/bus/usb 節點的行程（非 root 時只看得到自己的行程）。"""
        bus, num = dev.extra.get("busnum", ""), dev.extra.get("devnum", "")
        if not (bus.isdigit() and num.isdigit()):
            return []
        node = f"/dev/bus/usb/{int(bus):03d}/{int(num):03d}"
        found = []
        if not self.proc.is_dir():
            return found
        for p in self.proc.iterdir():
            if not p.name.isdigit():
                continue
            try:
                for fd in (p / "fd").iterdir():
                    if os.readlink(fd) == node:
                        found.append(f"{self._read(p / 'comm')}(pid {p.name})")
                        break
            except OSError:
                continue
        return found

    def running_data_tools(self) -> list[str]:
        out = []
        if not self.proc.is_dir():
            return out
        for p in self.proc.iterdir():
            if p.name.isdigit():
                comm = self._read(p / "comm")
                if comm in DATA_ACCESS_PROCS:
                    out.append(f"{DATA_ACCESS_PROCS[comm]}：{comm}(pid {p.name})")
        return sorted(set(out))


# ---------------------------------------------------------------------------
# Windows 掃描（PowerShell Get-PnpDevice）
# ---------------------------------------------------------------------------

class WindowsScanner:
    PS = (
        "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^(USB|USBSTOR|HID|SWD\\\\WPDBUSENUM)' } "
        "| Select-Object Class,FriendlyName,InstanceId,Status | ConvertTo-Json -Compress"
    )

    def _pnp(self) -> list[dict]:
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", self.PS],
                capture_output=True, text=True, timeout=30,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            data = json.loads(r.stdout or "[]")
            return data if isinstance(data, list) else [data]
        except (OSError, ValueError, subprocess.SubprocessError):
            return []

    @staticmethod
    def _class_to_itf(cls: str, name: str, inst: str) -> dict | None:
        c, n = (cls or "").lower(), (name or "").lower()
        if "adb" in n or c == "androidusbdeviceclass":
            return {"cls": 0xFF, "sub": 0x42, "proto": 0x01, "name": name, "driver": cls}
        if "apple mobile device" in n:
            return {"cls": 0xFF, "sub": 0xFE, "proto": 0x02, "name": name, "driver": cls}
        if c == "wpd":
            return {"cls": 0x06, "sub": 1, "proto": 1, "name": "MTP " + (name or ""), "driver": cls}
        if c == "image":
            return {"cls": 0x06, "sub": 1, "proto": 1, "name": name, "driver": cls}
        if c == "diskdrive" or inst.upper().startswith("USBSTOR"):
            return {"cls": 0x08, "sub": 6, "proto": 0x50, "name": name, "driver": cls}
        if c == "net" and ("rndis" in n or "ncm" in n or "tether" in n):
            return {"cls": 0xE0, "sub": 1, "proto": 3, "name": name, "driver": cls}
        if c in ("keyboard", "mouse") or (c == "hidclass" and "keyboard" in n):
            return {"cls": 0x03, "sub": 1, "proto": 1, "name": name, "driver": cls}
        return None

    def list_devices(self) -> dict[str, Device]:
        import re
        devices: dict[str, Device] = {}
        for e in self._pnp():
            inst = e.get("InstanceId") or ""
            m = re.search(r"VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})", inst)
            if m:
                vid, pid = m.group(1).lower(), m.group(2).lower()
                key = f"{vid}:{pid}"
            else:
                vid = pid = ""
                key = inst.split("\\")[0] + ":" + hash_serial(inst)
            dev = devices.setdefault(key, Device(key=key, vendor_id=vid, product_id=pid,
                                                 serial_hash=hash_serial(inst)))
            if not dev.product and e.get("FriendlyName"):
                dev.product = e["FriendlyName"]
            itf = self._class_to_itf(e.get("Class", ""), e.get("FriendlyName", ""), inst)
            if itf:
                dev.interfaces.append(itf)
        return devices

    def io_counters(self, dev: Device) -> dict[str, int]:
        return {}

    def accessing_processes(self, dev: Device) -> list[str]:
        return []

    def running_data_tools(self) -> list[str]:
        try:
            r = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True,
                               timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.SubprocessError):
            return []
        names = {"adb.exe": "Android 偵錯橋接 (ADB)", "itunes.exe": "iTunes 同步",
                 "applemobiledeviceservice.exe": "Apple 行動裝置服務",
                 "scrcpy.exe": "螢幕鏡像 (scrcpy)", "3utools.exe": "3uTools",
                 "imazing.exe": "iMazing"}
        out = set()
        for line in r.stdout.splitlines():
            exe = line.split(",")[0].strip('"').lower()
            if exe in names:
                out.add(f"{names[exe]}：{exe}")
        return sorted(out)


def make_scanner():
    sysname = platform.system()
    if sysname == "Linux":
        return LinuxScanner()
    if sysname == "Windows":
        return WindowsScanner()
    sys.exit(f"目前不支援此作業系統：{sysname}（支援 Linux、Windows）")


# ---------------------------------------------------------------------------
# 風險分析
# ---------------------------------------------------------------------------

def analyze(dev: Device, scanner, sample_seconds: float = 5.0, running_tools: list[str] | None = None
            ) -> tuple[str, list[Finding]]:
    findings: list[Finding] = []
    kinds: dict[str, str] = {}
    claimed_by_userspace = False

    for itf in dev.interfaces:
        c = classify_interface(itf["cls"], itf["sub"], itf["proto"], itf.get("name", ""))
        if c:
            kinds.setdefault(c[0], c[1])
        if itf.get("driver") == "usbfs":
            claimed_by_userspace = True

    data_kinds = [k for k in kinds if k not in ("hid", "audio")]

    if not dev.interfaces:
        findings.append(Finding(INFO, "no-interface", "裝置未開放任何介面（可能為純充電）。"))
    elif not data_kinds and "hid" not in kinds:
        findings.append(Finding(OK, "charge-only", "未發現資料傳輸介面，看起來只在充電。"))

    for k in data_kinds:
        risk = HIGH if k in ("adb", "storage", "tether", "aoa") else WARN
        findings.append(Finding(risk, f"itf-{k}", kinds[k]))

    if "hid" in kinds:
        if dev.is_phone or data_kinds:
            findings.append(Finding(HIGH, "hid-on-phone",
                "手機／充電線同時宣告為鍵盤或滑鼠：可能是惡意充電線（如 BadUSB / O.MG cable），可自動對電腦輸入指令！"))
        else:
            findings.append(Finding(WARN, "hid-new",
                "偵測到新的鍵盤／滑鼠類裝置。若你只是插上充電線，這很可疑，請立即拔除。"))

    if claimed_by_userspace:
        findings.append(Finding(HIGH, "claimed",
            "有程式已接管此裝置的資料介面（usbfs），代表正在存取手機。"))

    procs = scanner.accessing_processes(dev)
    if procs:
        findings.append(Finding(HIGH, "open-by", "正在存取此裝置的程式：" + "、".join(procs)))

    if data_kinds and running_tools:
        findings.append(Finding(WARN, "tools", "電腦上正在執行可讀取手機資料的程式：" + "、".join(running_tools)))

    # 流量取樣：比較一段時間內的位元組數變化
    if sample_seconds > 0 and data_kinds:
        before = scanner.io_counters(dev)
        if before:
            time.sleep(sample_seconds)
            after = scanner.io_counters(dev)
            moved = {k: after.get(k, v) - v for k, v in before.items() if after.get(k, v) - v > 0}
            if moved:
                desc = "、".join(f"{k} +{fmt_bytes(v)}" for k, v in moved.items())
                findings.append(Finding(HIGH, "traffic",
                    f"{sample_seconds:g} 秒內偵測到實際資料傳輸：{desc}"))
            else:
                findings.append(Finding(INFO, "no-traffic", f"{sample_seconds:g} 秒內未偵測到資料流量。"))

    overall = max((f.risk for f in findings), key=lambda r: RISK_ORDER[r], default=OK)
    return overall, findings


def fmt_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


ADVICE = {
    HIGH: "建議：立即拔除連接線；手機上關閉「USB 偵錯」、將 USB 模式設為「僅充電」；公共場所請使用充電專用線或資料阻隔器（USB data blocker）。",
    WARN: "建議：若你沒有要傳檔，請在手機通知中將 USB 用途改為「僅充電」，iPhone 若跳出「要信任這部電腦嗎？」請選「不信任」。",
    INFO: "",
    OK: "",
}


# ---------------------------------------------------------------------------
# 安全回報：本機、僅限本人可讀、HMAC 雜湊鏈防竄改
# ---------------------------------------------------------------------------

def default_data_dir() -> Path:
    if os.environ.get("USB_GUARD_HOME"):
        return Path(os.environ["USB_GUARD_HOME"])
    if platform.system() == "Windows":
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "usb-guard"
    return Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "usb-guard"


class SecureLog:
    GENESIS = "0" * 64

    def __init__(self, directory: Path):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.dir, 0o700)
        except OSError:
            pass
        self.path = self.dir / "reports.jsonl"
        self.key = self._load_key()

    def _load_key(self) -> bytes:
        kp = self.dir / "hmac.key"
        try:
            fd = os.open(kp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(secrets.token_bytes(32))
        except FileExistsError:
            pass
        return kp.read_bytes()

    @staticmethod
    def _canon(rec: dict) -> bytes:
        return json.dumps(rec, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()

    def _mac(self, prev: str, rec: dict) -> str:
        body = {k: v for k, v in rec.items() if k != "mac"}
        return hmac.new(self.key, prev.encode() + self._canon(body), hashlib.sha256).hexdigest()

    def records(self) -> list[dict]:
        if not self.path.exists():
            return []
        out = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                out.append(json.loads(line))
        return out

    def _last_mac(self) -> str:
        recs = self.records()
        return recs[-1]["mac"] if recs else self.GENESIS

    def append(self, rec: dict) -> dict:
        rec = dict(rec)
        rec["prev"] = self._last_mac()
        rec["mac"] = self._mac(rec["prev"], rec)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return rec

    def verify(self) -> tuple[bool, str]:
        prev = self.GENESIS
        recs = self.records()
        for i, r in enumerate(recs, 1):
            if r.get("prev") != prev:
                return False, f"第 {i} 筆紀錄的鏈結不連續（可能有紀錄被刪除或插入）"
            if not hmac.compare_digest(r.get("mac", ""), self._mac(prev, r)):
                return False, f"第 {i} 筆紀錄內容遭到修改"
            prev = r["mac"]
        return True, f"全部 {len(recs)} 筆紀錄完整，未遭竄改"


def notify(title: str, body: str) -> None:
    """桌面通知（失敗時安靜略過，不影響紀錄）。"""
    try:
        if platform.system() == "Linux":
            subprocess.run(["notify-send", "-a", "USB Guard", title, body], timeout=5,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif platform.system() == "Windows":
            ps = (
                "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;"
                "$n=New-Object System.Windows.Forms.NotifyIcon;"
                "$n.Icon=[System.Drawing.SystemIcons]::Warning;$n.Visible=$true;"
                f"$n.ShowBalloonTip(10000,{json.dumps(title)},{json.dumps(body)},'Warning');"
                "Start-Sleep -Seconds 10;$n.Dispose()"
            )
            subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        pass


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def inspect_and_report(dev: Device, scanner, log: SecureLog, sample: float, quiet_ok: bool,
                       running_tools: list[str]) -> dict:
    overall, findings = analyze(dev, scanner, sample, running_tools)
    rec = {
        "time": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "host": platform.node(),
        "event": "connected",
        "risk": overall,
        "device": {
            "label": dev.label(), "vendor_id": dev.vendor_id, "product_id": dev.product_id,
            "is_phone": dev.is_phone, "serial_hash": dev.serial_hash,
        },
        "findings": [asdict(f) for f in findings],
        "advice": ADVICE[overall],
    }
    log.append(rec)
    print_record(rec)
    if RISK_ORDER[overall] >= RISK_ORDER[WARN] or not quiet_ok:
        msgs = [f.message for f in findings if RISK_ORDER[f.risk] >= RISK_ORDER[WARN]] or \
               [findings[0].message if findings else ""]
        notify(f"USB Guard【{RISK_LABEL[overall]}】{dev.label()}", "\n".join(msgs[:3]))
    return rec


def print_record(rec: dict) -> None:
    print(f"\n[{rec['time']}] {RISK_LABEL[rec['risk']]}（{rec['risk']}）  {rec['device']['label']}"
          + ("  📱手機" if rec["device"].get("is_phone") else ""))
    for f in rec["findings"]:
        print(f"  - [{RISK_LABEL[f['risk']]}] {f['message']}")
    if rec.get("advice"):
        print(f"  {rec['advice']}")


def cmd_check(args) -> int:
    scanner, log = make_scanner(), SecureLog(args.data_dir)
    tools = scanner.running_data_tools()
    devs = scanner.list_devices()
    if args.phones_only:
        devs = {k: d for k, d in devs.items() if d.is_phone or d.interfaces}
    if not devs:
        print("目前沒有偵測到 USB 裝置。")
        return 0
    worst = OK
    for d in devs.values():
        rec = inspect_and_report(d, scanner, log, args.sample, True, tools)
        worst = max(worst, rec["risk"], key=lambda r: RISK_ORDER[r])
    return 2 if worst == HIGH else (1 if worst == WARN else 0)


def cmd_watch(args) -> int:
    scanner, log = make_scanner(), SecureLog(args.data_dir)
    known = set(scanner.list_devices())  # 啟動時已存在的裝置不重複回報
    print(f"USB Guard {VERSION} 監看中（每 {args.interval:g} 秒）… 紀錄：{log.path}")
    log.append({"time": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
                "host": platform.node(), "event": "watch-start", "risk": OK,
                "device": None, "findings": [], "advice": ""})
    try:
        while True:
            time.sleep(args.interval)
            current = scanner.list_devices()
            for key in sorted(set(current) - known):
                time.sleep(args.settle)  # 等待手機完成列舉（使用者切換 USB 模式後介面才會出現）
                dev = scanner.list_devices().get(key, current[key])
                inspect_and_report(dev, scanner, log, args.sample, args.quiet_ok,
                                   scanner.running_data_tools())
            known = set(current)
    except KeyboardInterrupt:
        print("\n已停止監看。")
        return 0


def cmd_report(args) -> int:
    log = SecureLog(args.data_dir)
    recs = [r for r in log.records() if r.get("event") == "connected"]
    if args.min_risk:
        recs = [r for r in recs if RISK_ORDER[r["risk"]] >= RISK_ORDER[args.min_risk]]
    for r in recs[-args.last:]:
        print_record(r)
    ok, msg = log.verify()
    print(f"\n紀錄完整性：{'✔ ' if ok else '✘ '}{msg}")
    return 0 if ok else 3


def cmd_verify(args) -> int:
    ok, msg = SecureLog(args.data_dir).verify()
    print(("✔ " if ok else "✘ ") + msg)
    return 0 if ok else 3


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (OSError, ValueError):
            pass
    p = argparse.ArgumentParser(description="接上手機充電線時自動檢查是否有資料外傳，並安全回報。")
    p.add_argument("--data-dir", type=Path, default=default_data_dir(), help="紀錄存放目錄")
    p.add_argument("--version", action="version", version=VERSION)
    sp = p.add_subparsers(dest="cmd", required=True)

    w = sp.add_parser("watch", help="常駐監看新接上的 USB 裝置")
    w.add_argument("--interval", type=float, default=2.0, help="輪詢間隔秒數")
    w.add_argument("--settle", type=float, default=3.0, help="新裝置出現後等待列舉完成的秒數")
    w.add_argument("--sample", type=float, default=5.0, help="流量取樣秒數（0 為不取樣）")
    w.add_argument("--quiet-ok", action="store_true", help="安全結果不跳通知，只寫紀錄")
    w.set_defaults(func=cmd_watch)

    c = sp.add_parser("check", help="立即檢查目前連接的裝置")
    c.add_argument("--sample", type=float, default=5.0)
    c.add_argument("--phones-only", action="store_true", help="只檢查手機或有介面的裝置")
    c.set_defaults(func=cmd_check)

    r = sp.add_parser("report", help="顯示最近的檢查紀錄")
    r.add_argument("--last", type=int, default=20)
    r.add_argument("--min-risk", choices=list(RISK_ORDER))
    r.set_defaults(func=cmd_report)

    v = sp.add_parser("verify", help="驗證紀錄是否遭竄改")
    v.set_defaults(func=cmd_verify)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
