export { ShearwaterBle } from './shearwater-ble';
export { ShearwaterProtocol } from './shearwater-protocol';
export { parseShearwaterDive } from './shearwater-parser';
export {
  parseShearwaterDiveWasm,
  parseDiveWasm,
  getAvailableDevices,
  DC_FAMILY,
} from './libdc-parser';
export type { DcFamily, DiveComputerDescriptor } from './libdc-parser';
export { loadLibDC, isLibDCAvailable, configureLibDC } from './libdc-wasm-loader';
export type { LibDCModule, LibDCLoaderOptions } from './libdc-wasm-loader';
export { slipEncode, SlipDecoder } from './slip';
export {
  SHEARWATER_SERVICE_UUID,
  SHEARWATER_CHAR_UUID,
  DEVICE_MODELS,
  SLIP_END,
  SLIP_ESC,
  SLIP_ESC_END,
  SLIP_ESC_ESC,
  CMD_TESTER_PRESENT,
  CMD_RDBI_REQUEST,
  CMD_RDBI_RESPONSE,
  CMD_NAK,
  RDBI_SERIAL,
  RDBI_FIRMWARE,
  RDBI_LOGUPLOAD,
  RDBI_HARDWARE,
  RDBI_DEVICE_TYPE,
  RDBI_BOOTLOADER,
  RDBI_LOG_STATUS,
  LOG_INIT,
  LOG_BLOCK,
  LOG_QUIT,
  LOG_INIT_RESPONSE,
  LOG_BLOCK_RESPONSE,
  LOG_QUIT_RESPONSE,
  MANIFEST_ADDRESS,
  MANIFEST_SIZE,
  MANIFEST_ENTRY_SIZE,
  MANIFEST_VALID,
  MANIFEST_DELETED,
  PACKET_TIMEOUT_MS,
} from './constants';
export type {
  ShearwaterDeviceInfo,
  ShearwaterRdbiProbeRecord,
  ShearwaterConfigSnapshot,
  ShearwaterCapabilities,
  ShearwaterGasSlot,
  ShearwaterTransmitterSlot,
  PressureSource,
  ManifestEntry,
  BleConnectionState,
  DownloadProgress,
  DiveLogFormat,
  DiveGasMix,
  DiveCylinder,
  DiveSample,
  DiveSiteInfo,
  DiveComputerInfo,
  DiveEventType,
  DiveEvent,
  ParsedDive,
  DiveParseErrorCode,
  DiveParseError,
  DiveLogParseResult,
} from './types';
