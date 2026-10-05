"""
Renders the bottle onboarding opens with: an unlabelled long-neck — lit amber glass, beer in it, a blank
paper label, beaded with cold — and, separately, its crown cap (so the app can take the cap off).

Run by scripts/render-opening-bottle.mjs, which also crops and compresses the result:

    blender -b -P scripts/render-opening-bottle.py -- <out-dir> [samples]

Everything is built here from numbers (no model file, no texture, no brand): the bottle is a profile turned
on a lathe. Dimensions are centimetres, converted to metres when placed.
"""
import math
import random
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = argv[0] if argv else "."
SAMPLES = int(argv[1]) if len(argv) > 1 else 220
CM = 0.01

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, **inputs):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    for key, value in inputs.items():
        bsdf.inputs[key].default_value = value
    return mat


def lathe(name, profile, mat, segments=128, wobble=None, smooth=True, arc=None):
    """
    Turns a profile [(radius, height), …] about the vertical axis. `wobble(index, angle)` scales a ring's
    radius; `arc=(from°, to°)` turns it only part of the way round (a label that does not meet at the back).
    """
    start, sweep = (math.radians(arc[0]), math.radians(arc[1] - arc[0])) if arc else (0.0, 2 * math.pi)
    steps = segments + 1 if arc else segments
    bm = bmesh.new()
    rings = []
    for index, (radius, height) in enumerate(profile):
        if radius == 0:
            rings.append([bm.verts.new((0, 0, height * CM))])
            continue
        ring = []
        for step in range(steps):
            angle = start + sweep * step / segments
            r = radius * (wobble(index, angle) if wobble else 1)
            ring.append(bm.verts.new((r * math.cos(angle) * CM, r * math.sin(angle) * CM, height * CM)))
        rings.append(ring)
    for lower, upper in zip(rings, rings[1:]):
        for step in range(segments):
            nxt = step + 1 if arc else (step + 1) % segments
            if len(lower) == 1 and len(upper) == 1:
                continue
            if len(lower) == 1:
                bm.faces.new((lower[0], upper[nxt], upper[step]))
            elif len(upper) == 1:
                bm.faces.new((lower[step], lower[nxt], upper[0]))
            else:
                bm.faces.new((lower[step], lower[nxt], upper[nxt], upper[step]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


# ----------------------------------------------------------------------------- materials

GLASS = material("glass", **{"Base Color": (0.62, 0.36, 0.12, 1), "Roughness": 0.035, "IOR": 1.5, "Transmission Weight": 1.0})
BEER = material("beer", **{"Base Color": (1.0, 0.74, 0.3, 1), "Roughness": 0.0, "IOR": 1.34, "Transmission Weight": 1.0})
PAPER = material("paper", **{"Base Color": (0.78, 0.75, 0.68, 1), "Roughness": 0.66})
RULE = material("rule", **{"Base Color": (0.4, 0.37, 0.32, 1), "Roughness": 0.7})
STEEL = material("steel", **{"Base Color": (0.78, 0.76, 0.72, 1), "Metallic": 1.0, "Roughness": 0.28})
WATER = material("water", **{"Base Color": (1, 1, 1, 1), "Roughness": 0.0, "IOR": 1.33, "Transmission Weight": 1.0})

# ----------------------------------------------------------------------------- the bottle

# The outside, base to lip, then the inside back down: one closed skin with real thickness.
OUTER = [
    (0, 0), (2.5, 0), (2.9, 0.12), (3.05, 0.45), (3.05, 10.2), (3.02, 11.0), (2.9, 11.9), (2.66, 12.9), (2.3, 14.0),
    (1.92, 15.1), (1.62, 16.2), (1.45, 17.3), (1.36, 18.8), (1.32, 20.0), (1.3, 21.3), (1.34, 21.5), (1.45, 21.65), (1.45, 21.95),
    (1.33, 22.1), (1.3, 22.4), (1.37, 22.55), (1.4, 22.75), (1.37, 22.95), (1.28, 23.0),
]
INNER = [
    (1.02, 23.0), (1.0, 22.0), (1.02, 20.0), (1.06, 18.8), (1.15, 17.3), (1.32, 16.2), (1.62, 15.1), (2.0, 14.0),
    (2.36, 12.9), (2.6, 11.9), (2.72, 11.0), (2.75, 10.2), (2.75, 1.0), (2.55, 0.72), (2.1, 0.62), (0, 0.6),
]
bottle = lathe("bottle", OUTER + INNER, GLASS)

FILL = 19.4
liquid = lathe(
    "beer",
    [(0, 0.63), (2.08, 0.65), (2.52, 0.75), (2.72, 1.02), (2.72, 10.2), (2.69, 11.0), (2.57, 11.9), (2.33, 12.9),
     (1.97, 14.0), (1.59, 15.1), (1.29, 16.2), (1.12, 17.3), (1.03, 18.8), (1.0, FILL), (0, FILL)],
    BEER,
)

# Blank paper: a body label ruled top and bottom, and a neck label. Nobody's name on either.
# They face the camera and stop short of the back, so the beer behind them is seen through clear glass.
FRONT = (-200, 20)
label = lathe("label", [(3.065, 3.4), (3.065, 9.7)], PAPER, arc=FRONT)
for z in (3.85, 9.17):
    lathe("rule", [(3.07, z), (3.07, z + 0.08)], RULE, arc=FRONT)
lathe("neck-label", [(1.385, 18.8), (1.34, 20.6)], PAPER, arc=FRONT)


def radius_at(height):
    for (r0, z0), (r1, z1) in zip(OUTER, OUTER[1:]):
        if z0 <= height <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (height - z0) / (z1 - z0)
    return 3.05


# Beads of cold on the glass the camera can see (never on the paper).
random.seed(11)
bead = bpy.data.meshes.new("bead")
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
bm.to_mesh(bead)
bm.free()
for poly in bead.polygons:
    poly.use_smooth = True
bead.materials.append(WATER)
for _ in range(300):
    height = random.choice([random.uniform(0.9, 3.2), random.uniform(10.0, 16.4), random.uniform(10.0, 13.2)])
    angle = math.radians(random.uniform(-200, 20))  # the camera looks along +Y: the side facing it is around -90°
    size = random.uniform(0.022, 0.085) ** 1.0
    r = radius_at(height) + size * 0.25
    drop = bpy.data.objects.new("bead", bead)
    drop.location = (r * math.cos(angle) * CM, r * math.sin(angle) * CM, height * CM)
    drop.rotation_euler = (0, 0, angle)
    drop.scale = (size * 0.55 * CM, size * CM, size * 1.3 * CM)
    scene.collection.objects.link(drop)

# ----------------------------------------------------------------------------- the crown cap

CRIMPS = 21


def crimp(index, angle):
    # The skirt (the last three rings) is pinched into teeth; the top stays round.
    depth = (0, 0, 0, 0.015, 0.05, 0.075)[index]
    return 1 + depth * math.cos(CRIMPS * angle)


cap = lathe("cap", [(0, 23.42), (1.05, 23.42), (1.42, 23.3), (1.56, 23.02), (1.6, 22.7), (1.66, 22.38)], STEEL, segments=252, wobble=crimp)
solid = cap.modifiers.new("thickness", "SOLIDIFY")
solid.thickness = 0.03 * CM

# ----------------------------------------------------------------------------- light

world = bpy.data.worlds.new("world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.045, 0.04, 1)
scene.world = world


def area(name, location, size, power, color=(1, 1, 1), target=(0, 0, 12)):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = "RECTANGLE"
    data.size, data.size_y = size[0] * CM, size[1] * CM
    data.energy = power
    data.color = color
    obj = bpy.data.objects.new(name, data)
    obj.location = tuple(c * CM for c in location)
    scene.collection.objects.link(obj)
    direction = obj.location - type(obj.location)(tuple(c * CM for c in target))
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


area("key", (-26, -30, 16), (7, 44), 7)                        # a tall strip: the long highlight down the lit side
area("rim", (24, -8, 14), (5, 40), 3.5)                        # a thin edge of light on the far side
area("top", (0, -10, 46), (30, 30), 2.5)                        # the cap and the shoulder
area("front", (6, -44, 10), (40, 50), 1.6)                      # so the paper reads as paper

# What makes beer glow: a warm wall behind the bottle, seen through the glass but not by the camera.
wall_mesh = bpy.data.meshes.new("wall")
wall_mesh.from_pydata([(-120 * CM, 22 * CM, -40 * CM), (120 * CM, 22 * CM, -40 * CM), (120 * CM, 22 * CM, 70 * CM), (-120 * CM, 22 * CM, 70 * CM)], [], [(0, 1, 2, 3)])
glow = bpy.data.materials.new("glow")
glow.use_nodes = True
glow.node_tree.nodes.clear()
emission = glow.node_tree.nodes.new("ShaderNodeEmission")
emission.inputs["Color"].default_value = (1.0, 0.76, 0.42, 1)
emission.inputs["Strength"].default_value = 1.25
output = glow.node_tree.nodes.new("ShaderNodeOutputMaterial")
glow.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
wall_mesh.materials.append(glow)
wall = bpy.data.objects.new("wall", wall_mesh)
wall.visible_camera = False
scene.collection.objects.link(wall)

# ----------------------------------------------------------------------------- camera and render

camera_data = bpy.data.cameras.new("camera")
camera_data.type = "ORTHO"
camera_data.ortho_scale = 24.6 * CM
camera_data.clip_start = 0.01
camera = bpy.data.objects.new("camera", camera_data)
camera.location = (0, -60 * CM, 11.75 * CM)
camera.rotation_euler = (math.radians(90), 0, 0)
scene.collection.objects.link(camera)
scene.camera = camera

scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 24
scene.cycles.transmission_bounces = 20
scene.cycles.glossy_bounces = 12
scene.cycles.caustics_refractive = True
scene.render.film_transparent = True
scene.render.resolution_x = 660
scene.render.resolution_y = 2000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"


def render(path, visible):
    for obj in scene.objects:
        if obj.type == "MESH" and obj.name != "wall":
            obj.hide_render = not visible(obj)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


render(f"{OUT}/bottle.png", lambda obj: obj.name != "cap")
render(f"{OUT}/cap.png", lambda obj: obj.name == "cap")
