// Shearwater BLE service and characteristic UUIDs
export const SHEARWATER_SERVICE_UUID = 'fe25c237-0ece-443c-b0aa-e02033e7029d';
export const SHEARWATER_CHAR_UUID = '27b7570b-359e-45a3-91bb-cf7e70049bd2';

// SLIP framing bytes
export const SLIP_END = 0xc0;
export const SLIP_ESC = 0xdb;
export const SLIP_ESC_END = 0xdc;
export const SLIP_ESC_ESC = 0xdd;

// UDS-style commands
export const CMD_TESTER_PRESENT = 0x3e; // ISO 14229 TesterPresent — keeps session alive
export const CMD_RDBI_REQUEST = 0x22;
export const CMD_RDBI_RESPONSE = 0x62;
export const CMD_NAK = 0x7f;

// RDBI data identifiers — core (used by libdivecomputer)
export const RDBI_SERIAL = 0x8010;
export const RDBI_FIRMWARE = 0x8011;
export const RDBI_LOGUPLOAD = 0x8021;
export const RDBI_HARDWARE = 0x8050;

// RDBI data identifiers — discovered via hardware probing (Perdix 2, V95 Classic)
// These respond but their payloads are not yet fully decoded.
export const RDBI_DEVICE_TYPE = 0x8000;   // 1 byte — device type flag (observed: 0x01)
export const RDBI_BOOTLOADER = 0x8012;    // 1 byte — bootloader/feature flag (observed: 0x00)
export const RDBI_LOG_STATUS = 0x8020;    // 9 bytes — log memory status block

// Log download commands (direct, not WDBI-wrapped)
export const LOG_INIT = 0x35;
export const LOG_BLOCK = 0x36;
export const LOG_QUIT = 0x37;
export const LOG_INIT_RESPONSE = 0x75;
export const LOG_BLOCK_RESPONSE = 0x76;
export const LOG_QUIT_RESPONSE = 0x77;

// Manifest constants
export const MANIFEST_ADDRESS = 0xe0000000;
export const MANIFEST_SIZE = 0x600; // 1536 bytes
export const MANIFEST_ENTRY_SIZE = 32;
export const MANIFEST_VALID = 0xa5c4;
export const MANIFEST_DELETED = 0x5a23;

// Device model IDs
export const DEVICE_MODELS: Record<number, string> = {
  2: 'Predator',
  3: 'Petrel',
  4: 'Nerd',
  5: 'Perdix',
  6: 'Perdix AI',
  7: 'Nerd 2',
  8: 'Teric',
  9: 'Peregrine',
  10: 'Petrel 3',
  11: 'Perdix 2',
  12: 'Tern',
  13: 'Peregrine TX',
  // Hardware revision bytes observed on some devices — map to known models
  196: 'Perdix 2', // 0xC4 — reported by Perdix 2 hardware RDBI
};

// BLE communication timeout (ms)
export const PACKET_TIMEOUT_MS = 10000;
