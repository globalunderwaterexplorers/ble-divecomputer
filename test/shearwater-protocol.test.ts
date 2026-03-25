import { describe, expect, it } from 'bun:test';
import { ShearwaterProtocol } from '../src/shearwater-protocol';
import {
  CMD_RDBI_RESPONSE,
  LOG_BLOCK_RESPONSE,
  LOG_INIT_RESPONSE,
  LOG_QUIT_RESPONSE,
  MANIFEST_DELETED,
  MANIFEST_ENTRY_SIZE,
  MANIFEST_SIZE,
  MANIFEST_VALID,
} from '../src/constants';

const RECORD_COUNT = MANIFEST_SIZE / MANIFEST_ENTRY_SIZE;

class MockBle {
  connected = true;
  deviceName = 'Perdix 2 12345';
  commands: Uint8Array[] = [];

  constructor(private responses: Uint8Array[]) {}

  async sendPacket(command: Uint8Array): Promise<Uint8Array> {
    this.commands.push(command.slice());
    const response = this.responses.shift();
    if (!response) throw new Error(`Unexpected packet 0x${command[0]?.toString(16) ?? '??'}`);
    return response;
  }

  resetDecoder(): void {}
}

function createManifestRecord(options: {
  diveNumber?: number;
  timestamp?: number;
  endTimestamp?: number;
  address?: number;
  endAddress?: number;
  marker?: number;
} = {}): Uint8Array {
  const record = new Uint8Array(MANIFEST_ENTRY_SIZE);
  const view = new DataView(record.buffer);

  view.setUint16(0, options.marker ?? MANIFEST_VALID, false);
  view.setUint16(2, options.diveNumber ?? 0, false);
  view.setUint32(4, options.timestamp ?? 0, false);
  view.setUint32(8, options.endTimestamp ?? 0, false);
  view.setUint32(20, options.address ?? 0, false);
  view.setUint32(24, options.endAddress ?? 0, false);

  return record;
}

function createManifestPage(records: Uint8Array[]): Uint8Array {
  const page = new Uint8Array(MANIFEST_SIZE);
  records.forEach((record, index) => {
    page.set(record, index * MANIFEST_ENTRY_SIZE);
  });
  return page;
}

function createProtocol(...pages: Uint8Array[]): { protocol: ShearwaterProtocol; ble: MockBle } {
  const responses: Uint8Array[] = [
    new Uint8Array([CMD_RDBI_RESPONSE, 0x80, 0x21, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00]),
  ];

  for (const page of pages) {
    responses.push(new Uint8Array([LOG_INIT_RESPONSE, 0x00, 0xff]));
    responses.push(concatBytes(new Uint8Array([LOG_BLOCK_RESPONSE, 0x01]), page));
    responses.push(new Uint8Array([LOG_QUIT_RESPONSE]));
  }

  const ble = new MockBle(responses);
  const protocol = new ShearwaterProtocol(ble as any);
  return { protocol, ble };
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

describe('ShearwaterProtocol.getManifest', () => {
  it('returns entries from a single partial manifest page', async () => {
    const page = createManifestPage([
      createManifestRecord({
        diveNumber: 41,
        timestamp: 1711001000,
        endTimestamp: 1711004600,
        address: 0x1000,
        endAddress: 0x1800,
      }),
      createManifestRecord({
        diveNumber: 42,
        timestamp: 1711011000,
        endTimestamp: 1711014600,
        address: 0x2000,
        endAddress: 0x2800,
      }),
    ]);
    const { protocol } = createProtocol(page);

    const manifest = await protocol.getManifest();

    expect(manifest).toHaveLength(2);
    expect(manifest.map(entry => entry.diveNumber)).toEqual([42, 41]);
  });

  it('merges multiple manifest pages when the first page is full', async () => {
    const firstPage = createManifestPage(
      Array.from({ length: RECORD_COUNT }, (_, index) =>
        createManifestRecord({
          diveNumber: index + 1,
          timestamp: 1710000000 + index,
          endTimestamp: 1710001800 + index,
          address: 0x1000 + index * 0x100,
          endAddress: 0x1080 + index * 0x100,
        })
      )
    );
    const secondPage = createManifestPage([
      createManifestRecord({
        diveNumber: 100,
        timestamp: 1711000000,
        endTimestamp: 1711001800,
        address: 0x9000,
        endAddress: 0x9800,
      }),
      createManifestRecord({
        diveNumber: 101,
        timestamp: 1711002000,
        endTimestamp: 1711003800,
        address: 0xa000,
        endAddress: 0xa800,
      }),
    ]);
    const { protocol } = createProtocol(firstPage, secondPage);

    const manifest = await protocol.getManifest();

    expect(manifest).toHaveLength(RECORD_COUNT + 2);
    expect(manifest[0]?.diveNumber).toBe(101);
    expect(manifest[1]?.diveNumber).toBe(100);
  });

  it('continues past deleted entries when the manifest page is otherwise full', async () => {
    const fullPageWithDeleted = createManifestPage([
      ...Array.from({ length: RECORD_COUNT - 2 }, (_, index) =>
        createManifestRecord({
          diveNumber: index + 1,
          timestamp: 1712000000 + index,
          endTimestamp: 1712001800 + index,
          address: 0x1000 + index * 0x80,
          endAddress: 0x1040 + index * 0x80,
        })
      ),
      createManifestRecord({ marker: MANIFEST_DELETED }),
      createManifestRecord({ marker: MANIFEST_DELETED }),
    ]);
    const olderPage = createManifestPage([
      createManifestRecord({
        diveNumber: 500,
        timestamp: 1711990000,
        endTimestamp: 1711991800,
        address: 0x8000,
        endAddress: 0x8800,
      }),
    ]);
    const { protocol } = createProtocol(fullPageWithDeleted, olderPage);

    const manifest = await protocol.getManifest();

    expect(manifest).toHaveLength(RECORD_COUNT - 1);
    expect(manifest.some(entry => entry.diveNumber === 500)).toBe(true);
  });

  it('stops if the device repeats the same full manifest page', async () => {
    const repeatedPage = createManifestPage(
      Array.from({ length: RECORD_COUNT }, (_, index) =>
        createManifestRecord({
          diveNumber: index + 1,
          timestamp: 1713000000 + index,
          endTimestamp: 1713001800 + index,
          address: 0x4000 + index * 0x100,
          endAddress: 0x4080 + index * 0x100,
        })
      )
    );
    const { protocol, ble } = createProtocol(repeatedPage, repeatedPage);

    const manifest = await protocol.getManifest();

    expect(manifest).toHaveLength(RECORD_COUNT);
    expect(ble.commands.filter(command => command[0] === 0x35)).toHaveLength(2);
  });
});
