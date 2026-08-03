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
  raw[opening4 + 1] = 1; // dive mode: M_OC_TEC
  raw[opening4 + 16] = 9; // log version
  setUint16(raw, opening4 + 17, 0x0003); // gas enabled bitmap: slots 0 + 1 enabled
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

  // A bailout IS in the log: the computer flags the circuit on every sample,
  // so the loop-then-open-circuit transition is recorded even though the
  // dive-level mode can only name one circuit.
  it('records the circuit per sample, so a bailout is visible', () => {
    const raw = buildPnfDive();
    const sample1 = RECORD_SIZE * 5;
    const sample2 = RECORD_SIZE * 6;
    raw[sample1 + 12] = 0x00; // closed circuit
    raw[sample2 + 12] = 0x10; // OC_FLAG — bailed out

    const parsed = parseShearwaterDive(raw, deviceInfo, manifestEntry);
    expect(parsed.samples.map(sample => sample.circuit)).toEqual(['CC', 'OC']);
    // The dive still reports CCR: it was a rebreather dive that bailed out.
    expect(parsed.diveMode).toBe('CCR');
  });

  it('distinguishes semi-closed from closed circuit', () => {
    const raw = buildPnfDive();
    raw[RECORD_SIZE * 5 + 12] = 0x08; // SC_FLAG
    raw[RECORD_SIZE * 6 + 12] = 0x08;

    const parsed = parseShearwaterDive(raw, deviceInfo, manifestEntry);
    expect(parsed.samples.every(sample => sample.circuit === 'SC')).toBe(true);
  });

  it('marks an all-open-circuit dive OC on every sample', () => {
    const parsed = parseShearwaterDive(buildPnfDive(), deviceInfo, manifestEntry);
    expect(parsed.samples.every(sample => sample.circuit === 'OC')).toBe(true);
  });
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
    const raw = buildPnfDive();
    raw[21] = 0; // Zero out second gas O2
    // Update bitmap to only enable slot 0
    setUint16(raw, RECORD_SIZE * 3 + 17, 0x0001);

    const parsed = parseShearwaterDive(raw, deviceInfo, manifestEntry);

    expect(parsed.cylinders).toHaveLength(1);
    expect(parsed.pressureSources).toHaveLength(2);

    const t2 = parsed.pressureSources!.find(s => s.channelLabel === 'T2')!;
    expect(t2.gasIndex).toBeUndefined();
    expect(t2.gasName).toBeUndefined();
    expect(t2.confidence).toBe('unmapped');
  });

  it('exposes gas enabled state and slot index', () => {
    const parsed = parseShearwaterDive(buildPnfDive(), deviceInfo, manifestEntry);

    expect(parsed.cylinders[0]?.gasMix.enabled).toBe(true);
    expect(parsed.cylinders[0]?.gasMix.slotIndex).toBe(0);
    expect(parsed.cylinders[0]?.gasMix.usage).toBe('none');

    expect(parsed.cylinders[1]?.gasMix.enabled).toBe(true);
    expect(parsed.cylinders[1]?.gasMix.slotIndex).toBe(1);
  });

  it('reads dive mode from OPENING_4 header', () => {
    const parsed = parseShearwaterDive(buildPnfDive(), deviceInfo, manifestEntry);
    expect(parsed.diveMode).toBe('OC');
  });

  it('marks diluent gases on CCR dives', () => {
    const raw = buildPnfDive();
    // Set dive mode to CCR (M_CC = 0)
    raw[RECORD_SIZE * 3 + 1] = 0;
    // Enable gas slots 0 (OC) and 5 (diluent)
    raw[RECORD_SIZE * 0 + 25] = 32; // slot 5 O2 = 32%
    setUint16(raw, RECORD_SIZE * 3 + 17, 0x0021); // bits 0 + 5

    // Set sample status to CCR (OC flag clear)
    raw[RECORD_SIZE * 5 + 12] = 0x00; // CCR
    raw[RECORD_SIZE * 6 + 12] = 0x00; // CCR

    const parsed = parseShearwaterDive(raw, deviceInfo, manifestEntry);

    expect(parsed.diveMode).toBe('CCR');
    const diluentGas = parsed.cylinders.find(c => c.gasMix.slotIndex === 5);
    expect(diluentGas).toBeDefined();
    expect(diluentGas!.gasMix.usage).toBe('diluent');
    expect(diluentGas!.gasMix.enabled).toBe(true);
  });

  it('excludes disabled non-active gases', () => {
    const raw = buildPnfDive();
    // Add a third gas (slot 2, O2=100) but don't enable it in bitmap
    raw[RECORD_SIZE * 0 + 22] = 100;
    // Bitmap still 0x0003 = only slots 0,1 enabled. Slot 2 not active either.
    const parsed = parseShearwaterDive(raw, deviceInfo, manifestEntry);
    // Slot 2 (O2=100) should NOT appear — not enabled and not active
    expect(parsed.cylinders).toHaveLength(2);
  });

  it('extracts VPM-B conservatism', () => {
    const raw = buildPnfDive();
    // Set deco model to VPM-B (byte 18 of OPENING_2)
    raw[RECORD_SIZE * 2 + 18] = 1; // VPMB
    raw[RECORD_SIZE * 2 + 19] = 3; // conservatism level 3

    const parsed = parseShearwaterDive(raw, deviceInfo, manifestEntry);

    expect(parsed.decoModel).toBe('VPM-B');
    expect(parsed.vpmbConservatism).toBe(3);
  });

  it('reports units field', () => {
    const parsed = parseShearwaterDive(buildPnfDive(), deviceInfo, manifestEntry);
    expect(parsed.units).toBe('metric');
  });
});
