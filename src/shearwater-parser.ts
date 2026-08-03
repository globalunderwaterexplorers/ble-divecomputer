import type { ShearwaterDeviceInfo, ManifestEntry } from './types';
import type { ParsedDive, DiveSample, DiveSampleCircuit, DiveCylinder, DiveGasMix, DiveEvent, PressureSource, DiveSiteInfo } from './types';
import { DEVICE_MODELS } from './constants';

/**
 * Parse raw binary dive data downloaded from a Shearwater dive computer.
 *
 * Based on libdivecomputer src/shearwater_predator_parser.c.
 *
 * Two formats exist:
 *   - Legacy (Predator): first 2 bytes == 0xFFFF, 128-byte header, 16-byte samples
 *   - PNF (Petrel Native Format): first 2 bytes != 0xFFFF, 32-byte records with
 *     type byte at offset 0 (opening/closing/sample/event records interleaved)
 */

const SZ_BLOCK = 128;
const SZ_SAMPLE_PETREL = 32;
const SZ_SAMPLE_PREDATOR = 16;

// Record types (PNF)
const REC_DIVE_SAMPLE = 0x01;
const REC_FREEDIVE_SAMPLE = 0x02;
const REC_AVELO_SAMPLE = 0x03;
const REC_OPENING_0 = 0x10;
const REC_CLOSING_0 = 0x20;
const REC_INFO_EVENT = 0x30;
const REC_SAMPLE_EXT = 0xE1;
const REC_FINAL = 0xFF;

// Status flags
const OC_FLAG = 0x10;
const SC_FLAG = 0x08;

// AI modes
const AI_OFF = 0;
const AI_HPCCR = 4;
const AI_ON_GPS = 6;

// Dive mode enum (from OPENING_4 byte 1, logversion >= 8)
const M_CC = 0;
const M_OC_TEC = 1;
const M_GAUGE = 2;
const M_PPO2 = 3;
const M_SC = 4;
const M_CC2 = 5;
const M_OC_REC = 6;
const M_FREEDIVE = 7;

// Deco model types
const GF = 0;
const VPMB = 1;
const VPMB_GFS = 2;
const DCIEM = 3;

// Teric model ID
const TERIC = 8;

const NFIXED = 10;
const NTANKS = 6;
const FEET = 0.3048;

interface ParsedGasSlot {
  slotIndex: number;
  o2: number;
  he: number;
  diluent: boolean;
  enabled: boolean;
  active: boolean;
}

interface ParsedTank {
  enabled: boolean;
  active: boolean;
  beginPressure: number;
  endPressure: number;
  maxPressure: number;
  reservePressure: number;
  serial: number;
  name: string;
  usage: 'none' | 'diluent' | 'oxygen' | 'sidemount';
}

function isCcrMode(mode: number): boolean {
  return mode === M_CC || mode === M_CC2 || mode === M_SC;
}

function mapDiveMode(mode: number): 'OC' | 'CCR' | 'SCR' | 'GAUGE' | 'FREEDIVE' {
  switch (mode) {
    case M_CC:
    case M_CC2:
      return 'CCR';
    case M_SC:
      return 'SCR';
    case M_GAUGE:
    case M_PPO2:
      return 'GAUGE';
    case M_FREEDIVE:
      return 'FREEDIVE';
    case M_OC_TEC:
    case M_OC_REC:
    default:
      return 'OC';
  }
}

export function parseShearwaterDive(
  raw: Uint8Array,
  deviceInfo: ShearwaterDeviceInfo,
  manifestEntry: ManifestEntry
): ParsedDive {
  if (raw.length < SZ_BLOCK * 2) {
    throw new Error(`Dive data too short: ${raw.length} bytes`);
  }

  // Detect PNF: first two bytes != 0xFFFF
  const pnf = (raw[0] !== 0xFF || raw[1] !== 0xFF) ? 1 : 0;
  const petrel = true; // All BLE-capable Shearwater devices are Petrel-class
  const sampleSize = petrel ? SZ_SAMPLE_PETREL : SZ_SAMPLE_PREDATOR;

  // ===== PHASE 1: Scan all records to find opening/closing/final positions =====
  const opening: (number | undefined)[] = new Array(10).fill(undefined);
  const closing: (number | undefined)[] = new Array(10).fill(undefined);
  let finalOffset: number | undefined;
  let logVersion = 0;
  let aiMode = AI_OFF;
  let sampleInterval = 10;

  // Gas slot state — all 10 fixed slots
  const gasSlots: ParsedGasSlot[] = Array.from({ length: NFIXED }, (_, i) => ({
    slotIndex: i,
    o2: 0,
    he: 0,
    diluent: i >= 5,
    enabled: !pnf, // legacy format: all enabled by default
    active: false,
  }));

  // Tank state — up to 6 tanks
  const tanks: ParsedTank[] = Array.from({ length: NTANKS }, () => ({
    enabled: false,
    active: false,
    beginPressure: 0,
    endPressure: 0,
    maxPressure: 0,
    reservePressure: 0,
    serial: 0,
    name: '',
    usage: 'none' as const,
  }));

  let headerDiveMode = M_OC_TEC;
  let hpccr = false;

  if (!pnf) {
    // Legacy format: single 128-byte opening block
    for (let i = 0; i <= 4; i++) {
      opening[i] = 0;
    }
    logVersion = raw[127];
    if (petrel) {
      finalOffset = raw.length - SZ_BLOCK;
    }
    // Legacy gas table
    for (let i = 0; i < NFIXED; i++) {
      gasSlots[i].o2 = raw[20 + i];
      gasSlots[i].he = raw[30 + i];
      gasSlots[i].diluent = i >= 5;
      gasSlots[i].enabled = true;
    }
  }

  // PNF: scan records and extract opening data inline
  let o2Previous = -1;
  let hePrevious = -1;
  let dilPrevious = -1;

  const samples: DiveSample[] = [];
  const events: DiveEvent[] = [];
  const sampleCountByTank = new Map<number, number>();
  const startPressureByTank = new Map<number, number>();
  const endPressureByTank = new Map<number, number>();
  let maxObservedPressureTank = -1;
  let currentTime = 0;
  let maxTemp = -999;
  let minTemp = 999;
  let sampleMaxDepth = 0;

  // Single pass: extract opening records + samples (matches libdivecomputer flow)
  const headerSize = pnf ? 0 : SZ_BLOCK;
  const footerSize = pnf ? 0 : (petrel ? SZ_BLOCK * 2 : SZ_BLOCK);

  for (let offset = headerSize; offset + sampleSize <= raw.length - footerSize; offset += sampleSize) {
    if (isAllZero(raw, offset, sampleSize)) continue;

    const recordType = pnf ? raw[offset] : REC_DIVE_SAMPLE;

    if (recordType >= REC_OPENING_0 && recordType <= REC_OPENING_0 + 9) {
      const idx = recordType - REC_OPENING_0;
      opening[idx] = offset;

      if (idx === 0) {
        // OPENING_0: gas O2 + first 2 He values
        for (let i = 0; i < NFIXED; i++) {
          gasSlots[i].o2 = raw[offset + 20 + i];
          gasSlots[i].diluent = i >= 5;
        }
        for (let i = 0; i < 2; i++) {
          gasSlots[i].he = raw[offset + 30 + i];
        }
      } else if (idx === 1) {
        // OPENING_1: He for gas 2-9
        for (let i = 2; i < NFIXED; i++) {
          gasSlots[i].he = raw[offset + 1 + i - 2];
        }
      } else if (idx === 4) {
        // OPENING_4: log version, gas enabled bitmap, AI mode, dive mode, GTR mode
        logVersion = raw[offset + 16];

        // Gas enabled bitmap (bytes 17-18)
        const enabledBitmap = (raw[offset + 17] << 8) | raw[offset + 18];
        for (let i = 0; i < NFIXED; i++) {
          gasSlots[i].enabled = (enabledBitmap & (1 << i)) !== 0;
        }

        // AI mode
        if (logVersion >= 7) {
          aiMode = raw[offset + 28];
          if (logVersion < 13) {
            if (aiMode === 1 || aiMode === 2) {
              tanks[aiMode - 1].enabled = true;
            } else if (aiMode === 3) {
              tanks[0].enabled = true;
              tanks[1].enabled = true;
            }
          }
          if (logVersion < 14) {
            if (aiMode === AI_HPCCR) {
              tanks[4].enabled = true;
              tanks[4].usage = 'diluent';
              tanks[5].enabled = true;
              tanks[5].usage = 'oxygen';
              hpccr = true;
            }
          }
        }

        // GTR mode (sidemount bitmap, byte 29)
        const gtrMode = raw[offset + 29];
        if (popcount(gtrMode) >= 2) {
          for (let i = 0; i < 4; i++) {
            if (gtrMode & (1 << i)) {
              tanks[i].usage = 'sidemount';
            }
          }
        }

        // Dive mode from header (logversion >= 8)
        if (logVersion >= 8) {
          headerDiveMode = raw[offset + (pnf ? 1 : 112)];
        }
      } else if (idx === 5) {
        // OPENING_5: tank serials + pressures, sample interval
        if (logVersion >= 9) {
          tanks[0].serial = bcd2dec(raw, offset + 1, 3);
          tanks[0].maxPressure = uint16BE(raw, offset + 6);
          tanks[0].reservePressure = uint16BE(raw, offset + 8);

          tanks[1].serial = bcd2dec(raw, offset + 10, 3);
          tanks[1].maxPressure = uint16BE(raw, offset + 15);
          tanks[1].reservePressure = uint16BE(raw, offset + 17);

          const intervalRaw = uint16BE(raw, offset + 23);
          if (intervalRaw > 0 && intervalRaw <= 60000) {
            sampleInterval = intervalRaw / 1000;
          }
        }
      } else if (idx === 6) {
        // OPENING_6: tank 0-1 names/enabled, tank 2 serial
        if (logVersion >= 13) {
          tanks[0].enabled = raw[offset + 19] !== 0;
          tanks[0].name = decodeAscii2(raw, offset + 20);

          tanks[1].enabled = raw[offset + 22] !== 0;
          tanks[1].name = decodeAscii2(raw, offset + 23);

          tanks[2].serial = bcd2dec(raw, offset + 25, 3);
          tanks[2].maxPressure = uint16BE(raw, offset + 28);
          tanks[2].reservePressure = uint16BE(raw, offset + 30);
        }
      } else if (idx === 7) {
        // OPENING_7: tank 2-3 names/enabled/serial
        if (logVersion >= 13) {
          tanks[2].enabled = raw[offset + 1] !== 0;
          tanks[2].name = decodeAscii2(raw, offset + 2);

          tanks[3].serial = bcd2dec(raw, offset + 4, 3);
          tanks[3].maxPressure = uint16BE(raw, offset + 7);
          tanks[3].reservePressure = uint16BE(raw, offset + 9);
          tanks[3].enabled = raw[offset + 11] !== 0;
          tanks[3].name = decodeAscii2(raw, offset + 12);
        }
      }
      continue;
    }

    if (recordType >= REC_CLOSING_0 && recordType <= REC_CLOSING_0 + 9) {
      closing[recordType - REC_CLOSING_0] = offset;
      continue;
    }

    if (recordType === REC_FINAL) {
      finalOffset = offset;
      continue;
    }

    if (recordType === REC_INFO_EVENT && pnf) {
      if (raw[offset + 1] === 38) { // TAG_LOG = bookmark
        events.push({ timeSeconds: currentTime, type: 'BOOKMARK', description: 'Bookmark' });
      }
      continue;
    }

    if (recordType === REC_FREEDIVE_SAMPLE) {
      headerDiveMode = M_FREEDIVE;
      continue;
    }

    // Extended sample: tanks 2-5 pressure (does NOT advance time)
    if (recordType === REC_SAMPLE_EXT && pnf) {
      if (logVersion >= 13 && samples.length > 0) {
        const lastSample = samples[samples.length - 1];
        const extTankPressures = lastSample.tankPressures ? [...lastSample.tankPressures] : [];

        for (let i = 0; i < 2; i++) {
          const pressureRaw = uint16BE(raw, offset + pnf + i * 2);
          const id = 2 + i;
          if (pressureRaw > 0 && pressureRaw < 0xFFF0) {
            const pressurePsi = (pressureRaw & 0x0FFF) * 2;
            if (pressurePsi > 0) {
              const pressureBar = psiToBar(pressurePsi);
              extTankPressures.push({ tank: id, bar: pressureBar });
              if (!startPressureByTank.has(id)) startPressureByTank.set(id, pressureBar);
              endPressureByTank.set(id, pressureBar);
              sampleCountByTank.set(id, (sampleCountByTank.get(id) ?? 0) + 1);
              if (!tanks[id].active) {
                tanks[id].active = true;
                tanks[id].beginPressure = pressureRaw & 0x0FFF;
              }
              tanks[id].endPressure = pressureRaw & 0x0FFF;
              if (id > maxObservedPressureTank) maxObservedPressureTank = id;
            }
          }
        }

        // HP CCR tanks 4-5 (logversion >= 14)
        if (logVersion >= 14) {
          for (let i = 0; i < 2; i++) {
            const pressureRaw = uint16BE(raw, offset + pnf + 4 + i * 2);
            const id = 4 + i;
            if (pressureRaw > 0) {
              const pressureBar = psiToBar(pressureRaw * 2);
              extTankPressures.push({ tank: id, bar: pressureBar });
              if (!startPressureByTank.has(id)) startPressureByTank.set(id, pressureBar);
              endPressureByTank.set(id, pressureBar);
              sampleCountByTank.set(id, (sampleCountByTank.get(id) ?? 0) + 1);
              if (!tanks[id].active) {
                tanks[id].active = true;
                tanks[id].enabled = true;
                tanks[id].beginPressure = pressureRaw;
                tanks[id].usage = i === 0 ? 'diluent' : 'oxygen';
                hpccr = true;
              }
              tanks[id].endPressure = pressureRaw;
              if (id > maxObservedPressureTank) maxObservedPressureTank = id;
            }
          }
        }

        if (extTankPressures.length > 0) {
          lastSample.tankPressures = extTankPressures;
        }
      }
      continue;
    }

    if (recordType !== REC_DIVE_SAMPLE && recordType !== REC_AVELO_SAMPLE) {
      continue;
    }

    // ===== DIVE SAMPLE =====
    currentTime += sampleInterval;

    // Depth
    const depthRaw = uint16BE(raw, offset + pnf);
    const depthMeters = depthRaw / 10;
    if (depthMeters > sampleMaxDepth) sampleMaxDepth = depthMeters;

    // Temperature
    let temp = toSigned8(raw[offset + pnf + 13]);
    if (temp < 0) {
      temp += 102;
      if (temp > 0) temp = 0;
    }
    if (temp !== 0) {
      if (temp > maxTemp) maxTemp = temp;
      if (temp < minTemp) minTemp = temp;
    }

    // Status flags
    const status = recordType !== REC_AVELO_SAMPLE ? raw[offset + 11 + pnf] : 0;
    const ccr = (status & OC_FLAG) === 0 && recordType !== REC_AVELO_SAMPLE;
    // The computer states the circuit on EVERY sample, so a bailout is in the
    // log even though the dive-level mode can only name one circuit.
    const sampleCircuit: DiveSampleCircuit | undefined = recordType === REC_AVELO_SAMPLE
      ? undefined
      : ccr ? ((status & SC_FLAG) ? 'SC' : 'CC') : 'OC';

    if (ccr && headerDiveMode === M_OC_TEC) {
      headerDiveMode = (status & SC_FLAG) ? M_SC : M_CC;
    }

    // Gas change detection — also marks gas as active
    const o2 = raw[offset + pnf + 7];
    const he = raw[offset + pnf + 8];
    const dil = ccr ? 1 : 0;
    if ((o2 !== o2Previous || he !== hePrevious || dil !== dilPrevious) &&
        (o2 !== 0 || he !== 0)) {
      // Find matching gas slot
      for (let i = 0; i < NFIXED; i++) {
        if (gasSlots[i].o2 === o2 && gasSlots[i].he === he && gasSlots[i].diluent === (dil === 1)) {
          gasSlots[i].active = true;
          break;
        }
      }

      if (o2Previous >= 0) {
        events.push({
          timeSeconds: currentTime,
          type: 'GAS_SWITCH',
          description: `Switch to ${formatGasName(o2, he)}`,
        });
      }

      o2Previous = o2;
      hePrevious = he;
      dilPrevious = dil;
    }

    const sample: DiveSample = {
      timeSeconds: currentTime,
      depthMeters,
      temperatureCelsius: temp !== 0 ? temp : undefined,
      circuit: sampleCircuit,
    };

    // Tank pressure (logversion >= 7, Petrel class)
    if (logVersion >= 7 && petrel) {
      const pressureOffsets = [27, 19];
      const count = recordType === REC_AVELO_SAMPLE ? 1 : 2;
      const tankPressures: Array<{ tank: number; bar: number }> = [];
      for (let i = 0; i < count; i++) {
        const pressureRaw = uint16BE(raw, offset + pnf + pressureOffsets[i]);
        const id = (aiMode === AI_HPCCR ? 4 : 0) + i;
        if (pressureRaw > 0 && pressureRaw < 0xFFF0) {
          const psi = (pressureRaw & 0x0FFF) * 2;
          if (psi > 0) {
            const pressureBar = psiToBar(psi);
            tankPressures.push({ tank: id, bar: pressureBar });
            if (!startPressureByTank.has(id)) startPressureByTank.set(id, pressureBar);
            endPressureByTank.set(id, pressureBar);
            sampleCountByTank.set(id, (sampleCountByTank.get(id) ?? 0) + 1);
            if (!tanks[id].active) {
              tanks[id].active = true;
              tanks[id].beginPressure = pressureRaw & 0x0FFF;
            }
            tanks[id].endPressure = pressureRaw & 0x0FFF;
            if (id > maxObservedPressureTank) maxObservedPressureTank = id;
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

    // Deco ceiling
    const decoStopRaw = uint16BE(raw, offset + pnf + 2);
    const ttsMinutes = uint16BE(raw, offset + pnf + 4);
    const ndlDecoMinutes = raw[offset + pnf + 9];

    if (decoStopRaw > 0) {
      sample.ceilingMeters = decoStopRaw;
      if (ttsMinutes > 0 && ttsMinutes < 0xFFFF) sample.ttsSeconds = ttsMinutes * 60;
    } else {
      if (ndlDecoMinutes > 0 && ndlDecoMinutes < 255) sample.ndlSeconds = ndlDecoMinutes * 60;
      if (ttsMinutes > 0 && ttsMinutes < 0xFFFF) sample.ttsSeconds = ttsMinutes * 60;
    }

    // CNS
    if (petrel) {
      const cns = raw[offset + pnf + 22];
      if (cns > 0 && cns < 255) sample.cnsPercent = cns;
    }

    // PPO2 + setpoint for CCR
    if (ccr) {
      const ppo2Raw = raw[offset + pnf + 6];
      if (ppo2Raw > 0) sample.ppo2 = ppo2Raw / 100;
      if (petrel) {
        const setpoint = raw[offset + pnf + 18];
        if (setpoint > 0) sample.setpoint = setpoint / 100;
      }
    }

    samples.push(sample);
  }

  // ===== Extract environment data from opening records =====

  // Units (OPENING_0 byte 8)
  const units: 'metric' | 'imperial' = opening[0] != null && raw[opening[0] + 8] === 1 ? 'imperial' : 'metric';

  // Atmospheric pressure (OPENING_1 bytes 16-17 PNF)
  let atmosphericPressureMbar: number | undefined;
  if (opening[1] != null) {
    atmosphericPressureMbar = uint16BE(raw, opening[1] + (pnf ? 16 : 47));
  }

  // Water density (OPENING_3 bytes 3-4 PNF)
  let salinityDensity: number | undefined;
  let waterType: 'salt' | 'fresh' | undefined;
  if (opening[3] != null) {
    salinityDensity = uint16BE(raw, opening[3] + (pnf ? 3 : 83));
    waterType = salinityDensity === 1000 ? 'fresh' : 'salt';
  }

  // Deco model + GF + VPM-B conservatism
  let decoModel: string | undefined;
  let gfLow: number | undefined;
  let gfHigh: number | undefined;
  let vpmbConservatism: number | undefined;
  if (opening[2] != null && opening[0] != null) {
    const decomodelIdx = pnf ? opening[2] + 18 : 67;
    const gfIdx = pnf ? opening[0] + 4 : 4;
    const modelByte = raw[decomodelIdx];
    if (modelByte === GF) {
      decoModel = 'Bühlmann ZHL-16C';
      gfLow = raw[gfIdx];
      gfHigh = raw[gfIdx + 1];
    } else if (modelByte === VPMB || modelByte === VPMB_GFS) {
      decoModel = modelByte === VPMB ? 'VPM-B' : 'VPM-B/GFS';
      vpmbConservatism = raw[decomodelIdx + 1];
    } else if (modelByte === DCIEM) {
      decoModel = 'DCIEM';
    }
  }

  // Closing block: max depth + duration
  let closingMaxDepth = 0;
  let closingDuration = 0;
  if (closing[0] != null) {
    const co = closing[0];
    let maxDepthRaw = uint16BE(raw, co + 4);
    if (units === 'imperial') {
      closingMaxDepth = maxDepthRaw * FEET / (pnf ? 10 : 1);
    } else {
      closingMaxDepth = pnf ? maxDepthRaw / 10 : maxDepthRaw;
    }
    closingDuration = pnf
      ? (raw[co + 6] << 16) | (raw[co + 7] << 8) | raw[co + 8]
      : uint16BE(raw, co + 6) * 60;
  }

  // Model from final block
  let modelFromDive = deviceInfo.modelId;
  if (finalOffset != null && finalOffset + 14 <= raw.length) {
    modelFromDive = raw[finalOffset + 13];
  }
  const modelName = DEVICE_MODELS[modelFromDive] ?? deviceInfo.model;

  // Teric timezone
  let timezoneOffset: number | undefined;
  if (modelFromDive === TERIC && logVersion >= 9 && opening[5] != null) {
    const utcOffsetMinutes = toSigned32BE(raw, opening[5] + 26);
    const dst = raw[opening[5] + 30];
    timezoneOffset = utcOffsetMinutes + dst * 60;
  }

  // GPS from OPENING_9
  let site: DiveSiteInfo | undefined;
  if (aiMode === AI_ON_GPS && opening[9] != null) {
    const lat = toSigned32BE(raw, opening[9] + 21);
    const lon = toSigned32BE(raw, opening[9] + 25);
    if (!(lat === 0 && lon === 0) && !(lat === -1 && lon === -1)) {
      site = { latitude: lat / 100000, longitude: lon / 100000 };
    }
  }
  if (waterType && !site) {
    site = { waterType };
  } else if (waterType && site) {
    site.waterType = waterType;
  }

  // ===== Build dive mode =====
  const diveMode = mapDiveMode(headerDiveMode);

  // ===== Filter gas mixes (matching libdivecomputer logic) =====
  const filteredGases: ParsedGasSlot[] = [];
  if (headerDiveMode !== M_FREEDIVE) {
    for (const gas of gasSlots) {
      if (gas.o2 === 0 && gas.he === 0) continue;
      if (!gas.enabled && !gas.active) continue;
      if (gas.diluent && !isCcrMode(headerDiveMode)) continue;
      filteredGases.push(gas);
    }
  }

  // ===== Build cylinders =====
  const cylinders: DiveCylinder[] = (filteredGases.length > 0
    ? filteredGases
    : [{ slotIndex: 0, o2: 21, he: 0, diluent: false, enabled: true, active: true }]
  ).map((gas, index) => {
    const usage = gas.diluent ? 'diluent' as const : 'none' as const;
    const gasMix: DiveGasMix = {
      oxygen: gas.o2 / 100,
      helium: gas.he / 100,
      nitrogen: Math.max(0, 1 - gas.o2 / 100 - gas.he / 100),
      name: formatGasName(gas.o2, gas.he),
      usage,
      enabled: gas.enabled,
      slotIndex: gas.slotIndex,
    };

    const cyl: DiveCylinder = {
      index,
      gasMix,
      startPressureBar: startPressureByTank.get(index),
      endPressureBar: endPressureByTank.get(index),
    };

    // Attach tank metadata if available (by positional mapping)
    if (index < NTANKS && tanks[index].serial > 0) {
      cyl.tankSerial = tanks[index].serial;
    }
    if (index < NTANKS && tanks[index].name) {
      const name = tanks[index].name.trim();
      if (name) {
        cyl.tankName = name;
        cyl.description = name;
        // Determine tank usage from name
        if (isCcrMode(headerDiveMode) && !hpccr) {
          if (name.startsWith('O')) cyl.gasMix.usage = 'oxygen';
          else if (name.startsWith('D')) cyl.gasMix.usage = 'diluent';
        }
      }
    }
    if (index < NTANKS && tanks[index].maxPressure > 0) {
      cyl.maxPressureBar = psiToBar(tanks[index].maxPressure * 2);
    }
    if (index < NTANKS && tanks[index].reservePressure > 0) {
      cyl.reservePressureBar = psiToBar(tanks[index].reservePressure * 2);
    }
    if (index < NTANKS) {
      cyl.tankEnabled = tanks[index].enabled || tanks[index].active;
    }

    return cyl;
  });

  // ===== Build pressure source metadata =====
  const pressureSources: PressureSource[] = [];
  for (const [tankIndex, count] of sampleCountByTank) {
    const tankLabel = tanks[tankIndex]?.name?.trim();
    const channelLabel = tankLabel || `T${tankIndex + 1}`;
    const gasIndex = tankIndex < cylinders.length ? tankIndex : undefined;
    const gasName = gasIndex != null ? cylinders[gasIndex].gasMix.name : undefined;
    const confidence = gasIndex != null ? 'high' as const : 'unmapped' as const;

    pressureSources.push({
      tankIndex,
      channelLabel,
      role: tankIndex === 0 ? 'primary' : 'secondary',
      gasIndex,
      gasName,
      sampleCount: count,
      startPressureBar: startPressureByTank.get(tankIndex),
      endPressureBar: endPressureByTank.get(tankIndex),
      confidence,
    });
  }

  const startTime = new Date(manifestEntry.timestamp * 1000).toISOString();
  const maxDepthMeters = sampleMaxDepth > 0 ? sampleMaxDepth : closingMaxDepth;
  const durationSeconds = samples.length > 0
    ? Math.round(samples[samples.length - 1].timeSeconds)
    : closingDuration;

  const rawDataHash = hashRawData(raw, deviceInfo.serial, manifestEntry.timestamp);

  return {
    sourceFormat: 'SHEARWATER_BLE',
    sourceFileName: `ble://${deviceInfo.serial}`,
    diveNumberInFile: manifestEntry.diveNumber,
    startTime,
    timezoneOffset,
    durationSeconds,
    maxDepthMeters,
    meanDepthMeters: undefined,
    diveMode,
    minTemperatureCelsius: minTemp < 999 ? minTemp : undefined,
    maxTemperatureCelsius: maxTemp > -999 ? maxTemp : undefined,
    waterTemperatureCelsius: minTemp < 999 ? minTemp : undefined,
    site,
    computer: {
      manufacturer: 'Shearwater',
      model: modelName,
      serial: deviceInfo.serial,
      firmwareVersion: deviceInfo.firmware,
    },
    cylinders,
    samples,
    sampleIntervalSeconds: sampleInterval,
    events,
    pressureSources: pressureSources.length > 0 ? pressureSources : undefined,
    decoModel,
    gradientFactorLow: gfLow,
    gradientFactorHigh: gfHigh,
    vpmbConservatism,
    units,
    salinityDensity,
    atmosphericPressureBar: atmosphericPressureMbar != null ? atmosphericPressureMbar / 1000 : undefined,
    rawDataHash,
    parseWarnings:
      maxObservedPressureTank >= cylinders.length
        ? ['Additional pressure channels were present without matching gas definitions.']
        : [],
    isPartial: false,
  };
}

// ===== Helpers =====

function isAllZero(data: Uint8Array, offset: number, length: number): boolean {
  for (let i = 0; i < length; i++) {
    if (data[offset + i] !== 0) return false;
  }
  return true;
}

function uint16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function toSigned8(value: number): number {
  return value > 127 ? value - 256 : value;
}

function toSigned32BE(data: Uint8Array, offset: number): number {
  const unsigned = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
  return unsigned | 0; // Convert to signed 32-bit
}

function psiToBar(psi: number): number {
  return Math.round(psi * 0.0689476 * 10) / 10;
}

function bcd2dec(data: Uint8Array, offset: number, length: number): number {
  let result = 0;
  for (let i = 0; i < length; i++) {
    const byte = data[offset + i];
    result = result * 100 + ((byte >> 4) * 10) + (byte & 0x0F);
  }
  return result;
}

function decodeAscii2(data: Uint8Array, offset: number): string {
  const c0 = data[offset];
  const c1 = data[offset + 1];
  let s = '';
  if (c0 >= 0x20 && c0 <= 0x7e) s += String.fromCharCode(c0);
  if (c1 >= 0x20 && c1 <= 0x7e) s += String.fromCharCode(c1);
  return s;
}

function popcount(n: number): number {
  let count = 0;
  while (n) {
    count += n & 1;
    n >>>= 1;
  }
  return count;
}

function formatGasName(o2Pct: number, hePct: number): string {
  if (hePct > 0) return `Trimix ${o2Pct}/${hePct}`;
  if (o2Pct === 21 || o2Pct === 0) return 'Air';
  if (o2Pct === 100) return 'O2';
  return `EAN${o2Pct}`;
}

function hashRawData(raw: Uint8Array, serial: string, timestamp: number): string {
  const parts = [serial, timestamp.toString(), raw.length.toString()];
  const head = raw.slice(0, Math.min(64, raw.length));
  const tail = raw.slice(Math.max(0, raw.length - 64));
  for (let i = 0; i < head.length; i++) parts.push(head[i].toString(16));
  for (let i = 0; i < tail.length; i++) parts.push(tail[i].toString(16));
  const str = parts.join(':');
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return `ble-${serial}-${timestamp}-${hash.toString(16)}`;
}
