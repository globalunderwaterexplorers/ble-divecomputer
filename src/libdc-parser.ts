/**
 * Generic WASM-based dive parser using libdivecomputer.
 *
 * Supports ALL dive computer families compiled into the WASM binary.
 * The Shearwater wrapper is kept for backward compatibility.
 */

import type { ShearwaterDeviceInfo, ManifestEntry } from './types';
import type {
  ParsedDive,
  DiveSample,
  DiveCylinder,
  DiveGasMix,
  DiveEvent,
  DiveComputerInfo,
  DiveLogFormat,
} from './types';
import { loadLibDC, type LibDCModule } from './libdc-wasm-loader';

/* ---------- dc_family_t constants (mirrors common.h) ---------- */

export const DC_FAMILY = {
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
  HALCYON_SYMBIOS: 24 << 16,
} as const;

export type DcFamily = (typeof DC_FAMILY)[keyof typeof DC_FAMILY];

/* ---------- device descriptor (from libdc_list_descriptors) ---------- */

export interface DiveComputerDescriptor {
  vendor: string;
  product: string;
  family: number;
  model: number;
}

/* ---------- JSON shape returned by libdc-bridge.c ---------- */

interface LibDCResult {
  error?: string;
  datetime?: string | null;
  timezoneOffsetSeconds?: number;
  diveTimeSeconds?: number;
  maxDepthMeters?: number;
  avgDepthMeters?: number;
  minTemperatureCelsius?: number;
  maxTemperatureCelsius?: number;
  diveMode?: 'OC' | 'CCR' | 'SCR' | 'GAUGE' | 'FREEDIVE';
  decoModel?: {
    type: string;
    conservatism: number;
    gfLow?: number;
    gfHigh?: number;
  };
  salinity?: {
    type: 'fresh' | 'salt';
    density: number;
  };
  atmosphericPressureBar?: number;
  location?: {
    latitude: number;
    longitude: number;
  };
  gasMixes?: Array<{
    oxygen: number;
    helium: number;
    nitrogen: number;
    usage: string;
  }>;
  tanks?: Array<{
    gasmix: number;
    volume: number;
    workpressure: number;
    beginpressure: number;
    endpressure: number;
    usage: string;
  }>;
  samples?: Array<{
    timeSeconds: number;
    depthMeters: number;
    temperatureCelsius?: number;
    pressureBar?: number;
    pressureTank?: number;
    pressures?: Array<{ tank: number; bar: number }>;
    ppo2?: number;
    setpoint?: number;
    cns?: number;
    deco?: {
      type: 'ndl' | 'decostop' | 'safetystop' | 'deepstop';
      depth: number;
      time: number;
      tts: number;
    };
    gasmix?: number;
    bearing?: number;
    rbt?: number;
    heartbeat?: number;
  }>;
}

/* ---------- helpers ---------- */

function formatGasName(o2Pct: number, hePct: number): string {
  if (hePct > 0) return `Trimix ${o2Pct}/${hePct}`;
  if (o2Pct === 21) return 'Air';
  if (o2Pct === 100) return 'O2';
  return `EAN${o2Pct}`;
}

function formatDecoModel(dm: LibDCResult['decoModel']): string | undefined {
  if (!dm) return undefined;
  let s = dm.type;
  if (dm.gfLow !== undefined && dm.gfHigh !== undefined && dm.gfLow > 0) {
    s += ` GF ${dm.gfLow}/${dm.gfHigh}`;
  }
  return s;
}

function hashRawData(raw: Uint8Array, serial: string, timestamp: number): string {
  const parts = [serial, timestamp.toString(), raw.length.toString()];
  const head = raw.slice(0, Math.min(64, raw.length));
  const tail = raw.slice(Math.max(0, raw.length - 64));
  for (const b of head) parts.push(b.toString(16));
  for (const b of tail) parts.push(b.toString(16));
  const str = parts.join(':');
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return `ble-${serial}-${timestamp}-${hash.toString(16)}`;
}

/* ---------- call WASM bridge ---------- */

async function callWasmParser(
  raw: Uint8Array,
  family: number,
  model: number,
): Promise<LibDCResult> {
  const module: LibDCModule = await loadLibDC();

  const dataPtr = module._malloc(raw.length);
  if (dataPtr === 0) {
    throw new Error('WASM: Failed to allocate memory');
  }

  try {
    module.HEAPU8.set(raw, dataPtr);

    const resultPtr = module._libdc_parse_dive(dataPtr, raw.length, family, model);

    if (resultPtr === 0) {
      throw new Error('WASM: libdc_parse_dive returned null');
    }

    const jsonStr = module.UTF8ToString(resultPtr);
    module._libdc_free_result(resultPtr);

    const result: LibDCResult = JSON.parse(jsonStr);

    if (result.error) {
      throw new Error(`libdivecomputer: ${result.error}`);
    }

    return result;
  } finally {
    module._free(dataPtr);
  }
}

/* ---------- convert LibDCResult → ParsedDive ---------- */

interface ParseOptions {
  sourceFormat: DiveLogFormat;
  sourceFileName: string;
  diveNumber: number;
  timestamp: number;
  serial: string;
  computer?: DiveComputerInfo;
}

function convertToParseResult(
  r: LibDCResult,
  raw: Uint8Array,
  opts: ParseOptions,
): ParsedDive {
  // Gas mixes → DiveGasMix[]
  const gasMixes: DiveGasMix[] = (r.gasMixes || []).map((gm) => {
    const o2Pct = Math.round(gm.oxygen * 100);
    const hePct = Math.round(gm.helium * 100);
    return {
      oxygen: gm.oxygen,
      helium: gm.helium,
      nitrogen: gm.nitrogen,
      name: formatGasName(o2Pct, hePct),
    };
  });

  // Tanks → DiveCylinder[]
  const cylinders: DiveCylinder[] = (r.tanks || []).map((tk, i) => {
    const gasMix: DiveGasMix =
      tk.gasmix !== 0xffffffff && tk.gasmix < gasMixes.length
        ? gasMixes[tk.gasmix]
        : { oxygen: 0.21, helium: 0, nitrogen: 0.79, name: 'Air' };

    return {
      index: i,
      gasMix,
      sizeInLiters: tk.volume > 0 ? tk.volume : undefined,
      workPressureBar: tk.workpressure > 0 ? tk.workpressure : undefined,
      startPressureBar: tk.beginpressure > 0 ? tk.beginpressure : undefined,
      endPressureBar: tk.endpressure > 0 ? tk.endpressure : undefined,
    };
  });

  // If no tanks from libdc but we have gas mixes, create cylinders from mixes
  if (cylinders.length === 0 && gasMixes.length > 0) {
    gasMixes.forEach((gm, i) => {
      cylinders.push({ index: i, gasMix: gm });
    });
  }

  // Samples → DiveSample[]
  const samples: DiveSample[] = (r.samples || []).map((s) => {
    const sample: DiveSample = {
      timeSeconds: s.timeSeconds,
      depthMeters: s.depthMeters,
    };
    if (s.temperatureCelsius !== undefined)
      sample.temperatureCelsius = s.temperatureCelsius;
    if (s.pressureBar !== undefined) sample.pressureBar = s.pressureBar;
    if (s.ppo2 !== undefined) sample.ppo2 = s.ppo2;
    if (s.setpoint !== undefined) sample.setpoint = s.setpoint;
    if (s.cns !== undefined) sample.cnsPercent = Math.round(s.cns * 100);
    if (s.heartbeat !== undefined) sample.heartRateBpm = s.heartbeat;

    if (s.rbt !== undefined) sample.rbtSeconds = s.rbt;
    if (s.bearing !== undefined) sample.bearingDegrees = s.bearing;
    if (s.pressures && s.pressures.length > 0) {
      sample.tankPressures = s.pressures.filter(p => p.bar > 0);
    }

    // Deco info → NDL or TTS/ceiling
    if (s.deco) {
      if (s.deco.type === 'ndl') {
        sample.ndlSeconds = s.deco.time;
      } else {
        if (s.deco.depth > 0) sample.ceilingMeters = s.deco.depth;
        if (s.deco.tts > 0) sample.ttsSeconds = s.deco.tts;
      }
    }
    return sample;
  });

  // Events from gas switches
  const events: DiveEvent[] = [];
  if (r.samples) {
    let lastGasmix: number | undefined;
    for (const s of r.samples) {
      if (s.gasmix !== undefined && s.gasmix !== lastGasmix) {
        if (lastGasmix !== undefined) {
          const mix = gasMixes[s.gasmix];
          events.push({
            timeSeconds: s.timeSeconds,
            type: 'GAS_SWITCH',
            description: mix ? `Switch to ${mix.name}` : `Switch to mix ${s.gasmix}`,
            value: s.gasmix,
          });
        }
        lastGasmix = s.gasmix;
      }
    }
  }

  // Sample interval
  let sampleIntervalSeconds: number | undefined;
  if (samples.length >= 2) {
    sampleIntervalSeconds = samples[1].timeSeconds - samples[0].timeSeconds;
  }

  // Start time: prefer libdc datetime, fall back to timestamp
  const startTime = r.datetime || new Date(opts.timestamp * 1000).toISOString();

  // Timezone
  const timezoneOffset =
    r.timezoneOffsetSeconds !== undefined
      ? Math.round(r.timezoneOffsetSeconds / 60)
      : undefined;

  // Max CNS from samples
  let maxCns: number | undefined;
  for (const s of samples) {
    if (s.cnsPercent !== undefined && s.cnsPercent !== null) {
      if (maxCns === undefined || s.cnsPercent > maxCns) {
        maxCns = s.cnsPercent;
      }
    }
  }

  // Duration: prefer libdc, fall back to last sample time
  const durationSeconds =
    r.diveTimeSeconds ||
    (samples.length > 0 ? samples[samples.length - 1].timeSeconds : 0);

  // Extract gradient factors as separate integers
  const gradientFactorLow = r.decoModel?.gfLow !== undefined && r.decoModel.gfLow > 0
    ? r.decoModel.gfLow : undefined;
  const gradientFactorHigh = r.decoModel?.gfHigh !== undefined && r.decoModel.gfHigh > 0
    ? r.decoModel.gfHigh : undefined;

  // Compute decoStops from ceiling transitions in samples
  const decoStops: Array<{ depthMeters: number; durationSeconds: number }> = [];
  {
    let currentCeiling: number | null = null;
    let stopStart = 0;
    for (let i = 0; i < samples.length; i++) {
      const ceil = samples[i].ceilingMeters;
      if (ceil != null && ceil > 0) {
        const depth = Math.round(ceil);
        if (currentCeiling !== depth) {
          if (currentCeiling !== null) {
            const dur = samples[i].timeSeconds - stopStart;
            const existing = decoStops.find(s => s.depthMeters === currentCeiling);
            if (existing) existing.durationSeconds += dur;
            else decoStops.push({ depthMeters: currentCeiling, durationSeconds: dur });
          }
          currentCeiling = depth;
          stopStart = samples[i].timeSeconds;
        }
      } else if (currentCeiling !== null) {
        const dur = samples[i].timeSeconds - stopStart;
        const existing = decoStops.find(s => s.depthMeters === currentCeiling);
        if (existing) existing.durationSeconds += dur;
        else decoStops.push({ depthMeters: currentCeiling, durationSeconds: dur });
        currentCeiling = null;
      }
    }
    // Close any open stop at end
    if (currentCeiling !== null && samples.length > 0) {
      const dur = samples[samples.length - 1].timeSeconds - stopStart;
      const existing = decoStops.find(s => s.depthMeters === currentCeiling);
      if (existing) existing.durationSeconds += dur;
      else decoStops.push({ depthMeters: currentCeiling, durationSeconds: dur });
    }
    // Sort deepest first
    decoStops.sort((a, b) => b.depthMeters - a.depthMeters);
  }

  // Compute totalOtu from PPO2 samples: ((PPO2 - 0.5) / 0.5)^0.83 per minute when PPO2 > 0.5
  let totalOtu: number | undefined;
  if (samples.some(s => s.ppo2 != null)) {
    let otuSum = 0;
    for (let i = 1; i < samples.length; i++) {
      const ppo2 = samples[i].ppo2;
      if (ppo2 != null && ppo2 > 0.5) {
        const dt = (samples[i].timeSeconds - samples[i - 1].timeSeconds) / 60; // minutes
        otuSum += Math.pow((ppo2 - 0.5) / 0.5, 0.83) * dt;
      }
    }
    if (otuSum > 0) totalOtu = Math.round(otuSum);
  }

  // Salinity and atmospheric pressure
  const salinityDensity = r.salinity?.density;
  const atmosphericPressureBar = r.atmosphericPressureBar;

  const rawDataHash = hashRawData(raw, opts.serial, opts.timestamp);

  return {
    sourceFormat: opts.sourceFormat,
    sourceFileName: opts.sourceFileName,
    diveNumberInFile: opts.diveNumber,
    startTime,
    timezoneOffset,
    durationSeconds,
    maxDepthMeters: r.maxDepthMeters || 0,
    meanDepthMeters: r.avgDepthMeters,
    diveMode: r.diveMode || 'OC',
    minTemperatureCelsius: r.minTemperatureCelsius,
    maxTemperatureCelsius: r.maxTemperatureCelsius,
    waterTemperatureCelsius: r.minTemperatureCelsius,
    site: r.location
      ? { latitude: r.location.latitude, longitude: r.location.longitude }
      : undefined,
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
    decoStops: decoStops.length > 0 ? decoStops : undefined,
    salinityDensity,
    atmosphericPressureBar,
    rawDataHash,
    parseWarnings: [],
    isPartial: false,
  };
}

/* ---------- Shearwater battery extraction ---------- */

/**
 * Extract battery state from Shearwater raw BLE data.
 * Shearwater encodes battery status in the top 4 bits of the first pressure
 * word in each sample block. libdivecomputer strips these bits, so we parse
 * from the raw download bytes directly.
 *
 * Format: Shearwater Petrel/Perdix log blocks are 32-byte records starting
 * at offset 6. Byte 14-15 (big-endian) contain the primary pressure field.
 * Top 4 bits: 0=normal, 1=critical, 2=warning.
 */
function extractShearwaterBattery(
  raw: Uint8Array,
  modelId: number,
): { percent?: number; state: 'normal' | 'warning' | 'critical' } | undefined {
  // Only Petrel-family (modelId > 2) has the extended format
  if (modelId <= 2 || raw.length < 32) return undefined;

  const BLOCK_SIZE = 32;
  const HEADER_SIZE = 6;
  const PRESSURE_OFFSET = 14; // offset within each sample block

  // Scan sample blocks for battery bits
  let worstState: 0 | 1 | 2 = 0; // 0=normal, 1=critical, 2=warning

  for (let offset = HEADER_SIZE; offset + BLOCK_SIZE <= raw.length; offset += BLOCK_SIZE) {
    const pressureWord = (raw[offset + PRESSURE_OFFSET] << 8) | raw[offset + PRESSURE_OFFSET + 1];
    const batteryBits = (pressureWord >> 12) & 0x0F;
    if (batteryBits === 1) {
      worstState = 1; // critical is worst
      break;
    }
    if (batteryBits === 2 && worstState < 2) {
      worstState = 2;
    }
  }

  const stateMap: Record<number, 'normal' | 'warning' | 'critical'> = {
    0: 'normal',
    1: 'critical',
    2: 'warning',
  };

  return { state: stateMap[worstState] };
}

/* ========== PUBLIC API ========== */

/**
 * Generic dive parser — works with any dive computer family supported
 * by libdivecomputer. Use DC_FAMILY constants for the family parameter.
 *
 * @param raw       - Raw dive bytes
 * @param family    - dc_family_t value (use DC_FAMILY.*)
 * @param model     - Device model number within the family
 * @param computer  - Computer info for the output ParsedDive
 * @param options   - Additional metadata
 */
export async function parseDiveWasm(
  raw: Uint8Array,
  family: number,
  model: number,
  computer: DiveComputerInfo,
  options: {
    sourceFormat?: DiveLogFormat;
    sourceFileName?: string;
    diveNumber?: number;
    timestamp?: number;
    serial?: string;
  } = {},
): Promise<ParsedDive> {
  const result = await callWasmParser(raw, family, model);

  return convertToParseResult(result, raw, {
    sourceFormat: options.sourceFormat || 'SHEARWATER_BLE',
    sourceFileName: options.sourceFileName || `ble://${computer.serial || 'unknown'}`,
    diveNumber: options.diveNumber ?? 0,
    timestamp: options.timestamp ?? Math.floor(Date.now() / 1000),
    serial: options.serial || computer.serial || 'unknown',
    computer,
  });
}

/**
 * Parse raw Shearwater dive data using libdivecomputer WASM.
 * Backward-compatible wrapper — same signature as before.
 *
 * @param raw       - Raw dive bytes downloaded from the dive computer
 * @param deviceInfo - Device identification (serial, model, firmware)
 * @param manifestEntry - Manifest entry for this dive (index, timestamp)
 */
export async function parseShearwaterDiveWasm(
  raw: Uint8Array,
  deviceInfo: ShearwaterDeviceInfo,
  manifestEntry: ManifestEntry,
): Promise<ParsedDive> {
  // Shearwater: modelId <= 2 → Predator family, otherwise Petrel family
  const family =
    deviceInfo.modelId <= 2
      ? DC_FAMILY.SHEARWATER_PREDATOR
      : DC_FAMILY.SHEARWATER_PETREL;

  const result = await callWasmParser(raw, family, deviceInfo.modelId);

  const dive = convertToParseResult(result, raw, {
    sourceFormat: 'SHEARWATER_BLE',
    sourceFileName: `ble://${deviceInfo.serial}`,
    diveNumber: manifestEntry.index,
    timestamp: manifestEntry.timestamp,
    serial: deviceInfo.serial,
    computer: {
      manufacturer: 'Shearwater',
      model: deviceInfo.model,
      serial: deviceInfo.serial,
      firmwareVersion: deviceInfo.firmware,
    },
  });

  // Extract battery state from raw Shearwater BLE data
  const battery = extractShearwaterBattery(raw, deviceInfo.modelId);
  if (battery) {
    dive.batteryState = battery.state;
    if (battery.percent !== undefined) dive.batteryPercent = battery.percent;
  }

  return dive;
}

/**
 * Get all dive computer descriptors known to libdivecomputer.
 * Useful for building device picker UIs.
 */
export async function getAvailableDevices(): Promise<DiveComputerDescriptor[]> {
  const module: LibDCModule = await loadLibDC();

  const resultPtr = module._libdc_list_descriptors();
  if (resultPtr === 0) {
    return [];
  }

  const jsonStr = module.UTF8ToString(resultPtr);
  module._libdc_free_result(resultPtr);

  return JSON.parse(jsonStr) as DiveComputerDescriptor[];
}
