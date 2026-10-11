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
import sys
import traceback
import zipfile
import xml.etree.ElementTree as ET

# Keep the real stdout for the protocol and point fd 1 at stderr.
_PROTO = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

import cadquery as cq  # noqa: E402  (import after the fd swap on purpose)
from OCP.BRepGProp import BRepGProp  # noqa: E402
from OCP.GProp import GProp_GProps  # noqa: E402
from OCP.BRepBuilderAPI import BRepBuilderAPI_Sewing  # noqa: E402
from OCP.BRepCheck import BRepCheck_Analyzer  # noqa: E402
from OCP.IGESControl import IGESControl_Reader  # noqa: E402
from OCP.IFSelect import IFSelect_RetDone  # noqa: E402
from OCP.StlAPI import StlAPI_Reader  # noqa: E402
from OCP.TopoDS import TopoDS_Shape  # noqa: E402
from OCP.gp import gp_Trsf  # noqa: E402

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


HELPERS = {"P", "ASSET", "MESH", "IGES"}


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

    def ASSET(name):
        if name not in assets:
            raise JobError(f"Unknown asset {name!r}")
        return assets[name]

    namespace = {
        "__name__": "__part__",
        "cq": cq,
        "math": math,
        "P": P,
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
        robot = job.get("name") or "assembly"
        robot = safe_name(robot, set())
        links = ['  <link name="base_link"/>']
        joints = []
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
                p = inst.get("position", [0, 0, 0])
                r, pi_, y = rpy_from_xyz(inst.get("rotation", [0, 0, 0]))
                joints.append(
                    f'  <joint name="{name}_joint" type="fixed">\n'
                    f'    <parent link="base_link"/><child link="{name}"/>\n'
                    f'    <origin xyz="{p[0] / 1000:.6f} {p[1] / 1000:.6f} {p[2] / 1000:.6f}" '
                    f'rpy="{r:.6f} {pi_:.6f} {y:.6f}"/>\n'
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


JOBS = {"build": run_build, "assemble": run_assemble}


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
