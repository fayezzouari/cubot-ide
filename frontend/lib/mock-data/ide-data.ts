// Mock file tree data for the IDE
export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  source?: 'ide' | 'sandbox';
}

export const mockFileTree: FileNode[] = [
  {
    id: '1',
    name: 'src',
    type: 'folder',
    children: [
      { id: '2', name: 'main.c', type: 'file' },
      { id: '3', name: 'gpio.c', type: 'file' },
      { id: '4', name: 'gpio.h', type: 'file' },
      { id: '5', name: 'uart.c', type: 'file' },
      { id: '6', name: 'uart.h', type: 'file' },
    ],
  },
  {
    id: '7',
    name: 'include',
    type: 'folder',
    children: [
      { id: '8', name: 'config.h', type: 'file' },
      { id: '9', name: 'types.h', type: 'file' },
    ],
  },
  { id: '10', name: 'Makefile', type: 'file' },
  { id: '11', name: 'README.md', type: 'file' },
];

// Mock file contents
export const mockFileContents: Record<string, string> = {
  '2': `#include <stdio.h>
#include "gpio.h"
#include "uart.h"

int main(void) {
    // Initialize peripherals
    gpio_init();
    uart_init(9600);
    
    // Main loop
    while(1) {
        // Toggle LED on GPIO pin 13
        gpio_toggle(13);
        
        // Send status via UART
        uart_send("LED toggled\\n");
        
        // Delay
        for(volatile int i = 0; i < 100000; i++);
    }
    
    return 0;
}`,
  '3': `#include "gpio.h"

void gpio_init(void) {
    // Configure GPIO pins
    // Set pin 13 as output
    GPIO_MODER |= (1 << 26);
}

void gpio_toggle(int pin) {
    GPIO_ODR ^= (1 << pin);
}

void gpio_write(int pin, int value) {
    if(value) {
        GPIO_ODR |= (1 << pin);
    } else {
        GPIO_ODR &= ~(1 << pin);
    }
}

int gpio_read(int pin) {
    return (GPIO_IDR >> pin) & 1;
}`,
  '4': `#ifndef GPIO_H
#define GPIO_H

// GPIO Register definitions
#define GPIO_MODER  (*(volatile unsigned int*)0x40020000)
#define GPIO_ODR    (*(volatile unsigned int*)0x40020014)
#define GPIO_IDR    (*(volatile unsigned int*)0x40020010)

// Function prototypes
void gpio_init(void);
void gpio_toggle(int pin);
void gpio_write(int pin, int value);
int gpio_read(int pin);

#endif // GPIO_H`,
  '5': `#include "uart.h"

static volatile unsigned int* const UART_DR = (unsigned int*)0x40011004;
static volatile unsigned int* const UART_SR = (unsigned int*)0x40011000;
static volatile unsigned int* const UART_BRR = (unsigned int*)0x4001100C;

void uart_init(unsigned int baudrate) {
    // Configure UART with given baudrate
    *UART_BRR = 84000000 / baudrate;
}

void uart_send(const char* str) {
    while(*str) {
        // Wait for transmit buffer empty
        while(!(*UART_SR & (1 << 7)));
        *UART_DR = *str++;
    }
}

char uart_receive(void) {
    // Wait for data
    while(!(*UART_SR & (1 << 5)));
    return *UART_DR;
}`,
  '6': `#ifndef UART_H
#define UART_H

void uart_init(unsigned int baudrate);
void uart_send(const char* str);
char uart_receive(void);

#endif // UART_H`,
  '8': `#ifndef CONFIG_H
#define CONFIG_H

// System configuration
#define SYSTEM_CLOCK    84000000
#define LED_PIN         13
#define BUTTON_PIN      0

// UART Configuration
#define UART_BAUDRATE   9600

// Debug settings
#define DEBUG_ENABLED   1

#endif // CONFIG_H`,
  '9': `#ifndef TYPES_H
#define TYPES_H

typedef unsigned char   uint8_t;
typedef unsigned short  uint16_t;
typedef unsigned int    uint32_t;
typedef signed char     int8_t;
typedef signed short    int16_t;
typedef signed int      int32_t;

typedef enum {
    FALSE = 0,
    TRUE = 1
} bool_t;

typedef enum {
    OK = 0,
    ERROR = -1,
    TIMEOUT = -2
} status_t;

#endif // TYPES_H`,
  '10': `# Makefile for embedded project

CC = arm-none-eabi-gcc
CFLAGS = -mcpu=cortex-m4 -mthumb -O2 -Wall
LDFLAGS = -T linker.ld -nostartfiles

SRCS = src/main.c src/gpio.c src/uart.c
OBJS = $(SRCS:.c=.o)
TARGET = firmware.elf

all: $(TARGET)

$(TARGET): $(OBJS)
\t$(CC) $(LDFLAGS) -o $@ $^

%.o: %.c
\t$(CC) $(CFLAGS) -c -o $@ $<

clean:
\trm -f $(OBJS) $(TARGET)

flash: $(TARGET)
\topenocd -f board/stm32f4discovery.cfg -c "program $(TARGET) verify reset exit"

.PHONY: all clean flash`,
  '11': `# Embedded Project

A simple embedded systems project demonstrating GPIO and UART functionality.

## Features

- LED blinking on GPIO pin 13
- UART communication at 9600 baud
- Modular code structure

## Building

\`\`\`bash
make clean
make
\`\`\`

## Flashing

\`\`\`bash
make flash
\`\`\`

## Hardware

- STM32F4 Discovery Board
- On-board LED connected to GPIO pin 13

## License

MIT License`,
};

// Chat mode
export type ChatMode = 'vibe' | 'plan';

// Plan step (used in plan mode messages)
export interface PlanStepExecutionResult {
  message: string;
  logs: Array<{ command: string; stdout: string; stderr: string; exit_code: number; success: boolean }>;
  fileOps: any[];
  success: boolean;
}

export interface PlanStep {
  id: string;
  stepNumber: number;
  title: string;
  body: string;
  status: 'pending' | 'executing' | 'done' | 'discarded';
  executionResult?: PlanStepExecutionResult;
}

// Mock chat messages
export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  planSteps?: PlanStep[];
  pendingFileOps?: any[];
}

/** Parse a plan-mode AI response into structured PlanStep objects. */
export function parsePlanSteps(content: string): PlanStep[] {
  const lines = content.split('\n');
  const steps: PlanStep[] = [];
  let current: { num: number; title: string; bodyLines: string[] } | null = null;

  // Matches lines like: "**Step 1: Title**", "1. Title", "Step 1: Title", "### 1. Title"
  const stepStart = /^(?:#{1,3}\s*)?(?:\*{0,2})?(?:Step\s+)?(\d+)[.:)\s]\s*\*{0,2}([^*\n]+?)\*{0,2}$/i;

  for (const line of lines) {
    const m = line.trim().match(stepStart);
    if (m) {
      if (current) {
        steps.push({
          id: `step-${current.num}-${Math.random().toString(36).substring(2, 8)}`,
          stepNumber: current.num,
          title: current.title,
          body: current.bodyLines.join('\n').trim(),
          status: 'pending',
        });
      }
      current = { num: parseInt(m[1]), title: m[2].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }

  if (current) {
    steps.push({
      id: `step-${current.num}-${Math.random().toString(36).substring(2, 8)}`,
      stepNumber: current.num,
      title: current.title,
      body: current.bodyLines.join('\n').trim(),
      status: 'pending',
    });
  }

  return steps;
}

// Separate initial messages for each mode to maintain independent conversation histories
export const mockMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content: 'Hello! I\'m your AI assistant for embedded development. How can I help you today?',
  },
];

export const mockVibeModeMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content: 'Hello! I\'m your AI assistant. How can I help?',
  },
];

export const mockPlanModeMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content: 'I can help you plan complex projects step-by-step. Describe what you want to build!',
  },
];
