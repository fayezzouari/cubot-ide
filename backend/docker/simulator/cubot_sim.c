/*
 * simavr wrapper for Cubot IDE
 *
 * Loads an Intel HEX file, runs an ATmega328p simulation, and exchanges JSON
 * lines with the backend: events out on stdout, inputs in on stdin.
 *
 * stdout (one JSON object per line):
 *   {"type":"ready"}
 *   {"type":"serial","data":"H","t":12}
 *   {"type":"pin","pin":13,"value":true,"t":1000}
 *   {"type":"tick","t":100}                        every 100 ms of simulated time
 *
 * "t" is simulated time in milliseconds since reset.
 *
 * stdin (one JSON object per line):
 *   {"type":"serial_input","data":"text\n"}        bytes for the UART receiver
 *   {"type":"analog","channel":0,"millivolts":2500}  voltage on A0..A5 (ADC0..ADC5)
 *   {"type":"digital","pin":2,"value":true}          level driven onto D0..D13
 *
 * Compile:
 *   gcc -O2 -o cubot_sim cubot_sim.c -lsimavr -lelf -lpthread
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
#include <poll.h>
#include <pthread.h>
#include <time.h>
#include <fcntl.h>
#include <errno.h>

#include "sim_avr.h"
#include "sim_elf.h"
#include "sim_hex.h"
#include "sim_gdb.h"
#include "avr_ioport.h"
#include "avr_uart.h"
#include "avr_adc.h"

#define ADC_CHANNELS 6
#define VREF_MV 5000
#define INPUT_POLL_INTERVAL 2000
#define LINE_MAX 4096
#define TICK_MS 100

static volatile int running = 1;

static void sig_handler(int sig) {
    (void)sig;
    running = 0;
}

static uint8_t prev_portb = 0;
static uint8_t prev_portd = 0;
static avr_t *sim = NULL;

static unsigned long long sim_ms(void) {
    if (!sim || !sim->frequency) return 0;
    return (unsigned long long)(sim->cycle / (sim->frequency / 1000));
}

static int port_pin_to_arduino(char port, int pin) {
    switch (port) {
        case 'D':
            if (pin >= 0 && pin <= 7) return pin;
            break;
        case 'B':
            if (pin >= 0 && pin <= 5) return pin + 8;
            break;
    }
    return -1;
}

static int arduino_to_port_pin(int apin, char *port, int *bit) {
    if (apin >= 0 && apin <= 7) {
        *port = 'D';
        *bit = apin;
        return 1;
    }
    if (apin >= 8 && apin <= 13) {
        *port = 'B';
        *bit = apin - 8;
        return 1;
    }
    return 0;
}

static void emit_pin(int arduino_pin, int value) {
    printf("{\"type\":\"pin\",\"pin\":%d,\"value\":%s,\"t\":%llu}\n", arduino_pin, value ? "true" : "false", sim_ms());
    fflush(stdout);
}

static void check_port(char port_letter, uint8_t new_val, uint8_t *prev_val) {
    uint8_t changed = new_val ^ *prev_val;
    if (!changed) return;
    for (int i = 0; i < 8; i++) {
        if (changed & (1 << i)) {
            int apin = port_pin_to_arduino(port_letter, i);
            if (apin >= 0) emit_pin(apin, (new_val >> i) & 1);
        }
    }
    *prev_val = new_val;
}

static void uart_output_hook(struct avr_irq_t *irq, uint32_t value, void *param) {
    (void)irq;
    (void)param;
    char c = (char)value;
    char data[8];
    if (c == '"') {
        snprintf(data, sizeof(data), "\\\"");
    } else if (c == '\\') {
        snprintf(data, sizeof(data), "\\\\");
    } else if (c == '\n') {
        snprintf(data, sizeof(data), "\\n");
    } else if (c == '\r') {
        snprintf(data, sizeof(data), "\\r");
    } else if (c == '\t') {
        snprintf(data, sizeof(data), "\\t");
    } else if (c >= 32 && c < 127) {
        snprintf(data, sizeof(data), "%c", c);
    } else {
        snprintf(data, sizeof(data), "\\u%04x", (unsigned char)c);
    }
    printf("{\"type\":\"serial\",\"data\":\"%s\",\"t\":%llu}\n", data, sim_ms());
    fflush(stdout);
}

static void portb_write_hook(struct avr_irq_t *irq, uint32_t value, void *param) {
    (void)irq;
    (void)param;
    check_port('B', (uint8_t)value, &prev_portb);
}

static void portd_write_hook(struct avr_irq_t *irq, uint32_t value, void *param) {
    (void)irq;
    (void)param;
    check_port('D', (uint8_t)value, &prev_portd);
}

/* ---- minimal JSON field readers (the backend writes flat objects) ---- */

static const char *find_key(const char *line, const char *key) {
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *p = strstr(line, pattern);
    if (!p) return NULL;
    p += strlen(pattern);
    while (*p == ' ' || *p == ':') p++;
    return p;
}

static int json_int(const char *line, const char *key, long *out) {
    const char *p = find_key(line, key);
    if (!p) return 0;
    char *end;
    long v = strtol(p, &end, 10);
    if (end == p) return 0;
    *out = v;
    return 1;
}

static int json_bool(const char *line, const char *key, int *out) {
    const char *p = find_key(line, key);
    if (!p) return 0;
    if (strncmp(p, "true", 4) == 0) { *out = 1; return 1; }
    if (strncmp(p, "false", 5) == 0) { *out = 0; return 1; }
    return 0;
}

/* Copies a JSON string value into buf, resolving the escapes the backend emits. */
static int json_str(const char *line, const char *key, char *buf, size_t size) {
    const char *p = find_key(line, key);
    if (!p || *p != '"') return 0;
    p++;
    size_t n = 0;
    while (*p && *p != '"' && n + 1 < size) {
        if (*p == '\\' && p[1]) {
            p++;
            switch (*p) {
                case 'n': buf[n++] = '\n'; break;
                case 'r': buf[n++] = '\r'; break;
                case 't': buf[n++] = '\t'; break;
                case 'u': {
                    if (strlen(p) >= 5) {
                        char hex[5] = { p[1], p[2], p[3], p[4], 0 };
                        buf[n++] = (char)strtol(hex, NULL, 16);
                        p += 4;
                    }
                    break;
                }
                default: buf[n++] = *p; break;
            }
            p++;
        } else {
            buf[n++] = *p++;
        }
    }
    buf[n] = 0;
    return 1;
}

static void handle_input_line(avr_t *avr, const char *line) {
    char type[32];
    if (!json_str(line, "type", type, sizeof(type))) return;

    if (strcmp(type, "serial_input") == 0) {
        static char data[LINE_MAX];
        if (!json_str(line, "data", data, sizeof(data))) return;
        avr_irq_t *rx = avr_io_getirq(avr, AVR_IOCTL_UART_GETIRQ('0'), UART_IRQ_INPUT);
        if (!rx) return;
        for (const char *c = data; *c; c++) avr_raise_irq(rx, (uint8_t)*c);
        return;
    }

    if (strcmp(type, "analog") == 0) {
        long channel, mv;
        if (!json_int(line, "channel", &channel) || !json_int(line, "millivolts", &mv)) return;
        if (channel < 0 || channel >= ADC_CHANNELS) return;
        if (mv < 0) mv = 0;
        if (mv > VREF_MV) mv = VREF_MV;
        avr_irq_t *adc = avr_io_getirq(avr, AVR_IOCTL_ADC_GETIRQ, ADC_IRQ_ADC0 + (int)channel);
        if (adc) avr_raise_irq(adc, (uint32_t)mv);
        return;
    }

    if (strcmp(type, "digital") == 0) {
        long pin;
        int value;
        char port;
        int bit;
        if (!json_int(line, "pin", &pin) || !json_bool(line, "value", &value)) return;
        if (!arduino_to_port_pin((int)pin, &port, &bit)) return;
        avr_irq_t *irq = avr_io_getirq(avr, AVR_IOCTL_IOPORT_GETIRQ(port), bit);
        if (irq) avr_raise_irq(irq, value ? 1 : 0);
        return;
    }
}

/*
 * Non-blocking: reads whatever is waiting on stdin and applies every complete
 * line. Uses read() rather than stdio so no line can sit in a buffer until the
 * next write arrives.
 */
static void pump_input(avr_t *avr) {
    static char acc[LINE_MAX * 4];
    static size_t used = 0;
    for (;;) {
        ssize_t n = read(STDIN_FILENO, acc + used, sizeof(acc) - used - 1);
        if (n < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) break;
            return;
        }
        if (n == 0) break;
        used += (size_t)n;
        char *start = acc;
        char *nl;
        while ((nl = memchr(start, '\n', used - (size_t)(start - acc))) != NULL) {
            *nl = 0;
            handle_input_line(avr, start);
            start = nl + 1;
        }
        used -= (size_t)(start - acc);
        memmove(acc, start, used);
        if (used >= sizeof(acc) - 1) used = 0;
    }
}

/* Keeps simulated time aligned with wall-clock time so delay() and millis() behave. */
static void throttle(avr_t *avr, const struct timespec *start) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    double wall = (now.tv_sec - start->tv_sec) + (now.tv_nsec - start->tv_nsec) / 1e9;
    double sim = (double)avr->cycle / (double)avr->frequency;
    double ahead = sim - wall;
    if (ahead > 0.001) {
        if (ahead > 0.05) ahead = 0.05;
        usleep((useconds_t)(ahead * 1e6));
    }
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <firmware.hex>\n", argv[0]);
        return 1;
    }

    const char *hex_path = argv[1];

    signal(SIGINT, sig_handler);
    signal(SIGTERM, sig_handler);

    setvbuf(stdout, NULL, _IONBF, 0);

    avr_t *avr = avr_make_mcu_by_name("atmega328p");
    if (!avr) {
        fprintf(stderr, "Error: could not create ATmega328p instance\n");
        return 1;
    }

    avr_init(avr);
    sim = avr;
    avr->frequency = 16000000UL;
    avr->vcc = VREF_MV;
    avr->avcc = VREF_MV;
    avr->aref = VREF_MV;

    uint32_t loadBase = AVR_SEGMENT_OFFSET_FLASH;
    uint32_t loadSize = 0;
    uint8_t *loadBuf = read_ihex_file(hex_path, &loadSize, &loadBase);
    if (!loadBuf) {
        fprintf(stderr, "Error: could not load hex file: %s\n", hex_path);
        avr_terminate(avr);
        return 1;
    }

    memcpy(avr->flash + loadBase, loadBuf, loadSize);
    avr->pc = loadBase;
    avr->codeend = loadBase + loadSize;
    free(loadBuf);

    uint32_t uart_flags = 0;
    if (avr_ioctl(avr, AVR_IOCTL_UART_GET_FLAGS('0'), &uart_flags) == 0) {
        uart_flags &= ~AVR_UART_FLAG_STDIO;
        avr_ioctl(avr, AVR_IOCTL_UART_SET_FLAGS('0'), &uart_flags);
    }
    avr_irq_t *uart_irq = avr_io_getirq(avr, AVR_IOCTL_UART_GETIRQ('0'), UART_IRQ_OUTPUT);
    if (uart_irq) avr_irq_register_notify(uart_irq, uart_output_hook, avr);

    avr_irq_t *portb_irq = avr_io_getirq(avr, AVR_IOCTL_IOPORT_GETIRQ('B'), IOPORT_IRQ_REG_PORT);
    if (portb_irq) avr_irq_register_notify(portb_irq, portb_write_hook, avr);

    avr_irq_t *portd_irq = avr_io_getirq(avr, AVR_IOCTL_IOPORT_GETIRQ('D'), IOPORT_IRQ_REG_PORT);
    if (portd_irq) avr_irq_register_notify(portd_irq, portd_write_hook, avr);

    fcntl(STDIN_FILENO, F_SETFL, fcntl(STDIN_FILENO, F_GETFL, 0) | O_NONBLOCK);

    printf("{\"type\":\"ready\"}\n");
    fflush(stdout);

    struct timespec start;
    clock_gettime(CLOCK_MONOTONIC, &start);
    unsigned long iterations = 0;
    unsigned long long next_tick = TICK_MS;
    while (running) {
        int state = avr_run(avr);
        if (state == cpu_Done || state == cpu_Crashed) break;
        if (++iterations % INPUT_POLL_INTERVAL == 0) {
            pump_input(avr);
            throttle(avr, &start);
            unsigned long long now = sim_ms();
            if (now >= next_tick) {
                printf("{\"type\":\"tick\",\"t\":%llu}\n", now);
                next_tick = now - now % TICK_MS + TICK_MS;
            }
        }
    }

    avr_terminate(avr);
    return 0;
}
