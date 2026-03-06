import type { ShearwaterDeviceInfo, ManifestEntry } from './types';
import type { ParsedDive, DiveSample, DiveCylinder, DiveGasMix, DiveEvent } from './types';
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
const REC_OPENING_1 = 0x11;
const REC_OPENING_4 = 0x14;
const REC_OPENING_5 = 0x15;
const REC_CLOSING_0 = 0x20;
const REC_INFO_EVENT = 0x30;
const REC_SAMPLE_EXT = 0xE1;
const REC_FINAL = 0xFF;

// Status flags
const OC_FLAG = 0x10;
const SC_FLAG = 0x08;
const GASSWITCH_FLAG = 0x01;

// AI modes
const AI_OFF = 0;
const AI_HPCCR = 4;

// Deco model types
const GF = 0;
const VPMB = 1;
const VPMB_GFS = 2;
const DCIEM = 3;

const NFIXED = 10;

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
  // This mirrors libdivecomputer's shearwater_predator_parser_cache()
  const opening: (number | undefined)[] = new Array(10).fill(undefined);
  const closing: (number | undefined)[] = new Array(10).fill(undefined);
  let finalOffset: number | undefined;
  let logVersion = 0;
  let aiMode = AI_OFF;
  let sampleInterval = 10; // Default 10 seconds

  if (pnf) {
    // PNF: scan all records to find opening/closing/final
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

    // Log version from OPENING_4 byte 16
    if (opening[4] != null) {
      logVersion = raw[opening[4] + 16];
    }

    // AI mode from OPENING_4 byte 28
    if (opening[4] != null && logVersion >= 7) {
      aiMode = raw[opening[4] + 28];
    }

    // Sample interval from OPENING_5 byte 23
    if (logVersion >= 9 && opening[5] != null) {
      const intervalRaw = (raw[opening[5] + 23] << 8) | raw[opening[5] + 24];
      if (intervalRaw > 0 && intervalRaw <= 60000) {
        sampleInterval = intervalRaw / 1000; // ms → seconds
      }
    }
  } else {
    // Legacy format: single 128-byte opening block at start
    for (let i = 0; i <= 4; i++) {
      opening[i] = 0;
    }
    logVersion = raw[127];
    // Footer: last 128 bytes (or 256 if petrel with final block)
    if (petrel) {
      finalOffset = raw.length - SZ_BLOCK;
    }
  }

  // ===== PHASE 2: Parse gas mixes from opening records =====
  const gasMixes = parseGasMixes(raw, pnf, opening);

  // ===== PHASE 3: Parse deco model + GF from opening records =====
  let decoModel: string | undefined;
  let gfLow: number | undefined;
  let gfHigh: number | undefined;
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
    } else if (modelByte === DCIEM) {
      decoModel = 'DCIEM';
    }
  }

  // ===== PHASE 4: Parse closing block for max depth / duration =====
  let closingMaxDepth = 0;
  let closingDuration = 0;
  if (closing[0] != null) {
    const co = closing[0];
    const maxDepthRaw = (raw[co + 4] << 8) | raw[co + 5];
    closingMaxDepth = maxDepthRaw / 10;
    if (pnf) {
      closingDuration = (raw[co + 6] << 16) | (raw[co + 7] << 8) | raw[co + 8];
    } else {
      closingDuration = ((raw[co + 6] << 8) | raw[co + 7]) * 60;
    }
  }

  // ===== PHASE 5: Get model from final block =====
  let modelFromDive = deviceInfo.modelId;
  if (finalOffset != null && finalOffset + 14 <= raw.length) {
    modelFromDive = raw[finalOffset + 13];
  }
  const modelName = DEVICE_MODELS[modelFromDive] ?? deviceInfo.model;

  // ===== PHASE 6: Parse samples =====
  const samples: DiveSample[] = [];
  const events: DiveEvent[] = [];
  let currentTime = 0;
  let maxTemp = -999;
  let minTemp = 999;
  let sampleMaxDepth = 0;
  let diveMode: 'OC' | 'CCR' | 'SCR' | 'GAUGE' | 'FREEDIVE' = 'OC';
  let diveModeSet = false;
  let prevO2 = -1;
  let prevHe = -1;

  for (let offset = 0; offset + sampleSize <= raw.length; offset += sampleSize) {
    if (isAllZero(raw, offset, sampleSize)) continue;

    const recordType = pnf ? raw[offset] : REC_DIVE_SAMPLE;

    // In legacy format, skip the header/footer
    if (!pnf) {
      if (offset < SZ_BLOCK) continue; // header
      if (offset >= raw.length - (petrel ? SZ_BLOCK * 2 : SZ_BLOCK)) continue; // footer
    }

    if (recordType !== REC_DIVE_SAMPLE && recordType !== REC_AVELO_SAMPLE) {
      // Handle info events
      if (recordType === REC_INFO_EVENT && pnf) {
        const eventType = raw[offset + 1];
        if (eventType === 38) { // TAG_LOG = bookmark
          events.push({
            timeSeconds: currentTime,
            type: 'BOOKMARK',
            description: 'Bookmark',
          });
        }
      }
      continue;
    }

    currentTime += sampleInterval;

    // Depth: 1/10 m at offset 0+pnf (big-endian uint16)
    const depthRaw = (raw[offset + pnf] << 8) | raw[offset + pnf + 1];
    const depthMeters = depthRaw / 10;
    if (depthMeters > sampleMaxDepth) sampleMaxDepth = depthMeters;

    // Temperature: signed byte at offset 13+pnf
    let temp = toSigned8(raw[offset + pnf + 13]);
    if (temp < 0) {
      temp += 102;
      if (temp > 0) temp = 0;
    }
    if (temp !== 0) {
      if (temp > maxTemp) maxTemp = temp;
      if (temp < minTemp) minTemp = temp;
    }

    // Status flags at offset 11+pnf
    const status = recordType !== REC_AVELO_SAMPLE ? raw[offset + 11 + pnf] : 0;
    const ccr = (status & OC_FLAG) === 0 && recordType !== REC_AVELO_SAMPLE;

    // Detect dive mode from first sample
    if (!diveModeSet && recordType === REC_DIVE_SAMPLE) {
      if (ccr) {
        diveMode = (status & SC_FLAG) ? 'SCR' : 'CCR';
      }
      diveModeSet = true;
    }

    // Gas change detection
    const o2 = raw[offset + pnf + 7];
    const he = raw[offset + pnf + 8];
    if ((o2 !== prevO2 || he !== prevHe) && (o2 !== 0 || he !== 0) && prevO2 >= 0) {
      events.push({
        timeSeconds: currentTime,
        type: 'GAS_SWITCH',
        description: `Switch to ${formatGasName(o2, he)}`,
      });
    }
    if (o2 !== 0 || he !== 0) {
      prevO2 = o2;
      prevHe = he;
    }

    const sample: DiveSample = {
      timeSeconds: currentTime,
      depthMeters,
      temperatureCelsius: temp !== 0 ? temp : undefined,
    };

    // Tank pressure (logversion >= 7, Petrel class)
    // Per libdivecomputer: idx[2] = {27, 19} — T1 at offset 27, T2 at offset 19
    if (logVersion >= 7 && petrel) {
      const pressureOffsets = [27, 19]; // T1 primary, T2 secondary
      const count = recordType === REC_AVELO_SAMPLE ? 1 : 2;
      for (let i = 0; i < count; i++) {
        const pressureRaw = (raw[offset + pnf + pressureOffsets[i]] << 8) | raw[offset + pnf + pressureOffsets[i] + 1];
        // Values >= 0xFFF0 are special codes (AI off, no comms, not paired)
        if (pressureRaw > 0 && pressureRaw < 0xFFF0) {
          const pressurePsi = (pressureRaw & 0x0FFF) * 2;
          if (pressurePsi > 0) {
            // Use first valid pressure reading (T1 preferred)
            if (sample.pressureBar == null) {
              sample.pressureBar = psiToBar(pressurePsi);
            }
          }
        }
      }
    }

    // Deco stop depth at offset 2+pnf (uint16, raw value = depth in meters for PNF, or tenths)
    const decoStopRaw = (raw[offset + pnf + 2] << 8) | raw[offset + pnf + 3];

    // TTS at offset 4+pnf (minutes, per libdivecomputer: tts * 60 for seconds)
    const ttsMinutes = (raw[offset + pnf + 4] << 8) | raw[offset + pnf + 5];

    // NDL/deco time at offset 9+pnf (minutes)
    const ndlDecoMinutes = raw[offset + pnf + 9];

    if (decoStopRaw > 0) {
      // In deco — decoStopRaw is depth value
      sample.ceilingMeters = decoStopRaw;
      if (ttsMinutes > 0 && ttsMinutes < 0xFFFF) {
        sample.ttsSeconds = ttsMinutes * 60;
      }
    } else {
      // Not in deco — ndlDecoMinutes is NDL
      if (ndlDecoMinutes > 0 && ndlDecoMinutes < 255) {
        sample.ndlSeconds = ndlDecoMinutes * 60;
      }
      if (ttsMinutes > 0 && ttsMinutes < 0xFFFF) {
        sample.ttsSeconds = ttsMinutes * 60;
      }
    }

    // CNS at offset 22+pnf (Petrel only, 0-100 raw = 0-100%)
    if (petrel) {
      const cns = raw[offset + pnf + 22];
      if (cns > 0 && cns < 255) {
        sample.cnsPercent = cns;
      }
    }

    // PPO2 for CCR at offset 6+pnf (1/100 bar)
    if (ccr) {
      const ppo2Raw = raw[offset + pnf + 6];
      if (ppo2Raw > 0) {
        sample.ppo2 = ppo2Raw / 100;
      }
      // Setpoint at offset 18+pnf (1/100 bar)
      if (petrel) {
        const setpoint = raw[offset + pnf + 18];
        if (setpoint > 0) {
          sample.setpoint = setpoint / 100;
        }
      }
    }

    samples.push(sample);
  }

  // ===== Build output =====
  const firstGas = gasMixes.length > 0 ? gasMixes[0] : { o2: 21, he: 0 };
  const gasMix: DiveGasMix = {
    oxygen: firstGas.o2 / 100,
    helium: firstGas.he / 100,
    nitrogen: Math.max(0, 1 - firstGas.o2 / 100 - firstGas.he / 100),
    name: formatGasName(firstGas.o2, firstGas.he),
  };

  const cylinders: DiveCylinder[] = [{
    index: 0,
    gasMix,
  }];

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
    durationSeconds,
    maxDepthMeters,
    meanDepthMeters: undefined,
    diveMode,
    minTemperatureCelsius: minTemp < 999 ? minTemp : undefined,
    maxTemperatureCelsius: maxTemp > -999 ? maxTemp : undefined,
    waterTemperatureCelsius: minTemp < 999 ? minTemp : undefined,
    site: undefined,
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
    decoModel,
    gradientFactorLow: gfLow,
    gradientFactorHigh: gfHigh,
    rawDataHash,
    parseWarnings: [],
    isPartial: false,
  };
}

/**
 * Parse gas mixes from opening records.
 */
function parseGasMixes(
  raw: Uint8Array,
  pnf: number,
  opening: (number | undefined)[]
): { o2: number; he: number }[] {
  const mixes: { o2: number; he: number }[] = [];

  if (pnf) {
    if (opening[0] == null) return mixes;
    const o0 = opening[0];

    const o2Values: number[] = [];
    const heValues: number[] = [];

    // OPENING_0: O2 at bytes 20-29, He at bytes 30-31
    for (let i = 0; i < NFIXED; i++) {
      o2Values.push(raw[o0 + 20 + i] || 0);
    }
    heValues.push(raw[o0 + 30] || 0);
    heValues.push(raw[o0 + 31] || 0);

    // OPENING_1: He at bytes 1-8 (mixes 2-9)
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
    // Legacy: O2 at bytes 20-29, He at bytes 30-39
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

function isAllZero(data: Uint8Array, offset: number, length: number): boolean {
  for (let i = 0; i < length; i++) {
    if (data[offset + i] !== 0) return false;
  }
  return true;
}

function toSigned8(value: number): number {
  return value > 127 ? value - 256 : value;
}

function psiToBar(psi: number): number {
  return Math.round(psi * 0.0689476 * 10) / 10;
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
