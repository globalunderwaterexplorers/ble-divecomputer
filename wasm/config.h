/*
 * Minimal config.h for libdivecomputer WASM build.
 * Replaces autotools-generated config.h — only enables what the
 * parser needs; all hardware transport backends are disabled.
 */

#ifndef CONFIG_H
#define CONFIG_H

/* Package version (from configure.ac) */
#define DC_VERSION       "0.10.0-wasm"
#define DC_VERSION_MAJOR 0
#define DC_VERSION_MINOR 10
#define DC_VERSION_MICRO 0

/* Enable logging (helps debugging, small code-size cost) */
#define ENABLE_LOGGING 1

/* POSIX functions available in Emscripten */
#define HAVE_LOCALTIME_R 1
#define HAVE_GMTIME_R    1
#define HAVE_TIMEGM      1
#define HAVE_STRUCT_TM_TM_GMTOFF 1

/* Explicitly disable hardware backends */
/* #undef ENABLE_PTY */
/* #undef HAVE_LIBUSB */
/* #undef HAVE_HIDAPI */
/* #undef HAVE_BLUEZ */
/* #undef HAVE_AF_IRDA_H */
/* #undef HAVE_LINUX_IRDA_H */
/* #undef HAVE_WINSOCK2_H */
/* #undef HAVE_WS2BTH_H */

#endif /* CONFIG_H */
