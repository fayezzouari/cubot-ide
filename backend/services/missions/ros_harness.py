import json
import os
import signal
import subprocess
import sys
import time

MARKER = "@@CUBOT_MISSION@@"
GRACE_MS = 3000
OUTPUT_LIMIT = 4000


def _plain(value):
    return value.tolist() if hasattr(value, "tolist") else list(value)


def _start(commands):
    procs = []
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    for index, command in enumerate(commands):
        log = open(f"/tmp/cubot-mission-{index}.log", "w+b")
        proc = subprocess.Popen(
            ["/bin/bash", "-c", command],
            stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True,
        )
        procs.append((command, proc, log))
    return procs


def _stop(procs):
    states = []
    for command, proc, log in procs:
        exit_code = proc.poll()
        if exit_code is None:
            try:
                os.killpg(proc.pid, signal.SIGINT)
            except ProcessLookupError:
                pass
        states.append((command, proc, log, exit_code))
    deadline = time.monotonic() + 2
    for _, proc, _, _ in states:
        try:
            proc.wait(timeout=max(0.0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()
    processes = []
    for command, _, log, exit_code in states:
        log.flush()
        log.seek(0)
        output = log.read().decode("utf-8", errors="replace")
        log.close()
        processes.append({"command": command, "exit_code": exit_code, "output": output[-OUTPUT_LIMIT:]})
    return processes


def run(spec):
    import rclpy
    from rclpy.node import Node
    from rosidl_runtime_py.convert import message_to_ordereddict
    from rosidl_runtime_py.set_message import set_message_fields
    from rosidl_runtime_py.utilities import get_message, get_service

    messages = []
    calls = []
    nodes = []
    pending = sorted(spec["scenario"], key=lambda s: s["at_ms"])
    inflight = []
    procs = _start(spec["run"])
    started = time.monotonic()

    def now_ms():
        return (time.monotonic() - started) * 1000

    rclpy.init()
    node = None
    try:
        node = Node("cubot_mission_checker")
        for entry in spec["subscribe"]:
            topic = entry["topic"]

            def on_message(msg, topic=topic):
                messages.append({"t": now_ms(), "topic": topic, "data": message_to_ordereddict(msg)})

            node.create_subscription(get_message(entry["msg_type"]), topic, on_message, 10)

        publishers = {}
        clients = {}
        for step in pending:
            if step["action"] == "publish":
                key = (step["topic"], step["msg_type"])
                if key not in publishers:
                    msg_cls = get_message(step["msg_type"])
                    publishers[key] = (msg_cls, node.create_publisher(msg_cls, step["topic"], 10))
            elif step["action"] == "call":
                key = (step["service"], step["srv_type"])
                if key not in clients:
                    srv_cls = get_service(step["srv_type"])
                    clients[key] = (srv_cls, node.create_client(srv_cls, step["service"]))

        while now_ms() < spec["duration_ms"]:
            rclpy.spin_once(node, timeout_sec=0.005)
            while pending and pending[0]["at_ms"] <= now_ms():
                step = pending[0]
                late = now_ms() > step["at_ms"] + GRACE_MS
                if step["action"] == "publish":
                    msg_cls, publisher = publishers[(step["topic"], step["msg_type"])]
                    if publisher.get_subscription_count() == 0 and not late:
                        break
                    msg = msg_cls()
                    set_message_fields(msg, step["data"])
                    publisher.publish(msg)
                elif step["action"] == "call":
                    srv_cls, service_client = clients[(step["service"], step["srv_type"])]
                    if not service_client.service_is_ready():
                        if not late:
                            break
                        calls.append({"id": step["id"], "t": now_ms(), "ok": False,
                                      "error": f"Service {step['service']} was not available."})
                    else:
                        request = srv_cls.Request()
                        set_message_fields(request, step["request"])
                        inflight.append((step, service_client.call_async(request)))
                pending.pop(0)
            for item in [item for item in inflight if item[1].done()]:
                inflight.remove(item)
                step, future = item
                if future.exception() is not None:
                    calls.append({"id": step["id"], "t": now_ms(), "ok": False, "error": str(future.exception())})
                else:
                    calls.append({"id": step["id"], "t": now_ms(), "ok": True,
                                  "response": message_to_ordereddict(future.result())})
        nodes = [name for name in node.get_node_names() if name != node.get_name()]
    finally:
        processes = _stop(procs)
        if node is not None:
            node.destroy_node()
        rclpy.try_shutdown()

    for step, _ in inflight:
        calls.append({"id": step["id"], "t": now_ms(), "ok": False,
                      "error": f"Service {step['service']} did not respond."})
    for step in pending:
        if step["action"] == "call":
            calls.append({"id": step["id"], "t": now_ms(), "ok": False,
                          "error": f"Service {step['service']} was not available."})
    return {
        "duration_ms": now_ms(),
        "messages": messages,
        "calls": calls,
        "nodes": nodes,
        "processes": processes,
    }


def main():
    spec = json.loads(sys.argv[1])
    try:
        result = run(spec)
    except Exception as exc:
        result = {"error": f"{type(exc).__name__}: {exc}"}
    sys.stdout.write(MARKER + json.dumps(result, default=_plain) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
