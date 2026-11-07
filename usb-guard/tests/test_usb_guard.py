import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import usb_guard as ug  # noqa: E402


def make_device(root: Path, name: str, vid: str, pid: str, interfaces, product="Phone", serial="ABC123"):
    """在假的 sysfs 樹中建立一個 USB 裝置。interfaces: [(cls, sub, proto, name, driver)]"""
    real = root / "devices/pci0000:00/usb1" / name
    real.mkdir(parents=True)
    for f, v in (("idVendor", vid), ("idProduct", pid), ("product", product), ("serial", serial),
                 ("manufacturer", "Test"), ("busnum", "1"), ("devnum", "5")):
        (real / f).write_text(v + "\n")
    for i, (cls, sub, proto, iname, driver) in enumerate(interfaces):
        itf = real / f"{name}:1.{i}"
        itf.mkdir()
        (itf / "bInterfaceClass").write_text(f"{cls:02x}\n")
        (itf / "bInterfaceSubClass").write_text(f"{sub:02x}\n")
        (itf / "bInterfaceProtocol").write_text(f"{proto:02x}\n")
        if iname:
            (itf / "interface").write_text(iname + "\n")
        if driver:
            drv = root / "bus/usb/drivers" / driver
            drv.mkdir(parents=True, exist_ok=True)
            os.symlink(drv, itf / "driver")
    links = root / "bus/usb/devices"
    links.mkdir(parents=True, exist_ok=True)
    os.symlink(real, links / name)
    return real


class ScannerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "proc").mkdir()
        self.scanner = ug.LinuxScanner(str(self.root), str(self.root / "proc"))

    def tearDown(self):
        self.tmp.cleanup()

    def risk(self, key):
        dev = self.scanner.list_devices()[key]
        return ug.analyze(dev, self.scanner, sample_seconds=0)

    def test_charge_only_phone_is_ok(self):
        make_device(self.root, "1-1", "18d1", "4ee8", [(0xFF, 0x00, 0x00, "", "")])
        overall, findings = self.risk("1-1")
        self.assertEqual(overall, ug.OK)
        self.assertEqual(findings[0].code, "charge-only")

    def test_mtp_is_warn(self):
        make_device(self.root, "1-1", "18d1", "4ee1", [(0xFF, 0xFF, 0x00, "MTP", "")])
        overall, _ = self.risk("1-1")
        self.assertEqual(overall, ug.WARN)

    def test_adb_is_high(self):
        make_device(self.root, "1-1", "18d1", "4ee2",
                    [(0xFF, 0xFF, 0x00, "MTP", ""), (0xFF, 0x42, 0x01, "ADB Interface", "")])
        overall, findings = self.risk("1-1")
        self.assertEqual(overall, ug.HIGH)
        self.assertIn("itf-adb", [f.code for f in findings])

    def test_iphone_usbmux_is_warn(self):
        make_device(self.root, "1-2", "05ac", "12a8",
                    [(0x06, 0x01, 0x01, "PTP", ""), (0xFF, 0xFE, 0x02, "Apple USB Multiplexor", "")])
        overall, findings = self.risk("1-2")
        self.assertEqual(overall, ug.WARN)
        codes = [f.code for f in findings]
        self.assertIn("itf-usbmux", codes)
        self.assertIn("itf-ptp", codes)

    def test_userspace_claim_is_high(self):
        make_device(self.root, "1-1", "18d1", "4ee1", [(0xFF, 0xFF, 0x00, "MTP", "usbfs")])
        overall, findings = self.risk("1-1")
        self.assertEqual(overall, ug.HIGH)
        self.assertIn("claimed", [f.code for f in findings])

    def test_malicious_cable_keyboard(self):
        make_device(self.root, "1-3", "04e8", "6860", [(0x03, 0x01, 0x01, "", "usbhid")])
        overall, findings = self.risk("1-3")
        self.assertEqual(overall, ug.HIGH)
        self.assertIn("hid-on-phone", [f.code for f in findings])

    def test_unknown_keyboard_is_warn(self):
        make_device(self.root, "1-4", "1234", "5678", [(0x03, 0x01, 0x01, "", "usbhid")], product="Cable")
        overall, _ = self.risk("1-4")
        self.assertEqual(overall, ug.WARN)

    def test_serial_is_hashed_not_stored(self):
        make_device(self.root, "1-1", "18d1", "4ee1", [], serial="SECRET-SERIAL")
        dev = self.scanner.list_devices()["1-1"]
        self.assertNotIn("SECRET", dev.serial_hash)
        self.assertEqual(len(dev.serial_hash), 16)

    def test_traffic_detection(self):
        real = make_device(self.root, "1-1", "18d1", "4ee1", [(0x08, 0x06, 0x50, "", "usb-storage")])
        blk_real = real / "1-1:1.0/host0/block/sdb"
        blk_real.mkdir(parents=True)
        stat = blk_real / "stat"
        stat.write_text("10 0 100 0 5 0 50 0 0 0 0\n")
        (self.root / "block").mkdir()
        os.symlink(blk_real, self.root / "block/sdb")
        dev = self.scanner.list_devices()["1-1"]

        orig_sleep = ug.time.sleep
        ug.time.sleep = lambda s: stat.write_text("20 0 4196 0 5 0 50 0 0 0 0\n")
        try:
            overall, findings = ug.analyze(dev, self.scanner, sample_seconds=1)
        finally:
            ug.time.sleep = orig_sleep
        self.assertEqual(overall, ug.HIGH)
        traffic = [f for f in findings if f.code == "traffic"]
        self.assertTrue(traffic)
        self.assertIn("disk:sdb:read", traffic[0].message)


class SecureLogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.log = ug.SecureLog(Path(self.tmp.name) / "data")

    def tearDown(self):
        self.tmp.cleanup()

    def test_permissions(self):
        self.log.append({"risk": "OK", "n": 1})
        if os.name == "posix":
            self.assertEqual(os.stat(self.log.path).st_mode & 0o777, 0o600)
            self.assertEqual(os.stat(self.log.dir / "hmac.key").st_mode & 0o777, 0o600)
            self.assertEqual(os.stat(self.log.dir).st_mode & 0o777, 0o700)

    def test_chain_ok_and_tamper_detected(self):
        for i in range(3):
            self.log.append({"risk": "OK", "n": i})
        self.assertTrue(self.log.verify()[0])

        lines = self.log.path.read_text().splitlines()
        rec = json.loads(lines[1])
        rec["risk"] = "HIGH"
        lines[1] = json.dumps(rec)
        self.log.path.write_text("\n".join(lines) + "\n")
        ok, msg = self.log.verify()
        self.assertFalse(ok)
        self.assertIn("第 2 筆", msg)

    def test_deletion_detected(self):
        for i in range(3):
            self.log.append({"risk": "OK", "n": i})
        lines = self.log.path.read_text().splitlines()
        self.log.path.write_text("\n".join([lines[0], lines[2]]) + "\n")
        self.assertFalse(self.log.verify()[0])


class WindowsMappingTests(unittest.TestCase):
    def test_pnp_grouping(self):
        s = ug.WindowsScanner()
        s._pnp = lambda: [
            {"Class": "WPD", "FriendlyName": "Pixel 8", "InstanceId": "USB\\VID_18D1&PID_4EE2&MI_00\\6&1"},
            {"Class": "AndroidUsbDeviceClass", "FriendlyName": "Android Composite ADB Interface",
             "InstanceId": "USB\\VID_18D1&PID_4EE2&MI_01\\6&2"},
        ]
        devs = s.list_devices()
        self.assertEqual(list(devs), ["18d1:4ee2"])
        overall, _ = ug.analyze(devs["18d1:4ee2"], s, sample_seconds=0)
        self.assertEqual(overall, ug.HIGH)


if __name__ == "__main__":
    unittest.main()
