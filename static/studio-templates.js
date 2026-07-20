// Editable starter parts for CAD Studio. This is deliberately data, not a
// collection of opaque meshes: every card opens a normal parameter list and
// feature history that can be edited, undone, saved, and exported.

const rect = (x, y, w, h) => ({ kind: 'rect', x, y, w, h });
const circle = (x, y, r) => ({ kind: 'circle', x, y, r });
const poly = (pts) => ({ kind: 'poly', pts });
const feature = (id, type, shapes, extra = {}) => ({ id, type, sketch: { shapes, z: extra.z ?? 0 }, ...extra });
const param = (name, value) => ({ name, value });

function item(meta, params, features) {
  return Object.freeze({
    ...meta,
    document: {
      title: meta.name,
      units: 'mm',
      params,
      features,
    },
  });
}

const plate = (id, meta, width, depth, height, cuts = [], extraParams = []) =>
  item(
    meta,
    [param('width', width), param('depth', depth), param('height', height), ...extraParams],
    [
      feature(id + '-base', 'extrude', [rect(0, 0, 'width', 'depth')], { h: 'height' }),
      ...cuts.map((shapes, index) => feature(id + '-cut-' + (index + 1), 'cut', shapes, { z: height, h: height * 2, through: true })),
    ],
  );

const ring = (id, meta, outer, bore, length) =>
  item(
    meta,
    [param('outer_dia', outer), param('bore_dia', bore), param('length', length)],
    [
      feature(id + '-body', 'extrude', [circle(0, 0, 'outer_dia/2')], { h: 'length' }),
      feature(id + '-bore', 'cut', [circle(0, 0, 'bore_dia/2')], { z: length, h: length * 2, through: true }),
    ],
  );

const META = (id, name, category, description, preview, difficulty, tags, size, recipe) => ({
  id,
  name,
  category,
  description,
  preview,
  difficulty,
  tags,
  size,
  recipe,
});

export const STUDIO_TEMPLATE_CATEGORIES = Object.freeze(['Basics', 'Mounting', 'Mechanical', 'Enclosures', 'Workshop']);

export const STUDIO_TEMPLATES = Object.freeze([
  plate(
    'starter-plate',
    META('starter-plate', 'Starter plate', 'Basics', 'A dimension-driven square plate with a through hole. The clearest place to learn the feature tree.', 'plate', 'Beginner', ['plate', 'hole', 'learn'], '40 × 40 × 5 mm', ['Sketch 40 × 40', 'Extrude 5', 'Cut Ø8 through']),
    40, 40, 5, [[circle(0, 0, 'hole_dia/2')]], [param('hole_dia', 8)],
  ),
  ring('flat-washer', META('flat-washer', 'Flat washer', 'Basics', 'A printable washer with editable outside diameter, bore, and thickness.', 'ring', 'Beginner', ['washer', 'ring', 'fastener'], '24 × 3 mm', ['Circle Ø24', 'Extrude 3', 'Cut Ø10 through']), 24, 10, 3),
  ring('spacer', META('spacer', 'Round spacer', 'Basics', 'A tall cylindrical spacer ready to resize for a bolt or shaft.', 'spacer', 'Beginner', ['spacer', 'standoff', 'bushing'], '16 × 12 mm', ['Circle Ø16', 'Extrude 12', 'Cut Ø5 through']), 16, 5, 12),
  plate('plain-shim', META('plain-shim', 'Plain shim', 'Basics', 'A thin rectangular packing shim with named width, depth, and thickness.', 'shim', 'Beginner', ['shim', 'spacer', 'plate'], '30 × 20 × 1 mm', ['Sketch 30 × 20', 'Extrude 1']), 30, 20, 1),
  ring('shaft-collar', META('shaft-collar', 'Shaft collar blank', 'Basics', 'A thick collar blank with a central shaft bore, ready for a clamp detail.', 'collar', 'Beginner', ['shaft', 'collar', 'bore'], '30 × 12 mm', ['Circle Ø30', 'Extrude 12', 'Cut Ø12 through']), 30, 12, 12),
  ring('turned-knob', META('turned-knob', 'Machine knob blank', 'Basics', 'A cylindrical control-knob blank with editable diameter, height, and shaft bore.', 'knob', 'Beginner', ['knob', 'control', 'shaft'], 'Ø32 × 24 mm', ['Circle Ø32', 'Extrude 24', 'Cut Ø6 through']), 32, 6, 24),

  plate('four-hole-plate', META('four-hole-plate', 'Four-hole mounting plate', 'Mounting', 'A rectangular mounting plate with four corner holes controlled by spacing parameters.', 'mounting-plate', 'Beginner', ['plate', 'mount', 'bolt pattern'], '80 × 50 × 6 mm', ['Base sketch', 'Extrude 6', 'Cut 4 holes through']), 80, 50, 6, [[circle(-32, -17, 'hole_dia/2'), circle(32, -17, 'hole_dia/2'), circle(-32, 17, 'hole_dia/2'), circle(32, 17, 'hole_dia/2')]], [param('hole_dia', 6)]),
  item(
    META('motor-flange', 'Motor flange', 'Mounting', 'Circular flange with a centre clearance and four-hole bolt circle.', 'flange', 'Intermediate', ['motor', 'flange', 'bolt circle'], 'Ø64 × 6 mm', ['Circle Ø64', 'Extrude 6', 'Cut centre', 'Pattern 4 holes']),
    [param('outer_dia', 64), param('shaft_dia', 24), param('bolt_dia', 5), param('pcd', 44), param('thickness', 6)],
    [
      feature('motor-flange-base', 'extrude', [circle(0, 0, 'outer_dia/2')], { h: 'thickness' }),
      feature('motor-flange-centre', 'cut', [circle(0, 0, 'shaft_dia/2')], { z: 6, h: 12, through: true }),
      feature('motor-flange-bolts', 'cut', [circle('pcd/2', 0, 'bolt_dia/2')], { z: 6, h: 12, through: true, pattern: { kind: 'circular', n: 4, cx: 0, cy: 0 } }),
    ],
  ),
  plate('camera-plate', META('camera-plate', 'Camera mounting plate', 'Mounting', 'Compact plate with a centre tripod clearance and two accessory slots represented as cuts.', 'camera-plate', 'Intermediate', ['camera', 'tripod', 'mount'], '60 × 42 × 5 mm', ['Base sketch', 'Extrude 5', 'Cut centre + slots']), 60, 42, 5, [[circle(0, 0, 3.25), rect(-20, 0, 4, 22), rect(20, 0, 4, 22)]]),
  plate('cable-tie-base', META('cable-tie-base', 'Cable-tie base', 'Mounting', 'Low-profile adhesive or screw-down base with two strap passages.', 'tie-base', 'Beginner', ['cable', 'tie', 'anchor'], '30 × 22 × 4 mm', ['Base sketch', 'Extrude 4', 'Cut 2 passages']), 30, 22, 4, [[rect(-7, 0, 3, 14), rect(7, 0, 3, 14)]]),
  item(
    META('servo-horn', 'Servo horn disk', 'Mounting', 'Disk horn with a centre bore and six evenly spaced linkage holes.', 'servo', 'Intermediate', ['servo', 'robotics', 'pattern'], 'Ø36 × 4 mm', ['Circle Ø36', 'Extrude 4', 'Cut centre', 'Pattern 6 holes']),
    [param('horn_dia', 36), param('thickness', 4), param('centre_dia', 6), param('link_dia', 2.8), param('link_radius', 12)],
    [
      feature('servo-horn-base', 'extrude', [circle(0, 0, 'horn_dia/2')], { h: 'thickness' }),
      feature('servo-horn-centre', 'cut', [circle(0, 0, 'centre_dia/2')], { z: 4, h: 8, through: true }),
      feature('servo-horn-links', 'cut', [circle('link_radius', 0, 'link_dia/2')], { z: 4, h: 8, through: true, pattern: { kind: 'circular', n: 6, cx: 0, cy: 0 } }),
    ],
  ),
  plate('wall-bracket-foot', META('wall-bracket-foot', 'Wall bracket foot', 'Mounting', 'A thick bracket foot with two wall fastener holes and an open centre.', 'bracket', 'Beginner', ['bracket', 'wall', 'mount'], '70 × 32 × 8 mm', ['Base sketch', 'Extrude 8', 'Cut 2 holes']), 70, 32, 8, [[circle(-24, 0, 3.5), circle(24, 0, 3.5)]]),

  ring('v-belt-pulley', META('v-belt-pulley', 'Pulley blank', 'Mechanical', 'A fully dimensioned pulley blank with a shaft bore, ready for grooves or hub details.', 'pulley', 'Beginner', ['pulley', 'belt', 'shaft'], 'Ø50 × 18 mm', ['Circle Ø50', 'Extrude 18', 'Cut Ø10 through']), 50, 10, 18),
  ring('plain-bushing', META('plain-bushing', 'Plain bushing', 'Mechanical', 'A sleeve bushing whose bore, outside diameter, and length are all reusable parameters.', 'bushing', 'Beginner', ['bushing', 'sleeve', 'bearing'], 'Ø22 × 18 mm', ['Circle Ø22', 'Extrude 18', 'Cut Ø12 through']), 22, 12, 18),
  ring('wheel-hub', META('wheel-hub', 'Wheel hub', 'Mechanical', 'Thick hub blank with a shaft bore, ready for radial holes or a keyed detail.', 'hub', 'Beginner', ['wheel', 'hub', 'shaft'], 'Ø45 × 20 mm', ['Circle Ø45', 'Extrude 20', 'Cut Ø10 through']), 45, 10, 20),
  item(
    META('bearing-seat', 'Bearing seat plate', 'Mechanical', 'Rectangular bearing carrier with a large centre seat and four attachment holes.', 'bearing-seat', 'Intermediate', ['bearing', 'seat', 'carrier'], '76 × 64 × 10 mm', ['Base sketch', 'Extrude 10', 'Cut bearing seat', 'Cut 4 mount holes']),
    [param('width', 76), param('depth', 64), param('height', 10), param('bearing_dia', 32), param('hole_dia', 6)],
    [
      feature('bearing-seat-base', 'extrude', [rect(0, 0, 'width', 'depth')], { h: 'height' }),
      feature('bearing-seat-bore', 'cut', [circle(0, 0, 'bearing_dia/2')], { z: 10, h: 20, through: true }),
      feature('bearing-seat-mounts', 'cut', [circle(-30, -24, 'hole_dia/2'), circle(30, -24, 'hole_dia/2'), circle(-30, 24, 'hole_dia/2'), circle(30, 24, 'hole_dia/2')], { z: 10, h: 20, through: true }),
    ],
  ),
  item(
    META('stepped-pin', 'Stepped pin', 'Mechanical', 'A two-diameter pin built from overlapping coaxial features so every driving value stays editable.', 'pin', 'Intermediate', ['pin', 'shaft', 'step'], 'Ø20 × 42 mm', ['Major cylinder Ø20 × 20', 'Tip cylinder Ø12 × 42']),
    [param('major_dia', 20), param('tip_dia', 12), param('major_length', 20), param('tip_length', 22)],
    [
      feature('stepped-pin-major', 'extrude', [circle(0, 0, 'major_dia/2')], { h: 'major_length' }),
      feature('stepped-pin-tip', 'extrude', [circle(0, 0, 'tip_dia/2')], { h: 'major_length+tip_length' }),
    ],
  ),
  plate('drill-jig', META('drill-jig', 'Drill guide', 'Mechanical', 'A thick drill guide with three aligned bores for repeatable hand drilling.', 'drill-jig', 'Beginner', ['drill', 'jig', 'guide'], '70 × 24 × 12 mm', ['Base sketch', 'Extrude 12', 'Cut 3 guide bores']), 70, 24, 12, [[circle(-22, 0, 3), circle(0, 0, 3), circle(22, 0, 3)]]),

  item(
    META('electronics-tray', 'Electronics tray', 'Enclosures', 'Open-top rectangular tray made from an outer solid and one pocket cut.', 'tray', 'Beginner', ['electronics', 'tray', 'case'], '100 × 70 × 14 mm', ['Outer block', 'Extrude 14', 'Pocket 11 deep']),
    [param('width', 100), param('depth', 70), param('height', 14), param('wall', 3), param('floor', 3)],
    [
      feature('electronics-tray-outer', 'extrude', [rect(0, 0, 'width', 'depth')], { h: 'height' }),
      feature('electronics-tray-pocket', 'cut', [rect(0, 0, 'width-wall*2', 'depth-wall*2')], { z: 14, h: 'height-floor', through: false }),
    ],
  ),
  item(
    META('box-lid', 'Project-box lid', 'Enclosures', 'A shallow cap with a recessed underside. Tune clearance before printing.', 'lid', 'Beginner', ['box', 'lid', 'enclosure'], '86 × 56 × 6 mm', ['Outer lid', 'Extrude 6', 'Recess 4 deep']),
    [param('width', 86), param('depth', 56), param('height', 6), param('rim', 3), param('top', 2)],
    [
      feature('box-lid-outer', 'extrude', [rect(0, 0, 'width', 'depth')], { h: 'height' }),
      feature('box-lid-recess', 'cut', [rect(0, 0, 'width-rim*2', 'depth-rim*2')], { z: 6, h: 'height-top', through: false }),
    ],
  ),
  item(
    META('sensor-case', 'Sensor case', 'Enclosures', 'Small protective case with a pocket and a front cable opening.', 'sensor-case', 'Intermediate', ['sensor', 'case', 'electronics'], '48 × 34 × 18 mm', ['Outer block', 'Pocket interior', 'Cut cable opening']),
    [param('width', 48), param('depth', 34), param('height', 18), param('wall', 2.5)],
    [
      feature('sensor-case-outer', 'extrude', [rect(0, 0, 'width', 'depth')], { h: 'height' }),
      feature('sensor-case-pocket', 'cut', [rect(0, 0, 'width-wall*2', 'depth-wall*2')], { z: 18, h: 15.5, through: false }),
      feature('sensor-case-cable', 'cut', [rect(0, -14, 10, 8)], { z: 18, h: 36, through: true }),
    ],
  ),
  item(
    META('battery-tray', 'Battery tray', 'Enclosures', 'Low tray for a rectangular battery pack with a central cavity and strap slots.', 'battery', 'Intermediate', ['battery', 'tray', 'strap'], '110 × 48 × 10 mm', ['Outer tray', 'Pocket', 'Cut strap slots']),
    [param('width', 110), param('depth', 48), param('height', 10), param('wall', 3)],
    [
      feature('battery-tray-outer', 'extrude', [rect(0, 0, 'width', 'depth')], { h: 'height' }),
      feature('battery-tray-pocket', 'cut', [rect(0, 0, 'width-wall*2', 'depth-wall*2')], { z: 10, h: 7, through: false }),
      feature('battery-tray-slots', 'cut', [rect(-38, 0, 5, 34), rect(38, 0, 5, 34)], { z: 10, h: 20, through: true }),
    ],
  ),
  plate('panel-nameplate', META('panel-nameplate', 'Panel nameplate', 'Enclosures', 'A clean equipment label plate with two fastener holes, ready for embossed lettering later.', 'nameplate', 'Beginner', ['label', 'panel', 'nameplate'], '80 × 24 × 2 mm', ['Plate sketch', 'Extrude 2', 'Cut 2 holes']), 80, 24, 2, [[circle(-32, 0, 2), circle(32, 0, 2)]]),

  item(
    META('phone-stand', 'Phone stand profile', 'Workshop', 'A stable side-profile stand made as one extrusion. Edit the profile points to change angle and lip.', 'phone-stand', 'Intermediate', ['phone', 'stand', 'desk'], '72 × 70 × 20 mm', ['Side profile', 'Extrude 20']),
    [param('width', 20)],
    [feature('phone-stand-body', 'extrude', [poly([[-36, -28], [34, -28], [34, -20], [4, -20], [18, 28], [8, 31], [-8, -17], [-36, -17]])], { h: 'width' })],
  ),
  item(
    META('utility-hook', 'Utility hook', 'Workshop', 'A strong flat hook profile for a wall rail or workshop panel.', 'hook', 'Intermediate', ['hook', 'wall', 'storage'], '58 × 72 × 12 mm', ['Hook profile', 'Extrude 12']),
    [param('thickness', 12)],
    [feature('utility-hook-body', 'extrude', [poly([[-12, -36], [12, -36], [12, 8], [28, 8], [28, 24], [20, 34], [10, 26], [14, 20], [4, 20], [4, -26], [-12, -26]])], { h: 'thickness' })],
  ),
  item(
    META('router-template', 'Router drilling template', 'Workshop', 'Wide reference template with a real six-instance linear hole pattern.', 'template', 'Beginner', ['router', 'drill', 'template', 'pattern'], '150 × 40 × 4 mm', ['Base plate', 'Extrude 4', 'Linear pattern 6 holes']),
    [param('width', 150), param('depth', 40), param('thickness', 4), param('hole_dia', 5), param('spacing', 25)],
    [
      feature('router-template-base', 'extrude', [rect(0, 0, 'width', 'depth')], { h: 'thickness' }),
      feature('router-template-holes', 'cut', [circle('-spacing*2.5', 0, 'hole_dia/2')], { z: 4, h: 8, through: true, pattern: { kind: 'linear', n: 6, dx: 'spacing', dy: 0 } }),
    ],
  ),
  plate('cable-comb', META('cable-comb', 'Cable comb blank', 'Workshop', 'Desk cable organiser with six evenly spaced cable passages.', 'cable-comb', 'Intermediate', ['cable', 'organizer', 'desk'], '100 × 26 × 8 mm', ['Base sketch', 'Extrude 8', 'Cut 6 passages']), 100, 26, 8, [[circle(-37.5, 0, 3.5), circle(-22.5, 0, 3.5), circle(-7.5, 0, 3.5), circle(7.5, 0, 3.5), circle(22.5, 0, 3.5), circle(37.5, 0, 3.5)]]),
  plate('bench-dog', META('bench-dog', 'Bench-dog plate', 'Workshop', 'Square fixture plate with a large centre bore and four screw holes.', 'bench-dog', 'Beginner', ['workbench', 'fixture', 'dog'], '60 × 60 × 8 mm', ['Base plate', 'Extrude 8', 'Cut centre + screws']), 60, 60, 8, [[circle(0, 0, 10), circle(-22, -22, 2.5), circle(22, -22, 2.5), circle(-22, 22, 2.5), circle(22, 22, 2.5)]]),
]);

export function getStudioTemplate(id) {
  return STUDIO_TEMPLATES.find((template) => template.id === id) || null;
}

export function cloneStudioTemplateDocument(id) {
  const template = getStudioTemplate(id);
  return template ? structuredClone(template.document) : null;
}
