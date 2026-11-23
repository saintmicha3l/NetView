import {deviceIcon, drawIcons} from "./icons.js";

const NODE_W = 174;
const NODE_H = 66;
const PAN_KEYS = {ArrowLeft: [44, 0], ArrowRight: [-44, 0], ArrowUp: [0, 44], ArrowDown: [0, -44]};
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function interfaceVlanMode(port, vlan) {
  if (port.native === vlan) return "untagged";
  if (port.tagged.includes(vlan)) return "tagged";
  if (port.vlan === vlan) return "virtual";
  return "";
}

export function linkVlanMode(a, b, vlan) {
  const first = interfaceVlanMode(a, vlan);
  const second = interfaceVlanMode(b, vlan);
  if (first && first === second) return "carried";
  if ((first && second) ||
      (first === "untagged" && b.native) || (second === "untagged" && a.native) ||
      (first === "tagged" && b.mode === "access") || (second === "tagged" && a.mode === "access")) return "mismatch";
  return first || second ? "one-side" : "";
}

function roundedPolyline(points) {
  const path = new Path2D();
  path.moveTo(...points[0]);
  for (let index = 1; index < points.length - 1; index++) {
    const [x, y] = points[index];
    const [ax, ay] = points[index - 1];
    const [bx, by] = points[index + 1];
    const first = Math.hypot(ax - x, ay - y);
    const last = Math.hypot(bx - x, by - y);
    const radius = Math.min(13, first / 2, last / 2);
    if (!radius) {
      path.lineTo(x, y);
      continue;
    }
    path.lineTo(x + (ax - x) * radius / first, y + (ay - y) * radius / first);
    path.quadraticCurveTo(x, y, x + (bx - x) * radius / last, y + (by - y) * radius / last);
  }
  path.lineTo(...points.at(-1));
  return path;
}

function labelBox(context, text, x, y, accent, palette) {
  context.font = "650 11px Inter, system-ui, sans-serif";
  const width = context.measureText(text).width + 23;
  const left = x - width / 2;
  const top = y - 10;
  context.fillStyle = palette.surface;
  context.strokeStyle = palette.border;
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(left, top, width, 20, 5);
  context.fill();
  context.stroke();
  context.fillStyle = accent;
  context.beginPath();
  context.arc(left + 8, y, 2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = palette.text;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(text, left + 14, y + .5);
  return {left, top, width, height: 20};
}

function setupCanvas(canvas, width, height) {
  const scale = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const context = canvas.getContext("2d");
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

export class TopologyGraph {
  constructor(root, options) {
    this.root = root;
    this.options = options;
    root.style.setProperty("--node-width", `${NODE_W}px`);
    root.style.setProperty("--node-height", `${NODE_H}px`);
    const style = getComputedStyle(root);
    const color = key => style.getPropertyValue(`--${key}`).trim();
    this.palette = {canvas: color("canvas"), surface: color("recessed"), border: color("line-strong"),
      text: color("secondary"), accent: color("accent"), muted: color("muted"),
      mismatch: color("link-mismatch"),
      medium: Object.fromEntries(["copper", "fiber", "wireless", "virtual"].map(type => [type, color(`link-${type}`)])),
      vlan: Object.fromEntries(["blue", "violet", "teal", "amber", "rose", "slate"].map(type => [type, color(`vlan-${type}`)])),
    };
    this.devices = new Map(options.workspace.devices.map(device => [device.id, {...device}]));
    const ports = new Map(options.workspace.interfaces.map(port => [port.id, port]));
    this.edges = options.workspace.links.map(link => ({
      link, a: this.devices.get(ports.get(link.a).device), b: this.devices.get(ports.get(link.b).device),
      portA: ports.get(link.a), portB: ports.get(link.b),
    }));
    this.memberDevices = new Set(options.workspace.interfaces
      .filter(port => options.vlan && interfaceVlanMode(port, options.vlan.id)).map(port => port.device));
    this.view = options.view;
    this.selected = options.selected;
    this.layer = root.querySelector(".graph-layer");
    this.world = root.querySelector(".graph-world");
    this.minimap = root.querySelector(".graph-minimap canvas");
    this.nodes = new Map();
    this.paths = [];
    this.labelHits = [];

    for (const device of this.devices.values()) {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "node";
      node.dataset.device = device.id;
      node.dataset.kind = device.type;
      const type = options.deviceLabels[device.type];
      node.title = [device.name, type, device.platform, device.model, device.management, device.status].filter(Boolean).join(" · ");
      node.setAttribute("aria-label", [device.name, type, device.platform, device.status].filter(Boolean).join(", "));
      const glyph = document.createElement("span");
      glyph.className = `glyph device-glyph ${device.type}`;
      glyph.dataset.icon = deviceIcon[device.type];
      glyph.dataset.deviceArt = device.type;
      glyph.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "node-text";
      const name = document.createElement("strong");
      name.textContent = device.name;
      text.append(name);
      const description = device.platform || device.model;
      if (description || !device.management) {
        const detail = document.createElement("small");
        detail.textContent = description || type;
        text.append(detail);
      }
      if (device.management) {
        const address = document.createElement("small");
        address.className = "mono";
        address.textContent = device.management;
        text.append(address);
      }
      const state = document.createElement("span");
      state.className = `status-indicator ${device.status}`;
      state.setAttribute("aria-hidden", "true");
      node.append(glyph, text, state);
      this.world.append(node);
      this.nodes.set(device.id, node);
      this.place(device);
    }

    drawIcons(this.world);
    this.updateSelection(options.selected);
    this.rebuildPaths();
    this.observer = new ResizeObserver(() => {
      const {width, height} = this.root.getBoundingClientRect();
      if (!width || !height) return;
      if (this.view.adjusted && this.view.width) {
        this.view.x += (width - this.view.width) / 2;
        this.view.y += (height - this.view.height) / 2;
      }
      this.width = this.view.width = width;
      this.height = this.view.height = height;
      this.layer.style.width = `${width}px`;
      this.layer.style.height = `${height}px`;
      if (!this.view.adjusted) this.fit();
      else this.paint();
    });
    this.observer.observe(this.root);

    root.addEventListener("pointerdown", event => this.pointerDown(event));
    root.addEventListener("pointermove", event => this.pointerMove(event));
    root.addEventListener("pointerup", event => this.pointerEnd(event));
    root.addEventListener("pointercancel", event => this.pointerEnd(event, true));
    root.addEventListener("keydown", event => this.keyDown(event));
    root.addEventListener("click", event => {
      const target = event.target.closest("[data-device]");
      if (target && event.detail === 0) this.options.onSelect("devices", target.dataset.device);
      if (event.target.closest(".graph-minimap")) this.moveFromMinimap(event);
    });
    root.addEventListener("wheel", event => {
      if (event.target.closest(".graph-controls, .vlan-filter")) return;
      event.preventDefault();
      const {x, y} = this.position(event);
      this.zoom(Math.exp(clamp(-event.deltaY * .002, -.35, .35)), x, y);
    }, {passive: false});
  }

  destroy() {
    this.observer.disconnect();
  }

  keyDown(event) {
    if (!this.width || event.target !== this.root || event.altKey || event.ctrlKey || event.metaKey) return;
    const offset = PAN_KEYS[event.key];
    if (offset) {
      this.view.x += offset[0];
      this.view.y += offset[1];
      this.view.adjusted = true;
      this.paint();
    } else if (event.key === "+" || event.key === "=") this.zoom(1.2);
    else if (event.key === "-") this.zoom(1 / 1.2);
    else if (event.key.toLowerCase() === "f") this.fit();
    else return;
    event.preventDefault();
  }

  place(device) {
    const node = this.nodes.get(device.id);
    node.style.left = `${device.x}px`;
    node.style.top = `${device.y}px`;
  }

  updateSelection(selection) {
    this.selected = selection;
    for (const [id, node] of this.nodes) {
      const selected = selection?.kind === "devices" && selection.id === id;
      node.classList.toggle("selected", selected);
      node.classList.toggle("faded", Boolean(this.options.vlan && !this.memberDevices.has(id) && !selected));
      node.setAttribute("aria-pressed", String(selected));
    }
    this.paint();
  }

  bounds(padding = 0) {
    if (!this.devices.size) return {left: 0, top: 0, width: 500, height: 400};
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const device of this.devices.values()) {
      left = Math.min(left, device.x);
      right = Math.max(right, device.x);
      top = Math.min(top, device.y);
      bottom = Math.max(bottom, device.y);
    }
    return {left: left - NODE_W / 2 - padding, top: top - NODE_H / 2 - padding,
      width: right - left + NODE_W + padding * 2, height: bottom - top + NODE_H + padding * 2};
  }

  fit() {
    if (!this.width) return;
    const area = this.bounds(20);
    this.view.scale = clamp(Math.min(this.width / area.width, (this.height - 34) / area.height), .02, 1.22);
    this.view.x = (this.width - area.width * this.view.scale) / 2 - area.left * this.view.scale;
    this.view.y = (this.height - 19 - area.height * this.view.scale) / 2 - area.top * this.view.scale;
    this.view.adjusted = false;
    this.paint();
  }

  centerOn(id) {
    const device = this.devices.get(id);
    if (!device || !this.width) return;
    this.view.scale = Math.max(.95, this.view.scale);
    this.view.adjusted = true;
    this.view.x = this.width / 2 - device.x * this.view.scale;
    this.view.y = this.height / 2 - device.y * this.view.scale;
    this.paint();
  }

  zoom(factor, x = this.width / 2, y = this.height / 2) {
    if (!this.width) return;
    const scale = clamp(this.view.scale * factor, .02, 3);
    const ratio = scale / this.view.scale;
    this.view.x = x - (x - this.view.x) * ratio;
    this.view.y = y - (y - this.view.y) * ratio;
    this.view.scale = scale;
    this.view.adjusted = true;
    this.paint();
  }

  position(event) {
    const rect = this.root.getBoundingClientRect();
    return {x: event.clientX - rect.left, y: event.clientY - rect.top};
  }

  pointerDown(event) {
    if (this.drag || ![0, 1].includes(event.button) ||
        event.target.closest(".graph-controls, .graph-minimap, .vlan-filter, .graph-empty")) return;
    const position = this.position(event);
    const button = event.target.closest("[data-device]");
    const device = event.button === 0 ? this.devices.get(button?.dataset.device) : null;
    if (button) button.focus({preventScroll: true});
    this.drag = {pointer: event.pointerId, ...position, ox: this.view.x, oy: this.view.y,
      device, dx: device?.x, dy: device?.y, moved: false, middle: event.button === 1};
    this.root.setPointerCapture(event.pointerId);
  }

  pointerMove(event) {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    const position = this.position(event);
    const dx = position.x - drag.x;
    const dy = position.y - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (drag.device && this.options.isSaving()) return;
    drag.moved = true;
    this.root.classList.add("is-panning");
    if (drag.device) {
      drag.device.x = clamp(Math.round(drag.dx + dx / this.view.scale), -1_000_000, 1_000_000);
      drag.device.y = clamp(Math.round(drag.dy + dy / this.view.scale), -1_000_000, 1_000_000);
      this.place(drag.device);
      this.rebuildPaths();
    } else {
      this.view.x = drag.ox + dx;
      this.view.y = drag.oy + dy;
      this.view.adjusted = true;
    }
    this.paint();
  }

  pointerEnd(event, cancelled = false) {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    this.drag = null;
    this.root.classList.remove("is-panning");
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
    if (cancelled) {
      if (drag.device) this.restore(drag.device.id, drag.dx, drag.dy);
      return;
    }
    if (drag.middle) return;
    if (drag.device) {
      this.options.onSelect("devices", drag.device.id);
      if (drag.moved) this.options.onMove(drag.device.id, drag.device.x, drag.device.y, drag.dx, drag.dy);
    } else if (!drag.moved) {
      const edge = this.hit(drag.x, drag.y);
      this.options.onSelect(edge ? "links" : "", edge?.link.id);
    }
  }

  restore(id, x, y) {
    const device = this.devices.get(id);
    if (!device) return;
    Object.assign(device, {x, y});
    this.place(device);
    this.rebuildPaths();
    this.paint();
  }

  rebuildPaths() {
    const bearings = new Map();
    const descriptors = [];
    // Distribute parallel wires along the same side of each device.
    const attach = (device, other, side, entry, end) => {
      const key = `${device.id}:${side}`;
      if (!bearings.has(key)) bearings.set(key, []);
      bearings.get(key).push({device, other, side, entry, end});
    };
    for (const [index, edge] of this.edges.entries()) {
      const d = {edge, index};
      descriptors.push(d);
      const {a, b} = edge;
      if (Math.abs(a.y - b.y) >= NODE_H + 9) {
        attach(a, b, a.y < b.y ? "bottom" : "top", d, "start");
        attach(b, a, b.y < a.y ? "bottom" : "top", d, "end");
      } else {
        attach(a, b, a.x <= b.x ? "right" : "left", d, "start");
        attach(b, a, b.x >= a.x ? "left" : "right", d, "end");
      }
    }
    for (const group of bearings.values()) {
      const vertical = ["top", "bottom"].includes(group[0].side);
      const axis = vertical ? "x" : "y";
      group.sort((a, b) => a.other[axis] - b.other[axis] || a.entry.index - b.entry.index);
      for (const [index, {device, side, entry, end}] of group.entries()) {
        const spacing = Math.min(vertical ? 18 : 9, (vertical ? 102 : 36) / group.length);
        const offset = (index - (group.length - 1) / 2) * spacing;
        const x = device.x + (vertical ? offset : (side === "right" ? 1 : -1) * NODE_W / 2);
        const y = device.y + (vertical ? (side === "bottom" ? 1 : -1) * NODE_H / 2 : offset);
        entry[end] = [x, y];
        entry.vertical = vertical;
        if (end === "start") entry.offset = offset;
      }
    }

    this.paths = descriptors.map(({edge, start, end, vertical, offset}) => {
      const [ax, ay] = start;
      const [bx, by] = end;
      if (edge.a.id === edge.b.id) {
        const path = roundedPolyline([start, [ax + 29, ay], [ax + 29, ay - 43],
          [bx - 29, by - 43], [bx - 29, by], end]);
        return {edge, path, start, end, labelX: (ax + bx) / 2, labelY: Math.min(ay, by) - 43};
      }
      if (vertical) {
        const mid = (ay + by) / 2 + offset * .48;
        return {edge, path: roundedPolyline([start, [ax, mid], [bx, mid], end]), start, end,
          labelX: Math.abs(ax - bx) >= 68 ? bx + (bx < ax ? 4 : -4) : (ax + bx) / 2 + 38,
          labelY: Math.abs(ax - bx) >= 68 ? (mid + by) / 2 : mid};
      }
      const mid = (ax + bx) / 2 + offset * .48;
      return {edge, path: roundedPolyline([start, [mid, ay], [mid, by], end]), start, end,
        labelX: mid, labelY: (ay + by) / 2 - 9};
    });
  }

  hit(x, y) {
    const worldX = (x - this.view.x) / this.view.scale;
    const worldY = (y - this.view.y) / this.view.scale;
    const label = this.labelHits.findLast(({bounds}) =>
      worldX >= bounds.left && worldX <= bounds.left + bounds.width &&
      worldY >= bounds.top && worldY <= bounds.top + bounds.height);
    if (label) return label.edge;
    const context = this.layer.getContext("2d");
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.lineWidth = 13 / this.view.scale;
    const matching = this.paths.find(item => context.isPointInStroke(item.path, worldX, worldY));
    context.restore();
    return matching?.edge;
  }

  paint() {
    if (!this.width) return;
    const {x, y, scale} = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.root.style.setProperty("--grid-x", `${x % 90}px`);
    this.root.style.setProperty("--grid-y", `${y % 90}px`);
    const zoomValue = this.root.querySelector(".zoom-value");
    if (zoomValue) zoomValue.textContent = `${Math.round(scale * 100)}%`;
    const context = setupCanvas(this.layer, this.width, this.height);
    context.translate(x, y);
    context.scale(scale, scale);
    context.lineCap = "round";
    context.lineJoin = "round";
    const vlan = this.options.vlan;
    this.labelHits = [];
    const labels = [];
    for (const {edge, path, start, end, labelX, labelY} of this.paths) {
      const {link, portA, portB} = edge;
      const selected = this.selected?.kind === "links" && this.selected.id === link.id;
      const adjacent = this.selected?.kind === "devices" && (this.selected.id === edge.a.id || this.selected.id === edge.b.id);
      const overlay = vlan && linkVlanMode(portA, portB, vlan.id);
      const visible = selected || !vlan || overlay === "carried" || overlay === "mismatch";
      const inactive = link.status !== "active" || !portA.enabled || !portB.enabled;
      const accent = selected ? this.palette.accent : !vlan ? this.palette.medium[link.type] :
        overlay === "carried" ? this.palette.vlan[vlan.color] : overlay === "mismatch" ? this.palette.mismatch : this.palette.muted;
      const emphasis = selected || overlay === "carried" || (!vlan && adjacent);
      context.strokeStyle = accent;
      context.setLineDash(inactive || overlay === "mismatch" || link.type === "wireless" ? [5, 5] : link.type === "virtual" ? [2, 4] : []);
      if (emphasis && !inactive) {
        context.globalAlpha = selected ? .23 : .15;
        context.lineWidth = selected ? 8 : 5.5;
        context.stroke(path);
      }
      context.globalAlpha = selected ? 1 : !visible ? .26 : inactive ? .57 : .98;
      context.lineWidth = selected ? 2.8 : emphasis ? 2.1 : 1.65;
      context.stroke(path);
      context.setLineDash([]);
      if (visible) {
        context.fillStyle = this.palette.canvas;
        context.lineWidth = 1.35;
        for (const p of [start, end]) {
          context.beginPath();
          context.arc(p[0], p[1], selected ? 4.3 : 3.5, 0, Math.PI * 2);
          context.fill();
          context.stroke();
        }
      }
      if (visible && scale > .58) {
        const label = overlay === "mismatch" ? "VLAN mismatch" : (link.label || link.speed);
        if (label) labels.push({edge, labelX, labelY, label, accent});
      }
    }
    context.globalAlpha = 1;
    for (const {edge, labelX, labelY, label, accent} of labels) {
      const bounds = labelBox(context, label.length > 23 ? `${label.slice(0, 22)}…` : label,
        labelX, labelY, accent, this.palette);
      this.labelHits.push({edge, bounds});
    }
    this.paintMinimap();
  }

  paintMinimap() {
    if (!this.minimap || !this.minimap.clientWidth) return;
    const width = this.minimap.clientWidth;
    const height = this.minimap.clientHeight;
    const context = setupCanvas(this.minimap, width, height);
    const area = this.bounds(27);
    const scale = Math.min(width / area.width, height / area.height);
    const left = (width - area.width * scale) / 2 - area.left * scale;
    const top = (height - area.height * scale) / 2 - area.top * scale;
    this.miniView = {left, top, scale};
    context.fillStyle = this.palette.canvas;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#536885";
    for (const {a, b} of this.edges) {
      context.beginPath();
      context.moveTo(left + a.x * scale, top + a.y * scale);
      context.lineTo(left + b.x * scale, top + b.y * scale);
      context.stroke();
    }
    for (const device of this.devices.values()) {
      context.fillStyle = this.selected?.id === device.id ? this.palette.accent : "#61799d";
      const w = Math.max(2, NODE_W * scale);
      const h = Math.max(2, NODE_H * scale);
      context.beginPath();
      context.roundRect(left + device.x * scale - w / 2, top + device.y * scale - h / 2, w, h, 1.4);
      context.fill();
    }
    const ratio = scale / this.view.scale;
    const x = left - this.view.x * ratio;
    const y = top - this.view.y * ratio;
    context.fillStyle = "#8aebb826";
    context.strokeStyle = this.palette.accent;
    context.fillRect(x, y, this.width * ratio, this.height * ratio);
    context.strokeRect(x, y, this.width * ratio, this.height * ratio);
  }

  moveFromMinimap(event) {
    if (event.detail === 0) return this.fit();
    if (!this.miniView) return;
    const {left, top, scale} = this.miniView;
    const bounds = this.minimap.getBoundingClientRect();
    this.view.x = this.width / 2 - (event.clientX - bounds.left - left) / scale * this.view.scale;
    this.view.y = this.height / 2 - (event.clientY - bounds.top - top) / scale * this.view.scale;
    this.view.adjusted = true;
    this.paint();
  }
}
