// ===== BLE Transport Types =====

export interface ShearwaterDeviceInfo {
  serial: string;
  firmware: string;
  hardware: string;
  model: string;
  modelId: number;
}

export interface ShearwaterRdbiProbeRecord {
  id: number;
  label?: string;
  length: number;
  data: Uint8Array;
  hex: string;
  ascii?: string;
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

// ===== Shearwater Configuration Snapshot Types =====

/** Declares which configuration data the Shearwater driver can currently provide. */
export interface ShearwaterCapabilities {
  /** True if the device responded to RDBI probes beyond the 4 core identifiers. */
  hasExtendedRdbi: boolean;
  /** True if gradient factor settings were decoded from RDBI. */
  hasGradientFactors: boolean;
  /** True if a gas table was decoded from RDBI. */
  hasGasTable: boolean;
  /** True if AI transmitter configuration was decoded from RDBI. */
  hasTransmitterConfig: boolean;
  /** True if battery status was decoded from RDBI. */
  hasBatteryStatus: boolean;
  /** True if ambient pressure was decoded from RDBI. */
  hasAmbientPressure: boolean;
  /** True if deco model was decoded from RDBI. */
  hasDecoModel: boolean;
}

/** A configured gas slot read from the device. */
export interface ShearwaterGasSlot {
  slot: number;
  oxygenPercent: number;
  heliumPercent: number;
  enabled: boolean;
}

/** AI transmitter pairing slot. */
export interface ShearwaterTransmitterSlot {
  slot: number;
  /** Raw pairing ID (0 = not paired). */
  pairingId: number;
  /** True if a transmitter is paired to this slot. */
  paired: boolean;
}

/** Structured configuration snapshot from a connected Shearwater device. */
export interface ShearwaterConfigSnapshot {
  capturedAt: string;
  capabilities: ShearwaterCapabilities;

  // Device identity (always available after connect)
  serial: string;
  firmware: string;
  hardware: string;
  model: string;
  modelId: number;

  // Battery and environment (from RDBI, may be unavailable)
  batteryPercent?: number;
  batteryVoltageMillivolts?: number;
  ambientPressureMbar?: number;

  // Deco configuration (from RDBI, may be unavailable)
  decoModel?: string;
  gradientFactorLow?: number;
  gradientFactorHigh?: number;

  // Gas table (from RDBI, may be unavailable)
  gases: ShearwaterGasSlot[];

  // AI transmitter pairings (from RDBI, may be unavailable)
  transmitters: ShearwaterTransmitterSlot[];

  // Raw RDBI probe results for all identifiers that responded
  rawRecords: ShearwaterRdbiProbeRecord[];
}

// ===== Dive Data Types =====

export type DiveLogFormat = 'UDDF' | 'SUBSURFACE' | 'SUUNTO_SDE' | 'SUUNTO_SML' | 'SHEARWATER' | 'SHEARWATER_BLE';

/** Gas mix definition */
export interface DiveGasMix {
  oxygen: number;   // fraction 0.0-1.0 (e.g., 0.21 for air)
  helium: number;   // fraction 0.0-1.0 (0 for non-trimix)
  nitrogen: number; // computed: 1 - oxygen - helium
  name?: string;    // human-readable: "Air", "EAN32", "Trimix 18/45"
  usage?: 'none' | 'diluent' | 'oxygen' | 'sidemount';
  enabled?: boolean;
  slotIndex?: number; // original 0-9 slot in the Shearwater gas table
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
  tankSerial?: number;
  tankName?: string;           // 2-char label from Shearwater: "T1", "O2", "Di"
  maxPressureBar?: number;
  reservePressureBar?: number;
  tankEnabled?: boolean;
}

/** Pressure source / transmitter channel metadata derived from dive data. */
export interface PressureSource {
  /** Tank index matching the `tank` field in DiveSample.tankPressures (0-based). */
  tankIndex: number;
  /** Channel label from the binary format (e.g. "T1", "T2"). */
  channelLabel: string;
  /** Role inferred from channel position and gas configuration. */
  role?: 'primary' | 'secondary' | 'stage' | 'deco';
  /** Index into the cylinders array, if a gas mapping could be established. */
  gasIndex?: number;
  /** Gas mix name at the mapped cylinder, if available. */
  gasName?: string;
  /** Number of samples that contained a valid pressure reading on this channel. */
  sampleCount: number;
  /** First observed pressure (bar). */
  startPressureBar?: number;
  /** Last observed pressure (bar). */
  endPressureBar?: number;
  /** Confidence that the gas mapping is correct. */
  confidence: 'high' | 'medium' | 'low' | 'unmapped';
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

  /** Pressure source metadata derived from the binary dive data. */
  pressureSources?: PressureSource[];

  decoModel?: string;
  gradientFactorLow?: number;
  gradientFactorHigh?: number;
  vpmbConservatism?: number;
  units?: 'metric' | 'imperial';
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
