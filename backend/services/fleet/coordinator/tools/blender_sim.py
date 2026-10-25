import argparse
import bmesh
import bpy
import colorsys
import json
import math
import os
import queue
import random
import sys
import time

from mathutils import Matrix

try:
    import paho.mqtt.client as mqtt
    PAHO_AVAILABLE = True
except ImportError:
    PAHO_AVAILABLE = False


INTERFACE_NAME = "uagv"
MAJOR_VERSION = "2"
ORDER_SUFFIX = "order"
INSTANT_ACTIONS_SUFFIX = "instantActions"
CANCEL_ORDER_ACTION = "cancelOrder"


def _topic_filter(suffix):
    return f"{INTERFACE_NAME}/v{MAJOR_VERSION}/+/+/{suffix}"


def order_topic_filter():
    return _topic_filter(ORDER_SUFFIX)


def instant_actions_topic_filter():
    return _topic_filter(INSTANT_ACTIONS_SUFFIX)


def parse_topic(topic, expected_suffix):
    parts = topic.split("/")
    if len(parts) != 5:
        return None
    interface, version, manufacturer, serial, suffix = parts
    if interface != INTERFACE_NAME or suffix != expected_suffix:
        return None
    return manufacturer, serial


def _vda_topic(manufacturer, serial, message_type):
    return f"{INTERFACE_NAME}/v{MAJOR_VERSION}/{manufacturer}/{serial}/{message_type}"


_incoming_orders = queue.Queue()
_order_store = {}
_finished_actions = {}
_pending_action_ids = {}
_mqtt_client = None
_mqtt_thread_connected = False
_just_connected = False
_STATE_HEADER_IDS = {}


def _on_connect(client, userdata, flags, reason_code, properties=None):
    global _just_connected
    print(f"[blender_sim] MQTT connected: {reason_code}")
    client.subscribe(order_topic_filter(), qos=1)
    client.subscribe(instant_actions_topic_filter(), qos=1)
    print(f"[blender_sim] subscribed to {order_topic_filter()}, {instant_actions_topic_filter()}")
    _just_connected = True


def _on_disconnect(client, userdata, *args):
    print("[blender_sim] MQTT disconnected")


def _on_message(client, userdata, msg):
    order_match = parse_topic(msg.topic, ORDER_SUFFIX)
    instant_match = None if order_match else parse_topic(msg.topic, INSTANT_ACTIONS_SUFFIX)
    match = order_match or instant_match
    if not match:
        return
    manufacturer, serial = match
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except Exception as e:
        print(f"[blender_sim] bad payload on {msg.topic}: {e}")
        return
    kind = "order" if order_match else "instant"
    _incoming_orders.put((kind, manufacturer, serial, payload))


def start_mqtt(host="localhost", port=1893, keepalive=60):
    global _mqtt_client, _mqtt_thread_connected
    if not PAHO_AVAILABLE:
        print("[blender_sim] paho-mqtt not installed. Run pip install paho-mqtt "
              "into Blender's Python, e.g.:\n"
              "  <blender>/python/bin/python3.x -m pip install paho-mqtt")
        return False

    stop_mqtt()

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                              client_id=f"cubot-blender-sim-{int(time.time())}")
    except AttributeError:
        client = mqtt.Client(client_id=f"cubot-blender-sim-{int(time.time())}")

    client.on_connect = _on_connect
    client.on_disconnect = _on_disconnect
    client.on_message = _on_message

    client.reconnect_delay_set(min_delay=1, max_delay=10)
    try:
        client.connect_async(host, port, keepalive)
    except Exception as e:
        print(f"[blender_sim] MQTT connect failed: {e}")
        return False

    client.loop_start()
    print(f"[blender_sim] connecting to {host}:{port} (retries until the broker answers)")
    _mqtt_client = client
    _mqtt_thread_connected = True
    return True


def stop_mqtt():
    global _mqtt_client, _mqtt_thread_connected
    if _mqtt_client is not None:
        publish_all_connections("OFFLINE")
        try:
            _mqtt_client.loop_stop()
            _mqtt_client.disconnect()
        except Exception:
            pass
    _mqtt_client = None
    _mqtt_thread_connected = False


def _next_header_id(serial, message_type):
    key = (serial, message_type)
    n = _STATE_HEADER_IDS.get(key, 0) + 1
    _STATE_HEADER_IDS[key] = n
    return n


def _iso_now():
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def publish_connection(root, connection_state):
    if _mqtt_client is None:
        return
    manufacturer = root.get("manufacturer", "cubot")
    serial = root.get("serialNumber", "")
    payload = {
        "headerId": _next_header_id(serial, "connection"),
        "timestamp": _iso_now(),
        "version": "2.0.0",
        "manufacturer": manufacturer,
        "serialNumber": serial,
        "connectionState": connection_state,
    }
    _mqtt_client.publish(
        _vda_topic(manufacturer, serial, "connection"),
        json.dumps(payload),
        qos=1,
        retain=True,
    )


def publish_state(root, driving):
    if _mqtt_client is None:
        return
    manufacturer = root.get("manufacturer", "cubot")
    serial = root.get("serialNumber", "")
    key = (manufacturer, serial)
    origin = _map_origin()
    ox, oy = (origin.location.x, origin.location.y) if origin else (0.0, 0.0)
    payload = {
        "headerId": _next_header_id(serial, "state"),
        "timestamp": _iso_now(),
        "version": "2.0.0",
        "manufacturer": manufacturer,
        "serialNumber": serial,
        "orderId": root.get("orderId", ""),
        "orderUpdateId": root.get("orderUpdateId", 0),
        "driving": driving,
        "operatingMode": "AUTOMATIC",
        "agvPosition": {
            "x": root.location.x - ox,
            "y": Y_SIGN * (root.location.y - oy),
            "theta": Y_SIGN * root.rotation_euler.z,
            "mapId": (origin.get("mapId", "") if origin else ""),
            "positionInitialized": True,
        },
        "batteryState": {"batteryCharge": root.get("battery", 100.0), "charging": False},
        "actionStates": [
            {"actionId": aid, "actionType": atype, "actionStatus": "FINISHED"}
            for aid, atype in _finished_actions.get(key, {}).items()
        ],
        "errors": [],
    }
    _mqtt_client.publish(_vda_topic(manufacturer, serial, "state"), json.dumps(payload))


def publish_all_connections(connection_state):
    robots_coll = bpy.data.collections.get("Robots")
    if not robots_coll:
        return
    for obj in robots_coll.objects:
        if "serialNumber" in obj and obj.parent is None:
            publish_connection(obj, connection_state)


def find_robot_root(manufacturer, serial):
    name = f"AGV_{serial}"
    obj = bpy.data.objects.get(name)
    if obj is None:
        return None
    if obj.get("manufacturer") != manufacturer or obj.get("serialNumber") != serial:
        return None
    return obj


def _map_origin():
    return bpy.data.objects.get("MapOrigin")


def node_to_world(node_position, scene):
    origin = _map_origin()
    ox, oy = (origin.location.x, origin.location.y) if origin else (0.0, 0.0)
    scale = scene.get("vda5050_cell_size", 1.0)
    x = ox + node_position.get("x", 0.0) * scale
    y = oy + Y_SIGN * node_position.get("y", 0.0) * scale
    return (x, y, 0.0)


def apply_order(manufacturer, serial, order, scene):
    root = find_robot_root(manufacturer, serial)
    if root is None:
        print(f"[blender_sim] order for unknown robot {manufacturer}/{serial}, ignoring")
        return
    if not root.get("online", True):
        print(f"[blender_sim] robot {serial} offline, dropping order")
        return

    origin = _map_origin()
    expected_map = origin.get("mapId") if origin else None

    order_id = order.get("orderId")
    order_update_id = order.get("orderUpdateId", 0)
    nodes = order.get("nodes", [])
    key = (manufacturer, serial)
    stored = _order_store.get(key)

    is_new_order = stored is None or stored["orderId"] != order_id
    is_stale_update = (not is_new_order) and order_update_id <= stored["orderUpdateId"]
    if is_stale_update:
        print(f"[blender_sim] stale orderUpdateId for {serial}, ignoring")
        return

    released_nodes = [n for n in nodes if n.get("released", True)]
    released_nodes.sort(key=lambda n: n.get("sequenceId", 0))

    world_nodes = []
    for n in released_nodes:
        pos = n.get("nodePosition") or {}
        if expected_map and pos.get("mapId") and pos.get("mapId") != expected_map:
            print(f"[blender_sim] node {n.get('nodeId')} targets mapId "
                  f"'{pos.get('mapId')}' != current map '{expected_map}', skipping node")
            continue
        world_nodes.append({
            "nodeId": n.get("nodeId"),
            "sequenceId": n.get("sequenceId", 0),
            "world": node_to_world(pos, scene),
            "actions": n.get("actions", []),
        })

    if is_new_order:
        cursor = 0
        _finished_actions.pop(key, None)
        _pending_action_ids.pop(key, None)
        _action_pause_until.pop(key, None)
    else:
        cursor = min(stored.get("cursor", 0), len(world_nodes))

    _order_store[key] = {
        "orderId": order_id,
        "orderUpdateId": order_update_id,
        "nodes": world_nodes,
        "cursor": cursor,
    }

    root["orderId"] = order_id or ""
    root["orderUpdateId"] = order_update_id
    print(f"[blender_sim] {serial}: order '{order_id}' upd={order_update_id} "
          f"-> {len(world_nodes)} nodes queued (cursor={cursor})")


def apply_instant_actions(manufacturer, serial, payload):
    actions = payload.get("actions") or []
    if not any(a.get("actionType") == CANCEL_ORDER_ACTION for a in actions):
        return
    key = (manufacturer, serial)
    _order_store.pop(key, None)
    _pending_action_ids.pop(key, None)
    _action_pause_until.pop(key, None)
    print(f"[blender_sim] {serial}: order cancelled")


def drain_incoming_orders():
    scene = bpy.context.scene
    drained = 0
    while True:
        try:
            kind, manufacturer, serial, payload = _incoming_orders.get_nowait()
        except queue.Empty:
            break
        if kind == "order":
            apply_order(manufacturer, serial, payload, scene)
        else:
            apply_instant_actions(manufacturer, serial, payload)
        drained += 1
    return 0.1


def clear_robots():
    robots_coll = bpy.data.collections.get("Robots")
    if robots_coll is None:
        return
    for obj in list(robots_coll.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


WHEEL_RADIUS = 0.1
Y_SIGN = -1.0


def _ensure_collection(name, hidden=False):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    coll.hide_viewport = hidden
    coll.hide_render = hidden
    return coll


def _clear_collection(coll):
    for obj in list(coll.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if isinstance(data, bpy.types.Mesh) and data.users == 0:
            bpy.data.meshes.remove(data)


def _material(name, rgb, emission=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        if emission:
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission
    mat.diffuse_color = (*rgb, 1.0)
    return mat


def _mesh_object(name, coll, build, mat=None):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    bm.to_mesh(mesh)
    bm.free()
    if mat is not None:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    return obj


def _box(sx, sy, sz, offset=(0.0, 0.0, 0.0)):
    def build(bm):
        geom = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=geom)
        bmesh.ops.translate(bm, vec=offset, verts=geom)
    return build


def _hex_to_rgb(value, fallback=(0.88, 0.63, 0.43)):
    value = (value or "").lstrip("#")
    if len(value) != 6:
        return fallback
    try:
        return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return fallback


def build_agv_template():
    tmpl_coll = _ensure_collection("Templates", hidden=True)
    if "AGV_Root" in bpy.data.objects:
        return bpy.data.objects["AGV_Root"]

    root = bpy.data.objects.new("AGV_Root", None)
    root.empty_display_type = 'PLAIN_AXES'
    root.empty_display_size = 0.3
    root["wheel_radius"] = WHEEL_RADIUS
    tmpl_coll.objects.link(root)

    body = _mesh_object("AGV_Body", tmpl_coll, _box(0.8, 0.55, 0.22, (0.0, 0.0, WHEEL_RADIUS + 0.08)),
                        _material("AGV_Body_Mat", (0.88, 0.63, 0.43)))
    body.parent = root

    nose = _mesh_object("AGV_Nose", tmpl_coll, _box(0.12, 0.3, 0.06, (0.36, 0.0, WHEEL_RADIUS + 0.22)),
                        _material("AGV_Nose_Mat", (0.1, 0.1, 0.1)))
    nose.parent = root

    def wheel(bm):
        geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=WHEEL_RADIUS,
                                     radius2=WHEEL_RADIUS, depth=0.06)["verts"]
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=geom)

    wheel_mat = _material("AGV_Wheel_Mat", (0.05, 0.05, 0.05))
    for suffix, (x, y) in {"FL": (0.27, 0.3), "FR": (0.27, -0.3),
                           "BL": (-0.27, 0.3), "BR": (-0.27, -0.3)}.items():
        w = _mesh_object(f"AGV_Wheel_{suffix}", tmpl_coll, wheel, wheel_mat)
        w.location = (x, y, WHEEL_RADIUS)
        w.rotation_euler = (0.0, 0.0, math.pi / 2)
        w.parent = root

    def sphere(bm):
        geom = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.06)["verts"]
        bmesh.ops.translate(bm, vec=(-0.25, 0.0, WHEEL_RADIUS + 0.25), verts=geom)

    light = _mesh_object("AGV_StatusLight", tmpl_coll, sphere,
                         _material("AGV_StatusLight_Mat", (0.1, 0.9, 0.1), emission=3.0))
    light.parent = root
    return root


def build_scene(width=20, height=20, cell_size=1.0, obstacles=(), map_id="", origin=(0.0, 0.0)):
    scene = bpy.context.scene
    scene["vda5050_cell_size"] = 1.0
    scene["vda5050_map_size"] = float(max(width, height)) * cell_size
    scene["vda5050_grid"] = [int(width), int(height), float(cell_size), float(origin[0]), float(origin[1])]

    map_origin = bpy.data.objects.get("MapOrigin")
    if map_origin is None:
        map_origin = bpy.data.objects.new("MapOrigin", None)
        map_origin.empty_display_type = 'ARROWS'
        scene.collection.objects.link(map_origin)
    map_origin.location = (0.0, 0.0, 0.0)
    map_origin["mapId"] = map_id

    env_coll = _ensure_collection("Environment")
    _clear_collection(env_coll)

    half = cell_size / 2.0
    ox, oy = origin
    floor_w, floor_h = width * cell_size, height * cell_size
    _mesh_object("Floor", env_coll,
                 _box(floor_w, floor_h, 0.02, (ox - half + floor_w / 2, Y_SIGN * (oy - half + floor_h / 2), -0.01)),
                 _material("Floor_Mat", (0.62, 0.63, 0.65)))

    if obstacles:
        def walls(bm):
            for col, row in obstacles:
                geom = bmesh.ops.create_cube(bm, size=1.0)["verts"]
                bmesh.ops.scale(bm, vec=(cell_size, cell_size, 1.0), verts=geom)
                bmesh.ops.translate(bm, vec=(ox + col * cell_size, Y_SIGN * (oy + row * cell_size), 0.5), verts=geom)
        _mesh_object("Obstacles", env_coll, walls, _material("Obstacle_Mat", (0.45, 0.46, 0.49)))

    if not any(o.type == 'LIGHT' for o in scene.objects):
        sun_data = bpy.data.lights.new("Sun", type='SUN')
        sun_data.energy = 3.0
        sun = bpy.data.objects.new("Sun", sun_data)
        sun.rotation_euler = (0.6, 0.2, 0.8)
        scene.collection.objects.link(sun)

    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = (0.5, 0.5, 0.52)
    background = world.node_tree.nodes.get("Background") if world.node_tree else None
    if background:
        background.inputs["Color"].default_value = (0.5, 0.5, 0.52, 1.0)

    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != 'VIEW_3D':
                continue
            shading = area.spaces.active.shading
            shading.background_type = 'WORLD'
            shading.color_type = 'MATERIAL'

    build_agv_template()
    print(f"[blender_sim] scene built: {width}x{height} cells @ {cell_size} m, "
          f"{len(obstacles)} obstacles, mapId='{map_id}'")


def _reset_runtime_state():
    clear_robots()
    clear_trails()
    _order_store.clear()
    _action_pause_until.clear()
    _finished_actions.clear()
    _pending_action_ids.clear()
    _last_state_publish.clear()


def _spawn_one(robots_coll, manufacturer, serial, x, y, heading, speed_mps=1.2, color=None):
    tmpl_coll = bpy.data.collections["Templates"]
    root_tmpl = bpy.data.objects["AGV_Root"]

    new_root = root_tmpl.copy()
    new_root.name = f"AGV_{serial}"
    new_root.location = (x, y, 0.0)
    new_root.rotation_euler = (0, 0, heading)
    new_root["manufacturer"] = manufacturer
    new_root["serialNumber"] = serial
    new_root["online"] = True
    new_root["orderId"] = ""
    new_root["orderUpdateId"] = 0
    new_root["speed_mps"] = float(speed_mps)
    robots_coll.objects.link(new_root)

    for child_tmpl in tmpl_coll.objects:
        if child_tmpl.name == "AGV_Root":
            continue
        new_child = child_tmpl.copy()
        new_child.name = f"{child_tmpl.name}_{serial}"
        if child_tmpl.name in ("AGV_StatusLight", "AGV_Body"):
            new_child.data = child_tmpl.data.copy()
            new_child.data.materials[0] = child_tmpl.data.materials[0].copy()
        new_child.parent = new_root
        new_child.matrix_parent_inverse = Matrix()
        robots_coll.objects.link(new_child)

    if color:
        body = bpy.data.objects.get(f"AGV_Body_{serial}")
        if body:
            rgb = _hex_to_rgb(color)
            mat = body.data.materials[0]
            mat.diffuse_color = (*rgb, 1.0)
            bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.node_tree else None
            if bsdf:
                bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)

    if _mqtt_client is not None:
        publish_connection(new_root, "ONLINE")
    return new_root


def spawn_robots(count, manufacturer="cubot", seed=None):
    scene = bpy.context.scene
    if "AGV_Root" not in bpy.data.objects:
        build_scene()

    robots_coll = _ensure_collection("Robots")
    _reset_runtime_state()

    if seed is not None:
        random.seed(seed)

    map_size = scene.get("vda5050_map_size", 20.0)
    margin = 1.0
    min_dist = 1.2
    placed = []

    names = []
    for i in range(count):
        serial = f"AMR-{i+1:04d}"
        x = y = 0.0
        for _ in range(200):
            x = random.uniform(margin, map_size - margin)
            y = random.uniform(margin, map_size - margin)
            if all((x - px) ** 2 + (y - py) ** 2 >= min_dist ** 2 for px, py in placed):
                placed.append((x, y))
                break
        else:
            placed.append((x, y))

        root = _spawn_one(robots_coll, manufacturer, serial, x, Y_SIGN * y, random.uniform(0, 2 * math.pi))
        names.append(root.name)

    scene["vda5050_robot_count"] = count
    return names


def load_fleet(path):
    with open(bpy.path.abspath(path)) as f:
        fleet = json.load(f)

    cell = float(fleet.get("cell_size_m", 1.0))
    ox, oy = fleet.get("origin", [0.0, 0.0])
    build_scene(
        width=fleet.get("width", 20),
        height=fleet.get("height", 20),
        cell_size=cell,
        obstacles=[tuple(c) for c in fleet.get("obstacles", [])],
        map_id=fleet.get("project_id", ""),
        origin=(ox, oy),
    )

    robots_coll = _ensure_collection("Robots")
    _reset_runtime_state()
    names = []
    for r in fleet.get("robots", []):
        root = _spawn_one(
            robots_coll,
            r.get("manufacturer", "cubot"),
            r["serial"],
            ox + float(r.get("x", 0.0)) * cell,
            Y_SIGN * (oy + float(r.get("y", 0.0)) * cell),
            Y_SIGN * float(r.get("heading", 0.0)),
            speed_mps=float(r.get("speed", 1.0)) * cell,
            color=r.get("color"),
        )
        names.append(root.name)

    bpy.context.scene["vda5050_robot_count"] = len(names)
    print(f"[blender_sim] loaded fleet '{fleet.get('name', '')}' ({fleet.get('project_id', '')}): "
          f"{', '.join(n[4:] for n in names) or 'no robots'}")
    return names


_last_tick_time = None
_action_pause_until = {}
ACTION_DWELL_SECONDS = 2.0
STATE_PUBLISH_INTERVAL = 0.2
_last_state_publish = {}


def _set_status_light(root, online):
    serial = root.get("serialNumber", "")
    light = bpy.data.objects.get(f"AGV_StatusLight_{serial}")
    if not light or not light.data.materials:
        return
    mat = light.data.materials[0]
    if not mat.use_nodes:
        return
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if not bsdf:
        return
    color = (0.1, 0.9, 0.1, 1) if online else (0.9, 0.1, 0.1, 1)
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Emission Color"].default_value = color


def _spin_wheels(root, distance_delta):
    serial = root.get("serialNumber", "")
    radius = root.get("wheel_radius", 0.08)
    if radius <= 0:
        return
    d_theta = distance_delta / radius
    for suffix in ("FL", "FR", "BL", "BR"):
        wheel = bpy.data.objects.get(f"AGV_Wheel_{suffix}_{serial}")
        if wheel:
            wheel.rotation_euler.x += d_theta


TRAIL_MIN_SEGMENT = 0.12
TRAIL_Z = 0.05


def _trail_color_for_serial(serial):
    seed = sum(ord(c) for c in serial) * 977 + 13
    rnd = random.Random(seed)
    hue = rnd.random()
    return colorsys.hsv_to_rgb(hue, 0.85, 0.95)


def ensure_trail(root):
    serial = root.get("serialNumber", "")
    name = f"Trail_{serial}"
    obj = bpy.data.objects.get(name)
    if obj is not None:
        return obj

    trails_coll = bpy.data.collections.get("Trails")
    if trails_coll is None:
        trails_coll = bpy.data.collections.new("Trails")
        bpy.context.scene.collection.children.link(trails_coll)

    curve_data = bpy.data.curves.new(name + "_data", type='CURVE')
    curve_data.dimensions = '3D'
    curve_data.bevel_depth = 0.025
    curve_data.bevel_resolution = 2
    curve_data.fill_mode = 'FULL'
    spline = curve_data.splines.new('POLY')
    spline.points[0].co = (root.location.x, root.location.y, TRAIL_Z, 1.0)

    obj = bpy.data.objects.new(name, curve_data)
    trails_coll.objects.link(obj)

    r, g, b = _trail_color_for_serial(serial)
    mat_name = f"TrailMat_{serial}"
    mat = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Emission Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.5
    if not obj.data.materials:
        obj.data.materials.append(mat)

    obj["last_point"] = (root.location.x, root.location.y)
    return obj


def clear_trails():
    trails_coll = bpy.data.collections.get("Trails")
    if trails_coll is None:
        return
    for obj in list(trails_coll.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data and data.users == 0:
            bpy.data.curves.remove(data)


def extend_trail(root):
    props = getattr(bpy.context.scene, "vda5050_props", None)
    if props is not None and not props.show_trails:
        return
    obj = ensure_trail(root)
    lx, ly = obj.get("last_point", (root.location.x, root.location.y))
    dx, dy = root.location.x - lx, root.location.y - ly
    if math.hypot(dx, dy) < TRAIL_MIN_SEGMENT:
        return
    spline = obj.data.splines[0]
    spline.points.add(1)
    spline.points[-1].co = (root.location.x, root.location.y, TRAIL_Z, 1.0)
    obj["last_point"] = (root.location.x, root.location.y)


def tick_robots():
    global _last_tick_time, _just_connected
    now = time.time()
    if _last_tick_time is None:
        _last_tick_time = now
    dt = min(now - _last_tick_time, 1.0)
    _last_tick_time = now

    robots_coll = bpy.data.collections.get("Robots")
    if robots_coll is None:
        return 0.05

    if _just_connected:
        _just_connected = False
        publish_all_connections("ONLINE")

    for root in robots_coll.objects:
        if "serialNumber" not in root or root.parent is not None:
            continue

        online = root.get("online", True)
        _set_status_light(root, online)
        if not online:
            continue

        key = (root.get("manufacturer"), root.get("serialNumber"))
        if _action_pause_until.get(key, 0) <= now and key in _pending_action_ids:
            for a in _pending_action_ids.pop(key):
                _finished_actions.setdefault(key, {})[a["actionId"]] = a.get("actionType", "")

        state = _order_store.get(key)
        driving = (
            bool(state)
            and state["cursor"] < len(state["nodes"])
            and _action_pause_until.get(key, 0) <= now
        )
        if now - _last_state_publish.get(key, 0.0) >= STATE_PUBLISH_INTERVAL:
            _last_state_publish[key] = now
            publish_state(root, driving)

        if not state or state["cursor"] >= len(state["nodes"]):
            continue

        if _action_pause_until.get(key, 0) > now:
            continue

        target_node = state["nodes"][state["cursor"]]
        tx, ty, tz = target_node["world"]
        cur = root.location
        dx, dy = tx - cur.x, ty - cur.y
        dist = math.hypot(dx, dy)

        speed = root.get("speed_mps", 1.2)
        step = speed * dt

        if dist <= max(step, 0.03):
            moved = dist
            root.location.x = tx
            root.location.y = ty
            _spin_wheels(root, moved)
            extend_trail(root)

            actions = target_node.get("actions", [])
            hard_actions = [a for a in actions if a.get("blockingType") == "HARD"]
            if hard_actions and _action_pause_until.get(key, 0) <= now:
                names = ", ".join(a.get("actionType", "?") for a in hard_actions)
                print(f"[blender_sim] {root.get('serialNumber')} running action(s) "
                      f"[{names}] at node {target_node.get('nodeId')}")
                _action_pause_until[key] = now + ACTION_DWELL_SECONDS
                _pending_action_ids[key] = hard_actions

            state["cursor"] += 1
            if state["cursor"] >= len(state["nodes"]):
                print(f"[blender_sim] {root.get('serialNumber')} finished order "
                      f"'{state['orderId']}'")
        else:
            heading = math.atan2(dy, dx)
            root.rotation_euler.z = heading
            root.location.x += dx / dist * step
            root.location.y += dy / dist * step
            _spin_wheels(root, step)
            extend_trail(root)

    return 0.05


def register_timers():
    gen = bpy.app.driver_namespace.get('vda5050_gen', 0) + 1
    bpy.app.driver_namespace['vda5050_gen'] = gen

    def _drain_wrapper():
        if bpy.app.driver_namespace.get('vda5050_gen') != gen:
            return None
        return drain_incoming_orders()

    def _tick_wrapper():
        if bpy.app.driver_namespace.get('vda5050_gen') != gen:
            return None
        return tick_robots()

    bpy.app.timers.register(_drain_wrapper, persistent=True)
    bpy.app.timers.register(_tick_wrapper, persistent=True)


def unregister_timers():
    bpy.app.driver_namespace['vda5050_gen'] = -1


def send_test_order(serial="AMR-0001", manufacturer="cubot"):
    scene = bpy.context.scene
    origin = _map_origin()
    map_id = origin.get("mapId", "project_id") if origin else "project_id"

    root = find_robot_root(manufacturer, serial)
    if root is None:
        print(f"[blender_sim] no such robot AGV_{serial}")
        return

    map_size = scene.get("vda5050_map_size", 20.0)
    x0, y0 = round(random.uniform(1, map_size - 1), 2), round(random.uniform(1, map_size - 1), 2)
    x1, y1 = round(random.uniform(1, map_size - 1), 2), round(random.uniform(1, map_size - 1), 2)
    order_id = root.get("orderId") or f"order-{serial}-{int(time.time())}"
    order_update_id = int(root.get("orderUpdateId", 0)) + 1 if root.get("orderId") else 0

    order = {
        "headerId": order_update_id + 1,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "version": "2.0.0",
        "manufacturer": manufacturer,
        "serialNumber": serial,
        "orderId": order_id,
        "orderUpdateId": order_update_id,
        "nodes": [
            {
                "nodeId": "n0",
                "sequenceId": 0,
                "released": True,
                "nodePosition": {"x": x0, "y": y0, "mapId": map_id},
                "actions": [],
            },
            {
                "nodeId": "n1",
                "sequenceId": 2,
                "released": True,
                "nodePosition": {"x": x1, "y": y1, "mapId": map_id},
                "actions": [
                    {
                        "actionId": f"{order_id}-pick",
                        "actionType": "pick",
                        "blockingType": "HARD",
                        "actionParameters": [{"key": "taskId", "value": order_id}],
                    }
                ],
            },
        ],
        "edges": [
            {"edgeId": "e0", "sequenceId": 1, "released": True,
             "startNodeId": "n0", "endNodeId": "n1"}
        ],
    }
    apply_order(manufacturer, serial, order, scene)


class VDA5050_Properties(bpy.types.PropertyGroup):
    mqtt_host: bpy.props.StringProperty(name="Host", default="localhost")
    mqtt_port: bpy.props.IntProperty(name="Port", default=1893, min=1, max=65535)
    fleet_path: bpy.props.StringProperty(name="Fleet JSON", subtype='FILE_PATH', default="")
    robot_count: bpy.props.IntProperty(name="Robot Count", default=6, min=1, max=50)
    test_serial: bpy.props.StringProperty(name="Test Robot Serial", default="AMR-0001")
    show_trails: bpy.props.BoolProperty(name="Show Trails", default=True)


class VDA5050_OT_spawn_robots(bpy.types.Operator):
    bl_idname = "vda5050.spawn_robots"
    bl_label = "Spawn Robots"

    def execute(self, context):
        props = context.scene.vda5050_props
        names = spawn_robots(props.robot_count, seed=None)
        self.report({'INFO'}, f"Spawned {len(names)} robots")
        return {'FINISHED'}


class VDA5050_OT_load_fleet(bpy.types.Operator):
    bl_idname = "vda5050.load_fleet"
    bl_label = "Load Project Fleet"

    def execute(self, context):
        props = context.scene.vda5050_props
        if not props.fleet_path:
            self.report({'WARNING'}, "Pick a fleet JSON exported from the backend first")
            return {'CANCELLED'}
        try:
            names = load_fleet(props.fleet_path)
        except (OSError, ValueError, KeyError) as e:
            self.report({'ERROR'}, f"Could not load fleet: {e}")
            return {'CANCELLED'}
        self.report({'INFO'}, f"Loaded {len(names)} robots")
        return {'FINISHED'}


class VDA5050_OT_connect_mqtt(bpy.types.Operator):
    bl_idname = "vda5050.connect_mqtt"
    bl_label = "Connect MQTT"

    def execute(self, context):
        props = context.scene.vda5050_props
        ok = start_mqtt(props.mqtt_host, props.mqtt_port)
        register_timers()
        if ok:
            self.report({'INFO'}, f"Connecting to {props.mqtt_host}:{props.mqtt_port}")
        else:
            self.report({'WARNING'}, "MQTT connect failed - check console")
        return {'FINISHED'}


class VDA5050_OT_disconnect_mqtt(bpy.types.Operator):
    bl_idname = "vda5050.disconnect_mqtt"
    bl_label = "Disconnect MQTT"

    def execute(self, context):
        stop_mqtt()
        self.report({'INFO'}, "MQTT disconnected")
        return {'FINISHED'}


class VDA5050_OT_send_test_order(bpy.types.Operator):
    bl_idname = "vda5050.send_test_order"
    bl_label = "Send Test Order"

    def execute(self, context):
        props = context.scene.vda5050_props
        register_timers()
        send_test_order(serial=props.test_serial)
        return {'FINISHED'}


class VDA5050_OT_clear_trails(bpy.types.Operator):
    bl_idname = "vda5050.clear_trails"
    bl_label = "Clear Trails"

    def execute(self, context):
        clear_trails()
        self.report({'INFO'}, "Trails cleared")
        return {'FINISHED'}


class VDA5050_PT_panel(bpy.types.Panel):
    bl_idname = "VDA5050_PT_panel"
    bl_label = "Cubot Fleet"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Cubot Fleet"

    def draw(self, context):
        layout = self.layout
        props = context.scene.vda5050_props

        box = layout.box()
        box.label(text="Project")
        box.prop(props, "fleet_path")
        box.operator(VDA5050_OT_load_fleet.bl_idname, icon='IMPORT')

        box = layout.box()
        box.label(text="Fleet")
        box.prop(props, "robot_count")
        box.operator(VDA5050_OT_spawn_robots.bl_idname, icon='DUPLICATE')

        box = layout.box()
        box.label(text="MQTT Broker")
        box.prop(props, "mqtt_host")
        box.prop(props, "mqtt_port")
        row = box.row(align=True)
        row.operator(VDA5050_OT_connect_mqtt.bl_idname, icon='PLUGIN')
        row.operator(VDA5050_OT_disconnect_mqtt.bl_idname, icon='X')
        box.label(text=f"paho-mqtt: {'found' if PAHO_AVAILABLE else 'NOT INSTALLED'}",
                   icon='ERROR' if not PAHO_AVAILABLE else 'CHECKMARK')

        box = layout.box()
        box.label(text="Test (no broker needed)")
        box.prop(props, "test_serial")
        box.operator(VDA5050_OT_send_test_order.bl_idname, icon='PLAY')

        box = layout.box()
        box.label(text="Trajectories")
        box.prop(props, "show_trails")
        box.operator(VDA5050_OT_clear_trails.bl_idname, icon='TRASH')

        box = layout.box()
        box.label(text="Robots")
        robots_coll = bpy.data.collections.get("Robots")
        if robots_coll:
            for obj in sorted(robots_coll.objects, key=lambda o: o.name):
                if "serialNumber" not in obj or obj.parent is not None:
                    continue
                row = box.row(align=True)
                row.label(text=obj.get("serialNumber", obj.name))
                row.prop(obj, '["online"]', text="online", toggle=True)


_classes = [
    VDA5050_Properties,
    VDA5050_OT_spawn_robots,
    VDA5050_OT_load_fleet,
    VDA5050_OT_connect_mqtt,
    VDA5050_OT_disconnect_mqtt,
    VDA5050_OT_send_test_order,
    VDA5050_OT_clear_trails,
    VDA5050_PT_panel,
]


def register():
    for cls in _classes:
        try:
            bpy.utils.register_class(cls)
        except ValueError:
            pass
    if not hasattr(bpy.types.Scene, "vda5050_props"):
        bpy.types.Scene.vda5050_props = bpy.props.PointerProperty(type=VDA5050_Properties)
    register_timers()
    print("[blender_sim] registered")


def unregister():
    unregister_timers()
    for cls in reversed(_classes):
        try:
            bpy.utils.unregister_class(cls)
        except (ValueError, RuntimeError):
            pass
    if hasattr(bpy.types.Scene, "vda5050_props"):
        del bpy.types.Scene.vda5050_props


def _cli_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="blender --python blender_sim.py --")
    parser.add_argument("--fleet", help="fleet JSON from services.fleet.coordinator.tools.blender_export")
    parser.add_argument("--robots", type=int, help="spawn N random AMR-000N robots instead of a fleet file")
    parser.add_argument("--project", help="Fleet project id; robots missing from it are added on first connection")
    parser.add_argument("--host", default=os.environ.get("FLEET_MQTT_HOST", "localhost"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("FLEET_MQTT_PORT", "1893")))
    parser.add_argument("--connect", action="store_true", help="connect to the broker right away")
    return parser.parse_args(argv)


def run_cli(args):
    props = bpy.context.scene.vda5050_props
    cube = bpy.data.objects.get("Cube")
    if not bpy.data.filepath and cube is not None and cube.type == 'MESH':
        bpy.data.objects.remove(cube, do_unlink=True)
    props.mqtt_host = args.host
    props.mqtt_port = args.port
    if args.fleet:
        props.fleet_path = os.path.abspath(args.fleet)
        load_fleet(props.fleet_path)
    if args.robots:
        props.robot_count = args.robots
        spawn_robots(args.robots)
    origin = _map_origin()
    if args.project and origin is not None:
        origin["mapId"] = args.project
    if args.connect:
        start_mqtt(args.host, args.port)


if __name__ == "__main__":
    register()
    _args = _cli_args()
    bpy.app.timers.register(lambda: run_cli(_args), first_interval=0.5)
