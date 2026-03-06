# @gue/ble-divecomputer

BLE protocol implementation for Shearwater dive computers with a generic libdivecomputer WASM parser.

## Features

- **Shearwater BLE transport** — Web Bluetooth GATT connection, SLIP framing, request/response protocol
- **Shearwater protocol** — Device identification, manifest reading, compressed dive download
- **Shearwater parser** — Pure TypeScript parser for Shearwater Petrel/Predator binary format
- **libdivecomputer WASM** — Generic parser supporting 25+ dive computer families via precompiled WASM

## Install

```bash
npm install @gue/ble-divecomputer
```

## Quick Start

```typescript
import {
  ShearwaterBle,
  ShearwaterProtocol,
  parseShearwaterDiveWasm,
  isLibDCAvailable,
  configureLibDC,
} from '@gue/ble-divecomputer';

// Optional: configure WASM asset location (default: /libdivecomputer)
configureLibDC({ baseUrl: '/assets/libdivecomputer' });

// Connect to dive computer
const ble = new ShearwaterBle();
await ble.connect();

const protocol = new ShearwaterProtocol(ble);
protocol.startKeepAlive();

const info = await protocol.getDeviceInfo();
const manifest = await protocol.getManifest();

// Download and parse dives
for (const entry of manifest) {
  const raw = await protocol.downloadDive(entry);
  const dive = await parseShearwaterDiveWasm(raw, info, entry);
  console.log(dive);
}

ble.disconnect();
```

## WASM Assets

The package includes precompiled `libdc.wasm` and `libdc.js` in `dist/wasm/`.
Applications should serve those files directly from the installed package. Do
not copy them into the consuming repository.

To rebuild from source (requires Emscripten SDK):

```bash
git submodule update --init --recursive
bun run wasm:build
```

See [BUILD.md](./BUILD.md) for the reproducible build process and repository
boundary rules.

## License

LGPL-2.1. The WASM binary links against
[libdivecomputer](https://github.com/libdivecomputer/libdivecomputer), and all
code and artifacts derived from that upstream codebase are intentionally kept in
this repository.
