"""
upload_service.py

Flashes an Arduino (Uno / Nano with Optiboot) using the STK500v1 bootloader
protocol over pyserial. No arduino-cli, no avrdude, no Docker needed — just the
pyserial library that is already installed for the serial monitor.
"""

import subprocess
import sys
import time
import serial
from typing import Callable, Optional

# STK500v1 constants
STK_OK             = 0x10
STK_INSYNC         = 0x14
CRC_EOP            = 0x20
STK_GET_SYNC       = 0x30
STK_ENTER_PROGMODE = 0x50
STK_LEAVE_PROGMODE = 0x51
STK_LOAD_ADDRESS   = 0x55
STK_PROG_PAGE      = 0x64

DEFAULT_BAUD = 115200
PAGE_SIZE    = 128  # Optiboot page size in bytes


# ── Intel HEX parser ──────────────────────────────────────────────────────────

def parse_intel_hex(hex_str: str) -> bytes:
    """Convert an Intel HEX string into a flat binary buffer (0xFF-padded)."""
    records: dict[int, int] = {}
    max_addr = 0

    for line in hex_str.strip().splitlines():
        line = line.strip()
        if not line.startswith(":"):
            continue
        length   = int(line[1:3],  16)
        addr     = int(line[3:7],  16)
        rec_type = int(line[7:9],  16)
        if rec_type == 0:  # data record
            for i in range(length):
                records[addr + i] = int(line[9 + i * 2 : 11 + i * 2], 16)
            max_addr = max(max_addr, addr + length)

    buf = bytearray([0xFF] * max_addr)
    for addr, byte in records.items():
        buf[addr] = byte
    return bytes(buf)


# ── Low-level STK500 helpers ──────────────────────────────────────────────────

def _expect_insync(ser: serial.Serial) -> None:
    """Read 2 bytes and assert they are INSYNC + OK."""
    b = ser.read(2)
    if len(b) < 2 or b[0] != STK_INSYNC or b[1] != STK_OK:
        got = b.hex() if b else "timeout"
        raise RuntimeError(f"STK500 protocol error — expected 14 10, got {got}")


# ── Port opener with pkexec escalation ───────────────────────────────────────

def _try_pkexec_chmod(port: str, log) -> bool:
    """
    Use pkexec (PolicyKit) to chmod 666 the port, which triggers the desktop
    password dialog on GNOME/KDE. Returns True if the port is now accessible.
    """
    if sys.platform != "linux":
        return False
    try:
        log(f"Requesting system permission for {port}…")
        result = subprocess.run(
            ["pkexec", "chmod", "666", port],
            timeout=60,  # wait up to 60 s for user to authenticate
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _open_port(port: str, baud: int, log) -> "serial.Serial | dict":
    """Open the serial port, escalating via pkexec on permission error."""
    try:
        return serial.Serial(port, baudrate=baud, timeout=2)
    except serial.SerialException as exc:
        err_str = str(exc)
        # Check if it's a permission error
        if "Permission denied" in err_str or "13" in err_str:
            if _try_pkexec_chmod(port, log):
                # Retry after pkexec granted access
                try:
                    return serial.Serial(port, baudrate=baud, timeout=2)
                except serial.SerialException as exc2:
                    err_str = str(exc2)
            # pkexec failed or not available — return structured error
            return {
                "success": False,
                "output": f"PERMISSION_DENIED:{port}",
            }
        return {
            "success": False,
            "output": f"Cannot open {port}: {exc}",
        }


# ── Public upload function ────────────────────────────────────────────────────

def upload_firmware(
    port: str,
    hex_content: str,
    on_log: Optional[Callable[[str], None]] = None,
    baud: Optional[int] = None,
) -> dict:
    """
    Compile-independent firmware upload via STK500v1 / Optiboot.

    Args:
        port:        Serial port path, e.g. '/dev/ttyACM0' or 'COM3'.
        hex_content: Intel HEX string (as returned by the compile endpoint).
        on_log:      Optional callback receiving progress strings.

    Returns:
        {"success": bool, "output": str}
    """
    def log(msg: str) -> None:
        if on_log:
            on_log(msg)

    upload_baud = baud or DEFAULT_BAUD
    log(f"Using baud rate: {upload_baud}")

    try:
        binary      = parse_intel_hex(hex_content)
        total_pages = (len(binary) + PAGE_SIZE - 1) // PAGE_SIZE
        log(f"Parsed firmware: {len(binary)} bytes, {total_pages} pages")
    except Exception as exc:
        return {"success": False, "output": f"HEX parse error: {exc}"}

    # ── Open port (with pkexec escalation on Linux if permission denied) ───────
    ser = _open_port(port, upload_baud, log)
    if isinstance(ser, dict):   # error dict returned
        return ser

    try:
        # ── DTR toggle → reset into bootloader ───────────────────────────────
        log("Resetting board…")
        ser.setDTR(False)
        time.sleep(0.25)
        ser.setDTR(True)
        time.sleep(0.05)
        ser.reset_input_buffer()

        # ── Sync ──────────────────────────────────────────────────────────────
        log("Syncing with bootloader…")
        synced = False
        for _ in range(12):
            ser.reset_input_buffer()
            ser.write(bytes([STK_GET_SYNC, CRC_EOP]))
            resp = ser.read(2)
            if len(resp) == 2 and resp[0] == STK_INSYNC and resp[1] == STK_OK:
                synced = True
                break
            time.sleep(0.1)

        if not synced:
            return {
                "success": False,
                "output": (
                    "Could not sync with the Arduino bootloader.\n"
                    "• Is the board connected and powered?\n"
                    "• Try pressing Reset just before uploading."
                ),
            }

        # ── Enter programming mode ────────────────────────────────────────────
        log("Entering programming mode…")
        ser.write(bytes([STK_ENTER_PROGMODE, CRC_EOP]))
        _expect_insync(ser)

        # ── Program flash pages ───────────────────────────────────────────────
        for page_idx in range(total_pages):
            byte_addr = page_idx * PAGE_SIZE
            word_addr = byte_addr >> 1  # STK500 uses word addresses

            # Load address
            ser.write(bytes([
                STK_LOAD_ADDRESS,
                word_addr & 0xFF,
                (word_addr >> 8) & 0xFF,
                CRC_EOP,
            ]))
            _expect_insync(ser)

            # Build 0xFF-padded page
            page  = bytearray([0xFF] * PAGE_SIZE)
            chunk = binary[byte_addr : byte_addr + PAGE_SIZE]
            page[: len(chunk)] = chunk

            # Program page: STK_PROG_PAGE size_hi size_lo 'F' <data> CRC_EOP
            cmd = (
                bytes([STK_PROG_PAGE, (PAGE_SIZE >> 8) & 0xFF, PAGE_SIZE & 0xFF, 0x46])
                + bytes(page)
                + bytes([CRC_EOP])
            )
            ser.write(cmd)
            _expect_insync(ser)

            pct = int((page_idx + 1) / total_pages * 100)
            log(f"Programming page {page_idx + 1}/{total_pages} ({pct}%)")

        # ── Leave programming mode ────────────────────────────────────────────
        ser.write(bytes([STK_LEAVE_PROGMODE, CRC_EOP]))
        _expect_insync(ser)

        log("Upload complete!")
        return {"success": True, "output": "Upload complete!"}

    except Exception as exc:
        return {"success": False, "output": str(exc)}

    finally:
        try:
            ser.close()
        except Exception:
            pass
