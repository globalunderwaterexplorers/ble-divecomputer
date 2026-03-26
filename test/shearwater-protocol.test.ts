import { describe, expect, it } from 'bun:test';
import { ShearwaterProtocol } from '../src/shearwater-protocol';
import {
  CMD_RDBI_RESPONSE,
  CMD_NAK,
  LOG_BLOCK_RESPONSE,
  LOG_INIT_RESPONSE,
  LOG_QUIT_RESPONSE,
  MANIFEST_DELETED,
  MANIFEST_ENTRY_SIZE,
  MANIFEST_SIZE,
  MANIFEST_VALID,
  RDBI_SERIAL,
  RDBI_FIRMWARE,
  RDBI_HARDWARE,
  RDBI_LOGUPLOAD,
  RDBI_DEVICE_TYPE,
  RDBI_BOOTLOADER,
  RDBI_LOG_STATUS,
} from '../src/constants';
import type { ShearwaterDeviceInfo } from '../src/types';

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

  it('probes successful RDBI identifiers in a range', async () => {
    const ble = new MockBle([
      new Uint8Array([CMD_RDBI_RESPONSE, 0x80, 0x10, 0x31, 0x32, 0x33, 0x34, 0x35]),
      new Uint8Array([CMD_RDBI_RESPONSE, 0x80, 0x11, 0x56, 0x39, 0x39]),
    ]);
    const protocol = new ShearwaterProtocol(ble as any);

    const records = await protocol.probeRdbiRange(0x8010, 0x8011);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      id: 0x8010,
      label: 'Serial',
      length: 5,
      ascii: '12345',
    });
    expect(records[1]).toMatchObject({
      id: 0x8011,
      label: 'Firmware',
      ascii: 'V99',
    });
  });
});

function rdbiResponse(id: number, ...data: number[]): Uint8Array {
  return new Uint8Array([CMD_RDBI_RESPONSE, (id >> 8) & 0xff, id & 0xff, ...data]);
}

function rdbiNak(id: number): Uint8Array {
  return new Uint8Array([CMD_NAK, 0x22, 0x31]);
}

const testDeviceInfo: ShearwaterDeviceInfo = {
  serial: '12345',
  firmware: 'V99',
  hardware: 'Perdix 2',
  model: 'Perdix 2',
  modelId: 11,
};

describe('ShearwaterProtocol.getConfigurationSnapshot', () => {
  function createSnapshotBle(knownResponses: Map<number, number[]>): MockBle {
    // Build responses for probeRdbiRange(0x8000, 0x805f) — 96 RDBI requests
    const responses: Uint8Array[] = [];
    for (let id = 0x8000; id <= 0x805f; id++) {
      const data = knownResponses.get(id);
      if (data) {
        responses.push(rdbiResponse(id, ...data));
      } else {
        // NAK for unknown identifiers — probeRdbiRange catches errors
        responses.push(rdbiNak(id));
      }
    }
    return new MockBle(responses);
  }

  it('returns snapshot matching real Perdix 2 RDBI responses', async () => {
    const known = new Map<number, number[]>();
    // Real Perdix 2 V95 Classic responses:
    known.set(RDBI_DEVICE_TYPE, [0x01]);
    known.set(RDBI_SERIAL, [0x41, 0x30, 0x39, 0x36, 0x30, 0x30, 0x32, 0x43]); // "A096002C"
    known.set(RDBI_FIRMWARE, [0x56, 0x39, 0x35, 0x20, 0x43, 0x6c, 0x61, 0x73, 0x73, 0x69, 0x63]); // "V95 Classic"
    known.set(RDBI_BOOTLOADER, [0x00]);
    known.set(RDBI_LOG_STATUS, [0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x30, 0x00, 0x00]);
    known.set(RDBI_LOGUPLOAD, [0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x80]);
    known.set(RDBI_HARDWARE, [0xc4, 0x07]); // modelId=196, rev=7

    const ble = createSnapshotBle(known);
    const protocol = new ShearwaterProtocol(ble as any);
    const snapshot = await protocol.getConfigurationSnapshot(testDeviceInfo);

    // 7 identifiers responded — more than the 4 core ones
    expect(snapshot.capabilities.hasExtendedRdbi).toBe(true);
    // Config is NOT available via RDBI on current firmware
    expect(snapshot.capabilities.hasGradientFactors).toBe(false);
    expect(snapshot.capabilities.hasGasTable).toBe(false);
    expect(snapshot.capabilities.hasTransmitterConfig).toBe(false);
    expect(snapshot.capabilities.hasBatteryStatus).toBe(false);
    expect(snapshot.capabilities.hasDecoModel).toBe(false);

    expect(snapshot.gases).toHaveLength(0);
    expect(snapshot.transmitters).toHaveLength(0);
    expect(snapshot.rawRecords).toHaveLength(7);

    // Verify labels
    expect(snapshot.rawRecords.find(r => r.id === RDBI_DEVICE_TYPE)?.label).toBe('Device type');
    expect(snapshot.rawRecords.find(r => r.id === RDBI_BOOTLOADER)?.label).toBe('Bootloader');
    expect(snapshot.rawRecords.find(r => r.id === RDBI_LOG_STATUS)?.label).toBe('Log status');
  });

  it('handles minimal probe with only core 4 identifiers', async () => {
    const known = new Map<number, number[]>();
    known.set(RDBI_SERIAL, [0x31, 0x32, 0x33, 0x34, 0x35]);
    known.set(RDBI_FIRMWARE, [0x56, 0x39, 0x39]);
    known.set(RDBI_LOGUPLOAD, [0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    known.set(RDBI_HARDWARE, [11, 0x02]);

    const ble = createSnapshotBle(known);
    const protocol = new ShearwaterProtocol(ble as any);
    const snapshot = await protocol.getConfigurationSnapshot(testDeviceInfo);

    expect(snapshot.capabilities.hasExtendedRdbi).toBe(false);
    expect(snapshot.gases).toHaveLength(0);
    expect(snapshot.transmitters).toHaveLength(0);
    expect(snapshot.rawRecords).toHaveLength(4);
  });
});
