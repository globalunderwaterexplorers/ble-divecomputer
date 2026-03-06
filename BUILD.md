# Build And Licensing Notes

`@gue/ble-divecomputer` is the sole repository that may contain code and build
artifacts derived from `libdivecomputer`, including:

- the `wasm/` build scripts and bridge code
- the `wasm/libdivecomputer` upstream submodule
- generated `dist/*`
- generated `dist/wasm/*`

Consumers such as Studio must depend on this package and must not vendor copies
of these files into their own repositories.

## Upstream Source

- Upstream project: `https://github.com/libdivecomputer/libdivecomputer.git`
- Submodule path: `wasm/libdivecomputer`
- Track a pinned submodule commit for each package release.

To inspect the pinned revision:

```bash
git submodule status wasm/libdivecomputer
```

## Build Prerequisites

- Bun
- Emscripten SDK with `emcc` on `PATH`

## Rebuild

```bash
git submodule update --init --recursive
bun install
bun run wasm:build
bun run build
```

Expected outputs:

- `dist/index.js`
- `dist/index.cjs`
- `dist/index.d.ts`
- `dist/index.d.cts`
- `dist/wasm/libdc.js`
- `dist/wasm/libdc.wasm`

## Verify Artifacts

```bash
shasum dist/index.js dist/index.d.ts dist/wasm/libdc.js dist/wasm/libdc.wasm
```

## Consumer Guidance

Consumers should:

1. install `@gue/ble-divecomputer` as a dependency
2. serve `dist/wasm/libdc.js` and `dist/wasm/libdc.wasm` from `node_modules`
3. configure runtime loading via `configureLibDC({ baseUrl })` if needed

Consumers must not:

- copy `dist/*` into their own source tree
- commit `libdc.wasm` outside this package repo
- commit the upstream `libdivecomputer` source outside this package repo
