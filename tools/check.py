#!/usr/bin/env python3
"""Structural and geometric checks on the model.

The type check lives in the app and runs in the page. This one covers what a
type check cannot see: flows that point at nothing, declarations that disagree
with the flows, elements with no diagram interchange, shapes that overlap or
escape their parent. Run it after editing the BPMN by hand or in a modeller.

    python3 tools/check.py [workflows/pipeline.bpmn]
"""
import sys
from xml.dom import minidom

BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL'
TASKISH = {'serviceTask', 'userTask', 'manualTask', 'task', 'subProcess'}


def kids(node, name=None):
    return [n for n in node.childNodes
            if n.nodeType == 1 and (name is None or n.localName == name)]


def texts(node, name):
    return [n.firstChild.data.strip() for n in kids(node, name) if n.firstChild]


def is_element(node):
    kind = node.localName
    return kind in TASKISH or kind.endswith('Event') or kind.endswith('Gateway')


def scopes(node, path='process', found=None):
    """The process, then every sub-process inside it."""
    found = [] if found is None else found
    found.append((path, node))
    for child in kids(node, 'subProcess'):
        scopes(child, f"{path} / {child.getAttribute('id')}", found)
    return found


def check_scope(path, node, data, problems):
    elements = {e.getAttribute('id'): e for e in kids(node) if is_element(e)}
    incoming, outgoing = {}, {}

    for flow in kids(node, 'sequenceFlow'):
        fid = flow.getAttribute('id')
        source, target = flow.getAttribute('sourceRef'), flow.getAttribute('targetRef')
        for end, ref in (('sourceRef', source), ('targetRef', target)):
            if ref not in elements:
                problems.append(f'{path}: flow "{fid}" {end}="{ref}" is not in this scope')
        outgoing.setdefault(source, set()).add(fid)
        incoming.setdefault(target, set()).add(fid)

    for eid, element in elements.items():
        for label, declared, actual in (
            ('incoming', set(texts(element, 'incoming')), incoming.get(eid, set())),
            ('outgoing', set(texts(element, 'outgoing')), outgoing.get(eid, set())),
        ):
            if declared != actual:
                problems.append(f'{path}: "{eid}" declares {label} {sorted(declared)}, '
                                f'flows say {sorted(actual)}')

        attached = element.getAttribute('attachedToRef')
        if attached and attached not in elements:
            problems.append(f'{path}: "{eid}" is attached to "{attached}", which is not here')
        if not incoming.get(eid) and element.localName != 'startEvent' and not attached:
            problems.append(f'{path}: "{eid}" has nothing leading to it')
        if not outgoing.get(eid) and element.localName != 'endEvent':
            problems.append(f'{path}: "{eid}" leads nowhere')

        for loop in kids(element, 'multiInstanceLoopCharacteristics'):
            for ref in texts(loop, 'loopDataOutputRef'):
                if ref not in data:
                    problems.append(f'{path}: "{eid}" collects into "{ref}", '
                                    'which is not declared as a property')

    for kind, wanted in (('startEvent', 1), ('endEvent', 1)):
        seen = [e for e in elements.values() if e.localName == kind]
        if len(seen) != wanted:
            problems.append(f'{path}: {len(seen)} {kind}s, expected {wanted}')


def boxes(doc):
    found = {}
    for shape in doc.getElementsByTagName('bpmndi:BPMNShape'):
        bounds = shape.getElementsByTagName('dc:Bounds')[0]
        found[shape.getAttribute('bpmnElement')] = tuple(
            float(bounds.getAttribute(k)) for k in ('x', 'y', 'width', 'height'))
    return found


def overlaps(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def inside(child, parent):
    cx, cy, cw, ch = child
    px, py, pw, ph = parent
    return cx >= px and cy >= py and cx + cw <= px + pw and cy + ch <= py + ph


def check_geometry(doc, process, problems):
    box = boxes(doc)
    notes = {n.getAttribute('id') for n in doc.getElementsByTagNameNS(BPMN, 'textAnnotation')}
    drawn = set(box)
    modelled = {n.getAttribute('id') for n in doc.getElementsByTagNameNS(BPMN, '*')
                if is_element(n) or n.localName == 'textAnnotation'}
    for missing in sorted(modelled - drawn):
        problems.append(f'geometry: "{missing}" has no shape')
    for extra in sorted(drawn - modelled):
        problems.append(f'geometry: a shape is drawn for "{extra}", which is not an element')

    edges = {e.getAttribute('bpmnElement') for e in doc.getElementsByTagName('bpmndi:BPMNEdge')}
    lines = {n.getAttribute('id') for n in doc.getElementsByTagNameNS(BPMN, '*')
             if n.localName in ('sequenceFlow', 'association')}
    for missing in sorted(lines - edges):
        problems.append(f'geometry: "{missing}" has no edge')
    for extra in sorted(edges - lines):
        problems.append(f'geometry: an edge is drawn for "{extra}", which is not a flow')

    # A boundary event is meant to sit on the edge of what it is attached to.
    attached = {n.getAttribute('id'): n.getAttribute('attachedToRef')
                for n in doc.getElementsByTagNameNS(BPMN, 'boundaryEvent')}

    for _, node in scopes(process):
        own = [e.getAttribute('id') for e in kids(node) if is_element(e)]
        parent = node.getAttribute('id')
        for eid in own:
            if parent in box and eid in box and not inside(box[eid], box[parent]):
                problems.append(f'geometry: "{eid}" sticks out of "{parent}"')
        for i, a in enumerate(own):
            for b in own[i + 1:]:
                if attached.get(a) == b or attached.get(b) == a:
                    continue
                if a in box and b in box and overlaps(box[a], box[b]):
                    problems.append(f'geometry: "{a}" and "{b}" overlap')

    for note in sorted(notes):
        for other, other_box in box.items():
            if other != note and (other not in notes or other > note):
                if overlaps(box[note], other_box):
                    problems.append(f'geometry: annotation "{note}" overlaps "{other}"')


def segments(edge):
    points = [(float(w.getAttribute('x')), float(w.getAttribute('y')))
              for w in edge.getElementsByTagName('di:waypoint')]
    return list(zip(points, points[1:]))


def crosses(segment, box):
    """Does a straight segment pass through a rectangle's interior?

    Liang-Barsky: clip the segment against each of the four edges and see
    whether any of it survives. Written for the general case rather than as an
    interval test per axis, because a vertical line has no width and an
    interval test on x quietly answers no. A line running exactly along an edge
    grazes rather than crosses, and `q <= 0` is what says so.
    """
    (x1, y1), (x2, y2) = segment
    bx, by, bw, bh = box
    dx, dy = x2 - x1, y2 - y1
    lo, hi = 0.0, 1.0
    for p, q in ((-dx, x1 - bx), (dx, bx + bw - x1), (-dy, y1 - by), (dy, by + bh - y1)):
        if p == 0:
            if q <= 0:
                return False
            continue
        t = q / p
        if p < 0:
            lo = max(lo, t)
        else:
            hi = min(hi, t)
    return lo < hi


def check_routing(doc, problems):
    """A line should not run through a box it has nothing to do with.

    Containers are exempt: an edge inside a sub-process is meant to be inside
    it, and an annotation's leader is meant to reach out of one.
    """
    box = boxes(doc)
    contains = {s.getAttribute('bpmnElement') for s in doc.getElementsByTagName('bpmndi:BPMNShape')
                if s.getAttribute('isExpanded') == 'true'}
    ends = {}
    for kind in ('sequenceFlow', 'association'):
        for line in doc.getElementsByTagNameNS(BPMN, kind):
            ends[line.getAttribute('id')] = {line.getAttribute('sourceRef'),
                                             line.getAttribute('targetRef')}

    for edge in doc.getElementsByTagName('bpmndi:BPMNEdge'):
        line = edge.getAttribute('bpmnElement')
        joined = ends.get(line, set())
        for segment in segments(edge):
            for eid, bounds in box.items():
                if eid in joined or eid in contains:
                    continue
                if crosses(segment, bounds):
                    problems.append(f'routing: "{line}" runs through "{eid}"')


def on_edge(point, box, slack=1.0):
    """Is a point on the boundary of a rectangle?"""
    px, py = point
    bx, by, bw, bh = box
    within_x = bx - slack <= px <= bx + bw + slack
    within_y = by - slack <= py <= by + bh + slack
    touches_x = abs(px - bx) <= slack or abs(px - (bx + bw)) <= slack
    touches_y = abs(py - by) <= slack or abs(py - (by + bh)) <= slack
    return (within_x and within_y) and (touches_x or touches_y)


def check_lines(doc, problems):
    """Diagram hygiene the eye is bad at and a reader notices anyway.

    Three rules, each of which has been broken here by hand at least once:
    a line starts and ends *on* the shapes it joins; every segment runs square;
    and no segment is a stub too short to read as anything but a hook.
    """
    box = boxes(doc)
    ends = {}
    for kind in ('sequenceFlow', 'association'):
        for line in doc.getElementsByTagNameNS(BPMN, kind):
            ends[line.getAttribute('id')] = (line.getAttribute('sourceRef'),
                                             line.getAttribute('targetRef'))

    for edge in doc.getElementsByTagName('bpmndi:BPMNEdge'):
        line = edge.getAttribute('bpmnElement')
        points = [(float(w.getAttribute('x')), float(w.getAttribute('y')))
                  for w in edge.getElementsByTagName('di:waypoint')]
        if len(points) < 2:
            problems.append(f'lines: "{line}" has fewer than two waypoints')
            continue

        source, target = ends.get(line, (None, None))
        for end, eid, point in (('starts', source, points[0]), ('ends', target, points[-1])):
            if eid in box and not on_edge(point, box[eid]):
                problems.append(f'lines: "{line}" {end} at {point[0]:.0f},{point[1]:.0f}, '
                                f'which is not on the edge of "{eid}"')

        for one, two in zip(points, points[1:]):
            if one[0] != two[0] and one[1] != two[1]:
                problems.append(f'lines: "{line}" has a diagonal segment '
                                f'{one[0]:.0f},{one[1]:.0f} to {two[0]:.0f},{two[1]:.0f}')
            elif abs(one[0] - two[0]) + abs(one[1] - two[1]) < 10:
                problems.append(f'lines: "{line}" has a stub segment shorter than 10px '
                                f'at {one[0]:.0f},{one[1]:.0f}')


def check_sizes(doc, problems):
    """One size per kind of thing. A task drawn 4px wider than its neighbour is
    invisible alone and reads as sloppiness in a row of six."""
    kinds = {}
    for node in doc.getElementsByTagNameNS(BPMN, '*'):
        if is_element(node) and node.localName != 'subProcess':
            kinds[node.getAttribute('id')] = node.localName
    kind_of = {k: ('event' if v.endswith('Event') else
                   'gateway' if v.endswith('Gateway') else 'task')
               for k, v in kinds.items()}

    seen = {}
    for eid, (_, _, w, h) in boxes(doc).items():
        kind = kind_of.get(eid)
        if not kind:
            continue
        seen.setdefault(kind, {}).setdefault((w, h), []).append(eid)

    for kind, sizes in seen.items():
        if len(sizes) > 1:
            said = '; '.join(f'{int(w)}x{int(h)} for {", ".join(sorted(ids))}'
                             for (w, h), ids in sorted(sizes.items()))
            problems.append(f'sizes: {kind}s are drawn at more than one size — {said}')


def check_operators(doc, problems):
    for op in doc.getElementsByTagName('spiff:serviceTaskOperator'):
        tid = op.parentNode.parentNode.getAttribute('id')
        params = {p.getAttribute('id') for p in op.getElementsByTagName('spiff:parameter')}
        if 'gives' not in params:
            problems.append(f'operators: "{tid}" does not say what it gives')
        if not op.getAttribute('resultVariable'):
            problems.append(f'operators: "{tid}" does not name what it gives')


def main(path):
    doc = minidom.parse(path)
    process = doc.getElementsByTagNameNS(BPMN, 'process')[0]
    data = {p.getAttribute('id') for p in doc.getElementsByTagNameNS(BPMN, 'property')}
    problems = []

    for scope_path, node in scopes(process):
        check_scope(scope_path, node, data, problems)
    check_geometry(doc, process, problems)
    check_routing(doc, problems)
    check_lines(doc, problems)
    check_sizes(doc, problems)
    check_operators(doc, problems)

    for problem in problems:
        print(problem)
    print(f'{len(problems)} problem(s)' if problems else 'no problems')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'workflows/pipeline.bpmn'))
