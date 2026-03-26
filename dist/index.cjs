"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  CMD_NAK: () => CMD_NAK,
  CMD_RDBI_REQUEST: () => CMD_RDBI_REQUEST,
  CMD_RDBI_RESPONSE: () => CMD_RDBI_RESPONSE,
  CMD_TESTER_PRESENT: () => CMD_TESTER_PRESENT,
  DC_FAMILY: () => DC_FAMILY,
  DEVICE_MODELS: () => DEVICE_MODELS,
  LOG_BLOCK: () => LOG_BLOCK,
  LOG_BLOCK_RESPONSE: () => LOG_BLOCK_RESPONSE,
  LOG_INIT: () => LOG_INIT,
  LOG_INIT_RESPONSE: () => LOG_INIT_RESPONSE,
  LOG_QUIT: () => LOG_QUIT,
  LOG_QUIT_RESPONSE: () => LOG_QUIT_RESPONSE,
  MANIFEST_ADDRESS: () => MANIFEST_ADDRESS,
  MANIFEST_DELETED: () => MANIFEST_DELETED,
  MANIFEST_ENTRY_SIZE: () => MANIFEST_ENTRY_SIZE,
  MANIFEST_SIZE: () => MANIFEST_SIZE,
  MANIFEST_VALID: () => MANIFEST_VALID,
  PACKET_TIMEOUT_MS: () => PACKET_TIMEOUT_MS,
  RDBI_FIRMWARE: () => RDBI_FIRMWARE,
  RDBI_HARDWARE: () => RDBI_HARDWARE,
  RDBI_LOGUPLOAD: () => RDBI_LOGUPLOAD,
  RDBI_SERIAL: () => RDBI_SERIAL,
  SHEARWATER_CHAR_UUID: () => SHEARWATER_CHAR_UUID,
  SHEARWATER_SERVICE_UUID: () => SHEARWATER_SERVICE_UUID,
  SLIP_END: () => SLIP_END,
  SLIP_ESC: () => SLIP_ESC,
  SLIP_ESC_END: () => SLIP_ESC_END,
  SLIP_ESC_ESC: () => SLIP_ESC_ESC,
  ShearwaterBle: () => ShearwaterBle,
  ShearwaterProtocol: () => ShearwaterProtocol,
  SlipDecoder: () => SlipDecoder,
  configureLibDC: () => configureLibDC,
  getAvailableDevices: () => getAvailableDevices,
  isLibDCAvailable: () => isLibDCAvailable,
  loadLibDC: () => loadLibDC,
  parseDiveWasm: () => parseDiveWasm,
  parseShearwaterDive: () => parseShearwaterDive,
  parseShearwaterDiveWasm: () => parseShearwaterDiveWasm,
  slipEncode: () => slipEncode
});
module.exports = __toCommonJS(index_exports);

// src/constants.ts
var SHEARWATER_SERVICE_UUID = "fe25c237-0ece-443c-b0aa-e02033e7029d";
var SHEARWATER_CHAR_UUID = "27b7570b-359e-45a3-91bb-cf7e70049bd2";
var SLIP_END = 192;
var SLIP_ESC = 219;
var SLIP_ESC_END = 220;
var SLIP_ESC_ESC = 221;
var CMD_TESTER_PRESENT = 62;
var CMD_RDBI_REQUEST = 34;
var CMD_RDBI_RESPONSE = 98;
var CMD_NAK = 127;
var RDBI_SERIAL = 32784;
var RDBI_FIRMWARE = 32785;
var RDBI_LOGUPLOAD = 32801;
var RDBI_HARDWARE = 32848;
var LOG_INIT = 53;
var LOG_BLOCK = 54;
var LOG_QUIT = 55;
var LOG_INIT_RESPONSE = 117;
var LOG_BLOCK_RESPONSE = 118;
var LOG_QUIT_RESPONSE = 119;
var MANIFEST_ADDRESS = 3758096384;
var MANIFEST_SIZE = 1536;
var MANIFEST_ENTRY_SIZE = 32;
var MANIFEST_VALID = 42436;
var MANIFEST_DELETED = 23075;
var DEVICE_MODELS = {
  2: "Predator",
  3: "Petrel",
  4: "Nerd",
  5: "Perdix",
  6: "Perdix AI",
  7: "Nerd 2",
  8: "Teric",
  9: "Peregrine",
  10: "Petrel 3",
  11: "Perdix 2",
  12: "Tern",
  13: "Peregrine TX"
};
var PACKET_TIMEOUT_MS = 1e4;

// src/slip.ts
function slipEncode(data) {
  const out = [];
  for (const byte of data) {
    if (byte === SLIP_END) {
      out.push(SLIP_ESC, SLIP_ESC_END);
    } else if (byte === SLIP_ESC) {
      out.push(SLIP_ESC, SLIP_ESC_ESC);
    } else {
      out.push(byte);
    }
  }
  out.push(SLIP_END);
  return new Uint8Array(out);
}
var SlipDecoder = class {
  constructor() {
    this.buffer = [];
    this.inEscape = false;
  }
  /**
   * Feed incoming BLE data. Returns array of complete decoded frames.
   */
  feed(chunk) {
    const frames = [];
    for (const byte of chunk) {
      if (byte === SLIP_END) {
        if (this.buffer.length > 0) {
          frames.push(new Uint8Array(this.buffer));
          this.buffer = [];
        }
        this.inEscape = false;
        continue;
      }
      if (this.inEscape) {
        this.inEscape = false;
        if (byte === SLIP_ESC_END) {
          this.buffer.push(SLIP_END);
        } else if (byte === SLIP_ESC_ESC) {
          this.buffer.push(SLIP_ESC);
        } else {
          this.buffer.push(byte);
        }
        continue;
      }
      if (byte === SLIP_ESC) {
        this.inEscape = true;
        continue;
      }
      this.buffer.push(byte);
    }
    return frames;
  }
  reset() {
    this.buffer = [];
    this.inEscape = false;
  }
};

// src/shearwater-ble.ts
var REQ_HEADER_0 = 255;
var REQ_HEADER_1 = 1;
var RES_HEADER_0 = 1;
var RES_HEADER_1 = 255;
var BLE_FRAME_SIZE = 32;
var BLE_PAYLOAD_SIZE = BLE_FRAME_SIZE - 2;
var _log = (..._args) => {
};
var _warn = (...args) => console.warn("[SW-BLE]", ...args);
var hex = (arr) => Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join(" ");
var ShearwaterBle = class {
  constructor() {
    this.device = null;
    this.characteristic = null;
    this.slipDecoder = new SlipDecoder();
    this.pendingResponse = null;
    /** Queue for responses that arrive before sendPacket sets up pendingResponse */
    this.responseQueue = [];
    this.disconnectCallback = null;
    this.useWriteWithResponse = false;
    // Mutex: only one sendPacket at a time (protocol is request/response)
    this.sendMutex = Promise.resolve();
    /**
     * Handle incoming BLE notification.
     * Ref: shearwater_common_slip_read() in libdivecomputer src/shearwater_common.c
     */
    this.handleNotification = (event) => {
      const target = event.target;
      const value = target.value;
      if (!value) {
        _log("RX notification: no value");
        return;
      }
      const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      _log("RX raw notification:", hex(raw), `(${raw.length} bytes)`);
      if (raw.length <= 2) {
        _log("RX notification too short (no data after BLE header)");
        return;
      }
      _log(`RX BLE header: frame_count=${raw[0]}, frame_number=${raw[1]}`);
      const chunk = raw.slice(2);
      const frames = this.slipDecoder.feed(chunk);
      _log("SLIP decoded frames:", frames.length);
      for (const frame of frames) {
        _log("RX frame:", hex(frame), `(${frame.length} bytes)`);
        if (frame.length < 4) {
          _log("Frame too short, skipping");
          continue;
        }
        if (frame[0] !== RES_HEADER_0 || frame[1] !== RES_HEADER_1 || frame[3] !== 0) {
          _warn("Frame header mismatch:", {
            byte0: frame[0].toString(16),
            byte1: frame[1].toString(16),
            byte3: frame[3].toString(16),
            expected: `${RES_HEADER_0.toString(16)} ${RES_HEADER_1.toString(16)} xx 00`
          });
          continue;
        }
        const payload = frame.slice(4);
        _log("RX payload:", hex(payload));
        if (this.pendingResponse) {
          const { resolve, timeout } = this.pendingResponse;
          clearTimeout(timeout);
          this.pendingResponse = null;
          resolve(payload);
        } else {
          _warn("Received frame but no pending response, queuing");
          this.responseQueue.push(payload);
        }
      }
    };
  }
  get connected() {
    return this.device?.gatt?.connected === true;
  }
  get deviceName() {
    return this.device?.name ?? void 0;
  }
  onDisconnect(cb) {
    this.disconnectCallback = cb;
  }
  /**
   * Request a Shearwater device via Web Bluetooth and connect.
   */
  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not supported in this browser");
    }
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SHEARWATER_SERVICE_UUID] }]
    });
    this.device.addEventListener("gattserverdisconnected", () => {
      this.cleanup();
      this.disconnectCallback?.();
    });
    const server = await this.device.gatt.connect();
    _log("GATT connected");
    const service = await server.getPrimaryService(SHEARWATER_SERVICE_UUID);
    _log("Service found");
    this.characteristic = await service.getCharacteristic(SHEARWATER_CHAR_UUID);
    _log("Characteristic found");
    const props = this.characteristic.properties;
    _log("Characteristic properties:", {
      write: props.write,
      writeWithoutResponse: props.writeWithoutResponse,
      notify: props.notify,
      indicate: props.indicate,
      read: props.read
    });
    this.useWriteWithResponse = props.write;
    if (!this.useWriteWithResponse && props.writeWithoutResponse) {
      this.useWriteWithResponse = false;
    }
    _log("Using write method:", this.useWriteWithResponse ? "writeValueWithResponse" : "writeValueWithoutResponse");
    await this.characteristic.startNotifications();
    _log("Notifications started");
    this.characteristic.addEventListener(
      "characteristicvaluechanged",
      this.handleNotification
    );
    return this.device;
  }
  /**
   * Send a command and wait for the response.
   * Ref: shearwater_common_slip_write() in libdivecomputer src/shearwater_common.c
   *
   * Serialized via mutex — only one packet can be in-flight at a time.
   * This prevents keepalive pings from racing with data transfer commands.
   *
   * @param data - Raw command bytes (e.g. [0x22, id_hi, id_lo] for RDBI)
   * @param timeoutMs - Override the default packet timeout (ms)
   * @returns The response payload (header already stripped)
   */
  async sendPacket(data, timeoutMs) {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const prev = this.sendMutex;
    this.sendMutex = gate;
    await prev;
    try {
      return await this._sendPacketInner(data, timeoutMs);
    } finally {
      release();
    }
  }
  async _sendPacketInner(data, timeoutMs) {
    if (!this.characteristic) {
      throw new Error("Not connected");
    }
    if (this.responseQueue.length > 0) {
      const queued = this.responseQueue.shift();
      _log("Using queued response:", hex(queued));
      return queued;
    }
    const length = data.length + 1;
    const packet = new Uint8Array(4 + data.length);
    packet[0] = REQ_HEADER_0;
    packet[1] = REQ_HEADER_1;
    packet[2] = length & 255;
    packet[3] = 0;
    packet.set(data, 4);
    const encoded = slipEncode(packet);
    _log("TX packet:", hex(packet));
    _log("TX SLIP-encoded:", hex(encoded), `(${encoded.length} bytes)`);
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponse = null;
        _warn("TIMEOUT waiting for response");
        reject(new Error("Response timeout"));
      }, timeoutMs ?? PACKET_TIMEOUT_MS);
      this.pendingResponse = { resolve, reject, timeout };
    });
    const nframes = Math.ceil(encoded.length / BLE_FRAME_SIZE);
    _log("TX BLE frames:", nframes);
    for (let i = 0; i < nframes; i++) {
      const start = i * BLE_PAYLOAD_SIZE;
      const end = Math.min(start + BLE_PAYLOAD_SIZE, encoded.length);
      const payload = encoded.slice(start, end);
      const frame = new Uint8Array(2 + payload.length);
      frame[0] = nframes;
      frame[1] = i;
      frame.set(payload, 2);
      _log(`TX BLE frame ${i}/${nframes}:`, hex(frame));
      if (this.useWriteWithResponse) {
        await this.characteristic.writeValueWithResponse(frame);
      } else {
        await this.characteristic.writeValueWithoutResponse(frame);
      }
    }
    _log("Write completed");
    return responsePromise;
  }
  /**
   * Reset the SLIP decoder, discarding any buffered partial data.
   * Call between transfers to ensure clean state.
   */
  resetDecoder() {
    this.slipDecoder.reset();
    this.responseQueue = [];
  }
  disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.cleanup();
  }
  cleanup() {
    if (this.characteristic) {
      try {
        this.characteristic.removeEventListener(
          "characteristicvaluechanged",
          this.handleNotification
        );
      } catch {
      }
    }
    if (this.pendingResponse) {
      clearTimeout(this.pendingResponse.timeout);
      this.pendingResponse.reject(new Error("Disconnected"));
      this.pendingResponse = null;
    }
    this.characteristic = null;
    this.slipDecoder.reset();
    this.responseQueue = [];
  }
};

// src/shearwater-protocol.ts
var _log2 = (..._args) => {
};
var _info = (...args) => console.log("[SW]", ...args);
var _diagnosticsEnabled = typeof globalThis !== "undefined" && (globalThis.DEBUG_BLE_DIAGNOSTICS === true || globalThis.DEBUG_BLE_DIAGNOSTICS === "true");
var _diag = (...args) => {
  if (_diagnosticsEnabled) console.error(...args);
};
var MANIFEST_RECORD_COUNT = MANIFEST_SIZE / MANIFEST_ENTRY_SIZE;
var KNOWN_RDBI_LABELS = {
  [RDBI_SERIAL]: "Serial",
  [RDBI_FIRMWARE]: "Firmware",
  [RDBI_LOGUPLOAD]: "Log upload base address",
  [RDBI_HARDWARE]: "Hardware"
};
var ShearwaterProtocol = class {
  constructor(ble) {
    this.ble = ble;
    this.baseAddr = 0;
    this.keepAliveTimer = null;
    this.transferActive = false;
  }
  /**
   * Some Shearwater devices need a brief pause after GATT connect before the
   * first protocol request, otherwise the initial RDBI often times out.
   */
  async waitForReady(delayMs = 500) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  /** BLE advertised device name (e.g. "Perdix AI 12345") — fallback for model display */
  get bleDeviceName() {
    return this.ble.deviceName;
  }
  /**
   * Start periodic keepalive pings to prevent the dive computer from
   * exiting its UDS diagnostic session during idle periods.
   * Uses ISO 14229 TesterPresent (0x3E) — the standard UDS session
   * keepalive — every 4 seconds.  Pauses during active data transfers.
   */
  startKeepAlive() {
    this.stopKeepAlive();
    const ping = async () => {
      if (!this.keepAliveTimer || this.transferActive || !this.ble.connected) return;
      try {
        await this.ble.sendPacket(new Uint8Array([CMD_TESTER_PRESENT, 0]), 2e3);
      } catch {
      }
    };
    ping();
    this.keepAliveTimer = setInterval(ping, 4e3);
  }
  stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
  /**
   * Read device info via RDBI commands.
   * Retries the first RDBI if it times out — some devices need time after GATT connect.
   */
  async getDeviceInfo() {
    let serialData;
    try {
      serialData = await this.rdbi(RDBI_SERIAL);
    } catch {
      _info("First RDBI timed out, retrying after 1s...");
      await new Promise((r) => setTimeout(r, 1e3));
      this.ble.resetDecoder();
      serialData = await this.rdbi(RDBI_SERIAL);
    }
    const firmwareData = await this.rdbi(RDBI_FIRMWARE);
    const hardwareData = await this.rdbi(RDBI_HARDWARE);
    const serial = this.decodeAscii(serialData).trim();
    const firmware = this.decodeFirmwareVersion(firmwareData);
    const hardware = this.decodeAscii(hardwareData).trim();
    const modelId = hardwareData.length > 0 ? hardwareData[0] : 0;
    let model = DEVICE_MODELS[modelId];
    if (!model) {
      const bleName = this.ble.deviceName;
      model = bleName ? bleName.replace(/\s+\d{4,}$/, "").trim() : `Unknown (${modelId})`;
      _info(`Model ID ${modelId} not in table, using BLE name: "${model}"`);
    }
    return { serial, firmware, hardware, model, modelId };
  }
  /**
   * Read the log upload base address via RDBI 0x8021.
   * Ref: shearwater_petrel_device_open() in libdivecomputer src/shearwater_petrel.c
   *   Response is 9 bytes, base_addr = uint32_be at offset 1
   *   Map known values to canonical base addresses.
   */
  async readBaseAddr() {
    const data = await this.rdbi(RDBI_LOGUPLOAD);
    _log2("RDBI_LOGUPLOAD response:", Array.from(data).map((b) => b.toString(16).padStart(2, "0")).join(" "));
    if (data.length < 5) {
      _log2("RDBI_LOGUPLOAD response too short, defaulting to 0xC0000000");
      this.baseAddr = 3221225472;
      return this.baseAddr;
    }
    const raw = (data[1] << 24 | data[2] << 16 | data[3] << 8 | data[4]) >>> 0;
    _log2("Raw base_addr:", "0x" + raw.toString(16));
    switch (raw) {
      case 3707764736:
      case 3221225472:
      case 2415919104:
        this.baseAddr = 3221225472;
        break;
      case 2147483648:
        this.baseAddr = 2147483648;
        break;
      default:
        _log2("Unknown base_addr format, using raw value:", "0x" + raw.toString(16));
        this.baseAddr = raw;
    }
    _log2("Using base_addr:", "0x" + this.baseAddr.toString(16));
    return this.baseAddr;
  }
  /**
   * Read the dive manifest from flash memory.
   * Ref: shearwater_petrel_device_foreach() in libdivecomputer src/shearwater_petrel.c
   * Returns entries sorted by timestamp descending (most recent first).
   */
  async getManifest() {
    await this.readBaseAddr();
    const entries = [];
    const seenManifestPages = /* @__PURE__ */ new Set();
    const seenEntries = /* @__PURE__ */ new Set();
    while (true) {
      const data = await this.readMemory(MANIFEST_ADDRESS, MANIFEST_SIZE);
      const pageSignature = this.getManifestPageSignature(data);
      if (seenManifestPages.has(pageSignature)) {
        _info("Manifest page repeated; stopping pagination.");
        break;
      }
      seenManifestPages.add(pageSignature);
      const page = this.parseManifestPage(data, seenEntries);
      entries.push(...page.entries);
      _info(
        `Manifest page: ${page.validSlots} valid, ${page.deletedSlots} deleted, ${page.entries.length} new entries`
      );
      if (page.validSlots + page.deletedSlots !== MANIFEST_RECORD_COUNT) break;
    }
    entries.sort((a, b) => b.timestamp - a.timestamp);
    entries.forEach((e, i) => {
      e.index = i;
    });
    return entries;
  }
  parseManifestPage(data, seenEntries) {
    const entries = [];
    let validSlots = 0;
    let deletedSlots = 0;
    for (let offset = 0; offset + MANIFEST_ENTRY_SIZE <= data.length; offset += MANIFEST_ENTRY_SIZE) {
      const view = new DataView(data.buffer, data.byteOffset + offset, MANIFEST_ENTRY_SIZE);
      const marker = view.getUint16(0, false);
      if (marker === MANIFEST_DELETED) {
        deletedSlots++;
        continue;
      }
      if (marker !== MANIFEST_VALID) break;
      validSlots++;
      const diveNumber = view.getUint16(2, false);
      const timestamp = view.getUint32(4, false);
      const endTimestamp = view.getUint32(8, false);
      const address = view.getUint32(20, false);
      const endAddress = view.getUint32(24, false);
      const size = endAddress - address;
      if (address === 0 || size <= 0) continue;
      const entryKey = `${diveNumber}:${timestamp}:${endTimestamp}:${address}:${endAddress}`;
      if (seenEntries.has(entryKey)) continue;
      seenEntries.add(entryKey);
      _log2(`Manifest entry: dive#${diveNumber} addr=0x${address.toString(16)} endAddr=0x${endAddress.toString(16)} size=${size} ts=${timestamp} (${new Date(timestamp * 1e3).toISOString()})`);
      entries.push({
        index: entries.length,
        diveNumber,
        address,
        size,
        timestamp,
        endTimestamp,
        valid: true
      });
    }
    return { entries, validSlots, deletedSlots };
  }
  getManifestPageSignature(data) {
    return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  toHex(data) {
    return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
  }
  decodeAsciiPreview(data) {
    const ascii = Array.from(data).map((byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".").join("").replace(/\.+$/g, "").trim();
    return ascii ? ascii : void 0;
  }
  /**
   * Diagnose download parameters by trying all combinations of
   * address, size, and compression to find what the device accepts.
   * Results are logged to the console.
   */
  async diagnoseDownload(entry) {
    const DIVE_SIZE = 16777215;
    const tests = [
      { desc: "raw addr, actual size, raw", addr: entry.address, size: entry.size, comp: 0 },
      { desc: "raw addr, DIVE_SIZE, raw", addr: entry.address, size: DIVE_SIZE, comp: 0 },
      { desc: "base+addr, actual size, raw", addr: this.baseAddr + entry.address >>> 0, size: entry.size, comp: 0 },
      { desc: "base+addr, DIVE_SIZE, raw", addr: this.baseAddr + entry.address >>> 0, size: DIVE_SIZE, comp: 0 },
      { desc: "raw addr, actual size, compressed", addr: entry.address, size: entry.size, comp: 16 },
      { desc: "raw addr, DIVE_SIZE, compressed", addr: entry.address, size: DIVE_SIZE, comp: 16 },
      { desc: "base+addr, actual size, compressed", addr: this.baseAddr + entry.address >>> 0, size: entry.size, comp: 16 },
      { desc: "base+addr, DIVE_SIZE, compressed", addr: this.baseAddr + entry.address >>> 0, size: DIVE_SIZE, comp: 16 }
    ];
    _diag("=== DOWNLOAD DIAGNOSTIC ===");
    _diag(`Entry: dive#${entry.diveNumber}, manifest addr=0x${entry.address.toString(16)}, size=${entry.size}, base_addr=0x${this.baseAddr.toString(16)}`);
    for (const test of tests) {
      try {
        const initCmd = new Uint8Array(10);
        initCmd[0] = LOG_INIT;
        initCmd[1] = test.comp;
        initCmd[2] = 52;
        initCmd[3] = test.addr >> 24 & 255;
        initCmd[4] = test.addr >> 16 & 255;
        initCmd[5] = test.addr >> 8 & 255;
        initCmd[6] = test.addr & 255;
        initCmd[7] = test.size >> 16 & 255;
        initCmd[8] = test.size >> 8 & 255;
        initCmd[9] = test.size & 255;
        const hex2 = Array.from(initCmd).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        _diag(`TEST: ${test.desc} \u2192 cmd=[${hex2}]`);
        const response = await this.ble.sendPacket(initCmd);
        if (response.length >= 1 && response[0] === CMD_NAK) {
          const nakCmd = response.length >= 2 ? response[1] : 0;
          const nakCode = response.length >= 3 ? response[2] : 0;
          _diag(`  FAIL: NAK cmd=0x${nakCmd.toString(16)}, code=0x${nakCode.toString(16)}`);
        } else if (response.length >= 1 && response[0] === LOG_INIT_RESPONSE) {
          _diag(`  SUCCESS! Response: ${Array.from(response).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
          try {
            await this.ble.sendPacket(new Uint8Array([LOG_QUIT]));
          } catch {
          }
        } else {
          _diag(`  UNKNOWN: ${Array.from(response).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
        }
      } catch (e) {
        _diag(`  ERROR: ${e}`);
      }
    }
    _diag("=== END DIAGNOSTIC ===");
  }
  /**
   * Download raw dive data from flash memory.
   * Per libdivecomputer: uses base_addr + address, DIVE_SIZE (0xFFFFFF), compressed mode.
   *
   * IMPORTANT: libdivecomputer always requests DIVE_SIZE (16MB), not the actual dive
   * size from the manifest. The compressed transfer ends naturally when the 9-bit LRE
   * stream contains a zero value (end-of-stream marker). Using the manifest size would
   * cause us to keep requesting blocks after the device considers the transfer complete,
   * resulting in "Trans Req Seq" errors.
   */
  async downloadDive(entry, onProgress) {
    const DIVE_SIZE = 16777215;
    const addr = this.baseAddr + entry.address >>> 0;
    this.transferActive = true;
    _info(`Download dive #${entry.diveNumber}: addr=0x${addr.toString(16)}`);
    return this.readMemory(addr, DIVE_SIZE, true, onProgress);
  }
  /**
   * Probe a range of RDBI identifiers and return successful responses.
   * This is read-only discovery for Shearwater capability/config exploration.
   */
  async probeRdbiRange(startId = 32768, endId = 32863) {
    const records = [];
    for (let id = startId; id <= endId; id++) {
      try {
        const data = await this.rdbi(id);
        records.push({
          id,
          label: KNOWN_RDBI_LABELS[id],
          length: data.length,
          data,
          hex: this.toHex(data),
          ascii: this.decodeAsciiPreview(data)
        });
      } catch {
      }
    }
    return records;
  }
  /**
   * Send an RDBI (Read Data By Identifier) request.
   * Command: [0x22, id_hi, id_lo]
   * Response: [0x62, id_hi, id_lo, ...data]
   */
  async rdbi(id) {
    const cmd = new Uint8Array(3);
    cmd[0] = CMD_RDBI_REQUEST;
    cmd[1] = id >> 8 & 255;
    cmd[2] = id & 255;
    const response = await this.ble.sendPacket(cmd);
    if (response.length < 3 || response[0] !== CMD_RDBI_RESPONSE) {
      throw new Error(`Invalid RDBI response for 0x${id.toString(16)}`);
    }
    const responseId = response[1] << 8 | response[2];
    if (responseId !== id) {
      throw new Error(`RDBI ID mismatch: expected 0x${id.toString(16)}, got 0x${responseId.toString(16)}`);
    }
    return response.slice(3);
  }
  /**
   * Read a block of flash memory using the log upload protocol.
   * Ref: shearwater_common_download() in libdivecomputer src/shearwater_common.c
   *
   * Uses compressed transfer mode (0x10) per modern Shearwater firmware.
   *
   * Protocol:
   *   Init:  [0x35, compression, 0x34, addr(4), size(3)]  → response [0x75, ...]
   *   Block: [0x36, block_counter]                         → response [0x76, block_counter, ...data]
   *   Quit:  [0x37]                                        → response [0x77]
   *
   * Compression: zero-run-length encoding.
   *   Non-zero byte → literal. Zero byte + count → that many zero bytes.
   */
  async readMemory(address, size, compressed = false, onProgress) {
    this.transferActive = true;
    try {
      return await this._readMemory(address, size, compressed, onProgress);
    } finally {
      this.transferActive = false;
    }
  }
  async _readMemory(address, size, compressed = false, onProgress) {
    const initCmd = new Uint8Array(10);
    initCmd[0] = LOG_INIT;
    initCmd[1] = compressed ? 16 : 0;
    initCmd[2] = 52;
    initCmd[3] = address >> 24 & 255;
    initCmd[4] = address >> 16 & 255;
    initCmd[5] = address >> 8 & 255;
    initCmd[6] = address & 255;
    initCmd[7] = size >> 16 & 255;
    initCmd[8] = size >> 8 & 255;
    initCmd[9] = size & 255;
    const initResponse = await this.ble.sendPacket(initCmd);
    if (initResponse.length >= 1 && initResponse[0] === CMD_NAK) {
      const nakCmd = initResponse.length >= 2 ? initResponse[1] : 0;
      const nakCode = initResponse.length >= 3 ? initResponse[2] : 0;
      throw new Error(
        `Device rejected memory read at 0x${address.toString(16)} (NAK cmd=0x${nakCmd.toString(16)}, code=0x${nakCode.toString(16)})`
      );
    }
    if (initResponse.length < 1 || initResponse[0] !== LOG_INIT_RESPONSE) {
      throw new Error(
        `Failed to initiate memory read (got 0x${initResponse[0]?.toString(16) ?? "empty"})`
      );
    }
    if (initResponse.length >= 3) {
      _info(`LOG_INIT OK: compression=0x${initResponse[1].toString(16)}, maxBlockSize=${initResponse[2]}`);
    }
    let blockNum = 1;
    let blockCount = 0;
    let compressedBytes = 0;
    const transferStart = Date.now();
    const lreOutput = [];
    let streamDone = false;
    const chunks = [];
    while (compressedBytes < size && !streamDone) {
      const blockCmd = new Uint8Array(2);
      blockCmd[0] = LOG_BLOCK;
      blockCmd[1] = blockNum & 255;
      const blockStart = Date.now();
      const blockResponse = await this.ble.sendPacket(blockCmd);
      const blockMs = Date.now() - blockStart;
      blockCount++;
      if (blockResponse.length < 2 || blockResponse[0] !== LOG_BLOCK_RESPONSE || blockResponse[1] !== blockNum) {
        _info(`NAK at block #${blockCount} (ctr=${blockNum}), ${blockMs}ms, ${compressedBytes} bytes, ${((Date.now() - transferStart) / 1e3).toFixed(1)}s, resp=[${Array.from(blockResponse.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join(" ")}]`);
        if (compressed && compressedBytes > 0) break;
        throw new Error(
          `Failed to read block ${blockNum} at offset ${compressedBytes} (got 0x${blockResponse[0]?.toString(16) ?? "empty"})`
        );
      }
      const blockData = blockResponse.slice(2);
      if (blockData.length === 0) {
        _info(`Empty block at #${blockCount}, done. ${compressedBytes} bytes`);
        break;
      }
      compressedBytes += blockData.length;
      if (compressed) {
        streamDone = this.decompressLreBlock(blockData, lreOutput);
      } else {
        chunks.push(blockData);
      }
      if (blockCount === 1 || blockCount % 50 === 0 || streamDone) {
        _info(`Block #${blockCount} (ctr=${blockNum}): ${compressedBytes} bytes, ${blockMs}ms, ${((Date.now() - transferStart) / 1e3).toFixed(1)}s${streamDone ? " [STREAM DONE]" : ""}`);
      }
      blockNum = blockNum + 1 & 255;
      onProgress?.(compressedBytes);
    }
    try {
      await this.ble.sendPacket(new Uint8Array([LOG_QUIT]));
    } catch {
    }
    this.ble.resetDecoder();
    await new Promise((r) => setTimeout(r, 200));
    if (compressed) {
      const result2 = new Uint8Array(lreOutput);
      for (let i = 32; i < result2.length; i++) {
        result2[i] ^= result2[i - 32];
      }
      return result2;
    }
    const raw = new Uint8Array(compressedBytes);
    let pos = 0;
    for (const chunk of chunks) {
      raw.set(chunk, pos);
      pos += chunk.length;
    }
    if (raw.length >= size) return raw.slice(0, size);
    const result = new Uint8Array(size);
    result.set(raw);
    return result;
  }
  /**
   * Decompress one block of 9-bit LRE data (Phase 1 of Shearwater compression).
   * Ref: shearwater_common_decompress_lre() in libdivecomputer src/shearwater_common.c
   *
   * Called per-block during transfer so we can detect the end-of-stream marker
   * and stop requesting blocks before the device NAKs.
   *
   * @returns true if end-of-stream marker was found (value == 0)
   */
  decompressLreBlock(data, output) {
    const nbits = data.length * 8;
    let offset = 0;
    while (offset + 9 <= nbits) {
      const bytePos = offset >>> 3;
      const bitPos = offset & 7;
      const shift = 16 - (bitPos + 9);
      const value = (data[bytePos] << 8 | (data[bytePos + 1] || 0)) >>> shift & 511;
      if (value & 256) {
        output.push(value & 255);
      } else if (value === 0) {
        return true;
      } else {
        for (let i = 0; i < value; i++) {
          output.push(0);
        }
      }
      offset += 9;
    }
    return false;
  }
  decodeAscii(data) {
    return Array.from(data).filter((b) => b >= 32 && b <= 126).map((b) => String.fromCharCode(b)).join("");
  }
  decodeFirmwareVersion(data) {
    if (data.length > 0 && data[0] >= 32 && data[0] <= 126) {
      return this.decodeAscii(data).trim();
    }
    if (data.length >= 3) {
      return `${data[0]}.${data[1]}.${data[2]}`;
    }
    return this.decodeAscii(data).trim();
  }
};

// src/shearwater-parser.ts
var SZ_BLOCK = 128;
var SZ_SAMPLE_PETREL = 32;
var SZ_SAMPLE_PREDATOR = 16;
var REC_DIVE_SAMPLE = 1;
var REC_AVELO_SAMPLE = 3;
var REC_OPENING_0 = 16;
var REC_CLOSING_0 = 32;
var REC_INFO_EVENT = 48;
var REC_FINAL = 255;
var OC_FLAG = 16;
var SC_FLAG = 8;
var AI_OFF = 0;
var GF = 0;
var VPMB = 1;
var VPMB_GFS = 2;
var DCIEM = 3;
var NFIXED = 10;
function parseShearwaterDive(raw, deviceInfo, manifestEntry) {
  if (raw.length < SZ_BLOCK * 2) {
    throw new Error(`Dive data too short: ${raw.length} bytes`);
  }
  const pnf = raw[0] !== 255 || raw[1] !== 255 ? 1 : 0;
  const petrel = true;
  const sampleSize = petrel ? SZ_SAMPLE_PETREL : SZ_SAMPLE_PREDATOR;
  const opening = new Array(10).fill(void 0);
  const closing = new Array(10).fill(void 0);
  let finalOffset;
  let logVersion = 0;
  let aiMode = AI_OFF;
  let sampleInterval = 10;
  if (pnf) {
    for (let offset = 0; offset + sampleSize <= raw.length; offset += sampleSize) {
      if (isAllZero(raw, offset, sampleSize)) continue;
      const recordType = raw[offset];
      if (recordType >= REC_OPENING_0 && recordType <= REC_OPENING_0 + 9) {
        opening[recordType - REC_OPENING_0] = offset;
      } else if (recordType >= REC_CLOSING_0 && recordType <= REC_CLOSING_0 + 9) {
        closing[recordType - REC_CLOSING_0] = offset;
      } else if (recordType === REC_FINAL) {
        finalOffset = offset;
      }
    }
    if (opening[4] != null) {
      logVersion = raw[opening[4] + 16];
    }
    if (opening[4] != null && logVersion >= 7) {
      aiMode = raw[opening[4] + 28];
    }
    if (logVersion >= 9 && opening[5] != null) {
      const intervalRaw = raw[opening[5] + 23] << 8 | raw[opening[5] + 24];
      if (intervalRaw > 0 && intervalRaw <= 6e4) {
        sampleInterval = intervalRaw / 1e3;
      }
    }
  } else {
    for (let i = 0; i <= 4; i++) {
      opening[i] = 0;
    }
    logVersion = raw[127];
    if (petrel) {
      finalOffset = raw.length - SZ_BLOCK;
    }
  }
  const gasMixes = parseGasMixes(raw, pnf, opening);
  let decoModel;
  let gfLow;
  let gfHigh;
  if (opening[2] != null && opening[0] != null) {
    const decomodelIdx = pnf ? opening[2] + 18 : 67;
    const gfIdx = pnf ? opening[0] + 4 : 4;
    const modelByte = raw[decomodelIdx];
    if (modelByte === GF) {
      decoModel = "B\xFChlmann ZHL-16C";
      gfLow = raw[gfIdx];
      gfHigh = raw[gfIdx + 1];
    } else if (modelByte === VPMB || modelByte === VPMB_GFS) {
      decoModel = modelByte === VPMB ? "VPM-B" : "VPM-B/GFS";
    } else if (modelByte === DCIEM) {
      decoModel = "DCIEM";
    }
  }
  let closingMaxDepth = 0;
  let closingDuration = 0;
  if (closing[0] != null) {
    const co = closing[0];
    const maxDepthRaw = raw[co + 4] << 8 | raw[co + 5];
    closingMaxDepth = maxDepthRaw / 10;
    if (pnf) {
      closingDuration = raw[co + 6] << 16 | raw[co + 7] << 8 | raw[co + 8];
    } else {
      closingDuration = (raw[co + 6] << 8 | raw[co + 7]) * 60;
    }
  }
  let modelFromDive = deviceInfo.modelId;
  if (finalOffset != null && finalOffset + 14 <= raw.length) {
    modelFromDive = raw[finalOffset + 13];
  }
  const modelName = DEVICE_MODELS[modelFromDive] ?? deviceInfo.model;
  const samples = [];
  const events = [];
  const startPressureByTank = /* @__PURE__ */ new Map();
  const endPressureByTank = /* @__PURE__ */ new Map();
  let maxObservedPressureTank = -1;
  let currentTime = 0;
  let maxTemp = -999;
  let minTemp = 999;
  let sampleMaxDepth = 0;
  let diveMode = "OC";
  let diveModeSet = false;
  let prevO2 = -1;
  let prevHe = -1;
  for (let offset = 0; offset + sampleSize <= raw.length; offset += sampleSize) {
    if (isAllZero(raw, offset, sampleSize)) continue;
    const recordType = pnf ? raw[offset] : REC_DIVE_SAMPLE;
    if (!pnf) {
      if (offset < SZ_BLOCK) continue;
      if (offset >= raw.length - (petrel ? SZ_BLOCK * 2 : SZ_BLOCK)) continue;
    }
    if (recordType !== REC_DIVE_SAMPLE && recordType !== REC_AVELO_SAMPLE) {
      if (recordType === REC_INFO_EVENT && pnf) {
        const eventType = raw[offset + 1];
        if (eventType === 38) {
          events.push({
            timeSeconds: currentTime,
            type: "BOOKMARK",
            description: "Bookmark"
          });
        }
      }
      continue;
    }
    currentTime += sampleInterval;
    const depthRaw = raw[offset + pnf] << 8 | raw[offset + pnf + 1];
    const depthMeters = depthRaw / 10;
    if (depthMeters > sampleMaxDepth) sampleMaxDepth = depthMeters;
    let temp = toSigned8(raw[offset + pnf + 13]);
    if (temp < 0) {
      temp += 102;
      if (temp > 0) temp = 0;
    }
    if (temp !== 0) {
      if (temp > maxTemp) maxTemp = temp;
      if (temp < minTemp) minTemp = temp;
    }
    const status = recordType !== REC_AVELO_SAMPLE ? raw[offset + 11 + pnf] : 0;
    const ccr = (status & OC_FLAG) === 0 && recordType !== REC_AVELO_SAMPLE;
    if (!diveModeSet && recordType === REC_DIVE_SAMPLE) {
      if (ccr) {
        diveMode = status & SC_FLAG ? "SCR" : "CCR";
      }
      diveModeSet = true;
    }
    const o2 = raw[offset + pnf + 7];
    const he = raw[offset + pnf + 8];
    if ((o2 !== prevO2 || he !== prevHe) && (o2 !== 0 || he !== 0) && prevO2 >= 0) {
      events.push({
        timeSeconds: currentTime,
        type: "GAS_SWITCH",
        description: `Switch to ${formatGasName(o2, he)}`
      });
    }
    if (o2 !== 0 || he !== 0) {
      prevO2 = o2;
      prevHe = he;
    }
    const sample = {
      timeSeconds: currentTime,
      depthMeters,
      temperatureCelsius: temp !== 0 ? temp : void 0
    };
    if (logVersion >= 7 && petrel) {
      const pressureOffsets = [27, 19];
      const count = recordType === REC_AVELO_SAMPLE ? 1 : 2;
      const tankPressures = [];
      for (let i = 0; i < count; i++) {
        const pressureRaw = raw[offset + pnf + pressureOffsets[i]] << 8 | raw[offset + pnf + pressureOffsets[i] + 1];
        if (pressureRaw > 0 && pressureRaw < 65520) {
          const pressurePsi = (pressureRaw & 4095) * 2;
          if (pressurePsi > 0) {
            const pressureBar = psiToBar(pressurePsi);
            tankPressures.push({ tank: i, bar: pressureBar });
            if (!startPressureByTank.has(i)) {
              startPressureByTank.set(i, pressureBar);
            }
            endPressureByTank.set(i, pressureBar);
            if (i > maxObservedPressureTank) {
              maxObservedPressureTank = i;
            }
            if (sample.pressureBar == null) {
              sample.pressureBar = pressureBar;
            }
          }
        }
      }
      if (tankPressures.length > 0) {
        sample.tankPressures = tankPressures;
      }
    }
    const decoStopRaw = raw[offset + pnf + 2] << 8 | raw[offset + pnf + 3];
    const ttsMinutes = raw[offset + pnf + 4] << 8 | raw[offset + pnf + 5];
    const ndlDecoMinutes = raw[offset + pnf + 9];
    if (decoStopRaw > 0) {
      sample.ceilingMeters = decoStopRaw;
      if (ttsMinutes > 0 && ttsMinutes < 65535) {
        sample.ttsSeconds = ttsMinutes * 60;
      }
    } else {
      if (ndlDecoMinutes > 0 && ndlDecoMinutes < 255) {
        sample.ndlSeconds = ndlDecoMinutes * 60;
      }
      if (ttsMinutes > 0 && ttsMinutes < 65535) {
        sample.ttsSeconds = ttsMinutes * 60;
      }
    }
    if (petrel) {
      const cns = raw[offset + pnf + 22];
      if (cns > 0 && cns < 255) {
        sample.cnsPercent = cns;
      }
    }
    if (ccr) {
      const ppo2Raw = raw[offset + pnf + 6];
      if (ppo2Raw > 0) {
        sample.ppo2 = ppo2Raw / 100;
      }
      if (petrel) {
        const setpoint = raw[offset + pnf + 18];
        if (setpoint > 0) {
          sample.setpoint = setpoint / 100;
        }
      }
    }
    samples.push(sample);
  }
  const cylinders = (gasMixes.length > 0 ? gasMixes : [{ o2: 21, he: 0 }]).map((mix, index) => {
    const gasMix = {
      oxygen: mix.o2 / 100,
      helium: mix.he / 100,
      nitrogen: Math.max(0, 1 - mix.o2 / 100 - mix.he / 100),
      name: formatGasName(mix.o2, mix.he)
    };
    return {
      index,
      gasMix,
      startPressureBar: startPressureByTank.get(index),
      endPressureBar: endPressureByTank.get(index)
    };
  });
  const startTime = new Date(manifestEntry.timestamp * 1e3).toISOString();
  const maxDepthMeters = sampleMaxDepth > 0 ? sampleMaxDepth : closingMaxDepth;
  const durationSeconds = samples.length > 0 ? Math.round(samples[samples.length - 1].timeSeconds) : closingDuration;
  const rawDataHash = hashRawData(raw, deviceInfo.serial, manifestEntry.timestamp);
  return {
    sourceFormat: "SHEARWATER_BLE",
    sourceFileName: `ble://${deviceInfo.serial}`,
    diveNumberInFile: manifestEntry.diveNumber,
    startTime,
    durationSeconds,
    maxDepthMeters,
    meanDepthMeters: void 0,
    diveMode,
    minTemperatureCelsius: minTemp < 999 ? minTemp : void 0,
    maxTemperatureCelsius: maxTemp > -999 ? maxTemp : void 0,
    waterTemperatureCelsius: minTemp < 999 ? minTemp : void 0,
    site: void 0,
    computer: {
      manufacturer: "Shearwater",
      model: modelName,
      serial: deviceInfo.serial,
      firmwareVersion: deviceInfo.firmware
    },
    cylinders,
    samples,
    sampleIntervalSeconds: sampleInterval,
    events,
    decoModel,
    gradientFactorLow: gfLow,
    gradientFactorHigh: gfHigh,
    rawDataHash,
    parseWarnings: maxObservedPressureTank >= cylinders.length ? ["Additional pressure channels were present without matching gas definitions."] : [],
    isPartial: false
  };
}
function parseGasMixes(raw, pnf, opening) {
  const mixes = [];
  if (pnf) {
    if (opening[0] == null) return mixes;
    const o0 = opening[0];
    const o2Values = [];
    const heValues = [];
    for (let i = 0; i < NFIXED; i++) {
      o2Values.push(raw[o0 + 20 + i] || 0);
    }
    heValues.push(raw[o0 + 30] || 0);
    heValues.push(raw[o0 + 31] || 0);
    if (opening[1] != null) {
      const o1 = opening[1];
      for (let i = 0; i < 8; i++) {
        heValues.push(raw[o1 + 1 + i] || 0);
      }
    }
    for (let i = 0; i < NFIXED; i++) {
      if (o2Values[i] > 0) {
        mixes.push({ o2: o2Values[i], he: heValues[i] || 0 });
      }
    }
  } else {
    for (let i = 0; i < NFIXED; i++) {
      const o2 = raw[20 + i];
      const he = raw[30 + i];
      if (o2 > 0) {
        mixes.push({ o2, he });
      }
    }
  }
  return mixes;
}
function isAllZero(data, offset, length) {
  for (let i = 0; i < length; i++) {
    if (data[offset + i] !== 0) return false;
  }
  return true;
}
function toSigned8(value) {
  return value > 127 ? value - 256 : value;
}
function psiToBar(psi) {
  return Math.round(psi * 0.0689476 * 10) / 10;
}
function formatGasName(o2Pct, hePct) {
  if (hePct > 0) return `Trimix ${o2Pct}/${hePct}`;
  if (o2Pct === 21 || o2Pct === 0) return "Air";
  if (o2Pct === 100) return "O2";
  return `EAN${o2Pct}`;
}
function hashRawData(raw, serial, timestamp) {
  const parts = [serial, timestamp.toString(), raw.length.toString()];
  const head = raw.slice(0, Math.min(64, raw.length));
  const tail = raw.slice(Math.max(0, raw.length - 64));
  for (let i = 0; i < head.length; i++) parts.push(head[i].toString(16));
  for (let i = 0; i < tail.length; i++) parts.push(tail[i].toString(16));
  const str = parts.join(":");
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i) >>> 0;
  }
  return `ble-${serial}-${timestamp}-${hash.toString(16)}`;
}

// src/libdc-wasm-loader.ts
var defaultBaseUrl = "/libdivecomputer";
var modulePromise = null;
function configureLibDC(options) {
  if (options.baseUrl !== void 0) {
    defaultBaseUrl = options.baseUrl.replace(/\/+$/, "");
    modulePromise = null;
  }
}
function loadEmscriptenFactory(baseUrl) {
  return new Promise((resolve, reject) => {
    const existing = globalThis["createLibDC"];
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = `${baseUrl}/libdc.js`;
    script.async = true;
    script.onload = () => {
      const factory = globalThis["createLibDC"];
      if (factory) {
        resolve(factory);
      } else {
        reject(new Error("createLibDC not found after loading libdc.js"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load libdc.js"));
    document.head.appendChild(script);
  });
}
async function loadLibDC(options) {
  const baseUrl = options?.baseUrl?.replace(/\/+$/, "") ?? defaultBaseUrl;
  if (baseUrl === defaultBaseUrl && modulePromise) return modulePromise;
  const promise = (async () => {
    const createLibDC = await loadEmscriptenFactory(baseUrl);
    const module2 = await createLibDC({
      locateFile: (path) => {
        if (path.endsWith(".wasm")) {
          return `${baseUrl}/libdc.wasm`;
        }
        return path;
      }
    });
    if (!module2.HEAPU8 || !module2._libdc_parse_dive) {
      throw new Error("WASM module failed to initialize \u2014 HEAPU8 or exports missing");
    }
    return module2;
  })();
  if (baseUrl === defaultBaseUrl) {
    modulePromise = promise;
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return promise;
}
async function isLibDCAvailable(options) {
  const baseUrl = options?.baseUrl?.replace(/\/+$/, "") ?? defaultBaseUrl;
  try {
    const resp = await fetch(`${baseUrl}/libdc.wasm`, { method: "HEAD" });
    return resp.ok;
  } catch {
    return false;
  }
}

// src/libdc-parser.ts
var DC_FAMILY = {
  NULL: 0,
  // Suunto
  SUUNTO_SOLUTION: 1 << 16,
  SUUNTO_EON: (1 << 16) + 1,
  SUUNTO_VYPER: (1 << 16) + 2,
  SUUNTO_VYPER2: (1 << 16) + 3,
  SUUNTO_D9: (1 << 16) + 4,
  SUUNTO_EONSTEEL: (1 << 16) + 5,
  // Reefnet
  REEFNET_SENSUS: 2 << 16,
  REEFNET_SENSUSPRO: (2 << 16) + 1,
  REEFNET_SENSUSULTRA: (2 << 16) + 2,
  // Uwatec / Scubapro
  UWATEC_ALADIN: 3 << 16,
  UWATEC_MEMOMOUSE: (3 << 16) + 1,
  UWATEC_SMART: (3 << 16) + 2,
  // Oceanic / Pelagic
  OCEANIC_VTPRO: 4 << 16,
  OCEANIC_VEO250: (4 << 16) + 1,
  OCEANIC_ATOM2: (4 << 16) + 2,
  PELAGIC_I330R: (4 << 16) + 3,
  // Mares
  MARES_NEMO: 5 << 16,
  MARES_PUCK: (5 << 16) + 1,
  MARES_DARWIN: (5 << 16) + 2,
  MARES_ICONHD: (5 << 16) + 3,
  // Heinrichs Weikamp
  HW_OSTC: 6 << 16,
  HW_FROG: (6 << 16) + 1,
  HW_OSTC3: (6 << 16) + 2,
  // Cressi
  CRESSI_EDY: 7 << 16,
  CRESSI_LEONARDO: (7 << 16) + 1,
  CRESSI_GOA: (7 << 16) + 2,
  // Zeagle
  ZEAGLE_N2ITION3: 8 << 16,
  // Atomic Aquatics
  ATOMICS_COBALT: 9 << 16,
  // Shearwater
  SHEARWATER_PREDATOR: 10 << 16,
  SHEARWATER_PETREL: (10 << 16) + 1,
  // Dive Rite
  DIVERITE_NITEKQ: 11 << 16,
  // Citizen
  CITIZEN_AQUALAND: 12 << 16,
  // DiveSystem
  DIVESYSTEM_IDIVE: 13 << 16,
  // Cochran
  COCHRAN_COMMANDER: 14 << 16,
  // Tecdiving
  TECDIVING_DIVECOMPUTEREU: 15 << 16,
  // McLean
  MCLEAN_EXTREME: 16 << 16,
  // Liquivision
  LIQUIVISION_LYNX: 17 << 16,
  // Sporasub
  SPORASUB_SP2: 18 << 16,
  // Deep Six
  DEEPSIX_EXCURSION: 19 << 16,
  // Seac
  SEAC_SCREEN: 20 << 16,
  // Deepblu
  DEEPBLU_COSMIQ: 21 << 16,
  // Oceans
  OCEANS_S1: 22 << 16,
  // Divesoft
  DIVESOFT_FREEDOM: 23 << 16,
  // Halcyon
  HALCYON_SYMBIOS: 24 << 16
};
function formatGasName2(o2Pct, hePct) {
  if (hePct > 0) return `Trimix ${o2Pct}/${hePct}`;
  if (o2Pct === 21) return "Air";
  if (o2Pct === 100) return "O2";
  return `EAN${o2Pct}`;
}
function formatDecoModel(dm) {
  if (!dm) return void 0;
  let s = dm.type;
  if (dm.gfLow !== void 0 && dm.gfHigh !== void 0 && dm.gfLow > 0) {
    s += ` GF ${dm.gfLow}/${dm.gfHigh}`;
  }
  return s;
}
function hashRawData2(raw, serial, timestamp) {
  const parts = [serial, timestamp.toString(), raw.length.toString()];
  const head = raw.slice(0, Math.min(64, raw.length));
  const tail = raw.slice(Math.max(0, raw.length - 64));
  for (const b of head) parts.push(b.toString(16));
  for (const b of tail) parts.push(b.toString(16));
  const str = parts.join(":");
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i) >>> 0;
  }
  return `ble-${serial}-${timestamp}-${hash.toString(16)}`;
}
async function callWasmParser(raw, family, model) {
  const module2 = await loadLibDC();
  const dataPtr = module2._malloc(raw.length);
  if (dataPtr === 0) {
    throw new Error("WASM: Failed to allocate memory");
  }
  try {
    module2.HEAPU8.set(raw, dataPtr);
    const resultPtr = module2._libdc_parse_dive(dataPtr, raw.length, family, model);
    if (resultPtr === 0) {
      throw new Error("WASM: libdc_parse_dive returned null");
    }
    const jsonStr = module2.UTF8ToString(resultPtr);
    module2._libdc_free_result(resultPtr);
    const result = JSON.parse(jsonStr);
    if (result.error) {
      throw new Error(`libdivecomputer: ${result.error}`);
    }
    return result;
  } finally {
    module2._free(dataPtr);
  }
}
function convertToParseResult(r, raw, opts) {
  const gasMixes = (r.gasMixes || []).map((gm) => {
    const o2Pct = Math.round(gm.oxygen * 100);
    const hePct = Math.round(gm.helium * 100);
    return {
      oxygen: gm.oxygen,
      helium: gm.helium,
      nitrogen: gm.nitrogen,
      name: formatGasName2(o2Pct, hePct)
    };
  });
  const cylinders = (r.tanks || []).map((tk, i) => {
    const gasMix = tk.gasmix !== 4294967295 && tk.gasmix < gasMixes.length ? gasMixes[tk.gasmix] : { oxygen: 0.21, helium: 0, nitrogen: 0.79, name: "Air" };
    return {
      index: i,
      gasMix,
      sizeInLiters: tk.volume > 0 ? tk.volume : void 0,
      workPressureBar: tk.workpressure > 0 ? tk.workpressure : void 0,
      startPressureBar: tk.beginpressure > 0 ? tk.beginpressure : void 0,
      endPressureBar: tk.endpressure > 0 ? tk.endpressure : void 0
    };
  });
  if (cylinders.length === 0 && gasMixes.length > 0) {
    gasMixes.forEach((gm, i) => {
      cylinders.push({ index: i, gasMix: gm });
    });
  }
  const samples = (r.samples || []).map((s) => {
    const sample = {
      timeSeconds: s.timeSeconds,
      depthMeters: s.depthMeters
    };
    if (s.temperatureCelsius !== void 0)
      sample.temperatureCelsius = s.temperatureCelsius;
    if (s.pressureBar !== void 0) sample.pressureBar = s.pressureBar;
    if (s.ppo2 !== void 0) sample.ppo2 = s.ppo2;
    if (s.setpoint !== void 0) sample.setpoint = s.setpoint;
    if (s.cns !== void 0) sample.cnsPercent = Math.round(s.cns * 100);
    if (s.heartbeat !== void 0) sample.heartRateBpm = s.heartbeat;
    if (s.rbt !== void 0) sample.rbtSeconds = s.rbt;
    if (s.bearing !== void 0) sample.bearingDegrees = s.bearing;
    if (s.pressures && s.pressures.length > 0) {
      sample.tankPressures = s.pressures.filter((p) => p.bar > 0);
    }
    if (s.deco) {
      if (s.deco.type === "ndl") {
        sample.ndlSeconds = s.deco.time;
      } else {
        if (s.deco.depth > 0) sample.ceilingMeters = s.deco.depth;
        if (s.deco.tts > 0) sample.ttsSeconds = s.deco.tts;
      }
    }
    return sample;
  });
  const events = [];
  if (r.samples) {
    let lastGasmix;
    for (const s of r.samples) {
      if (s.gasmix !== void 0 && s.gasmix !== lastGasmix) {
        if (lastGasmix !== void 0) {
          const mix = gasMixes[s.gasmix];
          events.push({
            timeSeconds: s.timeSeconds,
            type: "GAS_SWITCH",
            description: mix ? `Switch to ${mix.name}` : `Switch to mix ${s.gasmix}`,
            value: s.gasmix
          });
        }
        lastGasmix = s.gasmix;
      }
    }
  }
  let sampleIntervalSeconds;
  if (samples.length >= 2) {
    sampleIntervalSeconds = samples[1].timeSeconds - samples[0].timeSeconds;
  }
  const startTime = r.datetime || new Date(opts.timestamp * 1e3).toISOString();
  const timezoneOffset = r.timezoneOffsetSeconds !== void 0 ? Math.round(r.timezoneOffsetSeconds / 60) : void 0;
  let maxCns;
  for (const s of samples) {
    if (s.cnsPercent !== void 0 && s.cnsPercent !== null) {
      if (maxCns === void 0 || s.cnsPercent > maxCns) {
        maxCns = s.cnsPercent;
      }
    }
  }
  const durationSeconds = r.diveTimeSeconds || (samples.length > 0 ? samples[samples.length - 1].timeSeconds : 0);
  const gradientFactorLow = r.decoModel?.gfLow !== void 0 && r.decoModel.gfLow > 0 ? r.decoModel.gfLow : void 0;
  const gradientFactorHigh = r.decoModel?.gfHigh !== void 0 && r.decoModel.gfHigh > 0 ? r.decoModel.gfHigh : void 0;
  const decoStops = [];
  {
    let currentCeiling = null;
    let stopStart = 0;
    for (let i = 0; i < samples.length; i++) {
      const ceil = samples[i].ceilingMeters;
      if (ceil != null && ceil > 0) {
        const depth = Math.round(ceil);
        if (currentCeiling !== depth) {
          if (currentCeiling !== null) {
            const dur = samples[i].timeSeconds - stopStart;
            const existing = decoStops.find((s) => s.depthMeters === currentCeiling);
            if (existing) existing.durationSeconds += dur;
            else decoStops.push({ depthMeters: currentCeiling, durationSeconds: dur });
          }
          currentCeiling = depth;
          stopStart = samples[i].timeSeconds;
        }
      } else if (currentCeiling !== null) {
        const dur = samples[i].timeSeconds - stopStart;
        const existing = decoStops.find((s) => s.depthMeters === currentCeiling);
        if (existing) existing.durationSeconds += dur;
        else decoStops.push({ depthMeters: currentCeiling, durationSeconds: dur });
        currentCeiling = null;
      }
    }
    if (currentCeiling !== null && samples.length > 0) {
      const dur = samples[samples.length - 1].timeSeconds - stopStart;
      const existing = decoStops.find((s) => s.depthMeters === currentCeiling);
      if (existing) existing.durationSeconds += dur;
      else decoStops.push({ depthMeters: currentCeiling, durationSeconds: dur });
    }
    decoStops.sort((a, b) => b.depthMeters - a.depthMeters);
  }
  let totalOtu;
  if (samples.some((s) => s.ppo2 != null)) {
    let otuSum = 0;
    for (let i = 1; i < samples.length; i++) {
      const ppo2 = samples[i].ppo2;
      if (ppo2 != null && ppo2 > 0.5) {
        const dt = (samples[i].timeSeconds - samples[i - 1].timeSeconds) / 60;
        otuSum += Math.pow((ppo2 - 0.5) / 0.5, 0.83) * dt;
      }
    }
    if (otuSum > 0) totalOtu = Math.round(otuSum);
  }
  const salinityDensity = r.salinity?.density;
  const atmosphericPressureBar = r.atmosphericPressureBar;
  const rawDataHash = hashRawData2(raw, opts.serial, opts.timestamp);
  return {
    sourceFormat: opts.sourceFormat,
    sourceFileName: opts.sourceFileName,
    diveNumberInFile: opts.diveNumber,
    startTime,
    timezoneOffset,
    durationSeconds,
    maxDepthMeters: r.maxDepthMeters || 0,
    meanDepthMeters: r.avgDepthMeters,
    diveMode: r.diveMode || "OC",
    minTemperatureCelsius: r.minTemperatureCelsius,
    maxTemperatureCelsius: r.maxTemperatureCelsius,
    waterTemperatureCelsius: r.minTemperatureCelsius,
    site: r.location ? { latitude: r.location.latitude, longitude: r.location.longitude } : void 0,
    computer: opts.computer,
    cylinders,
    samples,
    sampleIntervalSeconds,
    events,
    decoModel: formatDecoModel(r.decoModel),
    gradientFactorLow,
    gradientFactorHigh,
    maxCnsPercent: maxCns,
    totalOtu,
    decoStops: decoStops.length > 0 ? decoStops : void 0,
    salinityDensity,
    atmosphericPressureBar,
    rawDataHash,
    parseWarnings: [],
    isPartial: false
  };
}
function extractShearwaterBattery(raw, modelId) {
  if (modelId <= 2 || raw.length < 32) return void 0;
  const BLOCK_SIZE = 32;
  const HEADER_SIZE = 6;
  const PRESSURE_OFFSET = 14;
  let worstState = 0;
  for (let offset = HEADER_SIZE; offset + BLOCK_SIZE <= raw.length; offset += BLOCK_SIZE) {
    const pressureWord = raw[offset + PRESSURE_OFFSET] << 8 | raw[offset + PRESSURE_OFFSET + 1];
    const batteryBits = pressureWord >> 12 & 15;
    if (batteryBits === 1) {
      worstState = 1;
      break;
    }
    if (batteryBits === 2 && worstState < 2) {
      worstState = 2;
    }
  }
  const stateMap = {
    0: "normal",
    1: "critical",
    2: "warning"
  };
  return { state: stateMap[worstState] };
}
async function parseDiveWasm(raw, family, model, computer, options = {}) {
  const result = await callWasmParser(raw, family, model);
  return convertToParseResult(result, raw, {
    sourceFormat: options.sourceFormat || "SHEARWATER_BLE",
    sourceFileName: options.sourceFileName || `ble://${computer.serial || "unknown"}`,
    diveNumber: options.diveNumber ?? 0,
    timestamp: options.timestamp ?? Math.floor(Date.now() / 1e3),
    serial: options.serial || computer.serial || "unknown",
    computer
  });
}
async function parseShearwaterDiveWasm(raw, deviceInfo, manifestEntry) {
  const family = deviceInfo.modelId <= 2 ? DC_FAMILY.SHEARWATER_PREDATOR : DC_FAMILY.SHEARWATER_PETREL;
  const result = await callWasmParser(raw, family, deviceInfo.modelId);
  const dive = convertToParseResult(result, raw, {
    sourceFormat: "SHEARWATER_BLE",
    sourceFileName: `ble://${deviceInfo.serial}`,
    diveNumber: manifestEntry.index,
    timestamp: manifestEntry.timestamp,
    serial: deviceInfo.serial,
    computer: {
      manufacturer: "Shearwater",
      model: deviceInfo.model,
      serial: deviceInfo.serial,
      firmwareVersion: deviceInfo.firmware
    }
  });
  const battery = extractShearwaterBattery(raw, deviceInfo.modelId);
  if (battery) {
    dive.batteryState = battery.state;
    if (battery.percent !== void 0) dive.batteryPercent = battery.percent;
  }
  return dive;
}
async function getAvailableDevices() {
  const module2 = await loadLibDC();
  const resultPtr = module2._libdc_list_descriptors();
  if (resultPtr === 0) {
    return [];
  }
  const jsonStr = module2.UTF8ToString(resultPtr);
  module2._libdc_free_result(resultPtr);
  return JSON.parse(jsonStr);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CMD_NAK,
  CMD_RDBI_REQUEST,
  CMD_RDBI_RESPONSE,
  CMD_TESTER_PRESENT,
  DC_FAMILY,
  DEVICE_MODELS,
  LOG_BLOCK,
  LOG_BLOCK_RESPONSE,
  LOG_INIT,
  LOG_INIT_RESPONSE,
  LOG_QUIT,
  LOG_QUIT_RESPONSE,
  MANIFEST_ADDRESS,
  MANIFEST_DELETED,
  MANIFEST_ENTRY_SIZE,
  MANIFEST_SIZE,
  MANIFEST_VALID,
  PACKET_TIMEOUT_MS,
  RDBI_FIRMWARE,
  RDBI_HARDWARE,
  RDBI_LOGUPLOAD,
  RDBI_SERIAL,
  SHEARWATER_CHAR_UUID,
  SHEARWATER_SERVICE_UUID,
  SLIP_END,
  SLIP_ESC,
  SLIP_ESC_END,
  SLIP_ESC_ESC,
  ShearwaterBle,
  ShearwaterProtocol,
  SlipDecoder,
  configureLibDC,
  getAvailableDevices,
  isLibDCAvailable,
  loadLibDC,
  parseDiveWasm,
  parseShearwaterDive,
  parseShearwaterDiveWasm,
  slipEncode
});
//# sourceMappingURL=index.cjs.map