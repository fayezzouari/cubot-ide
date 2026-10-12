"""
Bought components, built from templates with exact ports instead of by a
part agent: hobby servos and their horns, gear motors, steppers, bearings.

Dimensions are the common datasheet values. Every component is modelled
standing on z = 0 with its output axis along +Z. Ports carry extra flags the
assembler uses: `tapped` (a screw threads in here: size and depth) and
`joint` ("revolute": whatever mates here turns about the port axis).

The code and the port frames come from the same numbers, so what the plan
is checked against is exactly what gets built.
"""
from typing import Optional

COLOR = {"servo": "#3b4a5a", "horn": "#d8d8d8", "motor": "#4a4a4a", "stepper": "#2f2f2f", "bearing": "#b8bcc0"}


def _port(origin, axis, ref=(1.0, 0.0, 0.0), **flags) -> dict:
    return {"origin": [float(round(v, 4)) for v in origin], "axis": [float(v) for v in axis],
            "ref": [float(v) for v in ref], **flags}


def _port_code(ports: dict) -> str:
    return "\n".join(f"PORT({n!r}, {tuple(p['origin'])}, axis={tuple(p['axis'])}, ref={tuple(p['ref'])})"
                     for n, p in ports.items())


# ── Templates ─────────────────────────────────────────────────────────────


def _servo(d: dict) -> tuple[str, dict]:
    """Hobby servo: case, mounting tabs with holes, gear boss and spline on top.
    The horn sits on the boss ("shaft" port); screws go through the tabs."""
    L, W, H = d["L"], d["W"], d["H"]
    holes = []
    xs = (-d["pitch"] / 2, d["pitch"] / 2)
    ys = (-d["pitch_y"] / 2, d["pitch_y"] / 2) if d.get("pitch_y") else (0.0,)
    for x in xs:
        for y in ys:
            holes.append((x, y))
    sx = d["shaft_x"]
    ports = {}
    for i, (x, y) in enumerate(holes, 1):
        ports[f"mount_{i}"] = _port((x, y, d["tab_z"] + d["tab_t"]), (0, 0, 1))
        ports[f"tab_under_{i}"] = _port((x, y, d["tab_z"]), (0, 0, -1))
    ports["shaft"] = _port((sx, 0, H + d["boss_h"]), (0, 0, 1), joint="revolute")
    ports["bottom"] = _port((0, 0, 0), (0, 0, -1))
    code = f'''# {d["name"]} (bought part, template)
L, W, H = {L}, {W}, {H}
body = cq.Workplane("XY").box(L, W, H, centered=(True, True, False))
tabs = cq.Workplane("XY").workplane(offset={d["tab_z"]}).box({d["span"]}, W, {d["tab_t"]}, centered=(True, True, False))
holes = cq.Workplane("XY").pushPoints({holes}).circle({d["hole_d"]} / 2).extrude(H)
boss = cq.Workplane("XY").workplane(offset=H).center({sx}, 0).circle({d["boss_d"]} / 2).extrude({d["boss_h"]})
spline = (cq.Workplane("XY").workplane(offset=H + {d["boss_h"]}).center({sx}, 0)
          .circle({d["spline_d"]} / 2).extrude({d["spline_h"]}))
result = body.union(tabs).cut(holes).union(boss).union(spline)
{_port_code(ports)}
'''
    return code, ports


def _horn(d: dict) -> tuple[str, dict]:
    """Servo horn: hub bored for the spline, with a disc or an arm on top
    carrying screw holes. "hub" (underside) mates to the servo's "shaft"."""
    hub_h, t = d["hub_h"], d["t"]
    pts = d["holes"]
    ports = {"hub": _port((0, 0, 0), (0, 0, -1)), "top": _port((0, 0, hub_h), (0, 0, 1))}
    for i, (x, y) in enumerate(pts, 1):
        ports[f"hole_{i}_top"] = _port((x, y, hub_h), (0, 0, 1), tapped={"size": d["screw"], "depth": t})
        ports[f"hole_{i}_under"] = _port((x, y, hub_h - t), (0, 0, -1))
    if d.get("arm"):
        plate = (f'plate = (cq.Workplane("XY").workplane(offset={hub_h - t}).center({d["arm"] / 2}, 0)'
                 f'.rect({d["arm"]}, {d["arm_w"]}).extrude({t}))')
    else:
        plate = f'plate = cq.Workplane("XY").workplane(offset={hub_h - t}).circle({d["D"]} / 2).extrude({t})'
    code = f'''# {d["name"]} (bought part, template)
hub = cq.Workplane("XY").circle({d["hub_d"]} / 2).extrude({hub_h})
{plate}
holes = cq.Workplane("XY").pushPoints({pts}).circle({d["hole_d"]} / 2).extrude({hub_h})
bore = cq.Workplane("XY").circle({d["bore"]} / 2).extrude({hub_h})  # through: the spline is taller than the hub
result = hub.union(plate).cut(holes).cut(bore)
{_port_code(ports)}
'''
    return code, ports


def _n20(d: dict) -> tuple[str, dict]:
    """N20 micro gear motor standing on its back: can, gearbox, D shaft up.
    Two tapped holes on the gearbox face take the mounting screws."""
    can_h, gear_h, shaft_l = d["can_h"], d["gear_h"], d["shaft_l"]
    face = can_h + gear_h
    pts = [(-4.5, 0.0), (4.5, 0.0)]
    ports = {"face": _port((0, 0, face), (0, 0, 1)),
             "shaft": _port((0, 0, face + shaft_l), (0, 0, 1), joint="revolute"),
             "bottom": _port((0, 0, 0), (0, 0, -1))}
    for i, (x, y) in enumerate(pts, 1):
        ports[f"mount_{i}"] = _port((x, y, face), (0, 0, 1), tapped={"size": "M1.6", "depth": 3.0})
    code = f'''# {d["name"]} (bought part, template)
can = cq.Workplane("XY").box(12, 10, {can_h}, centered=(True, True, False))
gear = cq.Workplane("XY").workplane(offset={can_h}).box(12, 10, {gear_h}, centered=(True, True, False))
shaft = cq.Workplane("XY").workplane(offset={face}).circle(1.5).extrude({shaft_l})
flat = cq.Workplane("XY").workplane(offset={face + 2}).center(1.75, 0).rect(1.0, 4).extrude({shaft_l})
taps = cq.Workplane("XY").workplane(offset={face - 3}).pushPoints({pts}).circle(0.65).extrude(3)
result = can.union(gear).union(shaft).cut(flat).cut(taps)
{_port_code(ports)}
'''
    return code, ports


def _nema17(d: dict) -> tuple[str, dict]:
    pts = [(15.5, 15.5), (-15.5, 15.5), (15.5, -15.5), (-15.5, -15.5)]
    body_h = d["H"]
    ports = {"front": _port((0, 0, body_h), (0, 0, 1)),
             "shaft": _port((0, 0, body_h + 2 + d["shaft_l"]), (0, 0, 1), joint="revolute"),
             "bottom": _port((0, 0, 0), (0, 0, -1))}
    for i, (x, y) in enumerate(pts, 1):
        ports[f"mount_{i}"] = _port((x, y, body_h), (0, 0, 1), tapped={"size": "M3", "depth": 4.5})
    code = f'''# {d["name"]} (bought part, template)
body = cq.Workplane("XY").box(42.3, 42.3, {body_h}, centered=(True, True, False)).edges("|Z").chamfer(4)
boss = cq.Workplane("XY").workplane(offset={body_h}).circle(11).extrude(2)
shaft = cq.Workplane("XY").workplane(offset={body_h + 2}).circle(2.5).extrude({d["shaft_l"]})
flat = cq.Workplane("XY").workplane(offset={body_h + 2 + 5}).center(2.5, 0).rect(1.0, 6).extrude({d["shaft_l"]})
taps = cq.Workplane("XY").workplane(offset={body_h - 4.5}).pushPoints({pts}).circle(1.25).extrude(4.5)
result = body.union(boss).union(shaft).cut(flat).cut(taps)
{_port_code(ports)}
'''
    return code, ports


def _bearing(d: dict) -> tuple[str, dict]:
    od, bore, w = d["OD"], d["ID"], d["W"]
    ports = {"top": _port((0, 0, w), (0, 0, 1), joint="revolute"),
             "bottom": _port((0, 0, 0), (0, 0, -1), joint="revolute"),
             "outer_top": _port((od / 2, 0, w), (0, 0, 1)),
             "outer_bottom": _port((od / 2, 0, 0), (0, 0, -1))}
    code = f'''# {d["name"]} (bought part, template)
result = cq.Workplane("XY").circle({od} / 2).circle({bore} / 2).extrude({w})
{_port_code(ports)}
'''
    return code, ports


# ── Catalog ───────────────────────────────────────────────────────────────

COMPONENTS: dict[str, dict] = {
    "sg90": {
        "kind": "servo", "name": "SG90 micro servo", "build": _servo,
        "about": "9 g micro servo, 1.8 kg·cm; case 22.8 x 12.2 x 22.5, tabs 32.2 across with 2 holes 28 apart "
                 "(M2 screws), round boss and spline on top (horn: sg90_arm)",
        "dims": {"name": "SG90 micro servo", "L": 22.8, "W": 12.2, "H": 22.5, "tab_z": 15.9, "tab_t": 2.5,
                 "span": 32.2, "hole_d": 2.2, "pitch": 28.0, "boss_d": 11.8, "boss_h": 4.0,
                 "spline_d": 4.8, "spline_h": 3.5, "shaft_x": -5.4},
        "screws": "M2", "horn": "sg90_arm",
    },
    "mg996r": {
        "kind": "servo", "name": "MG996R standard servo", "build": _servo,
        "about": "standard-size metal gear servo, 11 kg·cm; case 40.7 x 19.7 x 34.5, tabs 54.5 across with "
                 "4 holes on 49 x 10 (M4 or M3 screws), 25T spline (horn: horn_25t)",
        "dims": {"name": "MG996R standard servo", "L": 40.7, "W": 19.7, "H": 34.5, "tab_z": 26.5, "tab_t": 2.5,
                 "span": 54.5, "hole_d": 4.3, "pitch": 49.0, "pitch_y": 10.0, "boss_d": 20.0, "boss_h": 4.5,
                 "spline_d": 5.9, "spline_h": 4.0, "shaft_x": -10.35},
        "screws": "M3", "horn": "horn_25t",
    },
    "ds3218": {
        "kind": "servo", "name": "DS3218 digital servo", "build": _servo,
        "about": "standard-size waterproof servo, 20 kg·cm; case 40 x 20 x 34.5, same tabs and 25T spline as "
                 "the MG996R (horn: horn_25t)",
        "dims": {"name": "DS3218 digital servo", "L": 40.0, "W": 20.0, "H": 34.5, "tab_z": 26.5, "tab_t": 2.5,
                 "span": 54.5, "hole_d": 4.3, "pitch": 49.0, "pitch_y": 10.0, "boss_d": 20.0, "boss_h": 4.5,
                 "spline_d": 5.9, "spline_h": 4.0, "shaft_x": -10.0},
        "screws": "M3", "horn": "horn_25t",
    },
    "horn_25t": {
        "kind": "horn", "name": "25T round servo horn", "build": _horn,
        "about": "round horn for 25T servos: 21 mm disc, 2 mm thick, 4 screw holes (M2) on a 14 mm circle; "
                 "'hub' mates to the servo's 'shaft'; a link bolts to 'hole_n_top'",
        "dims": {"name": "25T round servo horn", "hub_d": 7.5, "hub_h": 5.0, "t": 2.0, "D": 21.0, "bore": 5.9,
                 "hole_d": 2.2, "screw": "M2", "holes": [(7.0, 0.0), (0.0, 7.0), (-7.0, 0.0), (0.0, -7.0)]},
    },
    "sg90_arm": {
        "kind": "horn", "name": "SG90 single arm horn", "build": _horn,
        "about": "single-arm horn for the SG90: 19 mm arm, 1.5 mm thick, holes (M1.6) at 10 and 18 mm; "
                 "'hub' mates to the servo's 'shaft'",
        "dims": {"name": "SG90 single arm horn", "hub_d": 7.0, "hub_h": 5.0, "t": 1.5, "arm": 19.0, "arm_w": 4.5,
                 "bore": 4.8, "hole_d": 1.6, "screw": "M1.6", "holes": [(10.0, 0.0), (18.0, 0.0)]},
    },
    "n20": {
        "kind": "motor", "name": "N20 micro gear motor", "build": _n20,
        "about": "12 x 10 mm micro gear motor, 24 mm long plus 10 mm D shaft (3 mm), two M1.6 tapped holes "
                 "9 mm apart on the gearbox face; a bracket plate sits on 'face' and screws into 'mount_n'",
        "dims": {"name": "N20 micro gear motor", "can_h": 15.0, "gear_h": 9.0, "shaft_l": 10.0},
        "screws": "M1.6",
    },
    "nema17": {
        "kind": "stepper", "name": "NEMA 17 stepper motor", "build": _nema17,
        "about": "42.3 mm square stepper, 40 mm long, 22 mm pilot boss, 5 mm D shaft 24 mm long, four M3 "
                 "tapped holes on a 31 mm square on 'front'",
        "dims": {"name": "NEMA 17 stepper motor", "H": 40.0, "shaft_l": 22.0},
        "screws": "M3",
    },
    "bearing_608": {
        "kind": "bearing", "name": "608 ball bearing", "build": _bearing,
        "about": "22 x 8 x 7 mm; press into a 22 mm bore ('outer_*' ports on the outer ring edge), "
                 "an 8 mm shaft turns in it ('top'/'bottom' at the bore centre)",
        "dims": {"name": "608 ball bearing", "OD": 22.0, "ID": 8.0, "W": 7.0},
    },
    "bearing_625": {
        "kind": "bearing", "name": "625 ball bearing", "build": _bearing,
        "about": "16 x 5 x 5 mm; press into a 16 mm bore, a 5 mm shaft turns in it",
        "dims": {"name": "625 ball bearing", "OD": 16.0, "ID": 5.0, "W": 5.0},
    },
    "bearing_6900": {
        "kind": "bearing", "name": "6900 ball bearing", "build": _bearing,
        "about": "22 x 10 x 6 mm thin section; press into a 22 mm bore, a 10 mm shaft turns in it",
        "dims": {"name": "6900 ball bearing", "OD": 22.0, "ID": 10.0, "W": 6.0},
    },
}


def normalise(raw) -> Optional[dict]:
    """{"component": "mg996r"} (or a bare id) → {"id": ...}, or None."""
    cid = raw.get("component") if isinstance(raw, dict) else raw
    cid = str(cid or "").lower().strip().replace("-", "_")
    return {"id": cid} if cid in COMPONENTS else None


def name(spec: dict) -> str:
    return COMPONENTS[spec["id"]]["name"]


def color(spec: dict) -> str:
    return COLOR[COMPONENTS[spec["id"]]["kind"]]


def code(spec: dict) -> str:
    item = COMPONENTS[spec["id"]]
    return item["build"](item["dims"])[0]


def ports(spec: dict) -> dict[str, dict]:
    item = COMPONENTS[spec["id"]]
    return item["build"](item["dims"])[1]


def envelope(spec: dict) -> list[float]:
    """Bounding size of the template as built (centred on X/Y, from z = 0)."""
    item = COMPONENTS[spec["id"]]
    d = item["dims"]
    kind = item["kind"]
    if kind == "servo":
        return [d["span"], max(d["W"], d["boss_d"]), d["H"] + d["boss_h"] + d["spline_h"]]
    if kind == "horn":
        return [d["arm"] + d["hub_d"] / 2, max(d["arm_w"], d["hub_d"]), d["hub_h"]] if d.get("arm") else [d["D"], d["D"], d["hub_h"]]
    if kind == "motor":
        return [12.0, 10.0, d["can_h"] + d["gear_h"] + d["shaft_l"]]
    if kind == "stepper":
        return [42.3, 42.3, d["H"] + 2 + d["shaft_l"]]
    return [d["OD"], d["OD"], d["W"]]


def describe() -> str:
    """The catalog as the architect sees it."""
    lines = []
    for cid, item in COMPONENTS.items():
        pf = ports({"id": cid})
        plist = ", ".join(
            n + ("(tapped " + p["tapped"]["size"] + ")" if p.get("tapped") else "") + ("(rotary)" if p.get("joint") else "")
            for n, p in pf.items())
        lines.append(f'- "{cid}": {item["about"]}. Ports: {plist}.')
    return "\n".join(lines)
