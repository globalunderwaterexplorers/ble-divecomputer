/**
 * Low-level BLE transport for Shearwater dive computers.
 * Handles GATT connection, SLIP framing, BLE frame headers, and packet send/receive.
 *
 * Reference: libdivecomputer (https://github.com/libdivecomputer/libdivecomputer)
 *   - src/shearwater_common.c: shearwater_common_slip_write(), shearwater_common_slip_read()
 *
 * BLE frame format (each BLE write/notification):
 *   [frame_count, frame_number, ...SLIP_payload]
 *   Max 32 bytes per BLE write (2 header + 30 payload)
 *
 * Shearwater packet format (host → device, inside SLIP):
 *   [0xFF, 0x01, length, 0x00, ...command_data]
 *   length = command_data.length + 1
 *
 * Shearwater packet format (device → host, inside SLIP):
 *   [0x01, 0xFF, length, 0x00, ...response_data]
 *   response_data has length - 1 bytes
 */
declare class ShearwaterBle {
    private device;
    private characteristic;
    private slipDecoder;
    private pendingResponse;
    /** Queue for responses that arrive before sendPacket sets up pendingResponse */
    private responseQueue;
    private disconnectCallback;
    private useWriteWithResponse;
    private sendMutex;
    get connected(): boolean;
    get deviceName(): string | undefined;
    onDisconnect(cb: () => void): void;
    /**
     * Request a Shearwater device via Web Bluetooth and connect.
     */
    connect(): Promise<BluetoothDevice>;
    /**
     * Send a command and wait for the response.
     * Ref: shearwater_common_slip_write() in libdivecomputer src/shearwater_common.c
     *
     * Serialized via mutex — only one packet can be in-flight at a time.
     * This prevents keepalive pings from racing with data transfer commands.
     *
     * @param data - Raw command bytes (e.g. [0x22, id_hi, id_lo] for RDBI)
     * @param timeoutMs - Override the default packet timeout (ms)
     * @returns The response payload (header already stripped)
     */
    sendPacket(data: Uint8Array, timeoutMs?: number): Promise<Uint8Array>;
    private _sendPacketInner;
    /**
     * Reset the SLIP decoder, discarding any buffered partial data.
     * Call between transfers to ensure clean state.
     */
    resetDecoder(): void;
    disconnect(): void;
    private cleanup;
    /**
     * Handle incoming BLE notification.
     * Ref: shearwater_common_slip_read() in libdivecomputer src/shearwater_common.c
     */
    private handleNotification;
}

interface ShearwaterDeviceInfo {
    serial: string;
    firmware: string;
    hardware: string;
    model: string;
    modelId: number;
}
interface ManifestEntry {
    index: number;
    diveNumber: number;
    address: number;
    size: number;
    timestamp: number;
    endTimestamp: number;
    valid: boolean;
}
type BleConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reading-info' | 'ready';
interface DownloadProgress {
    currentDive: number;
    totalDives: number;
    currentBytes: number;
    totalBytes: number;
    phase: 'manifest' | 'downloading' | 'parsing' | 'done';
}
type DiveLogFormat = 'UDDF' | 'SUBSURFACE' | 'SUUNTO_SDE' | 'SUUNTO_SML' | 'SHEARWATER' | 'SHEARWATER_BLE';
/** Gas mix definition */
interface DiveGasMix {
    oxygen: number;
    helium: number;
    nitrogen: number;
    name?: string;
}
/** Cylinder / tank configuration */
interface DiveCylinder {
    index: number;
    description?: string;
    sizeInLiters?: number;
    workPressureBar?: number;
    startPressureBar?: number;
    endPressureBar?: number;
    gasMix: DiveGasMix;
}
/** A single time-series data point during a dive */
interface DiveSample {
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
    tankPressures?: Array<{
        tank: number;
        bar: number;
    }> | null;
}
/** Dive site / location */
interface DiveSiteInfo {
    name?: string;
    latitude?: number;
    longitude?: number;
    waterType?: 'salt' | 'fresh' | 'brackish';
}
/** Dive computer hardware */
interface DiveComputerInfo {
    manufacturer?: string;
    model?: string;
    serial?: string;
    firmwareVersion?: string;
}
type DiveEventType = 'ASCENT_RATE' | 'DECO_VIOLATION' | 'GAS_SWITCH' | 'BOOKMARK' | 'SURFACE' | 'SAFETY_STOP' | 'LOW_BATTERY' | 'PO2_HIGH' | 'PO2_LOW' | 'OTHER';
/** Warning or event during a dive */
interface DiveEvent {
    timeSeconds: number;
    type: DiveEventType;
    description?: string;
    value?: number;
}
/** Normalized dive record produced by all parsers */
interface ParsedDive {
    sourceFormat: DiveLogFormat;
    sourceFileName: string;
    diveNumberInFile: number;
    startTime: string;
    timezoneOffset?: number;
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
    decoStops?: Array<{
        depthMeters: number;
        durationSeconds: number;
    }>;
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
type DiveParseErrorCode = 'INVALID_XML' | 'UNKNOWN_FORMAT' | 'MISSING_REQUIRED_FIELD' | 'DEPTH_OUT_OF_RANGE' | 'DURATION_OUT_OF_RANGE' | 'TEMPERATURE_OUT_OF_RANGE' | 'PRESSURE_OUT_OF_RANGE' | 'TIMESTAMP_INVALID' | 'SAMPLE_ORDER_ERROR' | 'CORRUPT_DATA' | 'UNSUPPORTED_VERSION' | 'ZIP_EXTRACTION_FAILED' | 'TRUNCATED_PROFILE';
interface DiveParseError {
    diveIndex?: number;
    field?: string;
    code: DiveParseErrorCode;
    message: string;
    severity: 'error' | 'warning';
}
interface DiveLogParseResult {
    format: DiveLogFormat;
    fileName: string;
    totalDivesFound: number;
    dives: ParsedDive[];
    errors: DiveParseError[];
    formatVersion?: string;
    generatorSoftware?: string;
}

declare class ShearwaterProtocol {
    private ble;
    private baseAddr;
    private keepAliveTimer;
    private transferActive;
    constructor(ble: ShearwaterBle);
    /**
     * Some Shearwater devices need a brief pause after GATT connect before the
     * first protocol request, otherwise the initial RDBI often times out.
     */
    waitForReady(delayMs?: number): Promise<void>;
    /** BLE advertised device name (e.g. "Perdix AI 12345") — fallback for model display */
    get bleDeviceName(): string | undefined;
    /**
     * Start periodic keepalive pings to prevent the dive computer from
     * exiting its UDS diagnostic session during idle periods.
     * Uses ISO 14229 TesterPresent (0x3E) — the standard UDS session
     * keepalive — every 4 seconds.  Pauses during active data transfers.
     */
    startKeepAlive(): void;
    stopKeepAlive(): void;
    /**
     * Read device info via RDBI commands.
     * Retries the first RDBI if it times out — some devices need time after GATT connect.
     */
    getDeviceInfo(): Promise<ShearwaterDeviceInfo>;
    /**
     * Read the log upload base address via RDBI 0x8021.
     * Ref: shearwater_petrel_device_open() in libdivecomputer src/shearwater_petrel.c
     *   Response is 9 bytes, base_addr = uint32_be at offset 1
     *   Map known values to canonical base addresses.
     */
    readBaseAddr(): Promise<number>;
    /**
     * Read the dive manifest from flash memory.
     * Ref: shearwater_petrel_device_foreach() in libdivecomputer src/shearwater_petrel.c
     * Returns entries sorted by timestamp descending (most recent first).
     */
    getManifest(): Promise<ManifestEntry[]>;
    private parseManifestPage;
    private getManifestPageSignature;
    /**
     * Diagnose download parameters by trying all combinations of
     * address, size, and compression to find what the device accepts.
     * Results are logged to the console.
     */
    diagnoseDownload(entry: ManifestEntry): Promise<void>;
    /**
     * Download raw dive data from flash memory.
     * Per libdivecomputer: uses base_addr + address, DIVE_SIZE (0xFFFFFF), compressed mode.
     *
     * IMPORTANT: libdivecomputer always requests DIVE_SIZE (16MB), not the actual dive
     * size from the manifest. The compressed transfer ends naturally when the 9-bit LRE
     * stream contains a zero value (end-of-stream marker). Using the manifest size would
     * cause us to keep requesting blocks after the device considers the transfer complete,
     * resulting in "Trans Req Seq" errors.
     */
    downloadDive(entry: ManifestEntry, onProgress?: (bytes: number) => void): Promise<Uint8Array>;
    /**
     * Send an RDBI (Read Data By Identifier) request.
     * Command: [0x22, id_hi, id_lo]
     * Response: [0x62, id_hi, id_lo, ...data]
     */
    private rdbi;
    /**
     * Read a block of flash memory using the log upload protocol.
     * Ref: shearwater_common_download() in libdivecomputer src/shearwater_common.c
     *
     * Uses compressed transfer mode (0x10) per modern Shearwater firmware.
     *
     * Protocol:
     *   Init:  [0x35, compression, 0x34, addr(4), size(3)]  → response [0x75, ...]
     *   Block: [0x36, block_counter]                         → response [0x76, block_counter, ...data]
     *   Quit:  [0x37]                                        → response [0x77]
     *
     * Compression: zero-run-length encoding.
     *   Non-zero byte → literal. Zero byte + count → that many zero bytes.
     */
    private readMemory;
    private _readMemory;
    /**
     * Decompress one block of 9-bit LRE data (Phase 1 of Shearwater compression).
     * Ref: shearwater_common_decompress_lre() in libdivecomputer src/shearwater_common.c
     *
     * Called per-block during transfer so we can detect the end-of-stream marker
     * and stop requesting blocks before the device NAKs.
     *
     * @returns true if end-of-stream marker was found (value == 0)
     */
    private decompressLreBlock;
    private decodeAscii;
    private decodeFirmwareVersion;
}

declare function parseShearwaterDive(raw: Uint8Array, deviceInfo: ShearwaterDeviceInfo, manifestEntry: ManifestEntry): ParsedDive;

/**
 * Generic WASM-based dive parser using libdivecomputer.
 *
 * Supports ALL dive computer families compiled into the WASM binary.
 * The Shearwater wrapper is kept for backward compatibility.
 */

declare const DC_FAMILY: {
    readonly NULL: 0;
    readonly SUUNTO_SOLUTION: number;
    readonly SUUNTO_EON: number;
    readonly SUUNTO_VYPER: number;
    readonly SUUNTO_VYPER2: number;
    readonly SUUNTO_D9: number;
    readonly SUUNTO_EONSTEEL: number;
    readonly REEFNET_SENSUS: number;
    readonly REEFNET_SENSUSPRO: number;
    readonly REEFNET_SENSUSULTRA: number;
    readonly UWATEC_ALADIN: number;
    readonly UWATEC_MEMOMOUSE: number;
    readonly UWATEC_SMART: number;
    readonly OCEANIC_VTPRO: number;
    readonly OCEANIC_VEO250: number;
    readonly OCEANIC_ATOM2: number;
    readonly PELAGIC_I330R: number;
    readonly MARES_NEMO: number;
    readonly MARES_PUCK: number;
    readonly MARES_DARWIN: number;
    readonly MARES_ICONHD: number;
    readonly HW_OSTC: number;
    readonly HW_FROG: number;
    readonly HW_OSTC3: number;
    readonly CRESSI_EDY: number;
    readonly CRESSI_LEONARDO: number;
    readonly CRESSI_GOA: number;
    readonly ZEAGLE_N2ITION3: number;
    readonly ATOMICS_COBALT: number;
    readonly SHEARWATER_PREDATOR: number;
    readonly SHEARWATER_PETREL: number;
    readonly DIVERITE_NITEKQ: number;
    readonly CITIZEN_AQUALAND: number;
    readonly DIVESYSTEM_IDIVE: number;
    readonly COCHRAN_COMMANDER: number;
    readonly TECDIVING_DIVECOMPUTEREU: number;
    readonly MCLEAN_EXTREME: number;
    readonly LIQUIVISION_LYNX: number;
    readonly SPORASUB_SP2: number;
    readonly DEEPSIX_EXCURSION: number;
    readonly SEAC_SCREEN: number;
    readonly DEEPBLU_COSMIQ: number;
    readonly OCEANS_S1: number;
    readonly DIVESOFT_FREEDOM: number;
    readonly HALCYON_SYMBIOS: number;
};
type DcFamily = (typeof DC_FAMILY)[keyof typeof DC_FAMILY];
interface DiveComputerDescriptor {
    vendor: string;
    product: string;
    family: number;
    model: number;
}
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
declare function parseDiveWasm(raw: Uint8Array, family: number, model: number, computer: DiveComputerInfo, options?: {
    sourceFormat?: DiveLogFormat;
    sourceFileName?: string;
    diveNumber?: number;
    timestamp?: number;
    serial?: string;
}): Promise<ParsedDive>;
/**
 * Parse raw Shearwater dive data using libdivecomputer WASM.
 * Backward-compatible wrapper — same signature as before.
 *
 * @param raw       - Raw dive bytes downloaded from the dive computer
 * @param deviceInfo - Device identification (serial, model, firmware)
 * @param manifestEntry - Manifest entry for this dive (index, timestamp)
 */
declare function parseShearwaterDiveWasm(raw: Uint8Array, deviceInfo: ShearwaterDeviceInfo, manifestEntry: ManifestEntry): Promise<ParsedDive>;
/**
 * Get all dive computer descriptors known to libdivecomputer.
 * Useful for building device picker UIs.
 */
declare function getAvailableDevices(): Promise<DiveComputerDescriptor[]>;

/**
 * Singleton lazy loader for the libdivecomputer WASM module.
 *
 * Loads the Emscripten-compiled WASM module from a configurable base URL.
 * Default: '/libdivecomputer' (backward compatible with Vite public dir).
 */
/** Emscripten module interface — only the bits we use */
interface LibDCModule {
    _libdc_parse_dive(data: number, size: number, family: number, model: number): number;
    _libdc_list_descriptors(): number;
    _libdc_free_result(ptr: number): void;
    _malloc(size: number): number;
    _free(ptr: number): void;
    HEAPU8: Uint8Array;
    UTF8ToString(ptr: number): string;
}
/** Configuration options for the WASM loader */
interface LibDCLoaderOptions {
    /** Base URL where libdc.js and libdc.wasm are served. Default: '/libdivecomputer' */
    baseUrl?: string;
}
/**
 * Configure the default base URL for WASM assets.
 * Call before first loadLibDC() invocation.
 */
declare function configureLibDC(options: LibDCLoaderOptions): void;
/**
 * Load the libdivecomputer WASM module (cached singleton).
 * Returns the Emscripten module instance.
 */
declare function loadLibDC(options?: LibDCLoaderOptions): Promise<LibDCModule>;
/**
 * Check if the WASM module is available (built and served).
 * Does a quick HEAD request to avoid loading the full module.
 */
declare function isLibDCAvailable(options?: LibDCLoaderOptions): Promise<boolean>;

/**
 * SLIP-encode a payload: escaped data + END
 *
 * Note: libdivecomputer does NOT send a leading END byte for BLE —
 * only a trailing END. See shearwater_common_slip_write() in
 * libdivecomputer src/shearwater_common.c.
 */
declare function slipEncode(data: Uint8Array): Uint8Array;
/**
 * Streaming SLIP decoder. Buffers incoming BLE notification chunks
 * and emits complete decoded frames.
 */
declare class SlipDecoder {
    private buffer;
    private inEscape;
    /**
     * Feed incoming BLE data. Returns array of complete decoded frames.
     */
    feed(chunk: Uint8Array): Uint8Array[];
    reset(): void;
}

declare const SHEARWATER_SERVICE_UUID = "fe25c237-0ece-443c-b0aa-e02033e7029d";
declare const SHEARWATER_CHAR_UUID = "27b7570b-359e-45a3-91bb-cf7e70049bd2";
declare const SLIP_END = 192;
declare const SLIP_ESC = 219;
declare const SLIP_ESC_END = 220;
declare const SLIP_ESC_ESC = 221;
declare const CMD_TESTER_PRESENT = 62;
declare const CMD_RDBI_REQUEST = 34;
declare const CMD_RDBI_RESPONSE = 98;
declare const CMD_NAK = 127;
declare const RDBI_SERIAL = 32784;
declare const RDBI_FIRMWARE = 32785;
declare const RDBI_LOGUPLOAD = 32801;
declare const RDBI_HARDWARE = 32848;
declare const LOG_INIT = 53;
declare const LOG_BLOCK = 54;
declare const LOG_QUIT = 55;
declare const LOG_INIT_RESPONSE = 117;
declare const LOG_BLOCK_RESPONSE = 118;
declare const LOG_QUIT_RESPONSE = 119;
declare const MANIFEST_ADDRESS = 3758096384;
declare const MANIFEST_SIZE = 1536;
declare const MANIFEST_ENTRY_SIZE = 32;
declare const MANIFEST_VALID = 42436;
declare const MANIFEST_DELETED = 23075;
declare const DEVICE_MODELS: Record<number, string>;
declare const PACKET_TIMEOUT_MS = 10000;

export { type BleConnectionState, CMD_NAK, CMD_RDBI_REQUEST, CMD_RDBI_RESPONSE, CMD_TESTER_PRESENT, DC_FAMILY, DEVICE_MODELS, type DcFamily, type DiveComputerDescriptor, type DiveComputerInfo, type DiveCylinder, type DiveEvent, type DiveEventType, type DiveGasMix, type DiveLogFormat, type DiveLogParseResult, type DiveParseError, type DiveParseErrorCode, type DiveSample, type DiveSiteInfo, type DownloadProgress, LOG_BLOCK, LOG_BLOCK_RESPONSE, LOG_INIT, LOG_INIT_RESPONSE, LOG_QUIT, LOG_QUIT_RESPONSE, type LibDCLoaderOptions, type LibDCModule, MANIFEST_ADDRESS, MANIFEST_DELETED, MANIFEST_ENTRY_SIZE, MANIFEST_SIZE, MANIFEST_VALID, type ManifestEntry, PACKET_TIMEOUT_MS, type ParsedDive, RDBI_FIRMWARE, RDBI_HARDWARE, RDBI_LOGUPLOAD, RDBI_SERIAL, SHEARWATER_CHAR_UUID, SHEARWATER_SERVICE_UUID, SLIP_END, SLIP_ESC, SLIP_ESC_END, SLIP_ESC_ESC, ShearwaterBle, type ShearwaterDeviceInfo, ShearwaterProtocol, SlipDecoder, configureLibDC, getAvailableDevices, isLibDCAvailable, loadLibDC, parseDiveWasm, parseShearwaterDive, parseShearwaterDiveWasm, slipEncode };
