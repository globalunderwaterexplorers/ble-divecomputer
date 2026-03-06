/// <reference path="./web-bluetooth.d.ts" />

import {
  SHEARWATER_SERVICE_UUID,
  SHEARWATER_CHAR_UUID,
  PACKET_TIMEOUT_MS,
} from './constants';
import { slipEncode, SlipDecoder } from './slip';

// Shearwater packet header bytes
const REQ_HEADER_0 = 0xff;
const REQ_HEADER_1 = 0x01;
const RES_HEADER_0 = 0x01;
const RES_HEADER_1 = 0xff;

// BLE frame size: 2-byte header + up to 30 bytes payload = 32 bytes max
const BLE_FRAME_SIZE = 32;
const BLE_PAYLOAD_SIZE = BLE_FRAME_SIZE - 2;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _log = (..._args: any[]) => {}; // disabled — too noisy for BLE
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _warn = (...args: any[]) => console.warn('[SW-BLE]', ...args);
const hex = (arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');

/**
 * Low-level BLE transport for Shearwater dive computers.
 * Handles GATT connection, SLIP framing, BLE frame headers, and packet send/receive.
 *
 * Reference: libdivecomputer (https://github.com/libdivecomputer/libdivecomputer)
 *   - src/shearwater_common.c: shearwater_common_slip_write(), shearwater_common_slip_read()
 *
 * BLE frame format (each BLE write/notification):
 *   [frame_count, frame_number, ...SLIP_payload]
 *   Max 32 bytes per BLE write (2 header + 30 payload)
 *
 * Shearwater packet format (host → device, inside SLIP):
 *   [0xFF, 0x01, length, 0x00, ...command_data]
 *   length = command_data.length + 1
 *
 * Shearwater packet format (device → host, inside SLIP):
 *   [0x01, 0xFF, length, 0x00, ...response_data]
 *   response_data has length - 1 bytes
 */
export class ShearwaterBle {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private slipDecoder = new SlipDecoder();
  private pendingResponse: {
    resolve: (data: Uint8Array) => void;
    reject: (err: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;
  /** Queue for responses that arrive before sendPacket sets up pendingResponse */
  private responseQueue: Uint8Array[] = [];
  private disconnectCallback: (() => void) | null = null;
  private useWriteWithResponse = false;
  // Mutex: only one sendPacket at a time (protocol is request/response)
  private sendMutex: Promise<void> = Promise.resolve();

  get connected(): boolean {
    return this.device?.gatt?.connected === true;
  }

  get deviceName(): string | undefined {
    return this.device?.name ?? undefined;
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCallback = cb;
  }

  /**
   * Request a Shearwater device via Web Bluetooth and connect.
   */
  async connect(): Promise<BluetoothDevice> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is not supported in this browser');
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SHEARWATER_SERVICE_UUID] }],
    });

    this.device.addEventListener('gattserverdisconnected', () => {
      this.cleanup();
      this.disconnectCallback?.();
    });

    const server = await this.device.gatt!.connect();
    _log('GATT connected');
    const service = await server.getPrimaryService(SHEARWATER_SERVICE_UUID);
    _log('Service found');
    this.characteristic = await service.getCharacteristic(SHEARWATER_CHAR_UUID);
    _log('Characteristic found');

    // Detect which write method to use
    const props = this.characteristic.properties;
    _log('Characteristic properties:', {
      write: props.write,
      writeWithoutResponse: props.writeWithoutResponse,
      notify: props.notify,
      indicate: props.indicate,
      read: props.read,
    });

    // Use write-with-response for BLE flow control reliability.
    // write-without-response can overwhelm the device during sustained transfers,
    // causing the device to stop responding after 15-20 seconds.
    // Fall back to write-without-response only if write-with-response is unavailable.
    this.useWriteWithResponse = props.write;
    if (!this.useWriteWithResponse && props.writeWithoutResponse) {
      this.useWriteWithResponse = false;
    }
    _log('Using write method:', this.useWriteWithResponse ? 'writeValueWithResponse' : 'writeValueWithoutResponse');

    await this.characteristic.startNotifications();
    _log('Notifications started');
    this.characteristic.addEventListener(
      'characteristicvaluechanged',
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
  async sendPacket(data: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
    // Acquire mutex — wait for any previous send to complete
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const prev = this.sendMutex;
    this.sendMutex = gate;
    await prev;

    try {
      return await this._sendPacketInner(data, timeoutMs);
    } finally {
      release();
    }
  }

  private async _sendPacketInner(data: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
    if (!this.characteristic) {
      throw new Error('Not connected');
    }

    // Check if a response was already queued (from a late-arriving notification)
    if (this.responseQueue.length > 0) {
      const queued = this.responseQueue.shift()!;
      _log('Using queued response:', hex(queued));
      return queued;
    }

    // Build packet: [0xFF, 0x01, length, 0x00, ...data]
    // length = data.length + 1 (per libdivecomputer convention)
    const length = data.length + 1;
    const packet = new Uint8Array(4 + data.length);
    packet[0] = REQ_HEADER_0;
    packet[1] = REQ_HEADER_1;
    packet[2] = length & 0xff;
    packet[3] = 0x00;
    packet.set(data, 4);

    const encoded = slipEncode(packet);

    _log('TX packet:', hex(packet));
    _log('TX SLIP-encoded:', hex(encoded), `(${encoded.length} bytes)`);

    // Set up response listener BEFORE writing to avoid race condition
    const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponse = null;
        _warn('TIMEOUT waiting for response');
        reject(new Error('Response timeout'));
      }, timeoutMs ?? PACKET_TIMEOUT_MS);

      this.pendingResponse = { resolve, reject, timeout };
    });

    // Fragment SLIP data into BLE frames with 2-byte header [frame_count, frame_number]
    // Per libdivecomputer shearwater_common_slip_write:
    //   nframes = ceil(slip_encoded_bytes / 32)
    //   Each frame: [nframes, frame_number, ...up to 30 bytes of SLIP data]
    // Note: libdivecomputer calculates nframes using the full 32-byte buffer size
    // (not the 30-byte payload), matching how the device firmware expects it.
    const nframes = Math.ceil(encoded.length / BLE_FRAME_SIZE);
    _log('TX BLE frames:', nframes);

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
    _log('Write completed');

    return responsePromise;
  }

  /**
   * Reset the SLIP decoder, discarding any buffered partial data.
   * Call between transfers to ensure clean state.
   */
  resetDecoder(): void {
    this.slipDecoder.reset();
    this.responseQueue = [];
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.characteristic) {
      try {
        this.characteristic.removeEventListener(
          'characteristicvaluechanged',
          this.handleNotification
        );
      } catch {
        // ignore
      }
    }
    if (this.pendingResponse) {
      clearTimeout(this.pendingResponse.timeout);
      this.pendingResponse.reject(new Error('Disconnected'));
      this.pendingResponse = null;
    }
    this.characteristic = null;
    this.slipDecoder.reset();
    this.responseQueue = [];
  }

  /**
   * Handle incoming BLE notification.
   * Ref: shearwater_common_slip_read() in libdivecomputer src/shearwater_common.c
   */
  private handleNotification = (event: Event): void => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const value = target.value;
    if (!value) {
      _log('RX notification: no value');
      return;
    }

    const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    _log('RX raw notification:', hex(raw), `(${raw.length} bytes)`);

    // Strip the 2-byte BLE frame header [frame_count, frame_number]
    // per libdivecomputer shearwater_common_slip_read: offset = (BLE) ? 2 : 0
    if (raw.length <= 2) {
      _log('RX notification too short (no data after BLE header)');
      return;
    }
    _log(`RX BLE header: frame_count=${raw[0]}, frame_number=${raw[1]}`);
    const chunk = raw.slice(2);

    const frames = this.slipDecoder.feed(chunk);
    _log('SLIP decoded frames:', frames.length);

    for (const frame of frames) {
      _log('RX frame:', hex(frame), `(${frame.length} bytes)`);

      // Response header: [0x01, 0xFF, length, 0x00, ...payload]
      // Minimum valid frame = 4 bytes header
      if (frame.length < 4) {
        _log('Frame too short, skipping');
        continue;
      }

      // Validate response header
      if (frame[0] !== RES_HEADER_0 || frame[1] !== RES_HEADER_1 || frame[3] !== 0x00) {
        _warn('Frame header mismatch:', {
          byte0: frame[0].toString(16),
          byte1: frame[1].toString(16),
          byte3: frame[3].toString(16),
          expected: `${RES_HEADER_0.toString(16)} ${RES_HEADER_1.toString(16)} xx 00`,
        });
        continue;
      }

      // Extract payload (everything after the 4-byte header)
      const payload = frame.slice(4);
      _log('RX payload:', hex(payload));

      if (this.pendingResponse) {
        const { resolve, timeout } = this.pendingResponse;
        clearTimeout(timeout);
        this.pendingResponse = null;
        resolve(payload);
      } else {
        // Queue the response — it may arrive before the next sendPacket sets up pendingResponse
        _warn('Received frame but no pending response, queuing');
        this.responseQueue.push(payload);
      }
    }
  };
}
