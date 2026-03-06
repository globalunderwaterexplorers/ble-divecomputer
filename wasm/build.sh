#!/usr/bin/env bash
#
# Build libdivecomputer as WASM module — ALL parser families.
#
# Prerequisites: Emscripten SDK (emsdk) activated in PATH.
# Usage: ./build.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIBDC_DIR="$SCRIPT_DIR/libdivecomputer"
WASM_DIR="$SCRIPT_DIR"
OUTPUT_DIR="$SCRIPT_DIR/../dist/wasm"

echo "=== Building libdivecomputer WASM (all parsers) ==="

# Verify emcc is available
if ! command -v emcc &>/dev/null; then
    echo "ERROR: emcc not found. Install and activate Emscripten SDK:"
    echo "  git clone https://github.com/nicknisi/emsdk.git"
    echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

# Generate version.h from template
echo "--- Generating version.h ---"
sed -e 's/@DC_VERSION@/0.10.0-wasm/' \
    -e 's/@DC_VERSION_MAJOR@/0/' \
    -e 's/@DC_VERSION_MINOR@/10/' \
    -e 's/@DC_VERSION_MICRO@/0/' \
    "$LIBDC_DIR/include/libdivecomputer/version.h.in" \
    > "$LIBDC_DIR/include/libdivecomputer/version.h"

# Generate revision.h stub (normally created by autotools)
echo "--- Generating revision.h ---"
cat > "$LIBDC_DIR/src/revision.h" <<'HEADER'
#ifndef REVISION_H
#define REVISION_H
#define DC_VERSION_REVISION "wasm"
#endif
HEADER

mkdir -p "$OUTPUT_DIR"

# Source files — complete list from Makefile.am
# This compiles ALL parser families so dc_parser_new2() works generically.
LIBDC_SOURCES=(
    # Core infrastructure
    "$LIBDC_DIR/src/version.c"
    "$LIBDC_DIR/src/descriptor.c"
    "$LIBDC_DIR/src/iostream.c"
    "$LIBDC_DIR/src/iterator.c"
    "$LIBDC_DIR/src/common.c"
    "$LIBDC_DIR/src/context.c"
    "$LIBDC_DIR/src/device.c"
    "$LIBDC_DIR/src/parser.c"
    "$LIBDC_DIR/src/datetime.c"
    "$LIBDC_DIR/src/timer.c"
    "$LIBDC_DIR/src/platform.c"
    # Utility
    "$LIBDC_DIR/src/ringbuffer.c"
    "$LIBDC_DIR/src/rbstream.c"
    "$LIBDC_DIR/src/checksum.c"
    "$LIBDC_DIR/src/array.c"
    "$LIBDC_DIR/src/buffer.c"
    "$LIBDC_DIR/src/ihex.c"
    "$LIBDC_DIR/src/aes.c"
    "$LIBDC_DIR/src/hdlc.c"
    "$LIBDC_DIR/src/packet.c"
    # Suunto
    "$LIBDC_DIR/src/suunto_common.c"
    "$LIBDC_DIR/src/suunto_common2.c"
    "$LIBDC_DIR/src/suunto_solution.c"
    "$LIBDC_DIR/src/suunto_solution_parser.c"
    "$LIBDC_DIR/src/suunto_eon.c"
    "$LIBDC_DIR/src/suunto_eon_parser.c"
    "$LIBDC_DIR/src/suunto_vyper.c"
    "$LIBDC_DIR/src/suunto_vyper_parser.c"
    "$LIBDC_DIR/src/suunto_vyper2.c"
    "$LIBDC_DIR/src/suunto_d9.c"
    "$LIBDC_DIR/src/suunto_d9_parser.c"
    "$LIBDC_DIR/src/suunto_eonsteel.c"
    "$LIBDC_DIR/src/suunto_eonsteel_parser.c"
    # Reefnet
    "$LIBDC_DIR/src/reefnet_sensus.c"
    "$LIBDC_DIR/src/reefnet_sensus_parser.c"
    "$LIBDC_DIR/src/reefnet_sensuspro.c"
    "$LIBDC_DIR/src/reefnet_sensuspro_parser.c"
    "$LIBDC_DIR/src/reefnet_sensusultra.c"
    "$LIBDC_DIR/src/reefnet_sensusultra_parser.c"
    # Uwatec / Scubapro
    "$LIBDC_DIR/src/uwatec_aladin.c"
    "$LIBDC_DIR/src/uwatec_memomouse.c"
    "$LIBDC_DIR/src/uwatec_memomouse_parser.c"
    "$LIBDC_DIR/src/uwatec_smart.c"
    "$LIBDC_DIR/src/uwatec_smart_parser.c"
    # Oceanic / Pelagic
    "$LIBDC_DIR/src/oceanic_common.c"
    "$LIBDC_DIR/src/oceanic_atom2.c"
    "$LIBDC_DIR/src/oceanic_atom2_parser.c"
    "$LIBDC_DIR/src/oceanic_veo250.c"
    "$LIBDC_DIR/src/oceanic_veo250_parser.c"
    "$LIBDC_DIR/src/oceanic_vtpro.c"
    "$LIBDC_DIR/src/oceanic_vtpro_parser.c"
    "$LIBDC_DIR/src/pelagic_i330r.c"
    # Mares
    "$LIBDC_DIR/src/mares_common.c"
    "$LIBDC_DIR/src/mares_nemo.c"
    "$LIBDC_DIR/src/mares_nemo_parser.c"
    "$LIBDC_DIR/src/mares_puck.c"
    "$LIBDC_DIR/src/mares_darwin.c"
    "$LIBDC_DIR/src/mares_darwin_parser.c"
    "$LIBDC_DIR/src/mares_iconhd.c"
    "$LIBDC_DIR/src/mares_iconhd_parser.c"
    # Heinrichs Weikamp
    "$LIBDC_DIR/src/hw_ostc.c"
    "$LIBDC_DIR/src/hw_ostc_parser.c"
    "$LIBDC_DIR/src/hw_frog.c"
    "$LIBDC_DIR/src/hw_ostc3.c"
    # Cressi
    "$LIBDC_DIR/src/cressi_edy.c"
    "$LIBDC_DIR/src/cressi_edy_parser.c"
    "$LIBDC_DIR/src/cressi_leonardo.c"
    "$LIBDC_DIR/src/cressi_leonardo_parser.c"
    "$LIBDC_DIR/src/cressi_goa.c"
    "$LIBDC_DIR/src/cressi_goa_parser.c"
    # Zeagle
    "$LIBDC_DIR/src/zeagle_n2ition3.c"
    # Atomic Aquatics
    "$LIBDC_DIR/src/atomics_cobalt.c"
    "$LIBDC_DIR/src/atomics_cobalt_parser.c"
    # Shearwater
    "$LIBDC_DIR/src/shearwater_common.c"
    "$LIBDC_DIR/src/shearwater_predator.c"
    "$LIBDC_DIR/src/shearwater_predator_parser.c"
    "$LIBDC_DIR/src/shearwater_petrel.c"
    # Dive Rite
    "$LIBDC_DIR/src/diverite_nitekq.c"
    "$LIBDC_DIR/src/diverite_nitekq_parser.c"
    # Citizen
    "$LIBDC_DIR/src/citizen_aqualand.c"
    "$LIBDC_DIR/src/citizen_aqualand_parser.c"
    # DiveSystem
    "$LIBDC_DIR/src/divesystem_idive.c"
    "$LIBDC_DIR/src/divesystem_idive_parser.c"
    # Cochran
    "$LIBDC_DIR/src/cochran_commander.c"
    "$LIBDC_DIR/src/cochran_commander_parser.c"
    # Tecdiving
    "$LIBDC_DIR/src/tecdiving_divecomputereu.c"
    "$LIBDC_DIR/src/tecdiving_divecomputereu_parser.c"
    # McLean
    "$LIBDC_DIR/src/mclean_extreme.c"
    "$LIBDC_DIR/src/mclean_extreme_parser.c"
    # Liquivision
    "$LIBDC_DIR/src/liquivision_lynx.c"
    "$LIBDC_DIR/src/liquivision_lynx_parser.c"
    # Sporasub
    "$LIBDC_DIR/src/sporasub_sp2.c"
    "$LIBDC_DIR/src/sporasub_sp2_parser.c"
    # Deep Six
    "$LIBDC_DIR/src/deepsix_excursion.c"
    "$LIBDC_DIR/src/deepsix_excursion_parser.c"
    # Seac
    "$LIBDC_DIR/src/seac_screen_common.c"
    "$LIBDC_DIR/src/seac_screen.c"
    "$LIBDC_DIR/src/seac_screen_parser.c"
    # Deepblu
    "$LIBDC_DIR/src/deepblu_cosmiq.c"
    "$LIBDC_DIR/src/deepblu_cosmiq_parser.c"
    # Oceans
    "$LIBDC_DIR/src/oceans_s1_common.c"
    "$LIBDC_DIR/src/oceans_s1.c"
    "$LIBDC_DIR/src/oceans_s1_parser.c"
    # Divesoft
    "$LIBDC_DIR/src/divesoft_freedom.c"
    "$LIBDC_DIR/src/divesoft_freedom_parser.c"
    # Halcyon
    "$LIBDC_DIR/src/halcyon_symbios.c"
    "$LIBDC_DIR/src/halcyon_symbios_parser.c"
    # Transport stubs — only include ones that compile cleanly without
    # hardware-specific headers (serial_posix, usbhid, usb need Linux/HID headers)
    "$LIBDC_DIR/src/socket.c"
    "$LIBDC_DIR/src/irda.c"
    "$LIBDC_DIR/src/ble.c"
    "$LIBDC_DIR/src/bluetooth.c"
    "$LIBDC_DIR/src/custom.c"
    # Bridge
    "$WASM_DIR/libdc-bridge.c"
)

echo "--- Compiling ${#LIBDC_SOURCES[@]} source files with emcc ---"
emcc \
    "${LIBDC_SOURCES[@]}" \
    -I "$LIBDC_DIR/include" \
    -I "$LIBDC_DIR/src" \
    -I "$WASM_DIR" \
    -DHAVE_CONFIG_H \
    -O2 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="createLibDC" \
    -s EXPORTED_FUNCTIONS='["_libdc_parse_dive","_libdc_free_result","_libdc_list_descriptors","_malloc","_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["UTF8ToString","stringToUTF8","lengthBytesUTF8","HEAPU8"]' \
    -s FILESYSTEM=0 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT=web \
    -s INITIAL_MEMORY=16777216 \
    -s STACK_SIZE=1048576 \
    -o "$OUTPUT_DIR/libdc.js"

# Verify output
WASM_SIZE=$(wc -c < "$OUTPUT_DIR/libdc.wasm" | tr -d ' ')
JS_SIZE=$(wc -c < "$OUTPUT_DIR/libdc.js" | tr -d ' ')

echo ""
echo "=== Build complete ==="
echo "  libdc.wasm: ${WASM_SIZE} bytes ($(( WASM_SIZE / 1024 )) KB)"
echo "  libdc.js:   ${JS_SIZE} bytes ($(( JS_SIZE / 1024 )) KB)"
echo "  Output:     $OUTPUT_DIR/"
