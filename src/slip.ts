import { SLIP_END, SLIP_ESC, SLIP_ESC_END, SLIP_ESC_ESC } from './constants';

/**
 * SLIP-encode a payload: escaped data + END
 *
 * Note: libdivecomputer does NOT send a leading END byte for BLE —
 * only a trailing END. See shearwater_common_slip_write() in
 * libdivecomputer src/shearwater_common.c.
 */
export function slipEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
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

/**
 * Streaming SLIP decoder. Buffers incoming BLE notification chunks
 * and emits complete decoded frames.
 */
export class SlipDecoder {
  private buffer: number[] = [];
  private inEscape = false;

  /**
   * Feed incoming BLE data. Returns array of complete decoded frames.
   */
  feed(chunk: Uint8Array): Uint8Array[] {
    const frames: Uint8Array[] = [];

    for (const byte of chunk) {
      if (byte === SLIP_END) {
        // End of frame - emit if non-empty
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
          // Invalid escape sequence - push as-is
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

  reset(): void {
    this.buffer = [];
    this.inEscape = false;
  }
}
