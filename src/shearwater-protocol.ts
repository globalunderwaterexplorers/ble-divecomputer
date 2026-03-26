import {
  CMD_TESTER_PRESENT,
  CMD_RDBI_REQUEST,
  CMD_RDBI_RESPONSE,
  CMD_NAK,
  RDBI_SERIAL,
  RDBI_FIRMWARE,
  RDBI_HARDWARE,
  RDBI_LOGUPLOAD,
  RDBI_DEVICE_TYPE,
  RDBI_BOOTLOADER,
  RDBI_LOG_STATUS,
  LOG_INIT,
  LOG_BLOCK,
  LOG_QUIT,
  LOG_INIT_RESPONSE,
  LOG_BLOCK_RESPONSE,
  MANIFEST_ADDRESS,
  MANIFEST_SIZE,
  MANIFEST_ENTRY_SIZE,
  MANIFEST_VALID,
  MANIFEST_DELETED,
  DEVICE_MODELS,
} from './constants';
import type {
  ShearwaterDeviceInfo,
  ManifestEntry,
  ShearwaterRdbiProbeRecord,
  ShearwaterConfigSnapshot,
  ShearwaterCapabilities,
} from './types';
import { ShearwaterBle } from './shearwater-ble';

/**
 * High-level Shearwater protocol: device info, manifest, and dive download.
 *
 * Reference: libdivecomputer (https://github.com/libdivecomputer/libdivecomputer)
 *   - src/shearwater_common.c: shearwater_common_download(), shearwater_common_decompress()
 *   - src/shearwater_petrel.c: shearwater_petrel_device_open(), shearwater_petrel_device_foreach()
 *
 * Commands are passed to ShearwaterBle.sendPacket() which handles
 * the transport header ([0xFF, 0x01, len, 0x00]) and SLIP framing.
 * The responses returned by sendPacket() have the transport header
 * already stripped — they start directly with the command response byte.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _log = (..._args: any[]) => {}; // verbose — disabled
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _info = (...args: any[]) => console.log('[SW]', ...args); // milestones only
const _diagnosticsEnabled =
  typeof globalThis !== 'undefined' &&
  ((globalThis as Record<string, unknown>).DEBUG_BLE_DIAGNOSTICS === true ||
    (globalThis as Record<string, unknown>).DEBUG_BLE_DIAGNOSTICS === 'true');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _diag = (...args: any[]) => {
  if (_diagnosticsEnabled) console.error(...args);
};
const MANIFEST_RECORD_COUNT = MANIFEST_SIZE / MANIFEST_ENTRY_SIZE;
const KNOWN_RDBI_LABELS: Record<number, string> = {
  [RDBI_DEVICE_TYPE]: 'Device type',
  [RDBI_SERIAL]: 'Serial',
  [RDBI_FIRMWARE]: 'Firmware',
  [RDBI_BOOTLOADER]: 'Bootloader',
  [RDBI_LOG_STATUS]: 'Log status',
  [RDBI_LOGUPLOAD]: 'Log upload base address',
  [RDBI_HARDWARE]: 'Hardware',
};

export class ShearwaterProtocol {
  private baseAddr = 0;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private transferActive = false;
  private keepAliveFailures = 0;

  constructor(private ble: ShearwaterBle) {}

  /**
   * Some Shearwater devices need a brief pause after GATT connect before the
   * first protocol request, otherwise the initial RDBI often times out.
   */
  async waitForReady(delayMs = 500): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  /** BLE advertised device name (e.g. "Perdix AI 12345") — fallback for model display */
  get bleDeviceName(): string | undefined {
    return this.ble.deviceName;
  }

  /**
   * Start periodic keepalive pings to prevent the dive computer from
   * exiting its UDS diagnostic session during idle periods.
   * Uses ISO 14229 TesterPresent (0x3E) — the standard UDS session
   * keepalive — every 4 seconds.  Pauses during active data transfers.
   * Stops automatically after 3 consecutive failures to avoid flooding
   * the console with timeout warnings.
   */
  startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveFailures = 0;
    const ping = async () => {
      // Check before AND after — pings queued in the mutex may outlive stopKeepAlive()
      if (!this.keepAliveTimer || this.transferActive || !this.ble.connected) return;
      try {
        // TesterPresent: [0x3E, 0x00] → response [0x7E, 0x00]
        // Short timeout (2s) so a failed ping doesn't block the mutex for long
        await this.ble.sendPacket(new Uint8Array([CMD_TESTER_PRESENT, 0x00]), 2_000);
        this.keepAliveFailures = 0;
      } catch {
        this.keepAliveFailures++;
        if (this.keepAliveFailures >= 3) {
          _info('Keepalive stopped after 3 consecutive failures — device unresponsive');
          this.stopKeepAlive();
          return;
        }
      }
    };
    // Fire one immediately, then every 4 seconds
    ping();
    this.keepAliveTimer = setInterval(ping, 4_000);
  }

  stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * Read device info via RDBI commands.
   * Retries the first RDBI if it times out — some devices need time after GATT connect.
   */
  async getDeviceInfo(): Promise<ShearwaterDeviceInfo> {
    let serialData: Uint8Array;
    try {
      serialData = await this.rdbi(RDBI_SERIAL);
    } catch {
      // First packet after BLE connect often times out — retry once after a delay
      _info('First RDBI timed out, retrying after 1s...');
      await new Promise(r => setTimeout(r, 1_000));
      this.ble.resetDecoder();
      serialData = await this.rdbi(RDBI_SERIAL);
    }
    const firmwareData = await this.rdbi(RDBI_FIRMWARE);
    const hardwareData = await this.rdbi(RDBI_HARDWARE);

    const serial = this.decodeAscii(serialData).trim();
    const firmware = this.decodeFirmwareVersion(firmwareData);
    const hardware = this.decodeAscii(hardwareData).trim();

    // Model ID is the first byte of the hardware response
    const modelId = hardwareData.length > 0 ? hardwareData[0] : 0;
    // RDBI_HARDWARE may return a hardware revision byte (e.g. 141) that doesn't
    // map to a dive computer model. Fall back to BLE advertised device name.
    let model = DEVICE_MODELS[modelId];
    if (!model) {
      const bleName = this.ble.deviceName;
      // BLE name is typically "Perdix AI 12345" — strip trailing serial digits
      model = bleName ? bleName.replace(/\s+\d{4,}$/, '').trim() : `Unknown (${modelId})`;
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
  async readBaseAddr(): Promise<number> {
    const data = await this.rdbi(RDBI_LOGUPLOAD);
    _log('RDBI_LOGUPLOAD response:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));

    if (data.length < 5) {
      _log('RDBI_LOGUPLOAD response too short, defaulting to 0xC0000000');
      this.baseAddr = 0xC0000000;
      return this.baseAddr;
    }

    // base_addr is at bytes 1-4 (big-endian) of the response data
    const raw = ((data[1] << 24) | (data[2] << 16) | (data[3] << 8) | data[4]) >>> 0;
    _log('Raw base_addr:', '0x' + raw.toString(16));

    switch (raw) {
      case 0xDD000000:
      case 0xC0000000:
      case 0x90000000:
        this.baseAddr = 0xC0000000;
        break;
      case 0x80000000:
        this.baseAddr = 0x80000000;
        break;
      default:
        _log('Unknown base_addr format, using raw value:', '0x' + raw.toString(16));
        this.baseAddr = raw;
    }

    _log('Using base_addr:', '0x' + this.baseAddr.toString(16));
    return this.baseAddr;
  }

  /**
   * Read the dive manifest from flash memory.
   * Ref: shearwater_petrel_device_foreach() in libdivecomputer src/shearwater_petrel.c
   * Returns entries sorted by timestamp descending (most recent first).
   */
  async getManifest(): Promise<ManifestEntry[]> {
    // Read base address before manifest — needed for dive downloads
    await this.readBaseAddr();

    const entries: ManifestEntry[] = [];
    const seenManifestPages = new Set<string>();
    const seenEntries = new Set<string>();

    while (true) {
      const data = await this.readMemory(MANIFEST_ADDRESS, MANIFEST_SIZE);
      const pageSignature = this.getManifestPageSignature(data);
      if (seenManifestPages.has(pageSignature)) {
        _info('Manifest page repeated; stopping pagination.');
        break;
      }
      seenManifestPages.add(pageSignature);

      const page = this.parseManifestPage(data, seenEntries);
      entries.push(...page.entries);

      _info(
        `Manifest page: ${page.validSlots} valid, ${page.deletedSlots} deleted, ${page.entries.length} new entries`
      );

      // Match libdivecomputer: a non-full page means there are no older manifest pages.
      if (page.validSlots + page.deletedSlots !== MANIFEST_RECORD_COUNT) break;
    }

    // Sort by timestamp descending (most recent first)
    entries.sort((a, b) => b.timestamp - a.timestamp);

    // Re-index after sort
    entries.forEach((e, i) => { e.index = i; });

    return entries;
  }

  private parseManifestPage(
    data: Uint8Array,
    seenEntries: Set<string>
  ): { entries: ManifestEntry[]; validSlots: number; deletedSlots: number } {
    const entries: ManifestEntry[] = [];
    let validSlots = 0;
    let deletedSlots = 0;

    // Manifest entry format (32 bytes, big-endian):
    //   Offset 0-1:   marker (0xA5C4 = valid, 0x5A23 = deleted)
    //   Offset 2-3:   dive number
    //   Offset 4-7:   start timestamp (Unix epoch)
    //   Offset 8-11:  end timestamp (Unix epoch)
    //   Offset 20-23: flash start address
    //   Offset 24-27: flash end address
    //   Size = endAddress - startAddress
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

      _log(`Manifest entry: dive#${diveNumber} addr=0x${address.toString(16)} endAddr=0x${endAddress.toString(16)} size=${size} ts=${timestamp} (${new Date(timestamp * 1000).toISOString()})`);

      entries.push({
        index: entries.length,
        diveNumber,
        address,
        size,
        timestamp,
        endTimestamp,
        valid: true,
      });
    }

    return { entries, validSlots, deletedSlots };
  }

  private getManifestPageSignature(data: Uint8Array): string {
    return Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private toHex(data: Uint8Array): string {
    return Array.from(data, byte => byte.toString(16).padStart(2, '0')).join(' ');
  }

  private decodeAsciiPreview(data: Uint8Array): string | undefined {
    const ascii = Array.from(data)
      .map(byte => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'))
      .join('')
      .replace(/\.+$/g, '')
      .trim();
    return ascii ? ascii : undefined;
  }

  /**
   * Diagnose download parameters by trying all combinations of
   * address, size, and compression to find what the device accepts.
   * Results are logged to the console.
   */
  async diagnoseDownload(entry: ManifestEntry): Promise<void> {
    const DIVE_SIZE = 0xFFFFFF;
    const tests = [
      { desc: 'raw addr, actual size, raw',        addr: entry.address,                             size: entry.size, comp: 0x00 },
      { desc: 'raw addr, DIVE_SIZE, raw',           addr: entry.address,                             size: DIVE_SIZE,  comp: 0x00 },
      { desc: 'base+addr, actual size, raw',        addr: (this.baseAddr + entry.address) >>> 0,     size: entry.size, comp: 0x00 },
      { desc: 'base+addr, DIVE_SIZE, raw',          addr: (this.baseAddr + entry.address) >>> 0,     size: DIVE_SIZE,  comp: 0x00 },
      { desc: 'raw addr, actual size, compressed',  addr: entry.address,                             size: entry.size, comp: 0x10 },
      { desc: 'raw addr, DIVE_SIZE, compressed',    addr: entry.address,                             size: DIVE_SIZE,  comp: 0x10 },
      { desc: 'base+addr, actual size, compressed', addr: (this.baseAddr + entry.address) >>> 0,     size: entry.size, comp: 0x10 },
      { desc: 'base+addr, DIVE_SIZE, compressed',   addr: (this.baseAddr + entry.address) >>> 0,     size: DIVE_SIZE,  comp: 0x10 },
    ];

    _diag('=== DOWNLOAD DIAGNOSTIC ===');
    _diag(`Entry: dive#${entry.diveNumber}, manifest addr=0x${entry.address.toString(16)}, size=${entry.size}, base_addr=0x${this.baseAddr.toString(16)}`);

    for (const test of tests) {
      try {
        const initCmd = new Uint8Array(10);
        initCmd[0] = LOG_INIT;
        initCmd[1] = test.comp;
        initCmd[2] = 0x34;
        initCmd[3] = (test.addr >> 24) & 0xff;
        initCmd[4] = (test.addr >> 16) & 0xff;
        initCmd[5] = (test.addr >> 8) & 0xff;
        initCmd[6] = test.addr & 0xff;
        initCmd[7] = (test.size >> 16) & 0xff;
        initCmd[8] = (test.size >> 8) & 0xff;
        initCmd[9] = test.size & 0xff;

        const hex = Array.from(initCmd).map(b => b.toString(16).padStart(2, '0')).join(' ');
        _diag(`TEST: ${test.desc} → cmd=[${hex}]`);

        const response = await this.ble.sendPacket(initCmd);

        if (response.length >= 1 && response[0] === CMD_NAK) {
          const nakCmd = response.length >= 2 ? response[1] : 0;
          const nakCode = response.length >= 3 ? response[2] : 0;
          _diag(`  FAIL: NAK cmd=0x${nakCmd.toString(16)}, code=0x${nakCode.toString(16)}`);
        } else if (response.length >= 1 && response[0] === LOG_INIT_RESPONSE) {
          _diag(`  SUCCESS! Response: ${Array.from(response).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
          // Clean up — send LOG_QUIT
          try {
            await this.ble.sendPacket(new Uint8Array([LOG_QUIT]));
          } catch { /* ignore */ }
        } else {
          _diag(`  UNKNOWN: ${Array.from(response).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        }
      } catch (e) {
        _diag(`  ERROR: ${e}`);
      }
    }

    _diag('=== END DIAGNOSTIC ===');
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
  async downloadDive(
    entry: ManifestEntry,
    onProgress?: (bytes: number) => void
  ): Promise<Uint8Array> {
    const DIVE_SIZE = 0xFFFFFF;
    const addr = (this.baseAddr + entry.address) >>> 0;
    // Set transferActive BEFORE logging/readMemory to prevent keepalive race
    this.transferActive = true;
    _info(`Download dive #${entry.diveNumber}: addr=0x${addr.toString(16)}`);
    return this.readMemory(addr, DIVE_SIZE, true, onProgress);
  }

  /**
   * Probe a range of RDBI identifiers and return successful responses.
   * Uses a short timeout (1.5s) per identifier so unsupported IDs fail fast
   * instead of blocking for the default 10s packet timeout.
   */
  async probeRdbiRange(startId = 0x8000, endId = 0x805f): Promise<ShearwaterRdbiProbeRecord[]> {
    const PROBE_TIMEOUT_MS = 1_500;
    const records: ShearwaterRdbiProbeRecord[] = [];

    for (let id = startId; id <= endId; id++) {
      try {
        const data = await this.rdbi(id, PROBE_TIMEOUT_MS);
        records.push({
          id,
          label: KNOWN_RDBI_LABELS[id],
          length: data.length,
          data,
          hex: this.toHex(data),
          ascii: this.decodeAsciiPreview(data),
        });
      } catch {
        // Skip unsupported or unreadable identifiers.
      }
    }

    return records;
  }

  /**
   * Read a configuration snapshot from the connected device.
   *
   * Probes the full RDBI range with a short timeout per identifier.
   * On current Shearwater firmware (tested: Perdix 2 V95 Classic), only
   * 7 identifiers respond — all related to device identity and log access.
   * Configuration data (gases, GF, transmitter pairings) is NOT available
   * via RDBI; it lives in the dive binary opening records instead.
   *
   * The raw records are preserved so Studio can display them for diagnostics
   * and detect if future firmware versions expose additional identifiers.
   */
  async getConfigurationSnapshot(deviceInfo: ShearwaterDeviceInfo): Promise<ShearwaterConfigSnapshot> {
    const rawRecords = await this.probeRdbiRange(0x8000, 0x805f);

    const capabilities: ShearwaterCapabilities = {
      hasExtendedRdbi: rawRecords.length > 4,
      hasBatteryStatus: false,
      hasAmbientPressure: false,
      hasGradientFactors: false,
      hasDecoModel: false,
      hasGasTable: false,
      hasTransmitterConfig: false,
    };

    return {
      capturedAt: new Date().toISOString(),
      capabilities,
      serial: deviceInfo.serial,
      firmware: deviceInfo.firmware,
      hardware: deviceInfo.hardware,
      model: deviceInfo.model,
      modelId: deviceInfo.modelId,
      gases: [],
      transmitters: [],
      rawRecords,
    };
  }

  /**
   * Send an RDBI (Read Data By Identifier) request.
   * Command: [0x22, id_hi, id_lo]
   * Response: [0x62, id_hi, id_lo, ...data]
   */
  private async rdbi(id: number, timeoutMs?: number): Promise<Uint8Array> {
    const cmd = new Uint8Array(3);
    cmd[0] = CMD_RDBI_REQUEST;
    cmd[1] = (id >> 8) & 0xff;
    cmd[2] = id & 0xff;

    const response = await this.ble.sendPacket(cmd, timeoutMs);

    if (response.length < 3 || response[0] !== CMD_RDBI_RESPONSE) {
      throw new Error(`Invalid RDBI response for 0x${id.toString(16)}`);
    }

    // Verify echoed ID matches
    const responseId = (response[1] << 8) | response[2];
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
  private async readMemory(
    address: number,
    size: number,
    compressed = false,
    onProgress?: (bytes: number) => void
  ): Promise<Uint8Array> {
    this.transferActive = true;
    try {
      return await this._readMemory(address, size, compressed, onProgress);
    } finally {
      this.transferActive = false;
    }
  }

  private async _readMemory(
    address: number,
    size: number,
    compressed = false,
    onProgress?: (bytes: number) => void
  ): Promise<Uint8Array> {
    // LOG_INIT: [0x35, compression_flag, 0x34, addr(4bytes), size(3bytes)]
    const initCmd = new Uint8Array(10);
    initCmd[0] = LOG_INIT;   // 0x35
    initCmd[1] = compressed ? 0x10 : 0x00;
    initCmd[2] = 0x34;       // transfer mode
    initCmd[3] = (address >> 24) & 0xff;
    initCmd[4] = (address >> 16) & 0xff;
    initCmd[5] = (address >> 8) & 0xff;
    initCmd[6] = address & 0xff;
    initCmd[7] = (size >> 16) & 0xff;
    initCmd[8] = (size >> 8) & 0xff;
    initCmd[9] = size & 0xff;

    const initResponse = await this.ble.sendPacket(initCmd);

    if (initResponse.length >= 1 && initResponse[0] === CMD_NAK) {
      const nakCmd = initResponse.length >= 2 ? initResponse[1] : 0;
      const nakCode = initResponse.length >= 3 ? initResponse[2] : 0;
      throw new Error(
        `Device rejected memory read at 0x${address.toString(16)} ` +
        `(NAK cmd=0x${nakCmd.toString(16)}, code=0x${nakCode.toString(16)})`
      );
    }
    if (initResponse.length < 1 || initResponse[0] !== LOG_INIT_RESPONSE) {
      throw new Error(
        `Failed to initiate memory read (got 0x${initResponse[0]?.toString(16) ?? 'empty'})`
      );
    }

    // response[1] = compression ack (0x10), response[2] = max block data size
    if (initResponse.length >= 3) {
      _info(`LOG_INIT OK: compression=0x${initResponse[1].toString(16)}, maxBlockSize=${initResponse[2]}`);
    }

    // LOG_BLOCK: [0x36, block_counter] — counter increments each block
    //
    // For compressed transfers, we decompress per-block (matching libdivecomputer).
    // This lets us detect the end-of-stream marker in the 9-bit LRE data and stop
    // requesting blocks BEFORE the device NAKs. If we request a block after the
    // compressed stream is done, the device sends NAK 0x24 (requestSequenceError)
    // and enters a broken state where LOG_QUIT and subsequent LOG_INIT fail.
    let blockNum = 1;
    let blockCount = 0;
    let compressedBytes = 0;
    const transferStart = Date.now();

    // For compressed: per-block LRE output accumulated here; XOR applied at end
    const lreOutput: number[] = [];
    let streamDone = false;

    // For uncompressed: raw chunks accumulated here
    const chunks: Uint8Array[] = [];

    while (compressedBytes < size && !streamDone) {
      const blockCmd = new Uint8Array(2);
      blockCmd[0] = LOG_BLOCK; // 0x36
      blockCmd[1] = blockNum & 0xff;

      const blockStart = Date.now();
      const blockResponse = await this.ble.sendPacket(blockCmd);
      const blockMs = Date.now() - blockStart;
      blockCount++;

      // NAK or unexpected response
      if (
        blockResponse.length < 2 ||
        blockResponse[0] !== LOG_BLOCK_RESPONSE ||
        blockResponse[1] !== blockNum
      ) {
        _info(`NAK at block #${blockCount} (ctr=${blockNum}), ${blockMs}ms, ${compressedBytes} bytes, ${((Date.now() - transferStart) / 1000).toFixed(1)}s, resp=[${Array.from(blockResponse.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
        if (compressed && compressedBytes > 0) break;
        throw new Error(
          `Failed to read block ${blockNum} at offset ${compressedBytes} ` +
          `(got 0x${blockResponse[0]?.toString(16) ?? 'empty'})`
        );
      }

      const blockData = blockResponse.slice(2);
      if (blockData.length === 0) {
        _info(`Empty block at #${blockCount}, done. ${compressedBytes} bytes`);
        break;
      }

      compressedBytes += blockData.length;

      if (compressed) {
        // Per-block LRE decompression (matching libdivecomputer decompress_lre).
        // Detects end-of-stream marker (9-bit value == 0) to stop requesting blocks.
        streamDone = this.decompressLreBlock(blockData, lreOutput);
      } else {
        chunks.push(blockData);
      }

      if (blockCount === 1 || blockCount % 50 === 0 || streamDone) {
        _info(`Block #${blockCount} (ctr=${blockNum}): ${compressedBytes} bytes, ${blockMs}ms, ${((Date.now() - transferStart) / 1000).toFixed(1)}s${streamDone ? ' [STREAM DONE]' : ''}`);
      }

      blockNum = (blockNum + 1) & 0xff;
      onProgress?.(compressedBytes);
    }

    // LOG_QUIT: [0x37]
    try {
      await this.ble.sendPacket(new Uint8Array([LOG_QUIT]));
    } catch {
      // Quit response is optional after NAK-terminated transfer
    }

    // Reset the SLIP decoder between transfers to clear any stale buffered data.
    this.ble.resetDecoder();

    // Settling delay before the next transfer.
    await new Promise(r => setTimeout(r, 200));

    if (compressed) {
      // Phase 2: XOR each 32-byte block with the previous block
      const result = new Uint8Array(lreOutput);
      for (let i = 32; i < result.length; i++) {
        result[i] ^= result[i - 32];
      }
      return result;
    }

    // Uncompressed: concatenate and return
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
  private decompressLreBlock(data: Uint8Array, output: number[]): boolean {
    const nbits = data.length * 8;
    // Total bits must be multiple of 9 (per libdivecomputer)
    // If not, we still process as many complete 9-bit values as possible

    let offset = 0;
    while (offset + 9 <= nbits) {
      const bytePos = offset >>> 3;
      const bitPos = offset & 7;
      const shift = 16 - (bitPos + 9);
      const value = ((data[bytePos] << 8 | (data[bytePos + 1] || 0)) >>> shift) & 0x1ff;

      if (value & 0x100) {
        // 9th bit set: literal byte
        output.push(value & 0xff);
      } else if (value === 0) {
        // End of compressed stream
        return true;
      } else {
        // Run of zero bytes
        for (let i = 0; i < value; i++) {
          output.push(0);
        }
      }

      offset += 9;
    }

    return false;
  }

  private decodeAscii(data: Uint8Array): string {
    return Array.from(data)
      .filter(b => b >= 0x20 && b <= 0x7e)
      .map(b => String.fromCharCode(b))
      .join('');
  }

  private decodeFirmwareVersion(data: Uint8Array): string {
    // Some firmware sends ASCII strings (e.g. "V93 Classic"),
    // others send numeric version bytes. Detect by checking if first byte is printable ASCII.
    if (data.length > 0 && data[0] >= 0x20 && data[0] <= 0x7e) {
      return this.decodeAscii(data).trim();
    }
    if (data.length >= 3) {
      return `${data[0]}.${data[1]}.${data[2]}`;
    }
    return this.decodeAscii(data).trim();
  }
}
