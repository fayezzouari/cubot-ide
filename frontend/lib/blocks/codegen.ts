// Code generators.
//
//  * Python  — a standalone program that runs the same logic outside the
//              browser: it solves IK itself and drives an arm controller over
//              serial, publishes MQTT with paho, and classifies part colour with
//              OpenCV when a camera is available.
//  * Arduino — controller firmware for a servo arm that speaks the CuBot line
//              protocol (shared by the browser's hardware mode and the Python
//              program).
//
// Line protocol (newline terminated, controller answers "ok" or "ok <value>"):
//   J a1 a2 a3 a4 a5 a6 secs   move all joints (degrees) over `secs`
//   G 0|1                      gripper open / close
//   O ch 0|1                   digital output
//   I ch                       read digital input -> "ok 0|1"

import type { CompiledProgram, Stmt } from './compiler';
import { toSource, type Ast } from './expression';
import { ARM, HOME_JOINTS, JOINT_LIMITS } from './kinematics';
import type { Pose } from './types';

const PY_KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield print time math random robot'.split(' '),
);

const pyName = (n: string) => (PY_KEYWORDS.has(n) ? `${n}_` : n);

const PY_BUILTINS: Record<string, string> = {
  time: 'robot.elapsed()',
  tcp_x: 'robot.tcp()[0]',
  tcp_y: 'robot.tcp()[1]',
  tcp_z: 'robot.tcp()[2]',
  holding: 'robot.holding',
  part_present: 'robot.di(0)',
  machine_done: 'robot.di(1)',
  di0: 'robot.di(0)',
  di1: 'robot.di(1)',
  di2: 'robot.di(2)',
  di3: 'robot.di(3)',
};

const py = (ast: Ast | string) => toSource(ast as Ast, 'py', (n) => PY_BUILTINS[n] ?? pyName(n));

// `{name}` templates become f-strings.
const pyTemplate = (t: string) => {
  const body = t
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\{(?![A-Za-z_][A-Za-z0-9_]*\})/g, '{{')
    .replace(/(?<!\{[A-Za-z_][A-Za-z0-9_]*)\}/g, '}}')
    .replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => `{fmt(${PY_BUILTINS[n] ?? pyName(n)})}`);
  return `f"${body}"`;
};

export function generatePython(program: CompiledProgram, poses: Pose[], name: string): string {
  const lines: string[] = [];
  const emit = (depth: number, s: string) => lines.push('    '.repeat(depth) + s);

  const poseExpr = (f: Record<string, Ast | string>) => {
    const off = ['dx', 'dy', 'dz'].map((k) => (f[k] !== undefined ? py(f[k]) : '0'));
    const pose = `POSES[${JSON.stringify(f.pose)}]`;
    return off.every((o) => o === '0') ? pose : `offset(${pose}, ${off.join(', ')})`;
  };

  const block = (stmts: Stmt[], depth: number) => {
    if (stmts.length === 0) emit(depth, 'pass');
    for (const s of stmts) stmt(s, depth);
  };

  const stmt = (s: Stmt, d: number) => {
    switch (s.kind) {
      case 'end':
        emit(d, 'return');
        return;
      case 'if': {
        emit(d, `if ${py(s.cond)}:`);
        block(s.then, d + 1);
        // Collapse else → single if into elif chains.
        let rest = s.else;
        while (rest.length === 1 && rest[0].kind === 'if') {
          const inner = rest[0];
          emit(d, `elif ${py(inner.cond)}:`);
          block(inner.then, d + 1);
          rest = inner.else;
        }
        if (rest.length) {
          emit(d, 'else:');
          block(rest, d + 1);
        }
        return;
      }
      case 'for':
        emit(d, `for ${pyName(s.var)} in range(int(${py(s.count)})):`);
        block(s.body, d + 1);
        return;
      case 'while':
        emit(d, `while ${py(s.cond)}:`);
        block(s.body, d + 1);
        return;
    }
    const f = s.f;
    const sp = f.speed !== undefined ? py(f.speed) : '60';
    switch (s.type) {
      case 'delay':
        emit(d, `robot.sleep(${py(f.seconds)})`);
        break;
      case 'wait_until':
        emit(d, `robot.wait_until(lambda: ${py(f.condition)}, timeout=${py(f.timeout)})`);
        break;
      case 'alarm':
        emit(d, `raise RobotFault(${pyTemplate(f.message as string)})`);
        break;
      case 'move_pose':
        emit(d, `robot.move_to(${poseExpr(f)}, mode=${JSON.stringify(f.mode)}, speed=${sp})`);
        break;
      case 'move_position':
        emit(d, `robot.move_to((${py(f.x)}, ${py(f.y)}, ${py(f.z)}), mode=${JSON.stringify(f.mode)}, speed=${sp})`);
        break;
      case 'move_relative':
        emit(d, `robot.move_relative(${py(f.dx)}, ${py(f.dy)}, ${py(f.dz)}, speed=${sp})`);
        break;
      case 'move_joint':
        emit(d, `robot.move_joint(${Number(f.joint)}, ${py(f.angle)}, speed=${sp})`);
        break;
      case 'home':
        emit(d, `robot.home(speed=${sp})`);
        break;
      case 'get_position':
        emit(d, `${pyName(`${f.prefix}_x`)}, ${pyName(`${f.prefix}_y`)}, ${pyName(`${f.prefix}_z`)} = robot.tcp()`);
        break;
      case 'pick':
        emit(d, `robot.pick(${poseExpr(f)}, approach=${py(f.approach)}, speed=${sp})`);
        break;
      case 'place':
        emit(d, `robot.place(${poseExpr(f)}, approach=${py(f.approach)}, speed=${sp})`);
        break;
      case 'gripper':
        emit(d, `robot.gripper(${f.action === 'close' ? 'True' : 'False'})`);
        break;
      case 'conveyor':
        emit(d, `robot.do(0, ${f.action === 'stop' ? 'False' : 'True'})  # conveyor`);
        break;
      case 'set_output':
        emit(d, `robot.do(${Number(f.channel)}, ${f.value === 'off' ? 'False' : 'True'})`);
        break;
      case 'wait_input':
        emit(d, `robot.wait_until(lambda: robot.di(${Number(f.channel)}) == ${f.value === 'off' ? 'False' : 'True'}, timeout=${py(f.timeout)})`);
        break;
      case 'inspect':
        emit(d, 'part_color, part_defect = inspect_part()');
        emit(d, 'part_ok = part_color != "none" and not part_defect');
        break;
      case 'read_input':
        emit(d, `${pyName(f.var as string)} = robot.di(${Number(f.channel)})`);
        break;
      case 'set_var':
        emit(d, `${pyName(f.var as string)} = ${py(f.value)}`);
        break;
      case 'change_var':
        emit(d, `${pyName(f.var as string)} += ${py(f.by)}`);
        break;
      case 'pallet':
        emit(
          d,
          `pallet_dx, pallet_dy, pallet_dz = pallet_slot(int(${py(f.index)}), ${py(f.cols)}, ${py(f.rows)}, ${py(f.pitch_x)}, ${py(f.pitch_z)}, ${py(f.layer_height)})`,
        );
        break;
      case 'log':
        emit(d, `log(${pyTemplate(f.message as string)})`);
        break;
      case 'mqtt_publish':
        emit(d, `mqtt.publish(${pyTemplate(f.topic as string)}, ${pyTemplate(f.payload as string)})`);
        break;
    }
  };

  block(program.body, 1);

  const vars = program.variables.filter((v) => !(v in PY_BUILTINS));
  const init = [
    'part_color, part_defect, part_ok = "none", False, False',
    'pallet_dx = pallet_dy = pallet_dz = 0',
    ...vars.filter((v) => !v.startsWith('part_') && !v.startsWith('pallet_')).map((v) => `${pyName(v)} = 0`),
  ];
  const poseLines = poses.map((p) => `    ${JSON.stringify(p.name)}: (${p.x}, ${p.y}, ${p.z}),`);

  return `${PY_HEADER(name)}
POSES = {
${poseLines.join('\n')}
}


def program(robot, mqtt):
${init.map((l) => `    ${l}`).join('\n')}
${lines.join('\n')}


${PY_FOOTER}`;
}

const PY_HEADER = (name: string) => `#!/usr/bin/env python3
"""${name.replace(/"/g, "'")} — generated by CuBot Blocks.

Runs the same program as the simulator, on a real arm controller.

  pip install pyserial paho-mqtt opencv-python   # opencv / mqtt are optional
  python program.py --dry-run                    # print commands, no hardware
  python program.py --port /dev/ttyUSB0          # CuBot serial protocol controller
  python program.py --port COM3 --mqtt broker.local

Coordinates are millimetres in the robot base frame (Y up), angles in degrees.
"""
import argparse
import math
import random
import time

ARM = dict(shoulder=${ARM.shoulderHeight}, upper=${ARM.upperArm}, fore=${ARM.forearm}, tool=${ARM.tool})
HOME = ${JSON.stringify(HOME_JOINTS)}
LIMITS = ${JSON.stringify(JOINT_LIMITS)}
JOINT_SPEED = 150.0   # deg/s at 100 %
LINEAR_SPEED = 600.0  # mm/s at 100 %


class RobotFault(Exception):
    pass


def sin_deg(d):
    return math.sin(math.radians(d))


def cos_deg(d):
    return math.cos(math.radians(d))


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def offset(p, dx=0, dy=0, dz=0):
    return (p[0] + dx, p[1] + dy, p[2] + dz)


def pallet_slot(i, cols, rows, pitch_x, pitch_z, layer_height):
    cols, rows = max(1, int(cols)), max(1, int(rows))
    return ((i % cols) * pitch_x, (i // (cols * rows)) * layer_height, ((i // cols) % rows) * pitch_z)


def fmt(v):
    """Format a value inside {placeholders} the same way the simulator does."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else f"{v:.2f}"
    return str(v)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def fk(j):
    a2 = math.radians(j[1]); a3 = a2 + math.radians(j[2]); a5 = a3 + math.radians(j[4])
    h = ARM["upper"] * math.sin(a2) + ARM["fore"] * math.sin(a3) + ARM["tool"] * math.sin(a5)
    y = ARM["shoulder"] + ARM["upper"] * math.cos(a2) + ARM["fore"] * math.cos(a3) + ARM["tool"] * math.cos(a5)
    return (h * math.sin(math.radians(j[0])), y, h * math.cos(math.radians(j[0])))


def ik(t, roll=0.0):
    x, y, z = t
    r = math.hypot(x, z)
    wy = y + ARM["tool"] - ARM["shoulder"]
    d = math.hypot(r, wy)
    l1, l2 = ARM["upper"], ARM["fore"]
    if y < -5 or r < 120 or d > l1 + l2 - 1 or d < abs(l1 - l2) + 1:
        raise RobotFault(f"target {t} is unreachable")
    elbow = math.acos(clamp((d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1))
    a2 = math.atan2(r, wy) - math.atan2(l2 * math.sin(elbow), l1 + l2 * math.cos(elbow))
    a3 = a2 + elbow
    j = [math.degrees(math.atan2(x, z)), math.degrees(a2), math.degrees(elbow), 0.0, 180 - math.degrees(a3), roll]
    for i, (lo, hi) in enumerate(LIMITS):
        if not lo - 0.01 <= j[i] <= hi + 0.01:
            raise RobotFault(f"J{i + 1} = {j[i]:.1f} deg is outside {lo}..{hi}")
    return j


class Robot:
    """Talks the CuBot line protocol. With port=None it only prints commands."""

    def __init__(self, port=None, baud=115200):
        self.joints = list(HOME)
        self.holding = False
        self.start = time.monotonic()
        self.serial = None
        if port:
            import serial  # pyserial
            self.serial = serial.Serial(port, baud, timeout=10)
            time.sleep(2)  # boards reset when the port opens

    def _cmd(self, line):
        if not self.serial:
            print(">>", line)
            return "ok 1"  # dry run: every input reads as on
        self.serial.write((line + "\\n").encode())
        reply = self.serial.readline().decode().strip()
        if not reply.startswith("ok"):
            raise RobotFault(f"controller replied {reply!r} to {line!r}")
        return reply

    def elapsed(self):
        return time.monotonic() - self.start

    def tcp(self):
        return fk(self.joints)

    def move_joints(self, target, speed=60):
        delta = max(abs(a - b) for a, b in zip(target, self.joints))
        secs = delta / (JOINT_SPEED * clamp(speed, 1, 100) / 100)
        self._cmd("J " + " ".join(f"{a:.1f}" for a in target) + f" {secs:.2f}")
        if not self.serial:
            time.sleep(min(secs, 0.05))
        self.joints = list(target)

    def move_to(self, target, mode="joint", speed=60):
        if mode == "joint":
            return self.move_joints(ik(target, self.joints[5]), speed)
        start = self.tcp()
        dist = math.dist(start, target)
        steps = max(1, int(dist / 20))
        for i in range(1, steps + 1):
            s = i / steps
            p = tuple(a + (b - a) * s for a, b in zip(start, target))
            j = ik(p, self.joints[5])
            secs = dist / steps / (LINEAR_SPEED * clamp(speed, 1, 100) / 100)
            self._cmd("J " + " ".join(f"{a:.1f}" for a in j) + f" {secs:.2f}")
            self.joints = j

    def move_relative(self, dx, dy, dz, speed=40):
        self.move_to(offset(self.tcp(), dx, dy, dz), "linear", speed)

    def move_joint(self, joint, angle, speed=60):
        target = list(self.joints)
        target[joint - 1] = angle
        self.move_joints(target, speed)

    def home(self, speed=60):
        self.move_joints(HOME, speed)

    def gripper(self, close):
        self._cmd(f"G {1 if close else 0}")
        self.holding = close
        time.sleep(0.35)

    def pick(self, p, approach=120, speed=60):
        self.gripper(False)
        self.move_to(offset(p, 0, approach, 0), "joint", speed)
        self.move_to(p, "linear", min(speed, 40))
        self.gripper(True)
        self.move_to(offset(p, 0, approach, 0), "linear", min(speed, 40))

    def place(self, p, approach=120, speed=60):
        self.move_to(offset(p, 0, approach, 0), "joint", speed)
        self.move_to(p, "linear", min(speed, 40))
        self.gripper(False)
        self.move_to(offset(p, 0, approach, 0), "linear", min(speed, 40))

    def do(self, ch, on):
        self._cmd(f"O {ch} {1 if on else 0}")

    def di(self, ch):
        return self._cmd(f"I {ch}").split()[-1] == "1"

    def sleep(self, secs):
        time.sleep(max(0, secs))

    def wait_until(self, cond, timeout=0):
        deadline = time.monotonic() + timeout if timeout > 0 else None
        while not cond():
            if deadline and time.monotonic() > deadline:
                raise RobotFault(f"timed out after {timeout} s")
            time.sleep(0.05)


_camera = None


def inspect_part():
    """Classify the part under the camera by hue. Returns (color, defect).

    Replace the defect check with your own model (e.g. a trained classifier).
    """
    global _camera
    try:
        import cv2
    except ImportError:
        return "none", False
    if _camera is None:
        _camera = cv2.VideoCapture(0)
    ok, frame = _camera.read()
    if not ok:
        return "none", False
    h, w = frame.shape[:2]
    roi = cv2.cvtColor(frame[h // 3: 2 * h // 3, w // 3: 2 * w // 3], cv2.COLOR_BGR2HSV)
    hue, sat, val = [float(c) for c in cv2.mean(roi)[:3]]
    if sat < 60 or val < 40:
        return "none", False
    color = "red" if hue < 10 or hue > 160 else "yellow" if hue < 35 else "green" if hue < 85 else "blue"
    defect = False  # TODO: plug in surface inspection
    return color, defect


class Mqtt:
    def __init__(self, host=None):
        self.client = None
        if host:
            import paho.mqtt.client as paho
            self.client = paho.Client()
            self.client.connect(host)
            self.client.loop_start()

    def publish(self, topic, payload):
        log(f"MQTT {topic} {payload}")
        if self.client:
            self.client.publish(topic, payload)
`;

const PY_FOOTER = `def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", help="serial port of the arm controller")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--mqtt", help="MQTT broker host")
    ap.add_argument("--dry-run", action="store_true", help="print commands instead of using hardware")
    args = ap.parse_args()
    robot = Robot(None if args.dry_run else args.port, args.baud)
    mqtt = Mqtt(args.mqtt)
    try:
        robot.home(30)
        program(robot, mqtt)
        log("Program finished")
    except RobotFault as e:
        log(f"FAULT: {e}")
        robot.do(3, True)
        raise SystemExit(1)
    except KeyboardInterrupt:
        log("Stopped by operator")


if __name__ == "__main__":
    main()
`;

export function generateFirmware(): string {
  return `// CuBot arm controller firmware (Arduino Uno / Nano / ESP32 with ESP32Servo).
//
// Drives a 6-axis hobby servo arm plus a servo gripper and speaks the CuBot
// line protocol at 115200 baud, so the browser's hardware mode and exported
// Python programs can run on it.
//
//   J a1 a2 a3 a4 a5 a6 secs  -> ok      (joint move, interpolated)
//   G 0|1                     -> ok      (gripper)
//   O ch 0|1                  -> ok      (digital output)
//   I ch                      -> ok 0|1  (digital input)
//
// Calibrate SERVO_OFFSET / SERVO_DIR so that the arm matches the simulator at
// HOME = ${JSON.stringify(HOME_JOINTS)}.

#include <Servo.h>

const uint8_t SERVO_PIN[6]   = {3, 5, 6, 9, 10, 11};
const uint8_t GRIPPER_PIN    = 12;
const int     GRIP_OPEN      = 30;
const int     GRIP_CLOSED    = 95;
const float   SERVO_OFFSET[6] = {90, 90, 0, 90, 90, 90};   // servo degrees at joint 0°
const float   SERVO_DIR[6]    = {1, 1, 1, 1, 1, 1};         // flip to -1 if a joint runs backwards
const uint8_t OUTPUT_PIN[4]  = {A0, A1, A2, A3};           // conveyor, machine start, green, red
const uint8_t INPUT_PIN[4]   = {2, 4, 7, 8};               // part sensor, machine done, zone clear, button

Servo servo[6];
Servo gripper;
float current[6] = {${HOME_JOINTS.join(', ')}};

void writeJoint(uint8_t i, float angle) {
  float s = SERVO_OFFSET[i] + SERVO_DIR[i] * angle;
  servo[i].writeMicroseconds(map(constrain(s, 0, 180) * 10, 0, 1800, 544, 2400));
}

void moveJoints(const float *target, float secs) {
  float start[6];
  memcpy(start, current, sizeof(start));
  unsigned long t0 = millis();
  unsigned long ms = (unsigned long)(secs * 1000);
  for (;;) {
    float s = ms == 0 ? 1.0 : min(1.0, (millis() - t0) / (float)ms);
    float e = s * s * (3 - 2 * s);  // smoothstep, same profile as the simulator
    for (uint8_t i = 0; i < 6; i++) {
      current[i] = start[i] + (target[i] - start[i]) * e;
      writeJoint(i, current[i]);
    }
    if (s >= 1.0) break;
    delay(10);
  }
}

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < 6; i++) { servo[i].attach(SERVO_PIN[i]); writeJoint(i, current[i]); }
  gripper.attach(GRIPPER_PIN);
  gripper.write(GRIP_OPEN);
  for (uint8_t i = 0; i < 4; i++) { pinMode(OUTPUT_PIN[i], OUTPUT); pinMode(INPUT_PIN[i], INPUT_PULLUP); }
}

void loop() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\\n');
  line.trim();
  if (line.length() == 0) return;
  char cmd = line.charAt(0);
  const char *args = line.c_str() + 1;

  if (cmd == 'J') {
    float t[6], secs;
    char *p = (char *)args;
    for (uint8_t i = 0; i < 6; i++) t[i] = strtod(p, &p);
    secs = strtod(p, &p);
    moveJoints(t, secs);
    Serial.println("ok");
  } else if (cmd == 'G') {
    gripper.write(atoi(args) ? GRIP_CLOSED : GRIP_OPEN);
    Serial.println("ok");
  } else if (cmd == 'O') {
    int ch, v;
    if (sscanf(args, "%d %d", &ch, &v) == 2 && ch >= 0 && ch < 4) {
      digitalWrite(OUTPUT_PIN[ch], v ? HIGH : LOW);
      Serial.println("ok");
    } else Serial.println("err bad output");
  } else if (cmd == 'I') {
    int ch = atoi(args);
    if (ch >= 0 && ch < 4) {
      Serial.print("ok ");
      Serial.println(digitalRead(INPUT_PIN[ch]) == LOW ? 1 : 0);  // active low with pull-up
    } else Serial.println("err bad input");
  } else {
    Serial.println("err unknown command");
  }
}
`;
}
