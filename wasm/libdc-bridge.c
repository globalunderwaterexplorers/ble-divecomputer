/*
 * libdc-bridge.c — Generic WASM bridge for libdivecomputer.
 *
 * Exports three functions to JavaScript:
 *   libdc_parse_dive(data, size, family, model)  → char* JSON (heap-allocated)
 *   libdc_list_descriptors()                     → char* JSON (heap-allocated)
 *   libdc_free_result(ptr)                       → void
 *
 * Uses dc_parser_new2() via the descriptor API — supports ALL parser families
 * compiled into the WASM binary without any device-specific code here.
 *
 * LGPL 2.1 — see libdivecomputer/COPYING
 */

#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <stdarg.h>
#include <math.h>

#include <libdivecomputer/parser.h>
#include <libdivecomputer/context.h>
#include <libdivecomputer/descriptor.h>
#include <libdivecomputer/iterator.h>
#include <libdivecomputer/units.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

/* ---------- dynamic string buffer ---------- */

typedef struct {
    char  *buf;
    size_t len;
    size_t cap;
} strbuf_t;

static void sb_init(strbuf_t *sb) {
    sb->cap = 4096;
    sb->buf = (char *)malloc(sb->cap);
    sb->buf[0] = '\0';
    sb->len = 0;
}

static void sb_ensure(strbuf_t *sb, size_t extra) {
    while (sb->len + extra + 1 > sb->cap) {
        sb->cap *= 2;
        sb->buf = (char *)realloc(sb->buf, sb->cap);
    }
}

static void sb_append(strbuf_t *sb, const char *s) {
    size_t n = strlen(s);
    sb_ensure(sb, n);
    memcpy(sb->buf + sb->len, s, n + 1);
    sb->len += n;
}

static void sb_printf(strbuf_t *sb, const char *fmt, ...) {
    char tmp[512];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(tmp, sizeof(tmp), fmt, ap);
    va_end(ap);
    if (n > 0) {
        sb_ensure(sb, (size_t)n);
        memcpy(sb->buf + sb->len, tmp, (size_t)n + 1);
        sb->len += (size_t)n;
    }
}

/* ---------- JSON helpers ---------- */

static void json_append_key(strbuf_t *sb, const char *key) {
    sb_printf(sb, "\"%s\":", key);
}

static void json_string(strbuf_t *sb, const char *key, const char *val, int comma) {
    if (comma) sb_append(sb, ",");
    json_append_key(sb, key);
    /* Escape backslashes and quotes in val */
    sb_append(sb, "\"");
    for (const char *p = val; *p; p++) {
        if (*p == '"' || *p == '\\') {
            char esc[3] = {'\\', *p, '\0'};
            sb_append(sb, esc);
        } else {
            char ch[2] = {*p, '\0'};
            sb_append(sb, ch);
        }
    }
    sb_append(sb, "\"");
}

static void json_int(strbuf_t *sb, const char *key, int val, int comma) {
    if (comma) sb_append(sb, ",");
    json_append_key(sb, key);
    sb_printf(sb, "%d", val);
}

static void json_uint(strbuf_t *sb, const char *key, unsigned int val, int comma) {
    if (comma) sb_append(sb, ",");
    json_append_key(sb, key);
    sb_printf(sb, "%u", val);
}

static void json_double(strbuf_t *sb, const char *key, double val, int comma) {
    if (comma) sb_append(sb, ",");
    json_append_key(sb, key);
    if (isnan(val) || isinf(val))
        sb_append(sb, "null");
    else
        sb_printf(sb, "%.6f", val);
}

/* ---------- sample collection ---------- */

#define MAX_SAMPLES   16384
#define MAX_GASMIXES  20
#define MAX_TANKS     6

typedef struct {
    unsigned int time_ms;
    double       depth;
    double       temperature;
    int          has_temperature;
    /* pressure per tank (up to 6) */
    double       pressure[MAX_TANKS];
    int          has_pressure[MAX_TANKS];
    /* PPO2 values (sensor=DC_SENSOR_NONE → average, 0-2 → individual) */
    double       ppo2;
    int          has_ppo2;
    /* deco */
    unsigned int deco_type;   /* DC_DECO_NDL, DC_DECO_DECOSTOP, etc */
    double       deco_depth;
    unsigned int deco_time;   /* seconds */
    unsigned int deco_tts;    /* seconds */
    int          has_deco;
    /* extras */
    double       setpoint;
    int          has_setpoint;
    double       cns;
    int          has_cns;
    unsigned int gasmix;
    int          has_gasmix;
    unsigned int bearing;
    int          has_bearing;
    unsigned int rbt;
    int          has_rbt;
    unsigned int heartbeat;
    int          has_heartbeat;
} sample_t;

typedef struct {
    sample_t     samples[MAX_SAMPLES];
    unsigned int count;
    unsigned int current;   /* index of sample being built */
    int          started;   /* have we emitted at least one TIME? */
} sample_ctx_t;

static void
sample_cb(dc_sample_type_t type, const dc_sample_value_t *value, void *userdata)
{
    sample_ctx_t *ctx = (sample_ctx_t *)userdata;

    switch (type) {
    case DC_SAMPLE_TIME:
        /* Each TIME starts a new sample */
        if (ctx->started && ctx->count < MAX_SAMPLES) {
            ctx->count++;
        }
        ctx->started = 1;
        if (ctx->count < MAX_SAMPLES) {
            memset(&ctx->samples[ctx->count], 0, sizeof(sample_t));
            ctx->samples[ctx->count].time_ms = value->time;
        }
        break;
    case DC_SAMPLE_DEPTH:
        if (ctx->count < MAX_SAMPLES)
            ctx->samples[ctx->count].depth = value->depth;
        break;
    case DC_SAMPLE_TEMPERATURE:
        if (ctx->count < MAX_SAMPLES) {
            ctx->samples[ctx->count].temperature = value->temperature;
            ctx->samples[ctx->count].has_temperature = 1;
        }
        break;
    case DC_SAMPLE_PRESSURE:
        if (ctx->count < MAX_SAMPLES && value->pressure.tank < MAX_TANKS) {
            ctx->samples[ctx->count].pressure[value->pressure.tank] = value->pressure.value;
            ctx->samples[ctx->count].has_pressure[value->pressure.tank] = 1;
        }
        break;
    case DC_SAMPLE_PPO2:
        /* Take the average/consensus value (sensor=DC_SENSOR_NONE) or first sensor */
        if (ctx->count < MAX_SAMPLES) {
            if (value->ppo2.sensor == DC_SENSOR_NONE || !ctx->samples[ctx->count].has_ppo2) {
                ctx->samples[ctx->count].ppo2 = value->ppo2.value;
                ctx->samples[ctx->count].has_ppo2 = 1;
            }
        }
        break;
    case DC_SAMPLE_SETPOINT:
        if (ctx->count < MAX_SAMPLES) {
            ctx->samples[ctx->count].setpoint = value->setpoint;
            ctx->samples[ctx->count].has_setpoint = 1;
        }
        break;
    case DC_SAMPLE_CNS:
        if (ctx->count < MAX_SAMPLES) {
            ctx->samples[ctx->count].cns = value->cns;
            ctx->samples[ctx->count].has_cns = 1;
        }
        break;
    case DC_SAMPLE_DECO:
        if (ctx->count < MAX_SAMPLES) {
            ctx->samples[ctx->count].deco_type = value->deco.type;
            ctx->samples[ctx->count].deco_depth = value->deco.depth;
            ctx->samples[ctx->count].deco_time = value->deco.time;
            ctx->samples[ctx->count].deco_tts = value->deco.tts;
            ctx->samples[ctx->count].has_deco = 1;
        }
        break;
    case DC_SAMPLE_GASMIX:
        if (ctx->count < MAX_SAMPLES) {
            ctx->samples[ctx->count].gasmix = value->gasmix;
            ctx->samples[ctx->count].has_gasmix = 1;
        }
        break;
    case DC_SAMPLE_BEARING:
        if (ctx->count < MAX_SAMPLES) {
            ctx->samples[ctx->count].bearing = value->bearing;
            ctx->samples[ctx->count].has_bearing = 1;
        }
        break;
    case DC_SAMPLE_RBT:
        if (ctx->count < MAX_SAMPLES) {
            ctx->samples[ctx->count].rbt = value->rbt;
            ctx->samples[ctx->count].has_rbt = 1;
        }
        break;
    case DC_SAMPLE_HEARTBEAT:
        if (ctx->count < MAX_SAMPLES) {
            ctx->samples[ctx->count].heartbeat = value->heartbeat;
            ctx->samples[ctx->count].has_heartbeat = 1;
        }
        break;
    default:
        break;
    }
}

/* ---------- divemode to string ---------- */

static const char *
divemode_str(dc_divemode_t mode)
{
    switch (mode) {
    case DC_DIVEMODE_OC:       return "OC";
    case DC_DIVEMODE_CCR:      return "CCR";
    case DC_DIVEMODE_SCR:      return "SCR";
    case DC_DIVEMODE_GAUGE:    return "GAUGE";
    case DC_DIVEMODE_FREEDIVE: return "FREEDIVE";
    default:                   return "OC";
    }
}

static const char *
decomodel_str(dc_decomodel_type_t type)
{
    switch (type) {
    case DC_DECOMODEL_BUHLMANN: return "Buhlmann ZHL-16c";
    case DC_DECOMODEL_VPM:      return "VPM-B";
    case DC_DECOMODEL_RGBM:     return "RGBM";
    case DC_DECOMODEL_DCIEM:    return "DCIEM";
    default:                    return "Unknown";
    }
}

/* ---------- find descriptor by family + model ---------- */

static dc_descriptor_t *
find_descriptor(dc_family_t family, unsigned int model)
{
    dc_iterator_t *iterator = NULL;
    dc_descriptor_t *descriptor = NULL;
    dc_descriptor_t *found = NULL;

    if (dc_descriptor_iterator(&iterator) != DC_STATUS_SUCCESS)
        return NULL;

    while (dc_iterator_next(iterator, &descriptor) == DC_STATUS_SUCCESS) {
        if (dc_descriptor_get_type(descriptor) == family &&
            dc_descriptor_get_model(descriptor) == model) {
            found = descriptor;
            break;
        }
        dc_descriptor_free(descriptor);
    }

    dc_iterator_free(iterator);
    return found;
}

/* ---------- main parse export ---------- */

/*
 * Parse raw dive data using libdivecomputer's generic parser.
 *
 * Parameters:
 *   data   - pointer to raw dive bytes (in WASM heap)
 *   size   - length of data
 *   family - dc_family_t enum value (e.g. 0xA0000 for SHEARWATER_PREDATOR)
 *   model  - device model number within the family
 *
 * Returns: heap-allocated JSON string. Caller must free with libdc_free_result().
 *          On error, returns a JSON object with an "error" key.
 */
EXPORT
char *libdc_parse_dive(const unsigned char *data, unsigned int size,
                       unsigned int family, unsigned int model)
{
    dc_status_t rc;
    dc_context_t *context = NULL;
    dc_parser_t *parser = NULL;
    dc_descriptor_t *descriptor = NULL;
    strbuf_t sb;
    sb_init(&sb);

    /* Create context */
    rc = dc_context_new(&context);
    if (rc != DC_STATUS_SUCCESS) {
        sb_append(&sb, "{\"error\":\"Failed to create context\"}");
        return sb.buf;
    }

    /* Find the descriptor for this family+model */
    descriptor = find_descriptor((dc_family_t)family, model);
    if (descriptor == NULL) {
        sb_printf(&sb, "{\"error\":\"No descriptor found for family=%u model=%u\"}", family, model);
        dc_context_free(context);
        return sb.buf;
    }

    /* Create parser via the generic factory */
    rc = dc_parser_new2(&parser, context, descriptor, data, size);
    dc_descriptor_free(descriptor);

    if (rc != DC_STATUS_SUCCESS) {
        sb_printf(&sb, "{\"error\":\"Failed to create parser (family=%u model=%u status=%d)\"}", family, model, (int)rc);
        dc_context_free(context);
        return sb.buf;
    }

    /* Start JSON output */
    sb_append(&sb, "{");

    /* 1. DateTime */
    dc_datetime_t dt = {0};
    rc = dc_parser_get_datetime(parser, &dt);
    if (rc == DC_STATUS_SUCCESS) {
        sb_printf(&sb, "\"datetime\":\"%04d-%02d-%02dT%02d:%02d:%02dZ\"",
            dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second);
        if (dt.timezone != DC_TIMEZONE_NONE) {
            json_int(&sb, "timezoneOffsetSeconds", dt.timezone, 1);
        }
    } else {
        sb_append(&sb, "\"datetime\":null");
    }

    /* 2. Dive time (seconds) */
    unsigned int divetime = 0;
    rc = dc_parser_get_field(parser, DC_FIELD_DIVETIME, 0, &divetime);
    if (rc == DC_STATUS_SUCCESS) {
        json_uint(&sb, "diveTimeSeconds", divetime, 1);
    }

    /* 3. Max depth (meters) */
    double maxdepth = 0;
    rc = dc_parser_get_field(parser, DC_FIELD_MAXDEPTH, 0, &maxdepth);
    if (rc == DC_STATUS_SUCCESS) {
        json_double(&sb, "maxDepthMeters", maxdepth, 1);
    }

    /* 4. Average depth */
    double avgdepth = 0;
    rc = dc_parser_get_field(parser, DC_FIELD_AVGDEPTH, 0, &avgdepth);
    if (rc == DC_STATUS_SUCCESS) {
        json_double(&sb, "avgDepthMeters", avgdepth, 1);
    }

    /* 5. Temperature min/max */
    double temp_min = 0, temp_max = 0;
    rc = dc_parser_get_field(parser, DC_FIELD_TEMPERATURE_MINIMUM, 0, &temp_min);
    if (rc == DC_STATUS_SUCCESS) {
        json_double(&sb, "minTemperatureCelsius", temp_min, 1);
    }
    rc = dc_parser_get_field(parser, DC_FIELD_TEMPERATURE_MAXIMUM, 0, &temp_max);
    if (rc == DC_STATUS_SUCCESS) {
        json_double(&sb, "maxTemperatureCelsius", temp_max, 1);
    }

    /* 6. Dive mode */
    dc_divemode_t divemode = DC_DIVEMODE_OC;
    rc = dc_parser_get_field(parser, DC_FIELD_DIVEMODE, 0, &divemode);
    if (rc == DC_STATUS_SUCCESS) {
        json_string(&sb, "diveMode", divemode_str(divemode), 1);
    }

    /* 7. Deco model */
    dc_decomodel_t decomodel = {0};
    rc = dc_parser_get_field(parser, DC_FIELD_DECOMODEL, 0, &decomodel);
    if (rc == DC_STATUS_SUCCESS) {
        sb_append(&sb, ",\"decoModel\":{");
        json_string(&sb, "type", decomodel_str(decomodel.type), 0);
        json_int(&sb, "conservatism", decomodel.conservatism, 1);
        if (decomodel.type == DC_DECOMODEL_BUHLMANN) {
            json_uint(&sb, "gfLow", decomodel.params.gf.low, 1);
            json_uint(&sb, "gfHigh", decomodel.params.gf.high, 1);
        }
        sb_append(&sb, "}");
    }

    /* 8. Salinity */
    dc_salinity_t salinity = {0};
    rc = dc_parser_get_field(parser, DC_FIELD_SALINITY, 0, &salinity);
    if (rc == DC_STATUS_SUCCESS) {
        sb_append(&sb, ",\"salinity\":{");
        json_string(&sb, "type", salinity.type == DC_WATER_FRESH ? "fresh" : "salt", 0);
        json_double(&sb, "density", salinity.density, 1);
        sb_append(&sb, "}");
    }

    /* 9. Atmospheric pressure (bar) */
    double atmospheric = 0;
    rc = dc_parser_get_field(parser, DC_FIELD_ATMOSPHERIC, 0, &atmospheric);
    if (rc == DC_STATUS_SUCCESS) {
        json_double(&sb, "atmosphericPressureBar", atmospheric, 1);
    }

    /* 10. Location */
    dc_location_t location = {0};
    rc = dc_parser_get_field(parser, DC_FIELD_LOCATION, 0, &location);
    if (rc == DC_STATUS_SUCCESS) {
        sb_append(&sb, ",\"location\":{");
        json_double(&sb, "latitude", location.latitude, 0);
        json_double(&sb, "longitude", location.longitude, 1);
        sb_append(&sb, "}");
    }

    /* 11. Gas mixes */
    unsigned int ngasmixes = 0;
    rc = dc_parser_get_field(parser, DC_FIELD_GASMIX_COUNT, 0, &ngasmixes);
    if (rc == DC_STATUS_SUCCESS && ngasmixes > 0) {
        sb_append(&sb, ",\"gasMixes\":[");
        for (unsigned int i = 0; i < ngasmixes; i++) {
            dc_gasmix_t gm = {0};
            rc = dc_parser_get_field(parser, DC_FIELD_GASMIX, i, &gm);
            if (rc == DC_STATUS_SUCCESS) {
                if (i > 0) sb_append(&sb, ",");
                sb_append(&sb, "{");
                json_double(&sb, "oxygen", gm.oxygen, 0);
                json_double(&sb, "helium", gm.helium, 1);
                json_double(&sb, "nitrogen", gm.nitrogen, 1);
                const char *usage_str = "none";
                switch (gm.usage) {
                    case DC_USAGE_OXYGEN:   usage_str = "oxygen"; break;
                    case DC_USAGE_DILUENT:  usage_str = "diluent"; break;
                    case DC_USAGE_SIDEMOUNT:usage_str = "sidemount"; break;
                    default: break;
                }
                json_string(&sb, "usage", usage_str, 1);
                sb_append(&sb, "}");
            }
        }
        sb_append(&sb, "]");
    }

    /* 12. Tanks */
    unsigned int ntanks = 0;
    rc = dc_parser_get_field(parser, DC_FIELD_TANK_COUNT, 0, &ntanks);
    if (rc == DC_STATUS_SUCCESS && ntanks > 0) {
        sb_append(&sb, ",\"tanks\":[");
        for (unsigned int i = 0; i < ntanks; i++) {
            dc_tank_t tk = {0};
            rc = dc_parser_get_field(parser, DC_FIELD_TANK, i, &tk);
            if (rc == DC_STATUS_SUCCESS) {
                if (i > 0) sb_append(&sb, ",");
                sb_append(&sb, "{");
                json_uint(&sb, "gasmix", tk.gasmix, 0);
                json_double(&sb, "volume", tk.volume, 1);
                json_double(&sb, "workpressure", tk.workpressure, 1);
                json_double(&sb, "beginpressure", tk.beginpressure, 1);
                json_double(&sb, "endpressure", tk.endpressure, 1);
                const char *usage_str = "none";
                switch (tk.usage) {
                    case DC_USAGE_OXYGEN:   usage_str = "oxygen"; break;
                    case DC_USAGE_DILUENT:  usage_str = "diluent"; break;
                    case DC_USAGE_SIDEMOUNT:usage_str = "sidemount"; break;
                    default: break;
                }
                json_string(&sb, "usage", usage_str, 1);
                sb_append(&sb, "}");
            }
        }
        sb_append(&sb, "]");
    }

    /* 13. Samples */
    sample_ctx_t *sample_ctx = (sample_ctx_t *)calloc(1, sizeof(sample_ctx_t));
    if (!sample_ctx) {
        sb_printf(&sb, ",\"error\":\"Failed to allocate sample buffer (%zu bytes)\"}", sizeof(sample_ctx_t));
        dc_parser_destroy(parser);
        dc_context_free(context);
        return sb.buf;
    }

    rc = dc_parser_samples_foreach(parser, sample_cb, sample_ctx);
    if (rc == DC_STATUS_SUCCESS && sample_ctx->started) {
        /* Finalize the last sample */
        if (sample_ctx->count < MAX_SAMPLES) {
            sample_ctx->count++;
        }

        sb_append(&sb, ",\"samples\":[");
        for (unsigned int i = 0; i < sample_ctx->count; i++) {
            const sample_t *s = &sample_ctx->samples[i];
            if (i > 0) sb_append(&sb, ",");
            sb_append(&sb, "{");
            /* time in seconds (libdc gives milliseconds) */
            json_double(&sb, "timeSeconds", s->time_ms / 1000.0, 0);
            json_double(&sb, "depthMeters", s->depth, 1);
            if (s->has_temperature) json_double(&sb, "temperatureCelsius", s->temperature, 1);

            /* Emit first non-zero pressure as pressureBar */
            for (unsigned int t = 0; t < MAX_TANKS; t++) {
                if (s->has_pressure[t]) {
                    json_double(&sb, "pressureBar", s->pressure[t], 1);
                    json_uint(&sb, "pressureTank", t, 1);
                    break;
                }
            }
            /* Emit all pressures as array if multiple */
            {
                int pressure_count = 0;
                for (unsigned int t = 0; t < MAX_TANKS; t++) {
                    if (s->has_pressure[t]) pressure_count++;
                }
                if (pressure_count > 1) {
                    sb_append(&sb, ",\"pressures\":[");
                    int first = 1;
                    for (unsigned int t = 0; t < MAX_TANKS; t++) {
                        if (s->has_pressure[t]) {
                            if (!first) sb_append(&sb, ",");
                            sb_printf(&sb, "{\"tank\":%u,\"bar\":%.6f}", t, s->pressure[t]);
                            first = 0;
                        }
                    }
                    sb_append(&sb, "]");
                }
            }

            if (s->has_ppo2) json_double(&sb, "ppo2", s->ppo2, 1);
            if (s->has_setpoint) json_double(&sb, "setpoint", s->setpoint, 1);
            if (s->has_cns) json_double(&sb, "cns", s->cns, 1);

            if (s->has_deco) {
                sb_append(&sb, ",\"deco\":{");
                const char *dtype = "ndl";
                if (s->deco_type == DC_DECO_DECOSTOP) dtype = "decostop";
                else if (s->deco_type == DC_DECO_SAFETYSTOP) dtype = "safetystop";
                else if (s->deco_type == DC_DECO_DEEPSTOP) dtype = "deepstop";
                json_string(&sb, "type", dtype, 0);
                json_double(&sb, "depth", s->deco_depth, 1);
                json_uint(&sb, "time", s->deco_time, 1);
                json_uint(&sb, "tts", s->deco_tts, 1);
                sb_append(&sb, "}");
            }

            if (s->has_gasmix) json_uint(&sb, "gasmix", s->gasmix, 1);
            if (s->has_bearing) json_uint(&sb, "bearing", s->bearing, 1);
            if (s->has_rbt) json_uint(&sb, "rbt", s->rbt, 1);
            if (s->has_heartbeat) json_uint(&sb, "heartbeat", s->heartbeat, 1);

            sb_append(&sb, "}");
        }
        sb_append(&sb, "]");
    }

    sb_append(&sb, "}");

    free(sample_ctx);
    dc_parser_destroy(parser);
    dc_context_free(context);

    return sb.buf;
}

/* ---------- list all known devices ---------- */

/*
 * Returns a JSON array of all dive computer descriptors known to libdivecomputer.
 * Each entry: { vendor, product, family, model }
 *
 * Caller must free with libdc_free_result().
 */
EXPORT
char *libdc_list_descriptors(void)
{
    dc_iterator_t *iterator = NULL;
    dc_descriptor_t *descriptor = NULL;
    strbuf_t sb;
    sb_init(&sb);

    if (dc_descriptor_iterator(&iterator) != DC_STATUS_SUCCESS) {
        sb_append(&sb, "[]");
        return sb.buf;
    }

    sb_append(&sb, "[");
    int first = 1;

    while (dc_iterator_next(iterator, &descriptor) == DC_STATUS_SUCCESS) {
        if (!first) sb_append(&sb, ",");
        first = 0;

        sb_append(&sb, "{");
        json_string(&sb, "vendor", dc_descriptor_get_vendor(descriptor), 0);
        json_string(&sb, "product", dc_descriptor_get_product(descriptor), 1);
        json_uint(&sb, "family", (unsigned int)dc_descriptor_get_type(descriptor), 1);
        json_uint(&sb, "model", dc_descriptor_get_model(descriptor), 1);
        sb_append(&sb, "}");

        dc_descriptor_free(descriptor);
    }

    sb_append(&sb, "]");
    dc_iterator_free(iterator);

    return sb.buf;
}

/* ---------- free ---------- */

EXPORT
void libdc_free_result(char *ptr)
{
    free(ptr);
}
