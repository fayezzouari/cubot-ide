/*
 * simavr wrapper for Cubot IDE
 *
 * Loads an Intel HEX file, runs ATmega328p simulation, and outputs
 * JSON events to stdout for pin changes and serial (UART) output.
 *
 * Output format (one JSON object per line):
 *   {"type":"ready"}
 *   {"type":"serial","data":"H"}
 *   {"type":"pin","pin":13,"value":true}
 *
 * Compile:
 *   gcc -O2 -o cubot_sim cubot_sim.c -lsimavr -lelf -lpthread
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
#include <pthread.h>

#include "sim_avr.h"
#include "sim_elf.h"
#include "sim_hex.h"
#include "sim_gdb.h"
#include "avr_ioport.h"
#include "avr_uart.h"

static volatile int running = 1;

static void sig_handler(int sig) {
    running = 0;
}

/* Previous pin state for edge detection */
static uint8_t prev_portb = 0;
static uint8_t prev_portc = 0;
static uint8_t prev_portd = 0;

/*
 * Map AVR port/pin to Arduino Uno digital pin number.
 * Returns -1 if not a standard digital pin.
 */
static int port_pin_to_arduino(char port, int pin) {
    switch (port) {
        case 'D':
            if (pin >= 0 && pin <= 7) return pin;       /* D0-D7 */
            break;
        case 'B':
            if (pin >= 0 && pin <= 5) return pin + 8;   /* D8-D13 */
            break;
    }
    return -1;
}

/* Emit a pin change event */
static void emit_pin(int arduino_pin, int value) {
    printf("{\"type\":\"pin\",\"pin\":%d,\"value\":%s}\n",
           arduino_pin, value ? "true" : "false");
    fflush(stdout);
}

/* Check port changes and emit events */
static void check_port(avr_t *avr, char port_letter,
                       uint8_t new_val, uint8_t *prev_val) {
    uint8_t changed = new_val ^ *prev_val;
    if (!changed) return;

    for (int i = 0; i < 8; i++) {
        if (changed & (1 << i)) {
            int apin = port_pin_to_arduino(port_letter, i);
            if (apin >= 0) {
                emit_pin(apin, (new_val >> i) & 1);
            }
        }
    }
    *prev_val = new_val;
}

/* UART output hook */
static void uart_output_hook(struct avr_irq_t *irq, uint32_t value, void *param) {
    char c = (char)value;
    /* JSON-escape special characters */
    if (c == '"') {
        printf("{\"type\":\"serial\",\"data\":\"\\\"\"}\n");
    } else if (c == '\\') {
        printf("{\"type\":\"serial\",\"data\":\"\\\\\"}\n");
    } else if (c == '\n') {
        printf("{\"type\":\"serial\",\"data\":\"\\n\"}\n");
    } else if (c == '\r') {
        printf("{\"type\":\"serial\",\"data\":\"\\r\"}\n");
    } else if (c == '\t') {
        printf("{\"type\":\"serial\",\"data\":\"\\t\"}\n");
    } else if (c >= 32 && c < 127) {
        printf("{\"type\":\"serial\",\"data\":\"%c\"}\n", c);
    } else {
        /* Non-printable: output as unicode escape */
        printf("{\"type\":\"serial\",\"data\":\"\\u%04x\"}\n", (unsigned char)c);
    }
    fflush(stdout);
}

/* Port B write notification hook */
static void portb_write_hook(struct avr_irq_t *irq, uint32_t value, void *param) {
    check_port((avr_t*)param, 'B', (uint8_t)value, &prev_portb);
}

/* Port D write notification hook */
static void portd_write_hook(struct avr_irq_t *irq, uint32_t value, void *param) {
    check_port((avr_t*)param, 'D', (uint8_t)value, &prev_portd);
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <firmware.hex>\n", argv[0]);
        return 1;
    }

    const char *hex_path = argv[1];

    signal(SIGINT, sig_handler);
    signal(SIGTERM, sig_handler);

    /* Disable stdout buffering for real-time JSON output */
    setvbuf(stdout, NULL, _IONBF, 0);

    /* Create AVR instance - ATmega328p at 16MHz */
    avr_t *avr = avr_make_mcu_by_name("atmega328p");
    if (!avr) {
        fprintf(stderr, "Error: could not create ATmega328p instance\n");
        return 1;
    }

    avr_init(avr);
    avr->frequency = 16000000UL;  /* 16 MHz */

    /* Load the hex file */
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

    /* Hook UART output (serial) */
    avr_irq_t *uart_irq = avr_io_getirq(avr, AVR_IOCTL_UART_GETIRQ('0'), UART_IRQ_OUTPUT);
    if (uart_irq) {
        avr_irq_register_notify(uart_irq, uart_output_hook, avr);
    }

    /* Hook port state changes for digital pins */
    avr_irq_t *portb_irq = avr_io_getirq(avr, AVR_IOCTL_IOPORT_GETIRQ('B'), IOPORT_IRQ_REG_PORT);
    if (portb_irq) {
        avr_irq_register_notify(portb_irq, portb_write_hook, avr);
    }

    avr_irq_t *portd_irq = avr_io_getirq(avr, AVR_IOCTL_IOPORT_GETIRQ('D'), IOPORT_IRQ_REG_PORT);
    if (portd_irq) {
        avr_irq_register_notify(portd_irq, portd_write_hook, avr);
    }

    printf("{\"type\":\"ready\"}\n");
    fflush(stdout);

    /* Main simulation loop */
    while (running) {
        int state = avr_run(avr);
        if (state == cpu_Done || state == cpu_Crashed) {
            break;
        }
    }

    avr_terminate(avr);
    return 0;
}
