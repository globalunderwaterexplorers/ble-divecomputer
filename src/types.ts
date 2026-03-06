// ===== BLE Transport Types =====

export interface ShearwaterDeviceInfo {
  serial: string;
  firmware: string;
  hardware: string;
  model: string;
  modelId: number;
}

export interface ManifestEntry {
  index: number;
  diveNumber: number;  // dive sequence number from computer
  address: number;     // flash memory start address
  size: number;        // dive data size in bytes (endAddress - address)
  timestamp: number;   // dive start time, unix epoch seconds
  endTimestamp: number; // dive end time, unix epoch seconds
  valid: boolean;
}

export type BleConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reading-info'
  | 'ready';

export interface DownloadProgress {
  currentDive: number;
  totalDives: number;
  currentBytes: number;
  totalBytes: number;
  phase: 'manifest' | 'downloading' | 'parsing' | 'done';
}

// ===== Dive Data Types =====

export type DiveLogFormat = 'UDDF' | 'SUBSURFACE' | 'SUUNTO_SDE' | 'SUUNTO_SML' | 'SHEARWATER' | 'SHEARWATER_BLE';

/** Gas mix definition */
export interface DiveGasMix {
  oxygen: number;   // fraction 0.0-1.0 (e.g., 0.21 for air)
  helium: number;   // fraction 0.0-1.0 (0 for non-trimix)
  nitrogen: number; // computed: 1 - oxygen - helium
  name?: string;    // human-readable: "Air", "EAN32", "Trimix 18/45"
}

/** Cylinder / tank configuration */
export interface DiveCylinder {
  index: number;
  description?: string;        // "AL80", "Steel 12L"
  sizeInLiters?: number;
  workPressureBar?: number;
  startPressureBar?: number;
  endPressureBar?: number;
  gasMix: DiveGasMix;
}

/** A single time-series data point during a dive */
export interface DiveSample {
  timeSeconds: number;
  depthMeters: number;
  temperatureCelsius?: number | null;
  pressureBar?: number | null;
  heartRateBpm?: number | null;
  ndlSeconds?: number | null;
  ceilingMeters?: number | null;
  ttsSeconds?: number | null;
  cnsPercent?: number | null;
  ppo2?: number | null;
  setpoint?: number | null;
  tissueLoading?: number[] | null;
  rbtSeconds?: number | null;
  bearingDegrees?: number | null;
  tankPressures?: Array<{ tank: number; bar: number }> | null;
}

/** Dive site / location */
export interface DiveSiteInfo {
  name?: string;
  latitude?: number;
  longitude?: number;
  waterType?: 'salt' | 'fresh' | 'brackish';
}

/** Dive computer hardware */
export interface DiveComputerInfo {
  manufacturer?: string;
  model?: string;
  serial?: string;
  firmwareVersion?: string;
}

export type DiveEventType =
  | 'ASCENT_RATE'
  | 'DECO_VIOLATION'
  | 'GAS_SWITCH'
  | 'BOOKMARK'
  | 'SURFACE'
  | 'SAFETY_STOP'
  | 'LOW_BATTERY'
  | 'PO2_HIGH'
  | 'PO2_LOW'
  | 'OTHER';

/** Warning or event during a dive */
export interface DiveEvent {
  timeSeconds: number;
  type: DiveEventType;
  description?: string;
  value?: number;
}

/** Normalized dive record produced by all parsers */
export interface ParsedDive {
  sourceFormat: DiveLogFormat;
  sourceFileName: string;
  diveNumberInFile: number;

  startTime: string;           // ISO 8601
  timezoneOffset?: number;     // minutes from UTC
  durationSeconds: number;
  surfaceIntervalSeconds?: number;

  maxDepthMeters: number;
  meanDepthMeters?: number;
  minTemperatureCelsius?: number;
  maxTemperatureCelsius?: number;
  waterTemperatureCelsius?: number;
  airTemperatureCelsius?: number;

  diveMode?: 'OC' | 'CCR' | 'SCR' | 'FREEDIVE' | 'GAUGE';

  cylinders: DiveCylinder[];
  weightKg?: number;

  site?: DiveSiteInfo;
  computer?: DiveComputerInfo;

  samples: DiveSample[];
  sampleIntervalSeconds?: number;

  events: DiveEvent[];

  decoModel?: string;
  gradientFactorLow?: number;
  gradientFactorHigh?: number;
  maxCnsPercent?: number;
  totalOtu?: number;
  decoStops?: Array<{ depthMeters: number; durationSeconds: number }>;

  notes?: string;
  buddy?: string;
  divemaster?: string;
  rating?: number;
  visibility?: string;
  tags?: string[];

  salinityDensity?: number;
  atmosphericPressureBar?: number;
  batteryPercent?: number;
  batteryState?: 'normal' | 'warning' | 'critical';

  rawDataHash: string;
  parseWarnings: string[];
  isPartial: boolean;
}

export type DiveParseErrorCode =
  | 'INVALID_XML'
  | 'UNKNOWN_FORMAT'
  | 'MISSING_REQUIRED_FIELD'
  | 'DEPTH_OUT_OF_RANGE'
  | 'DURATION_OUT_OF_RANGE'
  | 'TEMPERATURE_OUT_OF_RANGE'
  | 'PRESSURE_OUT_OF_RANGE'
  | 'TIMESTAMP_INVALID'
  | 'SAMPLE_ORDER_ERROR'
  | 'CORRUPT_DATA'
  | 'UNSUPPORTED_VERSION'
  | 'ZIP_EXTRACTION_FAILED'
  | 'TRUNCATED_PROFILE';

export interface DiveParseError {
  diveIndex?: number;
  field?: string;
  code: DiveParseErrorCode;
  message: string;
  severity: 'error' | 'warning';
}

export interface DiveLogParseResult {
  format: DiveLogFormat;
  fileName: string;
  totalDivesFound: number;
  dives: ParsedDive[];
  errors: DiveParseError[];
  formatVersion?: string;
  generatorSoftware?: string;
}
