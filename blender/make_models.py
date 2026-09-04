"""Build the game's models in Blender and export them as GLB.

Run headless:  npm run models
(= Blender --background --python blender/make_models.py)

Models are modelled facing Blender +Y, which the glTF exporter turns into -Z:
three.js's forward. Units are metres. Material names matter: the client tints
"Hull" per player and drives "Glow" emission at runtime.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models")
PREVIEW = os.path.join(ROOT, "blender", "previews")
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)


# ---- helpers ----------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgb, metallic=0.0, roughness=0.6, emission=None, alpha=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 4.0
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
    return mat


def add(op, name, mat, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1), smooth=True, **kwargs):
    op(location=location, rotation=rotation, **kwargs)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    if smooth:
        bpy.ops.object.shade_smooth()
    else:
        bpy.ops.object.shade_flat()
    return obj


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    return obj


def export(obj, filename):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=False,
        export_animations=False,
    )
    print(f"exported {path} ({os.path.getsize(path)} bytes, {len(obj.data.vertices)} verts)")


def preview(obj, filename, distance=6.0, height=2.2):
    """A quick Workbench render so the model can be checked without opening Blender."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("World") if scene.world is None else scene.world
    scene.world.color = (0.08, 0.1, 0.14)

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = Vector((distance * 0.7, -distance * 0.8, height))
    direction = Vector((0, 0, obj.dimensions.z * 0.4)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = os.path.join(PREVIEW, filename)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


# ---- the pod: what you fly ---------------------------------------------------

def make_pod():
    reset_scene()
    hull = material("Hull", (0.85, 0.55, 0.2), metallic=0.35, roughness=0.45)
    dark = material("Dark", (0.12, 0.13, 0.15), metallic=0.6, roughness=0.5)
    glass = material("Glass", (0.45, 0.75, 0.95), metallic=0.0, roughness=0.1, alpha=0.45)
    light = material("Light", (1.0, 0.95, 0.8), emission=(1.0, 0.9, 0.6))
    trim = material("Trim", (0.92, 0.9, 0.85), metallic=0.2, roughness=0.5)

    parts = []
    # main hull: an ellipsoid, longer than wide
    parts.append(add(bpy.ops.mesh.primitive_uv_sphere_add, "HullBody", hull,
                     scale=(0.9, 1.55, 0.62), segments=32, ring_count=16))
    # cockpit dome at the front
    parts.append(add(bpy.ops.mesh.primitive_uv_sphere_add, "Dome", glass,
                     location=(0, 0.55, 0.32), scale=(0.62, 0.72, 0.5), segments=24, ring_count=12))
    # a lip under the dome
    parts.append(add(bpy.ops.mesh.primitive_torus_add, "DomeRing", trim,
                     location=(0, 0.55, 0.3), rotation=(0, 0, 0),
                     major_radius=0.62, minor_radius=0.05, major_segments=32, minor_segments=8))
    # side pontoons with thrusters
    for sx in (-1, 1):
        parts.append(add(bpy.ops.mesh.primitive_cylinder_add, f"Pontoon{sx}", dark,
                         location=(sx * 1.1, -0.15, -0.12), rotation=(math.pi / 2, 0, 0),
                         scale=(0.3, 0.3, 0.85), vertices=20, radius=1.0, depth=2.0))
        parts.append(add(bpy.ops.mesh.primitive_torus_add, f"Thruster{sx}", trim,
                         location=(sx * 1.1, -1.05, -0.12), rotation=(math.pi / 2, 0, 0),
                         major_radius=0.36, minor_radius=0.07, major_segments=24, minor_segments=8))
        parts.append(add(bpy.ops.mesh.primitive_cone_add, f"Nozzle{sx}", light,
                         location=(sx * 1.1, -1.12, -0.12), rotation=(-math.pi / 2, 0, 0),
                         scale=(0.22, 0.22, 0.25), vertices=16, radius1=1.0, radius2=0.4, depth=1.0, smooth=False))
        # strut joining pontoon to hull
        parts.append(add(bpy.ops.mesh.primitive_cube_add, f"Strut{sx}", dark,
                         location=(sx * 0.7, -0.15, -0.05), scale=(0.35, 0.35, 0.08), smooth=False))
        # headlights
        parts.append(add(bpy.ops.mesh.primitive_uv_sphere_add, f"Lamp{sx}", light,
                         location=(sx * 0.42, 1.38, -0.02), scale=(0.13, 0.1, 0.13), segments=12, ring_count=8))
    # tail fin
    parts.append(add(bpy.ops.mesh.primitive_cube_add, "Fin", trim,
                     location=(0, -1.25, 0.5), scale=(0.04, 0.42, 0.38), smooth=False))
    # ventral keel
    parts.append(add(bpy.ops.mesh.primitive_cube_add, "Keel", dark,
                     location=(0, -0.2, -0.58), scale=(0.08, 0.9, 0.12), smooth=False))

    pod = join(parts, "Pod")
    export(pod, "pod.glb")
    preview(pod, "pod.png", distance=6.5, height=2.4)


# ---- a street tree -----------------------------------------------------------

def make_tree():
    reset_scene()
    trunk = material("Trunk", (0.36, 0.25, 0.16), roughness=0.9)
    leaves = material("Leaves", (0.32, 0.55, 0.28), roughness=0.85)

    parts = [add(bpy.ops.mesh.primitive_cylinder_add, "Trunk", trunk,
                 location=(0, 0, 1.2), scale=(0.16, 0.16, 1.2), vertices=8, radius=1.0, depth=2.0, smooth=False)]
    blobs = [((0, 0, 3.4), 1.5), ((0.8, 0.3, 2.9), 1.05), ((-0.7, -0.4, 3.0), 1.0), ((0.1, -0.8, 3.9), 0.9)]
    for i, (loc, r) in enumerate(blobs):
        parts.append(add(bpy.ops.mesh.primitive_ico_sphere_add, f"Canopy{i}", leaves,
                         location=loc, scale=(r, r, r * 0.85), subdivisions=1, radius=1.0, smooth=False))
    tree = join(parts, "Tree")
    export(tree, "tree.glb")
    preview(tree, "tree.png", distance=9.0, height=3.5)


# ---- a memory lantern --------------------------------------------------------

def make_lantern():
    reset_scene()
    dark = material("Dark", (0.14, 0.12, 0.11), metallic=0.5, roughness=0.5)
    glow = material("Glow", (1.0, 0.72, 0.35), emission=(1.0, 0.62, 0.25))
    paper = material("Paper", (0.98, 0.9, 0.78), roughness=0.9, alpha=0.85)

    parts = [
        add(bpy.ops.mesh.primitive_cylinder_add, "Body", paper, location=(0, 0, 0.55),
            scale=(0.34, 0.34, 0.42), vertices=8, radius=1.0, depth=1.0, smooth=False),
        add(bpy.ops.mesh.primitive_uv_sphere_add, "Core", glow, location=(0, 0, 0.55),
            scale=(0.2, 0.2, 0.24), segments=16, ring_count=10),
        add(bpy.ops.mesh.primitive_cylinder_add, "Cap", dark, location=(0, 0, 1.0),
            scale=(0.4, 0.4, 0.06), vertices=8, radius=1.0, depth=1.0, smooth=False),
        add(bpy.ops.mesh.primitive_cylinder_add, "Base", dark, location=(0, 0, 0.1),
            scale=(0.4, 0.4, 0.06), vertices=8, radius=1.0, depth=1.0, smooth=False),
        add(bpy.ops.mesh.primitive_torus_add, "Handle", dark, location=(0, 0, 1.18),
            rotation=(math.pi / 2, 0, 0), major_radius=0.16, minor_radius=0.025, major_segments=16, minor_segments=6),
    ]
    for i in range(8):
        a = i * math.pi / 4
        parts.append(add(bpy.ops.mesh.primitive_cube_add, f"Rib{i}", dark,
                         location=(math.cos(a) * 0.35, math.sin(a) * 0.35, 0.55),
                         rotation=(0, 0, a), scale=(0.02, 0.02, 0.44), smooth=False))
    lantern = join(parts, "Lantern")
    export(lantern, "lantern.glb")
    preview(lantern, "lantern.png", distance=3.2, height=1.3)


if __name__ == "__main__":
    which = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    builders = {"pod": make_pod, "tree": make_tree, "lantern": make_lantern}
    for name, build in builders.items():
        if not which or name in which:
            build()
    print("models done")
