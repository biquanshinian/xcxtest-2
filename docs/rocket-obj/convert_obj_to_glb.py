"""Convert the Long March series OBJ to GLB with usable UVs and textures.

Cinema 4D OBJ often mixes a few v//vn faces into an otherwise textured
material. trimesh then drops the entire UV set — the main rocket-body
shader (yanglintaobao888_2) previously exported with a texture but no UVs.

C4D V increases toward the nose; glTF/three.js samples V=0 at the top of
the image. Flip V on standing meshes so 中国航天 / flags stay upright (nose
= top of the texture). Do not flip U, and do not flip floor planes.

Faces whose UVs sit in world/pixel space would REPEAT a CZ-2F unwrap across
every rocket. Those faces are split off as untextured white instead.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from trimesh.visual.material import PBRMaterial, SimpleMaterial

ROOT = Path(__file__).resolve().parent
SRC_OBJ = ROOT / "长征系列运载火箭.obj"
SRC_MTL = ROOT / "长征系列运载火箭.mtl"
DST = ROOT / "long-march-series.glb"
TEX = ROOT / "tex"
REPEAT = 10497
CLAMP = 33071
GLTF_WRAP = {REPEAT: "REPEAT", CLAMP: "CLAMP_TO_EDGE"}
SANE_UV = 2.25


def ensure_hq_jpegs() -> dict[str, str]:
    """Prefer original BMP pixels over the tiny PNG stand-ins."""
    mapping = {}
    for bmp in TEX.glob("*.bmp"):
        out = TEX / f"{bmp.stem}_hq.jpg"
        if not out.exists() or out.stat().st_mtime < bmp.stat().st_mtime:
            im = Image.open(bmp).convert("RGB")
            im.save(out, quality=95, optimize=True, subsampling=0)
            print("wrote", out.name, out.stat().st_size, im.size)
        mapping[bmp.name] = out.name
        mapping[f"{bmp.stem}.png"] = out.name
    return mapping


def rewrite_mtl(hq_map: dict[str, str]) -> None:
    lines = SRC_MTL.read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines:
        if line.lower().startswith("map_kd "):
            raw = line.split(None, 1)[1].replace("\\", "/").split("/")[-1]
            if raw in hq_map:
                line = f"map_Kd tex/{hq_map[raw]}"
        out.append(line)
    SRC_MTL.write_text("\n".join(out) + "\n", encoding="utf-8")


def rewrite_obj_dummy_uv(src: Path, dst: Path) -> int:
    """Give v//vn faces a dummy vt so trimesh will not drop UVs for the mesh."""
    lines = src.read_text(encoding="utf-8", errors="replace").splitlines()
    vt_count = sum(1 for line in lines if line.startswith("vt "))
    dummy = str(vt_count + 1)
    patched = 0
    out_lines = []
    for line in lines:
        if not line.startswith("f "):
            out_lines.append(line)
            continue
        parts = ["f"]
        changed = False
        for token in line.split()[1:]:
            bits = token.split("/")
            if len(bits) >= 2 and bits[1] == "":
                bits[1] = dummy
                changed = True
                patched += 1
                parts.append("/".join(bits))
            else:
                parts.append(token)
        out_lines.append(" ".join(parts) if changed else line)
    out_lines.append("vt 0 0")
    dst.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
    return patched


def is_floor_mesh(geom) -> bool:
    verts = np.asarray(getattr(geom, "vertices", []))
    if verts.size == 0:
        return False
    y_span = float(np.ptp(verts[:, 1]))
    xz_span = float(max(np.ptp(verts[:, 0]), np.ptp(verts[:, 2])))
    return y_span < 3.0 and xz_span > 40.0


def reorient_downfacing_floor(name: str, geom):
    """Front half of the platform is authored with -Y normals; from above
    DoubleSide shows the back of those faces and mirrors 中国长征系列运载火箭."""
    if not is_floor_mesh(geom) or not hasattr(geom, "faces"):
        return geom
    n = np.asarray(geom.face_normals)
    down = n[:, 1] < -0.5
    if not down.any():
        return geom
    faces = np.asarray(geom.faces).copy()
    faces[down] = faces[down][:, ::-1]
    geom.faces = faces
    print(f"reorient down-facing floor {name}: {int(down.sum())} faces")
    return geom


def uv_in_unit(uv: np.ndarray) -> float:
    return float(
        np.mean(
            (uv[:, 0] >= -0.15)
            & (uv[:, 0] <= 1.15)
            & (uv[:, 1] >= -0.15)
            & (uv[:, 1] <= 1.15)
        )
    )


def face_uv_sane(geom) -> np.ndarray | None:
    vis = getattr(geom, "visual", None)
    uv = None if vis is None else vis.uv
    faces = getattr(geom, "faces", None)
    if uv is None or faces is None or len(faces) == 0:
        return None
    uv = np.asarray(uv, dtype=np.float64)
    fv = uv[np.asarray(faces)]
    return np.all(
        (fv[:, :, 0] >= -0.25)
        & (fv[:, :, 0] <= SANE_UV)
        & (fv[:, :, 1] >= -0.25)
        & (fv[:, :, 1] <= SANE_UV),
        axis=1,
    )


def to_pbr(mat, metallic=0.0, roughness=0.8) -> PBRMaterial:
    if isinstance(mat, PBRMaterial):
        pbr = mat
    elif isinstance(mat, SimpleMaterial) and hasattr(mat, "to_pbr"):
        pbr = mat.to_pbr()
    else:
        pbr = PBRMaterial()
        if mat is not None and getattr(mat, "image", None) is not None:
            pbr.baseColorTexture = mat.image
        if mat is not None and getattr(mat, "diffuse", None) is not None:
            diff = np.asarray(mat.diffuse).reshape(-1)
            if diff.size >= 3:
                rgb = np.clip(diff[:3] / (255.0 if diff.max() > 1.5 else 1.0), 0, 1)
                pbr.baseColorFactor = np.array([rgb[0], rgb[1], rgb[2], 1.0], dtype=float)
    pbr.metallicFactor = metallic
    pbr.roughnessFactor = roughness
    if getattr(pbr, "baseColorFactor", None) is None:
        pbr.baseColorFactor = np.array([0.92, 0.92, 0.94, 1.0], dtype=float)
    return pbr


def white_pbr() -> PBRMaterial:
    pbr = PBRMaterial()
    pbr.baseColorTexture = None
    pbr.metallicFactor = 0.0
    pbr.roughnessFactor = 0.85
    pbr.baseColorFactor = np.array([0.93, 0.93, 0.95, 1.0], dtype=float)
    return pbr


def apply_uv_and_material(name: str, geom, keep_texture: bool) -> None:
    vis = getattr(geom, "visual", None)
    if vis is None:
        return
    uv = vis.uv
    if uv is None and getattr(vis, "vertex_attributes", None):
        uv = vis.vertex_attributes.get("uv")
        if uv is not None:
            vis.uv = uv
    mat = getattr(vis, "material", None)
    image = None
    if keep_texture and mat is not None:
        image = getattr(mat, "baseColorTexture", None) or getattr(mat, "image", None)

    in01 = -1.0
    wrap = REPEAT
    if uv is not None:
        src = np.asarray(uv, dtype=np.float64)
        in01 = uv_in_unit(src)
        uv = src.copy()
        if not is_floor_mesh(geom):
            uv[:, 1] = 1.0 - uv[:, 1]
        if image is not None and in01 >= 0.85:
            uv[:, 0] = np.clip(uv[:, 0], 0.0, 1.0)
            uv[:, 1] = np.clip(uv[:, 1], 0.0, 1.0)
            wrap = CLAMP
        vis.uv = uv
    else:
        vis.uv = uv
        image = None

    if image is None:
        vis.material = white_pbr()
    else:
        pbr = to_pbr(mat)
        pbr.baseColorTexture = image
        pbr.wrapS = wrap
        pbr.wrapT = wrap
        pbr.baseColorFactor = np.array([1.0, 1.0, 1.0, 1.0], dtype=float)
        vis.material = pbr
    print(
        f"{name:28s} uv={'none' if vis.uv is None else vis.uv.shape} "
        f"tex={'yes' if image is not None else 'no':3s} "
        f"wrap={GLTF_WRAP.get(wrap, '-') if image is not None else '-'} in01={in01:.3f}"
    )


def split_insane_uv(name: str, geom):
    """Keep only faces with atlas-space UVs textured; the rest become white."""
    mask = face_uv_sane(geom)
    if mask is None:
        apply_uv_and_material(name, geom, keep_texture=False)
        return geom, None
    n_sane = int(mask.sum())
    n_bad = int((~mask).sum())
    if n_sane == 0:
        print(f"drop all uvs {name}: insane faces={n_bad}")
        apply_uv_and_material(name, geom, keep_texture=False)
        return geom, None
    extra = None
    work = geom
    if n_bad:
        blank = geom.submesh([np.flatnonzero(~mask)], append=True, repair=False)
        if not isinstance(blank, trimesh.Trimesh):
            blank = blank[0]
        extra = blank
        kept = geom.submesh([np.flatnonzero(mask)], append=True, repair=False)
        if not isinstance(kept, trimesh.Trimesh):
            kept = kept[0]
        work = kept
        print(f"split {name}: keep {n_sane} faces, untex {n_bad}")
    apply_uv_and_material(name, work, keep_texture=True)
    if extra is not None:
        extra.visual.uv = None
        extra.visual.material = white_pbr()
        print(f"{name + '__untex':28s} uv=none tex=no  wrap=- in01=-1.000")
    return work, extra


def main() -> None:
    hq = ensure_hq_jpegs()
    rewrite_mtl(hq)
    tmp_obj = ROOT / "_series_uvfix.obj"
    patched = rewrite_obj_dummy_uv(SRC_OBJ, tmp_obj)
    print("patched v//vn verts", patched)

    print("loading", tmp_obj.name)
    scene = trimesh.load(tmp_obj, force="scene", process=False)
    if not isinstance(scene, trimesh.Scene):
        scene = trimesh.Scene(scene)
    print("geometries", len(scene.geometry))
    extras = []
    for name, geom in list(scene.geometry.items()):
        geom = reorient_downfacing_floor(name, geom)
        scene.geometry[name] = geom
        kept, extra = split_insane_uv(name, geom)
        if kept is not None and kept is not geom:
            scene.geometry[name] = kept
        if extra is not None:
            extras.append((name + "__untex", extra))
    for name, geom in extras:
        scene.add_geometry(geom, node_name=name, geom_name=name)

    print("exporting", DST.name)
    scene.export(DST)
    print("wrote", DST, "bytes", DST.stat().st_size)
    tmp_obj.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
