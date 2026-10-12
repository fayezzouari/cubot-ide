"""
Geometry worker process.

Started by the worker pool and kept alive between jobs, so CadQuery/OCP are
imported once (≈4 s) instead of once per job. Reads one JSON job per line on
stdin and answers with one JSON line on the protocol pipe. Anything the job
prints (including OCCT's C++ output) goes to stderr so it can't corrupt the
protocol.

Jobs:
  build     run part code and write part.step, part.stl, mesh.json, meta.json
  assemble  combine built parts into STEP / GLB / STL / 3MF / zip / URDF

This file must not import application modules: it runs in the sandboxed
geometry worker, which has no app settings or secrets.
"""
import ast
import json
import math
import os
import struct
import sys
import traceback
import zipfile
import zlib
import xml.etree.ElementTree as ET

# Keep the real stdout for the protocol and point fd 1 at stderr.
_PROTO = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

import cadquery as cq  # noqa: E402  (import after the fd swap on purpose)
import numpy as np  # noqa: E402
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common  # noqa: E402
from OCP.BRepExtrema import BRepExtrema_DistShapeShape  # noqa: E402
from OCP.BRepGProp import BRepGProp  # noqa: E402
from OCP.GProp import GProp_GProps  # noqa: E402
from OCP.BRepBuilderAPI import BRepBuilderAPI_Sewing  # noqa: E402
from OCP.BRepClass3d import BRepClass3d_SolidClassifier  # noqa: E402
from OCP.BRepCheck import BRepCheck_Analyzer  # noqa: E402
from OCP.IGESControl import IGESControl_Reader  # noqa: E402
from OCP.IFSelect import IFSelect_RetDone  # noqa: E402
from OCP.StlAPI import StlAPI_Reader  # noqa: E402
from OCP.TopoDS import TopoDS_Shape  # noqa: E402
from OCP.TopAbs import TopAbs_IN, TopAbs_OUT  # noqa: E402
from OCP.gp import gp_Pnt, gp_Trsf  # noqa: E402

MAX_MESH_TRIANGLES = 40_000  # meshes are sewn into a B-rep; beyond this it gets too slow
MESH_TOLERANCE = 0.1  # mm, chordal deviation of the preview mesh
ANGULAR_TOLERANCE = 0.2  # rad


class JobError(Exception):
    pass


# ── Shape helpers ─────────────────────────────────────────────────────────


def to_shape(obj) -> cq.Shape:
    """Turn whatever the part code assigned to `result` into one shape."""
    if isinstance(obj, cq.Shape):
        return obj
    if isinstance(obj, cq.Workplane):
        shapes = [o for o in obj.vals() if isinstance(o, cq.Shape)]
        if not shapes:
            raise JobError("`result` is a Workplane with no solids (did you forget to extrude?)")
        return shapes[0] if len(shapes) == 1 else cq.Compound.makeCompound(shapes)
    if isinstance(obj, cq.Assembly):
        return obj.toCompound()
    if isinstance(obj, cq.Sketch):
        raise JobError("`result` is a 2D Sketch; extrude it into a solid")
    if isinstance(obj, (list, tuple)) and obj:
        return cq.Compound.makeCompound([to_shape(o) for o in obj])
    raise JobError(f"`result` must be a CadQuery Workplane or Shape, got {type(obj).__name__}")


def read_mesh_triangles(path: str) -> list[tuple]:
    """Triangles (as 3 vertex tuples) from an OBJ or 3MF file."""
    ext = os.path.splitext(path)[1].lower()
    tris = []
    if ext == ".obj":
        verts = []
        with open(path, errors="replace") as f:
            for line in f:
                parts = line.split()
                if not parts:
                    continue
                if parts[0] == "v":
                    verts.append(tuple(float(x) for x in parts[1:4]))
                elif parts[0] == "f":
                    idx = [int(p.split("/")[0]) for p in parts[1:]]
                    idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
                    for k in range(1, len(idx) - 1):  # fan-triangulate polygons
                        tris.append((verts[idx[0]], verts[idx[k]], verts[idx[k + 1]]))
    elif ext == ".3mf":
        with zipfile.ZipFile(path) as z:
            model = next((n for n in z.namelist() if n.lower().endswith(".model")), None)
            if not model:
                raise JobError("3MF file has no 3D model")
            root = ET.fromstring(z.read(model))
        for mesh in root.iter():
            if not mesh.tag.endswith("}mesh"):
                continue
            verts = [
                (float(v.get("x")), float(v.get("y")), float(v.get("z")))
                for v in mesh.iter() if v.tag.endswith("}vertex")
            ]
            for t in mesh.iter():
                if t.tag.endswith("}triangle"):
                    tris.append((verts[int(t.get("v1"))], verts[int(t.get("v2"))], verts[int(t.get("v3"))]))
    else:
        raise JobError(f"Unsupported mesh format: {ext}")
    return tris


def sew_triangles(tris: list[tuple]) -> cq.Shape:
    if len(tris) > MAX_MESH_TRIANGLES:
        raise JobError(
            f"Mesh has {len(tris)} triangles; the limit is {MAX_MESH_TRIANGLES}. Decimate it first."
        )
    sewing = BRepBuilderAPI_Sewing(1e-4)
    for a, b, c in tris:
        try:
            face = cq.Face.makeFromWires(cq.Wire.makePolygon([cq.Vector(*a), cq.Vector(*b), cq.Vector(*c)], close=True))
        except Exception:
            continue  # degenerate triangle
        sewing.Add(face.wrapped)
    sewing.Perform()
    shell = cq.Shape.cast(sewing.SewedShape())
    try:
        solid = cq.Solid.makeSolid(cq.Shell(shell.wrapped)) if isinstance(shell, cq.Shell) else shell
        return solid if solid.isValid() else shell
    except Exception:
        return shell


def load_mesh(path: str) -> cq.Shape:
    """Mesh file (STL / OBJ / 3MF) as a faceted shape, so it can be placed,
    exported and combined like any other part."""
    if path.lower().endswith(".stl"):
        shape = TopoDS_Shape()
        if not StlAPI_Reader().Read(shape, path):
            raise JobError("Could not read the STL file")
        faces = cq.Shape.cast(shape).Faces()
        if len(faces) > MAX_MESH_TRIANGLES:
            raise JobError(
                f"Mesh has {len(faces)} triangles; the limit is {MAX_MESH_TRIANGLES}. Decimate it first."
            )
        sewn = cq.Shape.cast(shape)
        try:
            solid = cq.Solid.makeSolid(cq.Shell(sewn.wrapped)) if isinstance(sewn, cq.Shell) else sewn
            return solid if solid.isValid() else sewn
        except Exception:
            return sewn
    return sew_triangles(read_mesh_triangles(path))


def load_iges(path: str) -> cq.Shape:
    reader = IGESControl_Reader()
    if reader.ReadFile(path) != IFSelect_RetDone:
        raise JobError("Could not read the IGES file")
    reader.TransferRoots()
    return cq.Shape.cast(reader.OneShape())


def mesh_payload(shape: cq.Shape) -> dict:
    """Preview mesh with triangles grouped per B-rep face, so the viewer can
    pick a face and the edit prompt can refer to it."""
    positions: list[float] = []
    normals: list[float] = []
    indices: list[int] = []
    faces = []
    for fid, face in enumerate(shape.Faces()):
        try:
            verts, tris = face.tessellate(MESH_TOLERANCE, ANGULAR_TOLERANCE)
        except Exception:
            continue
        if not tris:
            continue
        base = len(positions) // 3
        start = len(indices)
        for v in verts:
            positions.extend((round(v.x, 4), round(v.y, 4), round(v.z, 4)))
            try:
                n = face.normalAt(v)
                normals.extend((round(n.x, 4), round(n.y, 4), round(n.z, 4)))
            except Exception:
                normals.extend((0.0, 0.0, 1.0))
        for t in tris:
            indices.extend((base + t[0], base + t[1], base + t[2]))
        center = face.Center()
        try:
            n = face.normalAt(center)
            normal = [round(n.x, 4), round(n.y, 4), round(n.z, 4)]
        except Exception:
            normal = None
        faces.append({
            "id": fid,
            "start": start,
            "count": len(indices) - start,
            "type": face.geomType(),
            "center": [round(center.x, 3), round(center.y, 3), round(center.z, 3)],
            "normal": normal,
            "area": round(face.Area(), 3),
        })
    return {"positions": positions, "normals": normals, "indices": indices, "faces": faces}


def shape_meta(shape: cq.Shape) -> dict:
    bb = shape.BoundingBox()
    try:
        volume = shape.Volume()
    except Exception:
        volume = 0.0
    solids = len(shape.Solids())
    return {
        "bbox": {
            "min": [round(bb.xmin, 3), round(bb.ymin, 3), round(bb.zmin, 3)],
            "max": [round(bb.xmax, 3), round(bb.ymax, 3), round(bb.zmax, 3)],
            "size": [round(bb.xlen, 3), round(bb.ylen, 3), round(bb.zlen, 3)],
        },
        "volume": round(volume, 3),
        "solids": solids,
        "faces": len(shape.Faces()),
        "valid": bool(BRepCheck_Analyzer(shape.wrapped).IsValid()),
    }


def check_geometry(meta: dict) -> None:
    """Reject results that ran but are clearly not a usable part, so the
    fix-up loop gets a precise error instead of a silently broken model."""
    size = meta["bbox"]["size"]
    if meta["faces"] == 0:
        raise JobError("The result has no faces (empty geometry)")
    if max(size) > 5000:
        raise JobError(f"The result is {max(size):.0f} mm across; units are millimetres, check the scale")
    if max(size) < 0.01:
        raise JobError("The result is smaller than 0.01 mm; units are millimetres, check the scale")


# ── Jobs ──────────────────────────────────────────────────────────────────


HELPERS = {"P", "PORT", "ASSET", "MESH", "IGES"}


def strip_helper_overrides(code: str):
    """Models sometimes define their own `P()` (returning the default) so the
    script runs standalone; that would hide every parameter. Drop top-level
    definitions of the helpers we provide."""
    tree = ast.parse(code, "<part>")
    tree.body = [
        node for node in tree.body
        if not (isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in HELPERS)
        and not (isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) and t.id in HELPERS for t in node.targets))
    ]
    return tree


PORT_TOLERANCE = 0.05  # mm: how far a port origin may be from the surface
PORT_PROBE = 0.25  # mm: distance of the inside/outside probe points


def _classify(shape: cq.Shape, point) -> str:
    c = BRepClass3d_SolidClassifier(shape.wrapped, gp_Pnt(*point), 1e-4)
    state = c.State()
    return "in" if state == TopAbs_IN else "out" if state == TopAbs_OUT else "on"


def check_ports(shape: cq.Shape, ports: dict) -> list[str]:
    """Each port's origin must be on the part's surface, or at the centre of a
    round edge (a hole or a shaft end) whose plane it lies in; and its axis
    must point out of the material: just outside along the axis is empty,
    just inside is solid."""
    issues = []
    circles = []
    for edge in shape.Edges():
        if edge.geomType() == "CIRCLE":
            try:
                circles.append((edge.Center(), edge.radius(), edge.normal()))
            except Exception:
                pass
    for name, port in ports.items():
        o = cq.Vector(*port["origin"])
        a = cq.Vector(*port["axis"])
        try:
            dist = BRepExtrema_DistShapeShape(shape.wrapped, cq.Vertex.makeVertex(o.x, o.y, o.z).wrapped)
            d = dist.Value()
        except Exception:
            continue
        probe = o
        if d > PORT_TOLERANCE:
            centre = next(((c, r) for c, r, n in circles
                           if (c - o).Length < PORT_TOLERANCE * 4 and abs(abs(n.dot(a)) - 1) < 1e-3), None)
            if centre is None:
                issues.append(f"port {name!r}: origin {port['origin']} is {d:.2f} mm from the part's surface; "
                              "put it on the contact face (or at the centre of the hole/shaft end)")
                continue
            # Hole or shaft centre: test beside it, just past the rim, in the same plane.
            perp = a.cross(cq.Vector(1, 0, 0))
            if perp.Length < 1e-6:
                perp = a.cross(cq.Vector(0, 1, 0))
            probe = o + perp.normalized() * (centre[1] + 0.4)
        outside = _classify(shape, (probe + a * PORT_PROBE).toTuple())
        inside = _classify(shape, (probe - a * PORT_PROBE).toTuple())
        if outside == "in" and inside != "in":
            issues.append(f"port {name!r}: axis {port['axis']} points INTO the material; flip it to point out of "
                          "the contact face")
        elif outside == "in" and inside == "in":
            issues.append(f"port {name!r}: origin {port['origin']} is inside the material, not on a face")
    return issues


def run_build(job: dict) -> dict:
    out_dir = job["out_dir"]
    os.makedirs(out_dir, exist_ok=True)
    overrides = job.get("params") or {}
    assets = job.get("assets") or {}
    declared: dict[str, dict] = {}

    def P(name, default, min=None, max=None, step=None, unit="mm"):  # noqa: A002
        """A tunable parameter: the UI shows it as a field and can override it."""
        value = overrides.get(name, default)
        if isinstance(default, bool):
            value = bool(value)
        elif isinstance(default, int) and not isinstance(default, bool):
            value = int(round(float(value)))
        elif isinstance(default, float):
            value = float(value)
        declared[name] = {
            "default": default, "value": value, "min": min, "max": max, "step": step, "unit": unit,
        }
        return value

    ports: dict[str, dict] = {}

    def PORT(name, origin=(0, 0, 0), axis=(0, 0, 1), ref=None):  # noqa: N802
        """A named connection frame: a point on the contact feature, the outward
        normal of the contact face, and optionally a perpendicular reference
        direction that fixes the rotation about it."""
        o = [float(v) for v in origin]
        a = [float(v) for v in axis]
        n = math.sqrt(sum(v * v for v in a))
        if len(o) != 3 or len(a) != 3 or n < 1e-9:
            raise JobError(f"PORT {name!r}: origin and axis must be 3 numbers, axis non-zero")
        a = [v / n for v in a]
        r = None
        if ref is not None:
            r = [float(v) for v in ref]
            dot = sum(x * y for x, y in zip(r, a))
            r = [x - dot * y for x, y in zip(r, a)]  # make it perpendicular to the axis
            rn = math.sqrt(sum(v * v for v in r))
            r = [round(v / rn, 6) for v in r] if rn > 1e-9 else None
        ports[str(name)] = {"origin": [round(v, 4) for v in o], "axis": [round(v, 6) for v in a], "ref": r}

    def ASSET(name):
        if name not in assets:
            raise JobError(f"Unknown asset {name!r}")
        return assets[name]

    namespace = {
        "__name__": "__part__",
        "cq": cq,
        "math": math,
        "P": P,
        "PORT": PORT,
        "ASSET": ASSET,
        "MESH": load_mesh,
        "IGES": load_iges,
    }
    exec(compile(strip_helper_overrides(job["code"]), "<part>", "exec"), namespace)
    if "result" not in namespace:
        raise JobError("The code did not assign `result`")
    shape = to_shape(namespace["result"])
    meta = shape_meta(shape)
    check_geometry(meta)
    meta["params"] = declared
    meta["ports"] = ports
    meta["port_issues"] = check_ports(shape, ports) if job.get("check_ports", True) else []

    cq.exporters.export(shape, os.path.join(out_dir, "part.step"))
    cq.exporters.export(shape, os.path.join(out_dir, "part.stl"), tolerance=MESH_TOLERANCE,
                        angularTolerance=ANGULAR_TOLERANCE)
    with open(os.path.join(out_dir, "mesh.json"), "w") as f:
        json.dump(mesh_payload(shape), f, separators=(",", ":"))
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f)
    return meta


def location(pos, rot_deg) -> cq.Location:
    """CAD-frame placement: position in mm, Euler XYZ in degrees (the same
    convention as three.js `Euler('XYZ')`, so the viewer and exports agree)."""
    rx, ry, rz = (math.radians(a) for a in rot_deg)
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    # R = Rx · Ry · Rz
    m = [
        [cy * cz, -cy * sz, sy],
        [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
        [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
    ]
    t = gp_Trsf()
    t.SetValues(m[0][0], m[0][1], m[0][2], pos[0],
                m[1][0], m[1][1], m[1][2], pos[1],
                m[2][0], m[2][1], m[2][2], pos[2])
    return cq.Location(t)


def rpy_from_xyz(rot_deg):
    """URDF wants fixed-axis roll/pitch/yaw (R = Rz·Ry·Rx); convert from our
    intrinsic XYZ Euler angles via the rotation matrix."""
    rx, ry, rz = (math.radians(a) for a in rot_deg)
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    r20 = sx * sz - cx * sy * cz
    r21 = sx * cz + cx * sy * sz
    r22 = cx * cy
    r10 = cx * sz + sx * sy * cz
    r00 = cy * cz
    pitch = math.asin(max(-1.0, min(1.0, -r20)))
    roll = math.atan2(r21, r22)
    yaw = math.atan2(r10, r00)
    return roll, pitch, yaw


def _mat4(pos, rot_deg) -> "np.ndarray":
    m = np.eye(4)
    m[:3, :3] = _rotation_matrix(rot_deg)
    m[:3, 3] = np.asarray(pos, float)
    return m


def _rpy(m: "np.ndarray"):
    """Fixed-axis roll/pitch/yaw (R = Rz·Ry·Rx) of a rotation matrix, as URDF wants."""
    pitch = math.asin(max(-1.0, min(1.0, -m[2, 0])))
    roll = math.atan2(m[2, 1], m[2, 2])
    yaw = math.atan2(m[1, 0], m[0, 0])
    return roll, pitch, yaw


def mass_properties(shape: cq.Shape, density: float):
    """Mass (kg), centre of mass (mm) and inertia about it (kg·m²: ixx, iyy,
    izz, ixy, ixz, iyz) of a uniform solid; tiny fallbacks for open meshes."""
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape.wrapped, props)
    volume = props.Mass()  # mm³
    if volume <= 1e-6:
        return 1e-3, shape.Center(), (1e-7, 1e-7, 1e-7, 0.0, 0.0, 0.0)
    com = props.CentreOfMass()
    m = props.MatrixOfInertia()  # about the centre of mass, per unit density, mm⁵
    k = density * 1e-15  # kg/m³ · mm⁵ → kg·m²
    inertia = (m.Value(1, 1) * k, m.Value(2, 2) * k, m.Value(3, 3) * k,
               m.Value(1, 2) * k, m.Value(1, 3) * k, m.Value(2, 3) * k)
    return density * volume * 1e-9, cq.Vector(com.X(), com.Y(), com.Z()), inertia


def safe_name(name: str, used: set) -> str:
    base = "".join(c if c.isalnum() or c in "-_" else "_" for c in name).strip("_") or "part"
    out, k = base, 2
    while out in used:
        out, k = f"{base}_{k}", k + 1
    used.add(out)
    return out


def run_assemble(job: dict) -> dict:
    fmt = job["format"]
    out_path = job["out_path"]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    assy = cq.Assembly(name=job.get("name") or "assembly")
    placed = []
    used: set = set()
    for inst in job["instances"]:
        shape = cq.importers.importStep(inst["step_path"]).val()
        name = safe_name(inst.get("name") or "part", used)
        color = inst.get("color") or [0.7, 0.7, 0.7]
        loc = location(inst.get("position", [0, 0, 0]), inst.get("rotation", [0, 0, 0]))
        assy.add(shape, name=name, loc=loc, color=cq.Color(*color[:3], 1.0))
        placed.append((name, shape, loc, inst))
    if not placed:
        raise JobError("The assembly is empty")

    if fmt == "step":
        assy.save(out_path, exportType="STEP")
    elif fmt == "glb":
        assy.save(out_path, exportType="GLTF")
    elif fmt in ("stl", "3mf"):
        fused = cq.Compound.makeCompound([s.moved(loc) for _, s, loc, _ in placed])
        cq.exporters.export(fused, out_path, tolerance=MESH_TOLERANCE, angularTolerance=ANGULAR_TOLERANCE)
    elif fmt == "stl-zip":
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            for name, shape, loc, _ in placed:
                tmp = f"{out_path}.{name}.stl"
                cq.exporters.export(shape.moved(loc), tmp, tolerance=MESH_TOLERANCE,
                                    angularTolerance=ANGULAR_TOLERANCE)
                z.write(tmp, f"{name}.stl")
                os.remove(tmp)
    elif fmt == "urdf":
        # The mate tree is the kinematic tree: each copy's link hangs off the link it is mated
        # to (base_link for the ground or an unplaced target), fixed or revolute about the mate axis.
        robot = job.get("name") or "assembly"
        robot = safe_name(robot, set())
        links = ['  <link name="base_link"/>']
        joints = []
        frames = {inst.get("id"): (name, _mat4(inst.get("position", [0, 0, 0]), inst.get("rotation", [0, 0, 0])))
                  for name, _, _, inst in placed}
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            for name, shape, _, inst in placed:
                tmp = f"{out_path}.{name}.stl"
                # Meshes stay in the part's own frame; the joint places them.
                cq.exporters.export(shape, tmp, tolerance=MESH_TOLERANCE, angularTolerance=ANGULAR_TOLERANCE)
                z.write(tmp, f"{robot}/meshes/{name}.stl")
                os.remove(tmp)
                mass, c, inertia = mass_properties(shape, float(inst.get("density", 1200)))  # PLA-ish
                mesh = f'<mesh filename="package://{robot}/meshes/{name}.stl" scale="0.001 0.001 0.001"/>'
                links.append(
                    f'  <link name="{name}">\n'
                    f'    <visual><geometry>{mesh}</geometry></visual>\n'
                    f'    <collision><geometry>{mesh}</geometry></collision>\n'
                    f'    <inertial><origin xyz="{c.x / 1000:.6f} {c.y / 1000:.6f} {c.z / 1000:.6f}"/>'
                    f'<mass value="{mass:.6g}"/>'
                    f'<inertia ixx="{inertia[0]:.6g}" iyy="{inertia[1]:.6g}" izz="{inertia[2]:.6g}" '
                    f'ixy="{inertia[3]:.6g}" ixz="{inertia[4]:.6g}" iyz="{inertia[5]:.6g}"/></inertial>\n'
                    f'  </link>'
                )
                t_child = frames[inst.get("id")][1]
                parent = frames.get(inst.get("parent"))
                if parent:
                    parent_name, t_parent = parent
                    t_rel = np.linalg.inv(t_parent) @ t_child
                else:
                    parent_name, t_rel = "base_link", t_child
                p = t_rel[:3, 3]
                r, pi_, y = _rpy(t_rel[:3, :3])
                kind = "revolute" if inst.get("joint") == "revolute" and inst.get("axis") else "fixed"
                axis_line = ""
                if kind == "revolute":
                    a = t_child[:3, :3].T @ np.asarray(inst["axis"], float)  # in the child (joint) frame
                    a /= max(np.linalg.norm(a), 1e-9)
                    axis_line = (f'    <axis xyz="{a[0]:.6f} {a[1]:.6f} {a[2]:.6f}"/>\n'
                                 f'    <limit lower="-3.1416" upper="3.1416" effort="1" velocity="1"/>\n')
                joints.append(
                    f'  <joint name="{name}_joint" type="{kind}">\n'
                    f'    <parent link="{parent_name}"/><child link="{name}"/>\n'
                    f'    <origin xyz="{p[0] / 1000:.6f} {p[1] / 1000:.6f} {p[2] / 1000:.6f}" '
                    f'rpy="{r:.6f} {pi_:.6f} {y:.6f}"/>\n'
                    f'{axis_line}'
                    f'  </joint>'
                )
            urdf = (
                f'<?xml version="1.0"?>\n<robot name="{robot}">\n'
                + "\n".join(links) + "\n" + "\n".join(joints) + "\n</robot>\n"
            )
            z.writestr(f"{robot}/urdf/{robot}.urdf", urdf)
            z.writestr(
                f"{robot}/package.xml",
                f'<?xml version="1.0"?>\n<package format="3">\n  <name>{robot}</name>\n  <version>0.1.0</version>\n'
                f'  <description>Exported from CuBot CAD Studio</description>\n'
                f'  <maintainer email="noreply@example.com">CuBot</maintainer>\n  <license>MIT</license>\n'
                f'  <buildtool_depend>ament_cmake</buildtool_depend>\n'
                f'  <export><build_type>ament_cmake</build_type></export>\n</package>\n',
            )
    else:
        raise JobError(f"Unknown export format {fmt!r}")
    return {"path": out_path, "size": os.path.getsize(out_path)}


# ── Preview renders (for the review step) ────────────────────────────────


def _rotation_matrix(rot_deg):
    rx, ry, rz = (math.radians(a) for a in rot_deg)
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    return np.array([
        [cy * cz, -cy * sz, sy],
        [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
        [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
    ])


def _png(rgb: "np.ndarray") -> bytes:
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].astype(np.uint8).tobytes() for y in range(h))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def _raster(tris, colors, ids, forward, up, size, bounds):
    """Orthographic z-buffer render with flat shading and outlines."""
    f = np.asarray(forward, float) / np.linalg.norm(forward)
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    lo, hi = bounds
    corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
    cx, cy = corners @ r, corners @ u
    span = max(cx.max() - cx.min(), cy.max() - cy.min(), 1e-6) * 1.12
    mid = np.array([(cx.max() + cx.min()) / 2, (cy.max() + cy.min()) / 2])
    scale = size / span

    px = ((tris @ r) - mid[0]) * scale + size / 2
    py = size / 2 - ((tris @ u) - mid[1]) * scale
    depth = tris @ f
    normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    lengths = np.linalg.norm(normals, axis=1)
    normals /= np.where(lengths > 0, lengths, 1)[:, None]
    light = -f * 0.75 + u * 0.45 + r * 0.25
    light /= np.linalg.norm(light)
    shade = 0.32 + 0.68 * np.abs(normals @ light)

    zbuf = np.full((size, size), np.inf)
    image = np.full((size, size, 3), 236.0)
    idbuf = np.full((size, size), -1)
    for t in range(len(tris)):
        xs, ys = px[t], py[t]
        x0, x1 = max(int(xs.min()), 0), min(int(xs.max()) + 1, size)
        y0, y1 = max(int(ys.min()), 0), min(int(ys.max()) + 1, size)
        if x0 >= x1 or y0 >= y1:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        (ax, bx, cx_), (ay, by, cy_) = xs, ys
        det = (by - cy_) * (ax - cx_) + (cx_ - bx) * (ay - cy_)
        if abs(det) < 1e-9:
            continue
        w0 = ((by - cy_) * (gx - cx_) + (cx_ - bx) * (gy - cy_)) / det
        w1 = ((cy_ - ay) * (gx - cx_) + (ax - cx_) * (gy - cy_)) / det
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        if not inside.any():
            continue
        z = w0 * depth[t, 0] + w1 * depth[t, 1] + w2 * depth[t, 2]
        region = zbuf[y0:y1, x0:x1]
        closer = inside & (z < region)
        region[closer] = z[closer]
        image[y0:y1, x0:x1][closer] = colors[t] * shade[t]
        idbuf[y0:y1, x0:x1][closer] = ids[t]
    # Outlines where the part changes or the depth jumps.
    edge = np.zeros((size, size), bool)
    finite = np.where(np.isfinite(zbuf), zbuf, 1e9)
    jump = span * 0.02
    for axis in (0, 1):
        d_id = np.diff(idbuf, axis=axis) != 0
        d_z = np.abs(np.diff(finite, axis=axis)) > jump
        mark = d_id | d_z
        if axis == 0:
            edge[1:, :] |= mark
        else:
            edge[:, 1:] |= mark
    image[edge] *= 0.25
    return image


def run_render(job: dict) -> dict:
    """Four views of the assembly (iso, front, right, top) on one PNG."""
    size = int(job.get("size", 360))
    tris, colors, ids = [], [], []
    for n, inst in enumerate(job["instances"]):
        with open(inst["mesh_path"]) as fh:
            mesh = json.load(fh)
        pos = np.asarray(mesh["positions"], float).reshape(-1, 3)
        idx = np.asarray(mesh["indices"], int).reshape(-1, 3)
        world = pos @ _rotation_matrix(inst.get("rotation", [0, 0, 0])).T + np.asarray(inst.get("position", [0, 0, 0]))
        tris.append(world[idx])
        colors.append(np.tile(np.asarray(inst.get("color", [0.6, 0.6, 0.6])) * 255, (len(idx), 1)))
        ids.append(np.full(len(idx), n))
    if not tris:
        raise JobError("Nothing to render")
    tris, colors, ids = np.concatenate(tris), np.concatenate(colors), np.concatenate(ids)
    pts = tris.reshape(-1, 3)
    bounds = (pts.min(axis=0), pts.max(axis=0))
    views = [
        ((-1, 1, -0.8), (0, 0, 1)),   # isometric, from front-right-above
        ((0, 1, 0), (0, 0, 1)),       # front: looking along +Y
        ((-1, 0, 0), (0, 0, 1)),      # right: looking along -X
        ((0, 0, -1), (0, 1, 0)),      # top: looking down, +Y up in the image
    ]
    tiles = [_raster(tris, colors, ids, f, u, size, bounds) for f, u in views]
    sheet = np.full((size * 2 + 6, size * 2 + 6, 3), 160.0)
    for k, tile in enumerate(tiles):
        y, x = (k // 2) * (size + 6), (k % 2) * (size + 6)
        sheet[y:y + size, x:x + size] = tile
    with open(job["out_path"], "wb") as fh:
        fh.write(_png(np.clip(sheet, 0, 255)))
    return {"path": job["out_path"], "triangles": int(len(tris))}


# ── Exact interference and contact checks ────────────────────────────────


def run_check(job: dict) -> dict:
    """For every pair of placed parts whose boxes come within `near` mm:
    the volume they share (exact boolean) and their minimum distance. Plus
    each part's lowest point. Pairs listed in `pairs` are always measured."""
    near = float(job.get("near", 1.0))
    shapes = []
    for inst in job["instances"]:
        if inst.get("box"):  # a part not built yet: its planned envelope, in its own frame
            lo, hi = inst["box"]
            shape = cq.Solid.makeBox(max(hi[0] - lo[0], 0.01), max(hi[1] - lo[1], 0.01), max(hi[2] - lo[2], 0.01),
                                     pnt=cq.Vector(*lo))
        else:
            shape = cq.importers.importStep(inst["step_path"]).val()
        shape = shape.moved(location(inst.get("position", [0, 0, 0]), inst.get("rotation", [0, 0, 0])))
        bb = shape.BoundingBox()
        shapes.append((inst["id"], shape, (bb.xmin, bb.ymin, bb.zmin), (bb.xmax, bb.ymax, bb.zmax)))
    wanted = {tuple(sorted(p)) for p in job.get("pairs", [])}
    pairs = []
    for i in range(len(shapes)):
        for j in range(i + 1, len(shapes)):
            ida, a, alo, ahi = shapes[i]
            idb, b, blo, bhi = shapes[j]
            close = all(min(ahi[k], bhi[k]) - max(alo[k], blo[k]) > -near for k in range(3))
            if not close and tuple(sorted((ida, idb))) not in wanted:
                continue
            overlap, centre, box = 0.0, None, None
            if close:
                try:
                    common = BRepAlgoAPI_Common(a.wrapped, b.wrapped)
                    common.Build()
                    if common.IsDone():
                        props = GProp_GProps()
                        BRepGProp.VolumeProperties_s(common.Shape(), props)
                        overlap = max(props.Mass(), 0.0)
                        if overlap > 0:  # where it is, so the fix can be aimed
                            c = props.CentreOfMass()
                            centre = [round(c.X(), 2), round(c.Y(), 2), round(c.Z(), 2)]
                            cb = cq.Shape.cast(common.Shape()).BoundingBox()
                            box = [[round(cb.xmin, 2), round(cb.ymin, 2), round(cb.zmin, 2)],
                                   [round(cb.xmax, 2), round(cb.ymax, 2), round(cb.zmax, 2)]]
                except Exception:
                    overlap = -1.0  # could not compute
            try:
                dist = BRepExtrema_DistShapeShape(a.wrapped, b.wrapped)
                distance = dist.Value() if dist.IsDone() else -1.0
            except Exception:
                distance = -1.0
            pairs.append({"a": ida, "b": idb, "overlap": round(overlap, 3), "distance": round(distance, 3),
                          "centre": centre, "box": box})
    lowest = {iid: round(lo[2], 3) for iid, _, lo, _ in shapes}
    return {"pairs": pairs, "lowest": lowest}


# ── Feature measurement (the part agent's ruler) ─────────────────────────


def run_measure(job: dict) -> dict:
    """Holes and bosses (coaxial cylindrical faces merged into one feature)
    and the largest flat faces of a part, measured from the solid."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane

    shape = cq.importers.importStep(job["step_path"]).val()
    cyls: dict[tuple, dict] = {}
    planes = []
    for face in shape.Faces():
        try:
            ad = BRepAdaptor_Surface(face.wrapped)
            kind = ad.GetType()
        except Exception:
            continue
        if kind == GeomAbs_Cylinder:
            cyl = ad.Cylinder()
            loc, d = cyl.Axis().Location(), cyl.Axis().Direction()
            axis = np.array([d.X(), d.Y(), d.Z()])
            if axis[2] < 0 or (axis[2] == 0 and (axis[1] < 0 or (axis[1] == 0 and axis[0] < 0))):
                axis = -axis  # one direction per line
            point = np.array([loc.X(), loc.Y(), loc.Z()])
            foot = point - np.dot(point, axis) * axis  # the axis line's closest point to the origin
            bb = face.BoundingBox()
            corners = np.array([[x, y, z] for x in (bb.xmin, bb.xmax) for y in (bb.ymin, bb.ymax)
                                for z in (bb.zmin, bb.zmax)])
            ts = corners @ axis
            key = (tuple(np.round(axis, 3)), tuple(np.round(foot, 2)), round(cyl.Radius(), 2))
            entry = cyls.setdefault(key, {"axis": axis, "foot": foot, "r": cyl.Radius(), "tmin": ts.min(),
                                          "tmax": ts.max(), "area": 0.0})
            entry["tmin"], entry["tmax"] = min(entry["tmin"], ts.min()), max(entry["tmax"], ts.max())
            entry["area"] += face.Area()
        elif kind == GeomAbs_Plane:
            c = face.Center()
            try:
                n = face.normalAt(c)
                planes.append({"center": [round(c.x, 2), round(c.y, 2), round(c.z, 2)],
                               "normal": [round(n.x, 3), round(n.y, 3), round(n.z, 3)], "area": round(face.Area(), 1)})
            except Exception:
                pass
    holes, bosses = [], []
    for e in cyls.values():
        mid = e["foot"] + e["axis"] * (e["tmin"] + e["tmax"]) / 2
        perp = np.cross(e["axis"], [1.0, 0.0, 0.0])
        if np.linalg.norm(perp) < 1e-6:
            perp = np.cross(e["axis"], [0.0, 1.0, 0.0])
        perp /= np.linalg.norm(perp)
        inside = _classify(shape, tuple(mid + perp * max(e["r"] - 0.3, e["r"] * 0.5)))
        feature = {"centre": [round(float(v), 2) for v in mid], "axis": [round(float(v), 3) for v in e["axis"]],
                   "diameter": round(2 * e["r"], 2), "length": round(float(e["tmax"] - e["tmin"]), 2)}
        (bosses if inside == "in" else holes).append(feature)
    holes.sort(key=lambda h: (h["diameter"], h["centre"]))
    bosses.sort(key=lambda h: (-h["diameter"], h["centre"]))
    planes.sort(key=lambda p: -p["area"])
    return {"holes": holes[:40], "bosses": bosses[:20], "flat_faces": planes[:12],
            "note": "holes: material around the axis; bosses: material inside; lengths along the axis"}


# ── Convex decomposition (collision shapes for the physics sandbox) ──────


def run_decompose(job: dict) -> dict:
    """Approximate convex pieces of a part's preview mesh (CoACD), so a
    physics engine keeps its bores, pockets and gaps. Writes {"hulls":
    [{"points": [x, y, z, ...]}, ...]} to out_path."""
    try:
        import coacd  # noqa: WPS433  (optional dependency of the worker)
    except ImportError as e:
        raise JobError("convex decomposition needs the coacd package in the geometry worker") from e
    with open(job["mesh_path"]) as fh:
        mesh = json.load(fh)
    verts = np.asarray(mesh["positions"], float).reshape(-1, 3)
    tris = np.asarray(mesh["indices"], np.int64).reshape(-1, 3)
    if len(tris) == 0:
        raise JobError("the mesh is empty")
    coacd.set_log_level("error")
    # Coarse but quick: a few seconds per part; the result is cached with the part's files.
    pieces = coacd.run_coacd(
        coacd.Mesh(verts, tris),
        threshold=float(job.get("threshold", 0.08)),
        max_convex_hull=int(job.get("max_hulls", 20)),
        preprocess_mode="auto",
        preprocess_resolution=30,
        resolution=int(job.get("resolution", 600)),
        mcts_nodes=6, mcts_iterations=30, mcts_max_depth=2,
        merge=True, max_ch_vertex=64, seed=0,
    )
    hulls = [{"points": np.round(np.asarray(v, float), 3).ravel().tolist()} for v, _ in pieces if len(v) >= 4]
    os.makedirs(os.path.dirname(job["out_path"]), exist_ok=True)
    with open(job["out_path"], "w") as fh:
        json.dump({"hulls": hulls}, fh, separators=(",", ":"))
    return {"hulls": len(hulls), "path": job["out_path"]}


JOBS = {"build": run_build, "assemble": run_assemble, "render": run_render, "check": run_check,
        "measure": run_measure, "decompose": run_decompose}


def main() -> None:
    _PROTO.write(json.dumps({"ready": True}) + "\n")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
            result = JOBS[job["type"]](job)
            reply = {"ok": True, "result": result}
        except JobError as e:
            reply = {"ok": False, "error": str(e)}
        except Exception as e:  # part code errors: give the model the useful traceback lines
            tb = traceback.format_exc().splitlines()
            relevant = [ln for ln in tb if "<part>" in ln or not ln.startswith("  File")]
            reply = {"ok": False, "error": f"{type(e).__name__}: {e}\n" + "\n".join(relevant[-12:])}
        _PROTO.write(json.dumps(reply) + "\n")


if __name__ == "__main__":
    main()
