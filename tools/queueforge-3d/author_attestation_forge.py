# SPDX-License-Identifier: MIT
"""Author QueueForge's integrated Attestation Forge and export production assets.

Run with Blender 4.5+:
  blender --background --factory-startup --python author_attestation_forge.py -- \
    --glb <path> --blend <path> --poster <path> --preview <path>

The script intentionally uses only Blender primitives and authored materials. No
third-party models, textures, HDRIs, or fonts are embedded in the deliverables.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import Iterable, Sequence

import bpy
from mathutils import Vector


FPS = 30
CYCLE_SECONDS = 12
FRAME_START = 0
FRAME_END = FRAME_START + FPS * CYCLE_SECONDS
PREVIEW_FRAME = 300


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--blend", required=True)
    parser.add_argument("--poster", required=True)
    parser.add_argument("--preview", required=True)
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(args)


def ensure_parent(path: str) -> Path:
    resolved = Path(path).resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.actions,
    ):
        for block in list(collection):
            collection.remove(block)


def input_if_present(node: bpy.types.Node, name: str):
    return node.inputs.get(name)


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float,
    roughness: float,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
    alpha: float = 1.0,
    transmission: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    material.metallic = metallic
    material.roughness = roughness
    # Every authored mesh is a closed hard-surface solid. Export front-face
    # culling explicitly so glTF does not mark all materials double-sided and
    # make the browser render the complete forge twice per frame.
    material.use_backface_culling = True

    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is None:
        raise RuntimeError(f"Principled BSDF missing for {name}")
    input_if_present(principled, "Base Color").default_value = color
    input_if_present(principled, "Metallic").default_value = metallic
    input_if_present(principled, "Roughness").default_value = roughness
    if emission is not None:
        emission_input = input_if_present(principled, "Emission Color") or input_if_present(
            principled, "Emission"
        )
        if emission_input is not None:
            emission_input.default_value = emission
        strength_input = input_if_present(principled, "Emission Strength")
        if strength_input is not None:
            strength_input.default_value = emission_strength
    alpha_input = input_if_present(principled, "Alpha")
    if alpha_input is not None:
        alpha_input.default_value = alpha
    transmission_input = input_if_present(principled, "Transmission Weight") or input_if_present(
        principled, "Transmission"
    )
    if transmission_input is not None:
        transmission_input.default_value = transmission
    if alpha < 1.0:
        material.surface_render_method = "DITHERED"
        material.use_transparency_overlap = False
    return material


def create_materials() -> dict[str, bpy.types.Material]:
    return {
        "black": make_material(
            "QF_BlackenedSteel", (0.018, 0.024, 0.027, 1.0), metallic=0.86, roughness=0.4
        ),
        "gunmetal": make_material(
            "QF_Gunmetal", (0.055, 0.072, 0.076, 1.0), metallic=0.78, roughness=0.31
        ),
        "steel": make_material(
            "QF_BrushedSteel", (0.22, 0.27, 0.28, 1.0), metallic=0.74, roughness=0.25
        ),
        "brass": make_material(
            "QF_BurnishedBrass", (0.48, 0.255, 0.07, 1.0), metallic=0.87, roughness=0.23
        ),
        "oxide": make_material(
            "QF_OxideEnamel",
            (0.018, 0.31, 0.26, 1.0),
            metallic=0.42,
            roughness=0.27,
            emission=(0.015, 0.28, 0.23, 1.0),
            emission_strength=0.11,
        ),
        "paper": make_material(
            "QF_ArchivalPaper", (0.76, 0.69, 0.54, 1.0), metallic=0.02, roughness=0.78
        ),
        "glass": make_material(
            "QF_SmokedGlass",
            (0.025, 0.075, 0.078, 0.42),
            metallic=0.08,
            roughness=0.2,
            alpha=0.42,
            # Alpha gives the delivery chamber its smoked-glass read without
            # Three.js' scene-wide transmission pre-pass (roughly doubling
            # draw calls for one small pane).
            transmission=0.0,
        ),
    }


def create_empty(
    name: str,
    *,
    parent: bpy.types.Object | None = None,
    location: Sequence[float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.32
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def apply_scale(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.select_set(False)


def add_bevel(obj: bpy.types.Object, width: float, segments: int = 2) -> None:
    if width <= 0:
        return
    modifier = obj.modifiers.new("QF_MicroBevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    try:
        modifier.harden_normals = True
    except AttributeError:
        pass


def add_box(
    name: str,
    dimensions: Sequence[float],
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    location: Sequence[float] = (0.0, 0.0, 0.0),
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    bevel: float = 0.05,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    apply_scale(obj)
    obj.data.materials.append(material)
    if parent is not None:
        obj.parent = parent
    add_bevel(obj, bevel)
    return obj


def add_cylinder(
    name: str,
    radius: float,
    depth: float,
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    location: Sequence[float] = (0.0, 0.0, 0.0),
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    vertices: int = 32,
    bevel: float = 0.035,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    if parent is not None:
        obj.parent = parent
    add_bevel(obj, bevel)
    return obj


def add_torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    location: Sequence[float] = (0.0, 0.0, 0.0),
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=40,
        minor_segments=10,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    if parent is not None:
        obj.parent = parent
    return obj


def join_meshes(
    objects: Sequence[bpy.types.Object],
    name: str,
    *,
    parent: bpy.types.Object | None,
    bevel: float,
) -> bpy.types.Object:
    if not objects:
        raise ValueError(f"Cannot join an empty mesh list for {name}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.parent = parent
    add_bevel(joined, bevel)
    joined.select_set(False)
    return joined


def add_tube(
    name: str,
    points: Sequence[Sequence[float]],
    material: bpy.types.Material,
    *,
    radius: float,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(f"{name}_Curve", "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 2
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = 3
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinates in zip(spline.bezier_points, points):
        point.co = coordinates
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    if parent is not None:
        obj.parent = parent
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    obj.select_set(False)
    return obj


def add_line_details(
    name: str,
    widths: Sequence[float],
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    origin: Sequence[float],
    spacing: float,
) -> bpy.types.Object:
    parts = []
    for index, width in enumerate(widths):
        parts.append(
            add_box(
                f"{name}_Part_{index + 1:02d}",
                (width, 0.025, 0.018),
                material,
                parent=parent,
                location=(origin[0] - (1.1 - width) * 0.5, origin[1] + index * spacing, origin[2]),
                bevel=0.005,
            )
        )
    return join_meshes(parts, name, parent=parent, bevel=0.004)


def build_bed(root: bpy.types.Object, materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bed = create_empty("QF_Forge_Bed", parent=root)
    add_box("QF_Bed_Base", (15.2, 3.75, 0.46), materials["black"], parent=bed, location=(0, 0, 0.25), bevel=0.12)
    add_box("QF_Bed_Deck", (14.7, 3.28, 0.22), materials["gunmetal"], parent=bed, location=(0, 0, 0.58), bevel=0.08)
    add_box("QF_Rail_Front", (14.45, 0.22, 0.25), materials["steel"], parent=bed, location=(0, -0.82, 0.78), bevel=0.045)
    add_box("QF_Rail_Back", (14.45, 0.22, 0.25), materials["steel"], parent=bed, location=(0, 0.82, 0.78), bevel=0.045)
    add_box("QF_Guide_Channel", (14.1, 0.34, 0.12), materials["black"], parent=bed, location=(0, 0, 0.73), bevel=0.025)

    ties = [
        add_box(
            f"QF_Tie_{index + 1:02d}",
            (0.28, 2.05, 0.12),
            materials["black"],
            parent=bed,
            location=(-6.55 + index * 1.19, 0, 0.67),
            bevel=0,
        )
        for index in range(12)
    ]
    join_meshes(ties, "QF_Bed_Ties", parent=bed, bevel=0.022)

    front_panels = [
        add_box(
            f"QF_FrontPanel_{index + 1:02d}",
            (4.55, 0.11, 0.34),
            materials["gunmetal"],
            parent=bed,
            location=(-4.78 + index * 4.78, -1.91, 0.32),
            bevel=0,
        )
        for index in range(3)
    ]
    join_meshes(front_panels, "QF_Bed_FrontArmor", parent=bed, bevel=0.055)

    bolts = []
    for x in (-6.7, -4.8, -2.5, 0, 2.5, 4.8, 6.7):
        bolt = add_cylinder(
            f"QF_BedBolt_{len(bolts) + 1:02d}",
            0.1,
            0.08,
            materials["brass"],
            parent=bed,
            location=(x, -1.99, 0.32),
            rotation=(math.pi / 2, 0, 0),
            vertices=16,
            bevel=0,
        )
        bolts.append(bolt)
    join_meshes(bolts, "QF_Bed_Fasteners", parent=bed, bevel=0.012)
    return bed


def build_intake(root: bpy.types.Object, materials: dict[str, bpy.types.Material]) -> dict[str, bpy.types.Object]:
    frame = create_empty("QF_Intake_Frame", parent=root, location=(-5.05, 0, 0))
    frame_parts = [
        add_box("QF_IntakePostL", (0.34, 0.54, 3.35), materials["gunmetal"], parent=frame, location=(-0.82, 0.18, 2.35), bevel=0),
        add_box("QF_IntakePostR", (0.34, 0.54, 3.35), materials["gunmetal"], parent=frame, location=(0.82, 0.18, 2.35), bevel=0),
        add_box("QF_IntakeCrown", (2.08, 0.8, 0.48), materials["gunmetal"], parent=frame, location=(0, 0.18, 4.03), bevel=0),
        add_box("QF_IntakeFoot", (2.2, 2.38, 0.26), materials["gunmetal"], parent=frame, location=(0, 0, 0.88), bevel=0),
    ]
    join_meshes(frame_parts, "QF_Intake_Frame_Metal", parent=frame, bevel=0.085)
    add_box("QF_Intake_Backplate", (1.42, 0.16, 2.1), materials["black"], parent=frame, location=(0, 0.72, 2.45), bevel=0.055)

    press = create_empty("QF_Intake_Press", parent=frame, location=(0, 0, 3.45))
    add_cylinder("QF_Intake_Ram", 0.25, 1.0, materials["steel"], parent=press, location=(0, 0, 0), vertices=32, bevel=0.04)
    add_box("QF_Intake_PressHead", (1.34, 1.15, 0.34), materials["gunmetal"], parent=press, location=(0, 0, -0.62), bevel=0.07)
    stamp = create_empty("QF_Intake_Stamp", parent=press, location=(0, 0, -0.9))
    add_cylinder("QF_Intake_StampFace", 0.4, 0.16, materials["brass"], parent=stamp, location=(0, 0, 0), vertices=40, bevel=0.025)
    add_torus("QF_Intake_StampRing", 0.29, 0.035, materials["black"], parent=stamp, location=(0, 0, -0.09))

    pins = []
    for x in (-0.68, 0.68):
        for y in (-0.58, 0.58):
            pins.append(add_cylinder(f"QF_IntakePin_{len(pins)+1}", 0.055, 0.38, materials["brass"], parent=frame, location=(x, y, 1.16), vertices=16, bevel=0))
    join_meshes(pins, "QF_Intake_RegistrationPins", parent=frame, bevel=0.012)
    return {"frame": frame, "press": press, "stamp": stamp}


def build_decision(root: bpy.types.Object, materials: dict[str, bpy.types.Material]) -> dict[str, bpy.types.Object]:
    island = create_empty("QF_Decision_Island", parent=root, location=(-1.68, 0, 0))
    frame_parts = [
        add_box("QF_DecisionBase", (2.55, 2.55, 0.28), materials["gunmetal"], parent=island, location=(0, 0, 0.91), bevel=0),
        add_box("QF_DecisionBack", (2.2, 0.3, 1.7), materials["black"], parent=island, location=(0, 0.95, 1.74), bevel=0),
        add_box("QF_DecisionBridge", (2.2, 0.46, 0.32), materials["gunmetal"], parent=island, location=(0, 0.16, 2.74), bevel=0),
    ]
    join_meshes(frame_parts, "QF_Decision_Island_Metal", parent=island, bevel=0.075)
    add_cylinder("QF_WitnessHub", 0.32, 0.34, materials["brass"], parent=island, location=(-0.18, -0.05, 2.9), rotation=(math.pi / 2, 0, 0), vertices=32, bevel=0.035)
    ring = add_torus("QF_Witness_Ring", 0.53, 0.075, materials["brass"], parent=island, location=(-0.18, 0, 3.85), rotation=(math.pi / 2, 0, 0))

    lever = create_empty("QF_Witness_Lever", parent=island, location=(-0.18, -0.22, 2.9))
    add_box("QF_Witness_LeverArm", (1.62, 0.16, 0.16), materials["brass"], parent=lever, location=(0.73, 0, 0), bevel=0.045)
    add_cylinder("QF_Witness_Grip", 0.2, 0.56, materials["gunmetal"], parent=lever, location=(1.47, 0, 0), rotation=(0, math.pi / 2, 0), vertices=24, bevel=0.035)
    die = create_empty("QF_Witness_Die", parent=island, location=(0.43, 0, 1.38))
    add_cylinder("QF_Witness_DieFace", 0.33, 0.18, materials["brass"], parent=die, vertices=32, bevel=0.03)
    add_box("QF_Witness_Anvil", (1.2, 1.25, 0.22), materials["steel"], parent=island, location=(0.43, 0, 1.08), bevel=0.055)
    return {"island": island, "ring": ring, "lever": lever, "die": die}


def build_process(root: bpy.types.Object, materials: dict[str, bpy.types.Material]) -> dict[str, bpy.types.Object]:
    housing = create_empty("QF_Process_Housing", parent=root, location=(1.88, 0, 0))
    frame_parts = [
        add_box("QF_ProcessPostL", (0.35, 2.4, 3.55), materials["gunmetal"], parent=housing, location=(-1.08, 0, 2.55), bevel=0),
        add_box("QF_ProcessPostR", (0.35, 2.4, 3.55), materials["gunmetal"], parent=housing, location=(1.08, 0, 2.55), bevel=0),
        add_box("QF_ProcessTop", (2.5, 2.45, 0.48), materials["gunmetal"], parent=housing, location=(0, 0, 4.1), bevel=0),
        add_box("QF_ProcessBase", (2.55, 2.55, 0.3), materials["gunmetal"], parent=housing, location=(0, 0, 0.9), bevel=0),
    ]
    join_meshes(frame_parts, "QF_Process_Housing_Metal", parent=housing, bevel=0.09)
    add_box("QF_Process_Backplate", (1.82, 0.2, 2.72), materials["black"], parent=housing, location=(0, 1.05, 2.48), bevel=0.05)

    trays = []
    for index, z in enumerate((1.38, 1.95, 2.52), start=1):
        tray = add_box(f"QF_Retry_Tray_{index:02d}", (1.72, 1.66, 0.24), materials["black"], parent=housing, location=(0, 0, z), bevel=0.055)
        add_box(f"QF_Retry_Handle_{index:02d}", (0.76, 0.18, 0.12), materials["brass"], parent=tray, location=(0, -0.9, 0), bevel=0.025)
        trays.append(tray)
    survivor = add_box("QF_Process_Survivor", (1.8, 1.72, 0.28), materials["oxide"], parent=housing, location=(0, 0, 3.08), bevel=0.06)
    add_box("QF_Process_SurvivorRail", (1.02, 0.12, 0.08), materials["brass"], parent=survivor, location=(0, -0.91, 0), bevel=0.018)
    head = create_empty("QF_Process_CompressionHead", parent=housing, location=(0, 0, 3.66))
    add_box("QF_Process_Compressor", (1.72, 1.65, 0.26), materials["steel"], parent=head, bevel=0.06)
    return {"housing": housing, "trays": trays, "survivor": survivor, "head": head}


def build_delivery(root: bpy.types.Object, materials: dict[str, bpy.types.Material]) -> dict[str, bpy.types.Object]:
    housing = create_empty("QF_Delivery_Housing", parent=root, location=(5.28, 0, 0))
    frame_parts = [
        add_box("QF_DeliveryPostL", (0.42, 2.65, 3.78), materials["gunmetal"], parent=housing, location=(-1.08, 0, 2.64), bevel=0),
        add_box("QF_DeliveryPostR", (0.42, 2.65, 3.78), materials["gunmetal"], parent=housing, location=(1.08, 0, 2.64), bevel=0),
        add_box("QF_DeliveryTop", (2.58, 2.7, 0.52), materials["gunmetal"], parent=housing, location=(0, 0, 4.27), bevel=0),
        add_box("QF_DeliveryBase", (2.62, 2.75, 0.3), materials["gunmetal"], parent=housing, location=(0, 0, 0.91), bevel=0),
    ]
    join_meshes(frame_parts, "QF_Delivery_Housing_Metal", parent=housing, bevel=0.105)
    gate = create_empty("QF_Delivery_Gate", parent=housing, location=(0, 0.93, 2.45))
    add_box("QF_Delivery_Glass", (1.75, 0.09, 2.45), materials["glass"], parent=gate, bevel=0.045)
    gate_trim = [
        add_box("QF_GateTrimTop", (1.95, 0.14, 0.12), materials["oxide"], parent=gate, location=(0, -0.07, 1.18), bevel=0),
        add_box("QF_GateTrimL", (0.12, 0.14, 2.3), materials["oxide"], parent=gate, location=(-0.92, -0.07, 0), bevel=0),
        add_box("QF_GateTrimR", (0.12, 0.14, 2.3), materials["oxide"], parent=gate, location=(0.92, -0.07, 0), bevel=0),
    ]
    join_meshes(gate_trim, "QF_Delivery_GateTrim", parent=gate, bevel=0.025)

    receipt = create_empty("QF_Receipt_Carrier", parent=housing, location=(0, -0.1, 1.28))
    add_box("QF_Receipt_Frame", (1.72, 1.65, 0.2), materials["gunmetal"], parent=receipt, bevel=0.055)
    add_box("QF_Receipt_Paper", (1.42, 1.34, 0.075), materials["paper"], parent=receipt, location=(0, 0, 0.14), bevel=0.028)
    add_line_details("QF_Receipt_Lines", (1.0, 0.8, 0.94, 0.62), materials["black"], parent=receipt, origin=(0, -0.39, 0.19), spacing=0.23)
    add_torus("QF_Receipt_SealRing", 0.28, 0.045, materials["oxide"], parent=receipt, location=(0.4, 0.35, 0.22))
    add_cylinder("QF_Receipt_SealFace", 0.21, 0.045, materials["oxide"], parent=receipt, location=(0.4, 0.35, 0.2), vertices=32, bevel=0.015)

    seal = create_empty("QF_Delivery_Seal", parent=housing, location=(0.4, 0.35, 3.45))
    add_cylinder("QF_Delivery_SealRam", 0.24, 1.0, materials["brass"], parent=seal, vertices=32, bevel=0.035)
    add_cylinder("QF_Delivery_SealDie", 0.37, 0.18, materials["brass"], parent=seal, location=(0, 0, -0.56), vertices=40, bevel=0.035)
    return {"housing": housing, "gate": gate, "receipt": receipt, "seal": seal}


def build_carrier(root: bpy.types.Object, materials: dict[str, bpy.types.Material]) -> dict[str, bpy.types.Object]:
    carrier = create_empty("QF_Carrier_Request", parent=root, location=(-7.55, 0, 1.13))
    add_box("QF_Carrier_Body", (1.66, 1.7, 0.25), materials["gunmetal"], parent=carrier, bevel=0.065)
    add_box("QF_Carrier_Record", (1.37, 1.4, 0.075), materials["paper"], parent=carrier, location=(0, 0, 0.17), bevel=0.028)
    clamps = [
        add_box("QF_CarrierClampL", (0.18, 1.56, 0.18), materials["black"], parent=carrier, location=(-0.75, 0, 0.13), bevel=0),
        add_box("QF_CarrierClampR", (0.18, 1.56, 0.18), materials["black"], parent=carrier, location=(0.75, 0, 0.13), bevel=0),
        add_box("QF_CarrierClampF", (1.34, 0.16, 0.18), materials["black"], parent=carrier, location=(0, -0.75, 0.13), bevel=0),
    ]
    join_meshes(clamps, "QF_Carrier_Clamps", parent=carrier, bevel=0.035)

    schema = create_empty("QF_Carrier_SchemaMark", parent=carrier, location=(0, 0, 0))
    add_line_details("QF_Carrier_SchemaLines", (1.0, 0.74, 0.92, 0.55), materials["brass"], parent=schema, origin=(0, -0.42, 0.23), spacing=0.24)
    add_torus("QF_Carrier_SchemaSeal", 0.22, 0.035, materials["brass"], parent=schema, location=(-0.35, 0.4, 0.25))

    witness = create_empty("QF_Carrier_WitnessMark", parent=carrier, location=(0.38, 0.38, 0.25))
    add_torus("QF_Carrier_WitnessRing", 0.17, 0.035, materials["brass"], parent=witness)
    add_box("QF_Carrier_WitnessKey", (0.42, 0.07, 0.045), materials["brass"], parent=witness, location=(0.22, 0, 0), rotation=(0, 0, -0.45), bevel=0.018)

    retries = create_empty("QF_Carrier_RetryMarks", parent=carrier, location=(0, 0, 0.24))
    for index, scale in enumerate((1.0, 0.83, 0.66), start=1):
        add_box(f"QF_Carrier_RetryOutline_{index:02d}", (1.16 * scale, 0.82 * scale, 0.022), materials["oxide"], parent=retries, location=(0, 0, index * 0.03), bevel=0.01)
    return {"carrier": carrier, "schema": schema, "witness": witness, "retries": retries}


def build_conduit(root: bpy.types.Object, materials: dict[str, bpy.types.Material]) -> dict[str, bpy.types.Object]:
    conduit = add_tube(
        "QF_Audit_Conduit",
        ((-7.1, -2.05, 0.72), (-5.1, -2.07, 0.8), (-1.7, -2.02, 0.76), (1.9, -2.05, 0.81), (5.3, -2.0, 0.76), (7.05, -2.03, 0.83)),
        materials["oxide"],
        radius=0.045,
        parent=root,
    )
    ferrules = []
    for x in (-5.05, -1.68, 1.88, 5.28):
        ferrules.append(add_torus(f"QF_ConduitFerrule_{len(ferrules)+1}", 0.13, 0.035, materials["brass"], parent=root, location=(x, -2.04, 0.78), rotation=(math.pi / 2, 0, 0)))
    join_meshes(ferrules, "QF_Audit_Ferrules", parent=root, bevel=0.008)
    pulse = add_cylinder("QF_Audit_Pulse", 0.09, 0.09, materials["oxide"], parent=root, location=(-7.0, -2.04, 0.8), rotation=(math.pi / 2, 0, 0), vertices=24, bevel=0.018)
    return {"conduit": conduit, "pulse": pulse}


def set_keyframe_interpolation(action: bpy.types.Action) -> None:
    try:
        curves = action.fcurves
    except AttributeError:
        return
    for curve in curves:
        for key in curve.keyframe_points:
            key.interpolation = "BEZIER"
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"


def bake_nla_action(obj: bpy.types.Object, keyframes: Sequence[dict]) -> None:
    obj.animation_data_create()
    action = bpy.data.actions.new(f"{obj.name}_ProofCycle")
    obj.animation_data.action = action
    for keyframe in keyframes:
        frame = keyframe["frame"]
        if "location" in keyframe:
            obj.location = keyframe["location"]
            obj.keyframe_insert(data_path="location", frame=frame, group="ProofCycle")
        if "rotation" in keyframe:
            obj.rotation_euler = keyframe["rotation"]
            obj.keyframe_insert(data_path="rotation_euler", frame=frame, group="ProofCycle")
        if "scale" in keyframe:
            obj.scale = keyframe["scale"]
            obj.keyframe_insert(data_path="scale", frame=frame, group="ProofCycle")
    set_keyframe_interpolation(action)
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = "ProofCycle"
    strip = track.strips.new("ProofCycle", FRAME_START, action)
    strip.action_frame_start = FRAME_START
    strip.action_frame_end = FRAME_END


def animate_scene(parts: dict[str, dict[str, bpy.types.Object]]) -> None:
    carrier = parts["carrier"]["carrier"]
    base_scale = (1.0, 1.0, 1.0)
    hidden_scale = (0.01, 0.01, 0.01)
    bake_nla_action(
        carrier,
        [
            {"frame": 1, "location": (-7.55, 0, 1.13), "scale": hidden_scale},
            {"frame": 14, "location": (-7.1, 0, 1.13), "scale": hidden_scale},
            {"frame": 28, "location": (-6.5, 0, 1.13), "scale": base_scale},
            {"frame": 45, "location": (-5.05, 0, 1.13), "scale": base_scale},
            {"frame": 96, "location": (-5.05, 0, 1.13), "scale": base_scale},
            {"frame": 111, "location": (-1.68, 0, 1.13), "scale": base_scale},
            {"frame": 156, "location": (-1.68, 0, 1.13), "scale": base_scale},
            {"frame": 173, "location": (1.88, 0, 1.13), "scale": base_scale},
            {"frame": 243, "location": (1.88, 0, 1.13), "scale": base_scale},
            {"frame": 263, "location": (5.28, 0, 1.13), "scale": base_scale},
            {"frame": 337, "location": (5.28, 0, 1.13), "scale": base_scale},
            {"frame": 351, "location": (6.65, 0, 1.13), "scale": hidden_scale},
            {"frame": FRAME_END, "location": (-7.55, 0, 1.13), "scale": hidden_scale},
        ],
    )

    bake_nla_action(parts["carrier"]["schema"], [
        {"frame": 1, "scale": hidden_scale}, {"frame": 64, "scale": hidden_scale},
        {"frame": 76, "scale": base_scale}, {"frame": 351, "scale": base_scale},
        {"frame": FRAME_END, "scale": hidden_scale},
    ])
    bake_nla_action(parts["carrier"]["witness"], [
        {"frame": 1, "scale": hidden_scale}, {"frame": 124, "scale": hidden_scale},
        {"frame": 143, "scale": base_scale}, {"frame": 351, "scale": base_scale},
        {"frame": FRAME_END, "scale": hidden_scale},
    ])
    bake_nla_action(parts["carrier"]["retries"], [
        {"frame": 1, "scale": hidden_scale}, {"frame": 197, "scale": hidden_scale},
        {"frame": 228, "scale": base_scale}, {"frame": 351, "scale": base_scale},
        {"frame": FRAME_END, "scale": hidden_scale},
    ])

    press = parts["intake"]["press"]
    bake_nla_action(press, [
        {"frame": 1, "location": (0, 0, 3.45)}, {"frame": 54, "location": (0, 0, 3.45)},
        {"frame": 67, "location": (0, 0, 2.35)}, {"frame": 77, "location": (0, 0, 2.35)},
        {"frame": 92, "location": (0, 0, 3.45)}, {"frame": FRAME_END, "location": (0, 0, 3.45)},
    ])

    lever = parts["decision"]["lever"]
    bake_nla_action(lever, [
        {"frame": 1, "rotation": (0, 0, -0.48)}, {"frame": 116, "rotation": (0, 0, -0.48)},
        {"frame": 136, "rotation": (0, 0, 0.62)}, {"frame": 148, "rotation": (0, 0, 0.62)},
        {"frame": 158, "rotation": (0, 0, -0.48)}, {"frame": FRAME_END, "rotation": (0, 0, -0.48)},
    ])
    die = parts["decision"]["die"]
    bake_nla_action(die, [
        {"frame": 1, "location": (0.43, 0, 1.58)}, {"frame": 126, "location": (0.43, 0, 1.58)},
        {"frame": 139, "location": (0.43, 0, 1.3)}, {"frame": 150, "location": (0.43, 0, 1.3)},
        {"frame": 160, "location": (0.43, 0, 1.58)}, {"frame": FRAME_END, "location": (0.43, 0, 1.58)},
    ])
    ring = parts["decision"]["ring"]
    bake_nla_action(ring, [
        {"frame": 1, "rotation": (math.pi / 2, 0, 0)},
        {"frame": 122, "rotation": (math.pi / 2, 0, 0)},
        {"frame": 145, "rotation": (math.pi / 2, 0, 0.22)},
        {"frame": 168, "rotation": (math.pi / 2, 0, 0)},
        {"frame": FRAME_END, "rotation": (math.pi / 2, 0, 0)},
    ])

    for index, tray in enumerate(parts["process"]["trays"]):
        rest_z = (1.38, 1.95, 2.52)[index]
        retained_z = (1.08, 1.72, 2.36)[index]
        bake_nla_action(tray, [
            {"frame": 1, "location": (0, 0, rest_z)}, {"frame": 180 + index * 7, "location": (0, 0, rest_z)},
            {"frame": 216 + index * 7, "location": ((index - 1) * 0.08, 0, retained_z)},
            {"frame": 347, "location": ((index - 1) * 0.08, 0, retained_z)},
            {"frame": FRAME_END, "location": (0, 0, rest_z)},
        ])
    survivor = parts["process"]["survivor"]
    bake_nla_action(survivor, [
        {"frame": 1, "location": (0, 0, 3.08)}, {"frame": 188, "location": (0, 0, 3.08)},
        {"frame": 230, "location": (0, -0.38, 3.34)}, {"frame": 347, "location": (0, -0.38, 3.34)},
        {"frame": FRAME_END, "location": (0, 0, 3.08)},
    ])
    head = parts["process"]["head"]
    bake_nla_action(head, [
        {"frame": 1, "location": (0, 0, 3.66)}, {"frame": 181, "location": (0, 0, 3.66)},
        {"frame": 205, "location": (0, 0, 3.28)}, {"frame": 221, "location": (0, 0, 3.28)},
        {"frame": 239, "location": (0, 0, 3.66)}, {"frame": FRAME_END, "location": (0, 0, 3.66)},
    ])

    gate = parts["delivery"]["gate"]
    bake_nla_action(gate, [
        {"frame": 1, "location": (0, 0.93, 3.5)}, {"frame": 265, "location": (0, 0.93, 3.5)},
        {"frame": 285, "location": (0, 0.93, 2.45)}, {"frame": 331, "location": (0, 0.93, 2.45)},
        {"frame": 347, "location": (0, 0.93, 3.5)}, {"frame": FRAME_END, "location": (0, 0.93, 3.5)},
    ])
    seal = parts["delivery"]["seal"]
    bake_nla_action(seal, [
        {"frame": 1, "location": (0.4, 0.35, 3.45), "rotation": (0, 0, 0)},
        {"frame": 281, "location": (0.4, 0.35, 3.45), "rotation": (0, 0, 0)},
        {"frame": 305, "location": (0.4, 0.35, 2.2), "rotation": (0, 0, math.radians(115))},
        {"frame": 317, "location": (0.4, 0.35, 2.2), "rotation": (0, 0, math.radians(150))},
        {"frame": 336, "location": (0.4, 0.35, 3.45), "rotation": (0, 0, math.radians(180))},
        {"frame": FRAME_END, "location": (0.4, 0.35, 3.45), "rotation": (0, 0, math.radians(180))},
    ])
    receipt = parts["delivery"]["receipt"]
    bake_nla_action(receipt, [
        {"frame": 1, "scale": hidden_scale, "location": (0, -0.1, 1.28)},
        {"frame": 285, "scale": hidden_scale, "location": (0, -0.1, 1.28)},
        {"frame": 309, "scale": base_scale, "location": (0, -0.1, 1.28)},
        {"frame": 337, "scale": (1.015, 1.015, 1.015), "location": (0, -0.18, 1.32)},
        {"frame": 350, "scale": hidden_scale, "location": (1.25, -0.1, 1.28)},
        {"frame": FRAME_END, "scale": hidden_scale, "location": (0, -0.1, 1.28)},
    ])

    pulse = parts["conduit"]["pulse"]
    bake_nla_action(pulse, [
        {"frame": 1, "location": (-7.0, -2.04, 0.8), "scale": hidden_scale},
        {"frame": 16, "location": (-6.8, -2.04, 0.8), "scale": base_scale},
        {"frame": 88, "location": (-5.05, -2.04, 0.8), "scale": base_scale},
        {"frame": 156, "location": (-1.68, -2.04, 0.78), "scale": base_scale},
        {"frame": 244, "location": (1.88, -2.04, 0.81), "scale": base_scale},
        {"frame": 332, "location": (5.28, -2.04, 0.78), "scale": base_scale},
        {"frame": 351, "location": (7.0, -2.04, 0.82), "scale": hidden_scale},
        {"frame": FRAME_END, "location": (-7.0, -2.04, 0.8), "scale": hidden_scale},
    ])


def build_asset() -> tuple[bpy.types.Object, dict[str, bpy.types.Material]]:
    materials = create_materials()
    root = create_empty("QF_Forge_Root")
    root["qf_asset_version"] = 1
    root["qf_cycle_ms"] = 12_000
    root["qf_scenario"] = "illustrative-request"
    build_bed(root, materials)
    for index, x in enumerate((-5.05, -1.68, 1.88, 5.28), start=1):
        stage = create_empty(f"QF_Stage_{index:02d}", parent=root, location=(x, 0, 1.15))
        stage[f"qf_stage_{index}"] = True
    create_empty("QF_Camera_Target", parent=root, location=(0, 0, 1.85))
    parts = {
        "intake": build_intake(root, materials),
        "decision": build_decision(root, materials),
        "process": build_process(root, materials),
        "delivery": build_delivery(root, materials),
        "carrier": build_carrier(root, materials),
        "conduit": build_conduit(root, materials),
    }
    animate_scene(parts)
    return root, materials


def iter_hierarchy(root: bpy.types.Object) -> Iterable[bpy.types.Object]:
    yield root
    for child in root.children:
        yield from iter_hierarchy(child)


def export_glb(root: bpy.types.Object, filepath: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in iter_hierarchy(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    candidate_options = {
        "filepath": str(filepath),
        "export_format": "GLB",
        "use_selection": True,
        "export_apply": True,
        "export_animations": True,
        "export_animation_mode": "NLA_TRACKS",
        "export_force_sampling": True,
        "export_frame_range": True,
        "export_frame_step": 1,
        "export_optimize_animation_size": True,
        "export_optimize_animation_keep_anim_object": True,
        "export_yup": True,
        "export_materials": "EXPORT",
        "export_cameras": False,
        "export_lights": False,
        "export_extras": True,
    }
    supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{key: value for key, value in candidate_options.items() if key in supported})


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_preview_environment(materials: dict[str, bpy.types.Material]) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass

    world = bpy.data.worlds.new("QF_PreviewWorld") if bpy.context.scene.world is None else bpy.context.scene.world
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.007, 0.008, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.12

    ground_material = make_material("QF_PreviewGround", (0.008, 0.012, 0.014, 1), metallic=0.12, roughness=0.64)
    add_box("QF_PreviewGround", (26, 15, 0.25), ground_material, location=(0, 1.1, -0.18), bevel=0.08)

    bpy.ops.object.camera_add(location=(10.8, -21.5, 8.7))
    camera = bpy.context.object
    camera.name = "QF_PreviewCamera"
    camera.data.lens = 58
    camera.data.sensor_width = 38
    camera.data.dof.use_dof = False
    point_camera(camera, Vector((0, 0, 1.95)))
    scene.camera = camera

    def area_light(name: str, location: Sequence[float], energy: float, size: float, color: Sequence[float]) -> None:
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light_data.color = color
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = location
        point_camera(light, Vector((0, 0, 1.8)))

    area_light("QF_KeyLight", (-5.5, -7.5, 11.5), 1500, 7.5, (1.0, 0.84, 0.68))
    area_light("QF_FillLight", (8.0, -2.0, 7.5), 1000, 6.0, (0.55, 0.74, 0.8))
    area_light("QF_RimLight", (2.0, 6.0, 9.0), 1300, 5.0, (0.36, 0.9, 0.78))
    area_light("QF_FrontSoftbox", (0, -10, 3.5), 700, 5.0, (1.0, 0.94, 0.82))


def render_assets(preview: Path, poster: Path) -> None:
    scene = bpy.context.scene
    scene.frame_set(PREVIEW_FRAME)
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(preview)
    bpy.ops.render.render(write_still=True)

    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.quality = 78
    scene.render.filepath = str(poster)
    bpy.ops.render.render(write_still=True)


def main() -> None:
    args = parse_args()
    glb_path = ensure_parent(args.glb)
    blend_path = ensure_parent(args.blend)
    poster_path = ensure_parent(args.poster)
    preview_path = ensure_parent(args.preview)
    reset_scene()
    root, materials = build_asset()
    add_preview_environment(materials)
    bpy.context.scene.frame_set(PREVIEW_FRAME)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), compress=True)
    export_glb(root, glb_path)
    render_assets(preview_path, poster_path)
    print(f"QF_ASSET glb={glb_path}")
    print(f"QF_ASSET blend={blend_path}")
    print(f"QF_ASSET poster={poster_path}")
    print(f"QF_ASSET preview={preview_path}")


if __name__ == "__main__":
    main()
