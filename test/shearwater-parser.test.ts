import { describe, expect, it } from 'bun:test';
import { parseShearwaterDive } from '../src/shearwater-parser';
import type { ManifestEntry, ShearwaterDeviceInfo } from '../src/types';

const RECORD_SIZE = 32;

const deviceInfo: ShearwaterDeviceInfo = {
  serial: '12345',
  firmware: 'V99',
  hardware: 'Perdix 2',
  model: 'Perdix 2',
  modelId: 11,
};

const manifestEntry: ManifestEntry = {
  index: 0,
  diveNumber: 42,
  address: 0x1000,
  size: 256,
  timestamp: 1_710_000_000,
  endTimestamp: 1_710_000_900,
  valid: true,
};

function setUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function setPressurePsi(bytes: Uint8Array, offset: number, pressurePsi: number): void {
  const raw = Math.round(pressurePsi / 2);
  setUint16(bytes, offset, raw);
}

function buildPnfDive(): Uint8Array {
  const raw = new Uint8Array(RECORD_SIZE * 8);

  const opening0 = 0;
  raw[opening0] = 0x10;
  raw[opening0 + 20] = 21;
  raw[opening0 + 21] = 50;

  const opening1 = RECORD_SIZE;
  raw[opening1] = 0x11;

  const opening2 = RECORD_SIZE * 2;
  raw[opening2] = 0x12;
  raw[opening2 + 18] = 0x00; // GF

  const opening4 = RECORD_SIZE * 3;
  raw[opening4] = 0x14;
  raw[opening4 + 16] = 9; // log version
  raw[opening4 + 28] = 0; // AI mode off

  const closing0 = RECORD_SIZE * 4;
  raw[closing0] = 0x20;
  setUint16(raw, closing0 + 4, 350); // 35.0m max
  raw[closing0 + 6] = 0x00;
  raw[closing0 + 7] = 0x03;
  raw[closing0 + 8] = 0x84; // 900 sec

  const sample1 = RECORD_SIZE * 5;
  raw[sample1] = 0x01;
  setUint16(raw, sample1 + 1, 120); // 12.0m
  raw[sample1 + 8] = 21;
  raw[sample1 + 9] = 0;
  raw[sample1 + 12] = 0x10; // OC
  setPressurePsi(raw, sample1 + 28, 3000); // T1
  setPressurePsi(raw, sample1 + 20, 2000); // T2

  const sample2 = RECORD_SIZE * 6;
  raw[sample2] = 0x01;
  setUint16(raw, sample2 + 1, 180); // 18.0m
  raw[sample2 + 8] = 50;
  raw[sample2 + 9] = 0;
  raw[sample2 + 12] = 0x10; // OC
  setPressurePsi(raw, sample2 + 28, 2600); // T1
  setPressurePsi(raw, sample2 + 20, 1700); // T2

  const finalRecord = RECORD_SIZE * 7;
  raw[finalRecord] = 0xff;
  raw[finalRecord + 13] = 11;

  return raw;
}

describe('parseShearwaterDive', () => {
  it('preserves multiple gas mixes and per-sample tank pressures', () => {
    const parsed = parseShearwaterDive(buildPnfDive(), deviceInfo, manifestEntry);

    expect(parsed.cylinders).toHaveLength(2);
    expect(parsed.cylinders.map(cylinder => cylinder.gasMix.name)).toEqual(['Air', 'EAN50']);
    expect(parsed.cylinders[0]?.startPressureBar).toBeGreaterThan(parsed.cylinders[0]?.endPressureBar ?? 0);
    expect(parsed.cylinders[1]?.startPressureBar).toBeGreaterThan(parsed.cylinders[1]?.endPressureBar ?? 0);

    expect(parsed.samples).toHaveLength(2);
    expect(parsed.samples[0]?.tankPressures).toEqual([
      { tank: 0, bar: 206.8 },
      { tank: 1, bar: 137.9 },
    ]);
    expect(parsed.samples[1]?.tankPressures).toEqual([
      { tank: 0, bar: 179.3 },
      { tank: 1, bar: 117.2 },
    ]);

    expect(parsed.events.some(event => event.type === 'GAS_SWITCH' && event.description === 'Switch to EAN50')).toBe(true);
    expect(parsed.parseWarnings).toEqual([]);
  });

  it('builds pressure source metadata with gas mapping', () => {
    const parsed = parseShearwaterDive(buildPnfDive(), deviceInfo, manifestEntry);

    expect(parsed.pressureSources).toHaveLength(2);

    const t1 = parsed.pressureSources!.find(s => s.channelLabel === 'T1')!;
    expect(t1.tankIndex).toBe(0);
    expect(t1.role).toBe('primary');
    expect(t1.gasIndex).toBe(0);
    expect(t1.gasName).toBe('Air');
    expect(t1.sampleCount).toBe(2);
    expect(t1.startPressureBar).toBe(206.8);
    expect(t1.endPressureBar).toBe(179.3);
    expect(t1.confidence).toBe('high');

    const t2 = parsed.pressureSources!.find(s => s.channelLabel === 'T2')!;
    expect(t2.tankIndex).toBe(1);
    expect(t2.role).toBe('secondary');
    expect(t2.gasIndex).toBe(1);
    expect(t2.gasName).toBe('EAN50');
    expect(t2.sampleCount).toBe(2);
    expect(t2.startPressureBar).toBe(137.9);
    expect(t2.endPressureBar).toBe(117.2);
    expect(t2.confidence).toBe('high');
  });

  it('marks pressure sources as unmapped when no matching gas exists', () => {
    // Build a dive with only 1 gas but 2 pressure channels
    const raw = buildPnfDive();
    // Zero out the second gas (O2 at opening0 + 21)
    raw[21] = 0;

    const parsed = parseShearwaterDive(raw, deviceInfo, manifestEntry);

    // Only 1 gas mix → T2 has no matching cylinder
    expect(parsed.cylinders).toHaveLength(1);
    expect(parsed.pressureSources).toHaveLength(2);

    const t2 = parsed.pressureSources!.find(s => s.channelLabel === 'T2')!;
    expect(t2.gasIndex).toBeUndefined();
    expect(t2.gasName).toBeUndefined();
    expect(t2.confidence).toBe('unmapped');
  });
});
