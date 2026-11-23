import {deviceIcon, drawIcons} from "./icons.js";
import {TopologyGraph, interfaceVlanMode, linkVlanMode} from "./graph.js";
import {lookupRoute, readWorkspace, writeWorkspace} from "./workspace-store.js";

const pages = {
  topology: {nav: "Topology", title: "Network topology", intro: "Map how your devices, interfaces, and network segments connect."},
  devices: {nav: "Devices", title: "Devices", single: "device", icon: "device", intro: "Inventory physical systems, virtual hosts, and network equipment."},
  links: {nav: "Connections", title: "Connections", single: "connection", icon: "link", intro: "Document the interfaces at both ends of each wired, wireless, or virtual connection."},
  vlans: {nav: "VLANs", title: "VLANs", single: "VLAN", icon: "layers", intro: "Group interfaces into segments and inspect how each VLAN crosses the network."},
  prefixes: {nav: "IP Prefixes", title: "IP prefixes", single: "prefix", icon: "grid", intro: "Document IPv4 and IPv6 subnets, gateways, and routing contexts."},
  routes: {nav: "Routes", title: "Routes", single: "route", icon: "route", intro: "Record forwarding paths and look up which routes match a destination."},
  interfaces: {nav: "Interfaces", single: "interface", icon: "port"},
};
const kinds = {
  cloud: "Internet / cloud", modem: "Modem / ONT", router: "Router", firewall: "Firewall", switch: "Switch",
  "patch-panel": "Patch panel", wireless: "Access point", server: "Server", "mini-pc": "Mini PC",
  sbc: "Single-board computer", hypervisor: "Hypervisor", vm: "Virtual machine", container: "Container",
  service: "Service", storage: "NAS / storage", client: "Client", camera: "IP camera", iot: "IoT", other: "Other",
};
const presetGroups = [
  ["Hardware and virtual devices", [
    ["Mini PC", "mini-pc"], ["Single-board computer", "sbc"], ["Modem / ONT", "modem"],
    ["Patch panel", "patch-panel"], ["NAS appliance", "storage"], ["IP camera", "camera"],
    ["Virtual machine", "vm"], ["Container", "container"],
  ]],
  ["Routing and firewalls", [
    ["OPNsense", "firewall"], ["pfSense CE", "firewall"], ["OpenWrt", "router"], ["VyOS", "router"],
    ["IPFire", "firewall"], ["FRRouting", "router"], ["Open vSwitch", "switch"],
  ], true],
  ["Compute and virtualization", [
    ["Proxmox VE", "hypervisor"], ["XCP-ng", "hypervisor"], ["KVM / libvirt", "hypervisor"],
    ["Debian", "server"], ["Ubuntu Server", "server"], ["Raspberry Pi OS", "sbc"],
    ["Docker Engine", "server"], ["Podman", "server"], ["K3s", "server"], ["LXC", "container"],
  ], true],
  ["Storage and backups", [
    ["TrueNAS", "storage"], ["OpenMediaVault", "storage"], ["Proxmox Backup Server", "server"],
  ], true],
  ["Self-hosted services", [
    ["Home Assistant", "service"], ["Pi-hole", "service"], ["AdGuard Home", "service"], ["WireGuard", "service"],
    ["Jellyfin", "service"], ["Nextcloud", "service"], ["Caddy", "service"], ["Grafana", "service"],
  ], true],
];
const devicePresets = new Map(presetGroups.flatMap(([, entries, software]) =>
  entries.map(([name, type]) => [name, {type, platform: software ? name : ""}])));
const states = {online: "Online", offline: "Offline", planned: "Planned", unknown: "Unknown"};
const modes = {routed: "Routed", access: "Access", trunk: "Trunk", virtual: "Virtual"};
const media = {copper: "Copper", fiber: "Fiber", wireless: "Wireless", virtual: "Virtual"};
const linkStates = {active: "Active", down: "Down", planned: "Planned"};
const protocols = {connected: "Connected", static: "Static", bgp: "BGP", ospf: "OSPF", rip: "RIP", other: "Other"};
const distances = {connected: 0, static: 1, bgp: 20, ospf: 110, rip: 120, other: 255};
const colors = {blue: "Blue", violet: "Violet", teal: "Teal", amber: "Amber", rose: "Rose", slate: "Slate"};

const main = document.querySelector("#main");
const dialog = document.querySelector("#dialog");
const fileInput = document.querySelector("#import-file");
const toast = document.querySelector("#toast");
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

let workspace;
let revision;
let index;
let byDevice;
let byPort;
let page;
let graph;
let view = {};
let selection = null;
let inspectorPage = "overview";
let mapExpanded = false;
let overlay = false;
let vlanId = "";
let lastFilter = "";
let routeFilter = "";
let saving = false;
let dirtyConflict = false;
let pendingFocus;
let modalReady;
let toastTimer;

const esc = value => String(value ?? "").replace(/[&<>"']/g, character =>
  ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[character]);
const icon = (name, extra = "") => `<span class="${extra}" data-icon="${name}" aria-hidden="true"></span>`;
const glyph = (name, color = "") => icon(name, `glyph ${color}`);
const deviceGlyph = type => `<span class="glyph device-glyph ${esc(type)}" data-icon="${deviceIcon[type]}" data-device-art="${esc(type)}" aria-hidden="true"></span>`;
const value = (text, monospace = false) => text ? `<span class="${monospace ? "mono" : ""}">${esc(text)}</span>` : '<span class="muted">—</span>';
const numberLabel = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
const modeVlanIds = port => [port.native, ...port.tagged, port.vlan].filter(Boolean);
const list = name => workspace[name];
const row = (kind, id) => index[kind].get(id);
const ports = id => byDevice.get(id) || [];
const portLinks = id => byPort.get(id) || [];
const status = state => `<span class="status-pill ${state}"><i class="status-indicator ${state}"></i>${states[state] || linkStates[state]}</span>`;
const chip = (label, color = "") => `<span class="chip ${color}">${esc(label)}</span>`;
const vlanChip = vlan => vlan ? chip(`VLAN ${vlan.vid}`, vlan.color) : '<span class="muted">—</span>';
const deviceName = id => row("devices", id)?.name || "Unknown device";
const endpoint = id => {
  const port = row("interfaces", id);
  return port ? `${deviceName(port.device)} · ${port.name}` : "";
};
const data = attributes => Object.entries(attributes).map(([key, val]) => ` data-${key}="${esc(val)}"`).join("");

function button(label, action, options = {}) {
  const {icon: name, style = "", attrs = {}, iconOnly = false, pressed} = options;
  return `<button type="button" class="${iconOnly ? "icon-button" : "button"} ${style}"${data({action, ...attrs})}${pressed === undefined ? "" : ` aria-pressed="${pressed}"`}
    ${iconOnly ? `aria-label="${esc(label)}" title="${esc(label)}"` : ""}>${name ? icon(name) : ""}${iconOnly ? "" : esc(label)}</button>`;
}

function message(text, error = false) {
  toast.textContent = text;
  toast.classList.toggle("error", error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 6500 : 3200);
}

function saveState(label, state) {
  document.querySelector("#save-status").textContent = label;
  document.querySelector("#local-dot").className = `local-dot ${state}`;
}

function acceptWorkspace(result) {
  ({workspace, revision} = result);
  index = Object.fromEntries(Object.keys(pages).filter(key => key !== "topology").map(key =>
    [key, new Map(workspace[key].map(item => [item.id, item]))]));
  byDevice = new Map();
  byPort = new Map();
  for (const port of list("interfaces")) {
    if (!byDevice.has(port.device)) byDevice.set(port.device, []);
    ports(port.device).push(port);
  }
  for (const link of list("links")) {
    for (const id of [link.a, link.b]) {
      if (!byPort.has(id)) byPort.set(id, []);
      portLinks(id).push(link);
    }
  }
  if (selection && !row(selection.kind, selection.id)) selection = null;
  if (vlanId && !row("vlans", vlanId)) vlanId = "";
  if (routeFilter && !row("devices", routeFilter)) routeFilter = "";
  document.querySelector("#workspace-name").textContent = workspace.name;
}

async function save(next, expectedRevision = revision) {
  if (saving) throw new Error("A save is in progress. Try again shortly.");
  if (dirtyConflict) throw new Error("Another tab changed this workspace. Reload this page to continue.");
  if (expectedRevision !== revision) throw new Error("The workspace changed while this dialog was open. Reopen it and try again.");
  saving = true;
  saveState("Saving…", "");
  try {
    acceptWorkspace(await writeWorkspace(expectedRevision, next));
    saveState("All changes saved", "saved");
  } catch (error) {
    if (error.status === 409) dirtyConflict = true;
    saveState(dirtyConflict ? "Reload to continue" : (error.status === 400 ? "All changes saved" : "Save failed"), dirtyConflict || error.status !== 400 ? "error" : "saved");
    throw error;
  } finally {
    saving = false;
  }
}

function heading(title, intro, actions) {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${intro}</p></div><div class="toolbar">${actions}</div></div>`;
}

function summaryChart(kind, series) {
  const label = series.map(([name, count]) => `${name} ${count}`).join(", ");
  const counts = series.filter(([, count]) => count > 0);
  const chartAttrs = `role="img" aria-label="${esc(label)}" title="${esc(label)}"`;
  if (kind === "ring") {
    const total = counts.reduce((sum, [, count]) => sum + count, 0);
    let start = 0;
    const bands = counts.map(([, count, color]) => {
      const end = start + count / total * 360;
      const stop = counts.length > 1 ? Math.max(start, end - 2) : end;
      const band = `var(--chart-${color}) ${start}deg ${stop}deg, transparent ${stop}deg ${end}deg`;
      start = end;
      return band;
    });
    const fill = bands.length ? ` style="--ring:conic-gradient(from -3deg, ${bands.join(",")})"` : "";
    return `<div class="summary-chart summary-ring" ${chartAttrs}${fill}></div>`;
  }
  const spread = kind === "swatches" ? counts : series;
  const peak = Math.max(1, ...spread.map(([, count]) => count));
  return `<div class="summary-chart summary-${kind}" ${chartAttrs}>${spread.map(([, count, color]) =>
    `<i${count ? "" : ' class="zero"'} style="--series:var(--chart-${color});--scale:${(count / peak).toFixed(3)}"></i>`).join("")}</div>`;
}

function metrics() {
  const devices = list("devices");
  const links = list("links");
  const vlans = list("vlans");
  const routes = list("routes");
  const online = devices.filter(device => device.status === "online").length;
  const offline = devices.filter(device => device.status === "offline").length;
  const wired = links.filter(link => ["copper", "fiber"].includes(link.type)).length;
  const wireless = links.filter(link => link.type === "wireless").length;
  const domains = new Set(vlans.map(vlan => vlan.domain.toLowerCase())).size;
  const routers = new Set(routes.map(route => route.device)).size;
  const defaults = routes.filter(route => route.destination.endsWith("/0")).length;
  const ipv6 = routes.filter(route => route.destination.includes(":") && !route.destination.endsWith("/0")).length;
  const cards = [
    ["devices", "Devices", devices.length, `${online} online · ${offline} offline`, "blue", summaryChart("ring", [
      ["Online", online, "teal"], ["Offline", offline, "slate"],
      ["Planned", devices.filter(device => device.status === "planned").length, "amber"],
      ["Unknown", devices.filter(device => device.status === "unknown").length, "blue"],
    ])],
    ["links", "Connections", links.length, `${wired} wired · ${wireless} wireless`, "teal", summaryChart("bars",
      Object.entries(media).map(([type, name], i) => [name, links.filter(link => link.type === type).length,
        ["blue", "violet", "teal", "slate"][i]]))],
    ["vlans", "VLANs", vlans.length, numberLabel(domains, "VLAN domain"), "violet", summaryChart("swatches",
      Object.entries(colors).map(([id, name]) => [name, vlans.filter(vlan => vlan.color === id).length, id]))],
    ["routes", "Routes", routes.length, numberLabel(routers, "device with routes", "devices with routes"), "amber",
      summaryChart("bars", [["Default", defaults, "amber"], ["IPv4 specific", routes.length - defaults - ipv6, "violet"],
        ["IPv6 specific", ipv6, "teal"]])],
  ];
  return `<section class="metrics" aria-label="Workspace totals">${cards.map(([kind, label, total, detail, color, chart]) =>
    `<a class="metric ${color}" href="#${kind}">${glyph(pages[kind].icon, color)}
      <div class="metric-data"><div class="metric-top">${label}<strong class="metric-value">${total}</strong></div><small>${detail}</small></div>
      ${chart}</a>`).join("")}</section>`;
}

function topology() {
  const vlans = [...list("vlans")].sort((a, b) => a.vid - b.vid);
  if (overlay && !vlanId && vlans.length) vlanId = vlans[0].id;
  const vlan = overlay && row("vlans", vlanId);
  return `<div class="topology-heading"><div><p class="workspace-caption">${icon("workspace")}${esc(workspace.name)}</p>
      <h1>${pages.topology.title}</h1></div><div class="toolbar">${button("Export", "export", {icon: "download"})}
      ${button("Add device", "edit", {icon: "plus", style: "primary", attrs: {kind: "devices"}})}</div></div>` +
    metrics() + `<div class="panel topology-layout${mapExpanded ? " is-expanded" : ""}">
      <section class="map-panel" aria-label="Topology map">
      <div class="panel-head graph-head"><div class="graph-head-title">${icon("topology")}<h2>Topology map</h2></div>
      <div class="toolbar">
        <div class="segmented" aria-label="Map view">
          <button type="button" data-action="physical" aria-pressed="${!overlay}">${icon("topology")}Physical</button>
          <button type="button" data-action="overlay" aria-pressed="${overlay}">${icon("layers")}VLAN overlay</button>
        </div>
        ${button("Connect", "edit", {icon: "link", style: "small", attrs: {kind: "links"}})}
        ${button("Auto-arrange", "layout", {icon: "layout", style: "small", iconOnly: true})}
        ${button(mapExpanded ? "Exit expanded map" : "Expand map", "expand-map",
          {icon: mapExpanded ? "collapse" : "expand", style: "small", iconOnly: true, pressed: mapExpanded})}
      </div></div>
      <div id="graph" class="graph" role="region" tabindex="0"
        aria-label="Interactive topology. Use the arrow keys to pan, plus or minus to zoom, or F to fit the map.">
        <canvas class="graph-layer" aria-hidden="true"></canvas><div class="graph-world"></div>
        ${overlay ? (vlans.length ? `<div class="vlan-filter"><label>VLAN <select id="vlan-picker" aria-label="VLAN to highlight">${selectOptions(vlans.map(v => [v.id, `${v.vid} · ${v.name} / ${v.domain}`]), vlanId)}</select></label></div>` :
          `<div class="vlan-filter">${button("Create a VLAN", "edit", {icon: "plus", style: "subtle small", attrs: {kind: "vlans"}})}</div>`) : ""}
        ${list("devices").length ? `
          <div class="graph-controls" aria-label="Map controls">
            ${button("Zoom out", "zoom-out", {icon: "minus", iconOnly: true})}<span class="zoom-value">100%</span>
            ${button("Zoom in", "zoom-in", {icon: "plus", iconOnly: true})}
            ${button("Fit map to view", "fit", {icon: "fit", iconOnly: true})}
          </div>
          <button type="button" class="graph-minimap" aria-label="Recenter map overview" title="Click to center this area"><canvas aria-hidden="true"></canvas></button>` :
          `<div class="graph-empty">${glyph("topology")}<h3>Build your network map</h3><p>Start with a router, switch, or any other device.</p>
            ${button("Add your first device", "edit", {icon: "plus", style: "primary", attrs: {kind: "devices"}})}
            ${button("Getting started", "guide", {style: "subtle"})}</div>`}
      </div>
      <div class="graph-footer">${vlan ? `<div class="graph-legend"><span>${vlanChip(vlan)} ${esc(vlan.name)}</span><span><i class="legend-line mismatch"></i>VLAN mismatch</span></div>` :
        '<div class="graph-legend"><span><i class="legend-line"></i>Copper</span><span><i class="legend-line fiber"></i>Fiber</span><span><i class="legend-line wireless"></i>Wireless</span><span><i class="legend-line virtual"></i>Virtual</span></div>'}
        <span class="graph-hint">Drag to pan · Scroll to zoom</span>
        ${button("Inspector", "jump-inspector", {icon: "inspect", style: "small mobile-inspector"})}</div>
      </section>
      <aside class="inspector" id="inspector" aria-label="Selection details" tabindex="-1"></aside></div>`;
}

function detailList(items) {
  return `<dl class="detail-list">${items.map(([label, html]) => `<div><dt>${label}</dt><dd>${html}</dd></div>`).join("")}</dl>`;
}

function renderInspector() {
  const parent = document.querySelector("#inspector");
  if (!parent) return;
  const kind = selection?.kind;
  const record = kind && row(kind, selection.id);
  const edit = record ? button("Edit", "edit", {icon: "edit", style: "small", attrs: {kind, id: record.id}}) : "";
  const clear = record ? button("Clear selection", "clear", {icon: "close", style: "small", iconOnly: true}) : "";
  parent.innerHTML = `<div class="panel-head inspector-head"><div class="graph-head-title">${icon("inspect")}
    <h2>${kind === "links" ? "Connection details" : "Inspector"}</h2></div>
    <div class="toolbar">${button("Back to map", "jump-map", {icon: "topology", style: "small mobile-inspector", iconOnly: true})}${edit}${clear}</div></div>` +
    `<div class="inspector-body">${kind === "devices" && record ? deviceDetail(record) : kind === "links" && record ? linkDetail(record) :
      `<div class="inspector-empty">${glyph("topology")}<strong>Nothing selected</strong>
        <p>Select a device or connection on the map to inspect it.</p></div>`}</div>`;
  drawIcons(parent);
}

function deviceDetail(device) {
  const interfaces = ports(device.id);
  const memberships = new Map();
  for (const port of interfaces) {
    for (const vlanId of modeVlanIds(port)) memberships.set(vlanId, (memberships.get(vlanId) || 0) + 1);
  }
  const vlans = [...memberships.keys()].map(id => row("vlans", id)).sort((a, b) => a.vid - b.vid);
  const tabs = [["overview", "Overview"], ["ports", "Ports", interfaces.length], ["vlans", "VLANs", vlans.length]];
  const panel = inspectorPage === "ports" ? devicePorts(device, interfaces) : inspectorPage === "vlans" ?
    deviceVlans(vlans, memberships) : deviceOverview(device, interfaces);
  return `<div class="inspector-main inspector-hero">
    <div class="inspector-identity">${deviceGlyph(device.type)}<div><strong>${esc(device.name)}</strong>
      <small>${esc(device.platform || kinds[device.type])}</small></div></div>
    <div class="inspector-identity-meta">${status(device.status)}
      ${device.management ? `<span class="inspector-address mono">${esc(device.management)}</span>` : ""}</div>
    </div><div class="inspector-tabs" aria-label="Device details">${tabs.map(([key, label, count]) =>
      `<button type="button"${data({action: "inspector-page", tab: key})} aria-pressed="${inspectorPage === key}">
        ${label}${count === undefined ? "" : `<span>${count}</span>`}</button>`).join("")}</div>${panel}`;
}

function deviceOverview(device, interfaces) {
  const neighbors = new Map();
  for (const port of interfaces) {
    for (const link of portLinks(port.id)) {
      const peer = row("interfaces", link.a === port.id ? link.b : link.a);
      if (peer.device !== device.id && !neighbors.has(peer.device)) {
        neighbors.set(peer.device, {port, peer, link});
      }
    }
  }
  const details = [["Type", value(kinds[device.type])], ["Model", value(device.model)], ["Location", value(device.site)]];
  if (device.platform) details.splice(1, 0, ["Platform", value(device.platform)]);
  return `<div class="inspector-section overview-details"><h3>Device information</h3>${detailList(details)}</div>
    <div class="inspector-section"><div class="section-heading"><h3>Neighbors <span class="section-count">${neighbors.size}</span></h3></div>
      <div class="port-list">${[...neighbors.values()].slice(0, 4).map(({port, peer, link}) =>
        `<button class="port-row inspector-item" type="button"${data({action: "focus-link", id: link.id})}>
          ${deviceGlyph(row("devices", peer.device).type)}<span><strong>${esc(deviceName(peer.device))}</strong><small>${esc(port.name)} · ${esc(peer.name)}</small></span>
          ${icon("chevron", "inspector-chevron")}</button>`).join("") ||
        '<p class="notes">Add an interface and connect it to show its neighbors.</p>'}
      </div>
      ${neighbors.size > 4 ? button("See all ports", "inspector-page", {style: "subtle small", attrs: {tab: "ports"}}) : ""}
    </div>
    <div class="inspector-section inspector-actions">${button("Device routes", "device-routes", {icon: "route", style: "subtle small", attrs: {id: device.id}})}</div>
    ${device.notes ? `<div class="inspector-section"><div class="section-heading"><h3>Notes</h3></div><p class="notes">${esc(device.notes)}</p></div>` : ""}`;
}

function devicePorts(device, interfaces) {
  const portRows = interfaces.map(port => {
    const first = row("vlans", port.native || port.tagged[0] || port.vlan);
    const links = portLinks(port.id);
    const link = links[0];
    const description = !port.enabled ? "Disabled" :
      link ? endpoint(link.a === port.id ? link.b : link.a) : port.addresses[0] || "Unconnected";
    return `<button type="button" class="port-row inspector-item"${data({action: "port-detail", id: port.id})}>
      ${icon("port", "inspector-item-icon")}<span><strong>${esc(port.name)}</strong><small>${esc(description)}${port.enabled && links.length > 1 ? ` + ${links.length - 1}` : ""}</small></span>
      ${port.mode === "trunk" ? chip("Trunk", "violet") : first ? vlanChip(first) : chip(modes[port.mode])}</button>`;
  }).join("");
  return `<div class="inspector-section"><div class="section-heading"><h3>Interfaces</h3>
      ${button("Add interface", "edit", {icon: "plus", style: "small", attrs: {kind: "interfaces", device: device.id}})}</div>
      <div class="port-list">${portRows || '<p class="notes">Add an interface to connect this device.</p>'}</div>
      ${interfaces.length ? `<div class="inspector-footer">${button("Open interface table", "ports", {icon: "table", style: "subtle small", attrs: {id: device.id}})}</div>` : ""}
    </div>`;
}

function deviceVlans(vlans, memberships) {
  const rows = vlans.map(vlan => {
    const count = memberships.get(vlan.id);
    return `<button type="button" class="port-row inspector-item"${data({action: "show-vlan", id: vlan.id})}>
      ${glyph("layers", vlan.color)}<span><strong>${esc(vlan.name)}</strong><small>${esc(vlan.domain)} · ${numberLabel(count, "port")}</small></span>
      ${vlanChip(vlan)}</button>`;
  });
  return `<div class="inspector-section"><div class="section-heading"><h3>VLAN membership</h3></div>
    <div class="port-list">${rows.join("") || '<p class="notes">Assign VLANs to this device’s interfaces to see them here.</p>'}</div></div>`;
}

function linkDetail(link) {
  const first = row("interfaces", link.a);
  const second = row("interfaces", link.b);
  const memberships = [...new Set([first, second].flatMap(modeVlanIds))];
  const matches = memberships.filter(id => linkVlanMode(first, second, id) === "carried");
  const issues = memberships.filter(id => linkVlanMode(first, second, id) === "mismatch");
  return `<div class="inspector-main inspector-hero"><div class="inspector-identity">${glyph("link", "teal")}<div>
    <strong>${esc(link.label || media[link.type] + " link")}</strong><small>${media[link.type]}</small></div></div>
    <div class="inspector-identity-meta">${status(link.status)}${link.speed ? `<span class="inspector-address mono">${esc(link.speed)}</span>` : ""}</div>
    </div>
    <div class="inspector-section"><div class="section-heading"><h3>Endpoints</h3></div><div class="endpoint-stack ${link.type}">
    ${[first, second].map(port => {
      const device = row("devices", port.device);
      return `<button type="button" class="port-row inspector-item"${data({action: "focus-device", id: port.device})}>
        ${deviceGlyph(device.type)}<span><strong>${esc(device.name)}</strong><small>${esc(port.name)}</small></span>
        ${icon("chevron", "inspector-chevron")}</button>`;
    }).join("")}
    </div></div>
    <div class="inspector-section"><div class="section-heading"><h3>VLANs carried</h3></div><div class="chip-list">
      ${matches.map(id => vlanChip(row("vlans", id))).join("") || '<span class="notes">No matching VLAN assignments on both endpoints.</span>'}
    </div>${issues.length ? `<p class="notes"><strong>Configuration mismatch</strong> · ${issues.map(id => vlanChip(row("vlans", id))).join(" ")}</p>` : ""}</div>
    ${link.notes ? `<div class="inspector-section"><div class="section-heading"><h3>Notes</h3></div><p class="notes">${esc(link.notes)}</p></div>` : ""}`;
}

const tableHeaders = {
  devices: ["Device", "Type", "Management IP", "Location", "Status", "Interfaces"],
  links: ["Connection", "Endpoint A", "Endpoint B", "Medium", "Status"],
  vlans: ["VLAN", "Name", "Domain", "Interfaces", "Prefixes"],
  prefixes: ["Prefix", "Name", "VRF", "Gateway", "VLAN"],
  routes: ["Destination", "Device", "VRF", "Protocol", "Next hop / interface", "Distance", "Metric"],
};

function rowButton(label, action, attrs, badge = "") {
  return `<button class="row-name" type="button"${data({action, ...attrs})}>${badge}${esc(label)}</button>`;
}

function tableCells(kind, item) {
  const edit = label => rowButton(label, "edit", {kind, id: item.id});
  switch (kind) {
    case "devices": {
      const description = item.platform || item.model;
      return [rowButton(item.name, "focus-device", {id: item.id}, deviceGlyph(item.type)),
        kinds[item.type] + (description ? `<small class="table-meta">${esc(description)}</small>` : ""),
        value(item.management, true), value(item.site), status(item.status),
        rowButton(numberLabel(ports(item.id).length, "interface"), "ports", {id: item.id})];
    }
    case "links":
      return [rowButton(item.label || media[item.type] + " link", "focus-link", {id: item.id}),
        esc(endpoint(item.a)), esc(endpoint(item.b)), value(media[item.type]) + (item.speed ? `<small class="table-meta">${esc(item.speed)}</small>` : ""), status(item.status)];
    case "vlans":
      return [rowButton(String(item.vid), "show-vlan", {id: item.id}, glyph("layers", item.color)), edit(item.name),
        esc(item.domain), list("interfaces").filter(port => interfaceVlanMode(port, item.id)).length,
        list("prefixes").filter(prefix => prefix.vlan === item.id).length];
    case "prefixes":
      return [edit(item.cidr), esc(item.name), esc(item.vrf || "Global"), value(item.gateway, true), vlanChip(row("vlans", item.vlan))];
    case "routes": {
      const port = row("interfaces", item.interface);
      const target = item.action === "discard" ? chip("Discard", "rose") : value(item.via || port?.name, Boolean(item.via));
      return [edit(item.destination), rowButton(deviceName(item.device), "focus-device", {id: item.device}),
        esc(item.vrf || "Global"), esc(protocols[item.protocol]), target +
        (item.via && port ? `<small class="table-meta">${esc(port.name)}</small>` : ""), item.distance, item.metric];
    }
  }
}

function tablePage() {
  const config = pages[page];
  const add = button(`Add ${config.single}`, "edit", {icon: "plus", style: "primary", attrs: {kind: page, ...(routeFilter && page === "routes" ? {device: routeFilter} : {})}});
  const actions = page === "routes" ? button("Route lookup", "lookup", {icon: "bolt", attrs: {device: routeFilter}}) + add : add;
  return heading(config.title, config.intro, actions) +
    `<section class="panel" aria-label="${config.title}">
    <div class="table-toolbar"><div class="toolbar">
      <label class="filter-input">${icon("search")}<input id="table-filter" type="search" value="${esc(lastFilter)}" placeholder="Filter ${config.title.toLowerCase()}" aria-label="Filter ${config.title.toLowerCase()}"></label>
      ${page === "routes" ? `<label class="filter-input"><select class="compact-select" id="route-filter" aria-label="Filter by device">${selectOptions(deviceOptions(), routeFilter, "All devices")}</select></label>` : ""}
    </div><span id="table-count" aria-live="polite"></span></div>
    <div class="table-wrap"><table><thead><tr>${tableHeaders[page].map(text => `<th scope="col">${text}</th>`).join("")}<th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody id="table-body"></tbody></table></div></section>`;
}

function renderTable() {
  const target = document.querySelector("#table-body");
  if (!target) return;
  const items = list(page).filter(item => (page !== "routes" || !routeFilter || item.device === routeFilter)
    && matchesSearch(page, item, lastFilter));
  document.querySelector("#table-count").textContent = numberLabel(items.length, "record");
  target.innerHTML = items.length ? items.map(item => `<tr>${tableCells(page, item).map(cell => `<td>${cell}</td>`).join("")}
    <td class="table-action">${button(`Edit ${pages[page].single}`, "edit", {icon: "edit", iconOnly: true, style: "small", attrs: {kind: page, id: item.id}})}</td></tr>`).join("") :
    `<tr><td class="empty-row" colspan="${tableHeaders[page].length + 1}">${lastFilter || (page === "routes" && routeFilter) ? "No records match the current filters." : `No ${pages[page].title.toLowerCase()} have been added yet.`}</td></tr>`;
  drawIcons(target);
}

function matchesSearch(kind, item, text) {
  const query = text.trim().toLowerCase();
  if (!query) return true;
  const related = kind === "devices" ? [kinds[item.type]] : kind === "links" ? [endpoint(item.a), endpoint(item.b)] :
    kind === "interfaces" || kind === "routes" ? [deviceName(item.device), row("interfaces", item.interface)?.name] : [];
  const haystack = [...Object.entries(item).filter(([key]) => !["id", "x", "y", "a", "b", "device"].includes(key)).map(([, val]) => val), ...related].join(" ").toLowerCase();
  return query.split(/\s+/).every(term => haystack.includes(term));
}

function locate() {
  const hash = location.hash.slice(1);
  return Object.hasOwn(pages, hash) && hash !== "interfaces" ? hash : "topology";
}

function render() {
  if (!workspace) return;
  const nextPage = locate();
  if (page !== nextPage) lastFilter = "";
  page = nextPage;
  if (page !== "topology") mapExpanded = false;
  graph?.destroy();
  graph = null;
  document.querySelector("#breadcrumb").textContent = pages[page].nav;
  document.title = `NetView · ${pages[page].title}`;
  document.querySelectorAll(".nav-item[data-page]").forEach(link => {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  drawIcons(document.querySelector(".navigation"));
  main.innerHTML = page === "topology" ? topology() : tablePage();
  document.body.classList.toggle("map-expanded", mapExpanded);
  for (const element of document.querySelectorAll("#sidebar, .topbar, .topology-heading, .metrics")) {
    element.inert = mapExpanded;
  }
  main.setAttribute("aria-busy", "false");
  drawIcons(main);
  if (page === "topology") {
    graph = new TopologyGraph(document.querySelector("#graph"), {workspace, deviceLabels: kinds, selected: selection,
      view, vlan: overlay && row("vlans", vlanId), onSelect: select, onMove: savePosition, isSaving: () => saving || dirtyConflict});
    if (pendingFocus) {
      const id = pendingFocus;
      pendingFocus = null;
      requestAnimationFrame(() => requestAnimationFrame(() => graph?.centerOn(id)));
    }
    renderInspector();
  } else {
    renderTable();
  }
}

function select(kind, id) {
  if (kind !== "devices" || selection?.kind !== "devices") inspectorPage = "overview";
  selection = kind && id ? {kind, id} : null;
  graph?.updateSelection(selection);
  renderInspector();
}

function setInspectorPage(tab) {
  if (!["overview", "ports", "vlans"].includes(tab) || selection?.kind !== "devices") return;
  inspectorPage = tab;
  renderInspector();
  document.querySelector(".inspector-tabs button[aria-pressed='true']")?.focus({preventScroll: true});
}

function toggleExpandedMap() {
  if (page !== "topology") return;
  mapExpanded = !mapExpanded;
  render();
  document.querySelector('[data-action="expand-map"]').focus({preventScroll: true});
}

function jumpToRegion(id) {
  const element = document.getElementById(id);
  if (element) {
    element.focus({preventScroll: true});
    element.scrollIntoView({block: "start"});
  }
}

function navigate(nextPage) {
  if (locate() === nextPage) render();
  else location.hash = nextPage;
  setMenu(false);
  window.scrollTo({top: 0});
}

function setMenu(open) {
  document.body.classList.toggle("menu-open", open);
  document.querySelector(".mobile-toggle").setAttribute("aria-expanded", String(open));
}

async function savePosition(id, x, y, originalX, originalY) {
  const previousGraph = graph;
  const next = structuredClone(workspace);
  Object.assign(next.devices.find(device => device.id === id), {x, y});
  try {
    await save(next);
    if (graph !== previousGraph) graph?.restore(id, x, y);
  } catch (error) {
    graph?.restore(id, originalX, originalY);
    message(error.message, true);
  }
}

function showDevice(id) {
  select("devices", id);
  if (page === "topology") graph?.centerOn(id);
  else {
    pendingFocus = id;
    navigate("topology");
  }
}

function selectOptions(options, current, placeholder) {
  const entries = placeholder === undefined ? options : [["", placeholder], ...options];
  const values = new Set(Array.isArray(current) ? current : [current]);
  return entries.map(([key, label]) =>
    `<option value="${esc(key)}"${values.has(key) ? " selected" : ""}>${esc(label)}</option>`).join("");
}

function field(label, name, current = "", options = {}) {
  const {choices, placeholder, help, full, multiline, multiple, checked, required, type = "text", min, max, key} = options;
  const base = ` name="${name}"${required ? " required" : ""}`;
  let control;
  if (choices || type === "select") {
    control = `<select${base}${multiple ? " multiple" : ""}>${selectOptions(choices || [], current, placeholder)}</select>`;
  } else if (multiline) {
    control = `<textarea${base} maxlength="4000"${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}>${esc(current)}</textarea>`;
  } else if (type === "checkbox") {
    return `<label class="field check"><input type="checkbox"${base}${checked ? " checked" : ""}>${label}</label>`;
  } else {
    control = `<input type="${type}"${base} value="${esc(current)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}
      ${min !== undefined ? ` min="${min}"` : ""}${type === "number" ? ` max="${max}"` : ` maxlength="${max ?? 180}"`}>`;
  }
  return `<label class="field${full ? " full" : ""}"${key ? ` data-field="${key}"` : ""}>${label}${control}${help ? `<small>${help}</small>` : ""}</label>`;
}

const choose = (label, name, current, choices, extra) => field(label, name, current, {choices: Object.entries(choices), ...extra});
const noteField = record => field("Notes", "notes", record.notes, {full: true, multiline: true});
const vrfField = record => field("Routing context (VRF)", "vrf", record.vrf, {placeholder: "Global", max: 80, help: "Leave blank for the global routing table."});
const deviceOptions = () => list("devices").map(device => [device.id, device.name]);
const vlanOptions = () => [...list("vlans")].sort((a, b) => a.vid - b.vid).map(vlan => [vlan.id, `${vlan.vid} · ${vlan.name} / ${vlan.domain}`]);
const portOptions = (device, vrf) => ports(device).filter(port => vrf === undefined || port.vrf.toLowerCase() === vrf.trim().toLowerCase())
  .map(port => [port.id, port.name]);
const deviceField = (record, label = "Device", {name = "device", ...extra} = {}) =>
  field(label, name, record, {choices: deviceOptions(), placeholder: "Select a device", required: true, ...extra});
const numberField = (label, name, current, min, max) => field(label, name, current, {type: "number", min, max, required: true});

function showModal(title, content, options = {}) {
  const {wide = false, init} = options;
  modalReady = null;
  dialog.innerHTML = `<div${wide ? ' class="wide-dialog"' : ""}><div class="dialog-head">
    <h2 id="dialog-title">${esc(title)}</h2>${button("Close dialog", "close", {icon: "close", iconOnly: true})}</div>
    <div class="dialog-content">${content}</div></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  drawIcons(dialog);
  init?.();
  requestAnimationFrame(() => dialog.querySelector("input:not([type=checkbox]), select, [data-initial]")?.focus());
}

function formMarkup(fields, saveLabel, {kind, id} = {}) {
  return `<form><div class="fields">${fields}</div><div class="form-error" role="alert" hidden></div><div class="form-actions">
      ${id ? button("Delete", "delete", {icon: "trash", style: "subtle delete-button", attrs: {kind, id}}) : ""}
      ${button("Cancel", "close")}<button class="button primary" type="submit">${esc(saveLabel)}</button></div></form>`;
}

function setOptions(form, name, options, preferred, placeholder) {
  const select = form.elements[name];
  select.replaceChildren(...[[ "", placeholder], ...options].map(([id, label]) => new Option(label, id)));
  select.value = options.some(([id]) => id === preferred) ? preferred : "";
}

function toggleField(form, name, visible) {
  const control = form.elements[name];
  control.closest("label").hidden = !visible;
  control.disabled = !visible;
}

function editFields(kind, record) {
  switch (kind) {
    case "devices":
      return `<label class="field full preset-field"><span class="preset-art">${deviceGlyph(record.type || "other")}</span>
        <span class="preset-label">Device preset
        <select name="preset"><option value="">Choose a preset (optional)</option>${presetGroups.map(([group, entries]) =>
          `<optgroup label="${esc(group)}">${selectOptions(entries.map(([label]) => [label, label]))}</optgroup>`).join("")}</select>
        <small>Presets fill in the device type and platform. You can edit both.</small></span>
        </label>` +
        field("Device name", "name", record.name, {required: true, placeholder: "e.g. core-switch"}) +
        choose("Device type", "type", record.type || "other", kinds) +
        field("Management IP", "management", record.management, {placeholder: "e.g. 10.0.10.2"}) +
        choose("Documented status", "status", record.status || "unknown", states) +
        field("Hardware model", "model", record.model, {placeholder: "e.g. ThinkCentre Tiny"}) +
        field("Software or firmware", "platform", record.platform, {placeholder: "e.g. Proxmox VE"}) +
        field("Site or location", "site", record.site, {placeholder: "e.g. Main rack · U06", full: true}) + noteField(record);
    case "interfaces":
      return deviceField(record.device) +
        field("Interface name", "name", record.name, {required: true, placeholder: "e.g. eth0 or Port 01"}) +
        choose("Interface mode", "mode", record.mode || "routed", modes, {help: "Use access for one untagged VLAN or trunk for tagged VLANs."}) +
        vrfField(record) +
        field("Untagged / native VLAN", "native", record.native, {choices: vlanOptions(), placeholder: "None"}) +
        field("Virtual interface VLAN", "vlan", record.vlan, {choices: vlanOptions(), placeholder: "None"}) +
        field("Tagged VLANs", "tagged", record.tagged || [], {choices: vlanOptions(), multiple: true, full: true, help: "Select every tagged VLAN configured on this interface."}) +
        field("IP addresses with prefix length", "addresses", (record.addresses || []).join(", "), {full: true, max: 12000, placeholder: "10.0.20.1/24, 2001:db8:20::1/64", help: "Separate multiple addresses with commas."}) +
        field("Interface enabled", "enabled", "", {type: "checkbox", checked: record.enabled !== false}) + noteField(record);
    case "links": {
      const ends = [row("interfaces", record.a), row("interfaces", record.b)];
      return ["a", "b"].map((side, i) =>
        deviceField(ends[i]?.device || record[side + "Device"], `Device ${side.toUpperCase()}`, {name: side + "Device"}) +
        field(`Interface ${side.toUpperCase()}`, side, record[side], {choices: [], placeholder: "Select an interface", required: true}) +
        field(`New interface ${side.toUpperCase()}`, side + "Name", "", {placeholder: "e.g. eth0", full: true, required: true, help: "Creates a routed interface. Edit it later to set VLANs or addresses."})
      ).join("") +
        choose("Medium", "type", record.type || "copper", media) +
        choose("Documented status", "status", record.status || "active", linkStates) +
        field("Connection label", "label", record.label, {placeholder: "e.g. Uplink"}) +
        field("Speed", "speed", record.speed, {placeholder: "e.g. 10 GbE"}) + noteField(record);
    }
    case "vlans":
      return numberField("VLAN ID", "vid", record.vid, 1, 4094) +
        field("VLAN name", "name", record.name, {required: true, placeholder: "e.g. Management"}) +
        field("VLAN domain", "domain", record.domain, {placeholder: "Default", max: 80, help: "Use a domain name to reuse the same VLAN ID in another network."}) +
        choose("Color", "color", record.color || "blue", colors) + noteField(record);
    case "prefixes":
      return field("Network prefix", "cidr", record.cidr, {required: true, placeholder: "e.g. 10.0.20.0/24"}) +
        field("Prefix name", "name", record.name, {required: true, placeholder: "e.g. Server network"}) +
        vrfField(record) + field("Gateway IP", "gateway", record.gateway, {placeholder: "e.g. 10.0.20.1"}) +
        field("VLAN", "vlan", record.vlan, {choices: vlanOptions(), placeholder: "None"}) + noteField(record);
    case "routes":
      return deviceField(record.device) +
        field("Destination prefix", "destination", record.destination, {required: true, placeholder: "e.g. 0.0.0.0/0 or ::/0"}) +
        vrfField(record) + choose("Protocol", "protocol", record.protocol || "static", protocols) +
        choose("Action", "action", record.action || "forward", {forward: "Forward", discard: "Discard"}) +
        field("Next-hop IP", "via", record.via, {placeholder: "e.g. 10.0.20.1"}) +
        field("Outgoing interface", "interface", record.interface, {choices: [], placeholder: "None"}) +
        "<div></div>" +
        numberField("Administrative distance", "distance", record.distance ?? 1, 0, 255) +
        numberField("Metric", "metric", record.metric ?? 0, 0, 4_294_967_295) + noteField(record);
  }
}

function configureEdit(form, kind, record) {
  const fields = form.elements;
  if (kind === "devices") {
    const preview = form.querySelector(".preset-art");
    const updatePreview = () => {
      preview.innerHTML = deviceGlyph(fields.type.value);
      drawIcons(preview);
    };
    fields.preset.addEventListener("change", () => {
      const preset = devicePresets.get(fields.preset.value);
      if (!preset) return;
      fields.type.value = preset.type;
      if (preset.platform) fields.platform.value = preset.platform;
      updatePreview();
    });
    fields.type.addEventListener("change", updatePreview);
  }
  if (kind === "interfaces") {
    const sync = () => {
      toggleField(form, "native", ["access", "trunk"].includes(fields.mode.value));
      toggleField(form, "tagged", fields.mode.value === "trunk");
      toggleField(form, "vlan", fields.mode.value === "virtual");
    };
    fields.mode.addEventListener("change", sync);
    sync();
  }
  if (kind === "links") {
    for (const side of ["a", "b"]) {
      const device = fields[side + "Device"];
      const port = fields[side];
      const syncName = () => toggleField(form, side + "Name", port.value === "@new");
      const refresh = (preferred, initial = false) => {
        const choices = device.value ? [...portOptions(device.value), ["@new", "Create a new interface"]] : [];
        const onlyNew = choices.length === 1;
        const next = preferred || (onlyNew ? "@new" : "");
        setOptions(form, side, choices, next, "Select an interface");
        if (!initial) fields[side + "Name"].value = "";
        syncName();
      };
      device.addEventListener("change", () => refresh());
      port.addEventListener("change", syncName);
      refresh(record[side], true);
    }
  }
  if (kind === "routes") {
    const updatePorts = preferred => setOptions(form, "interface", portOptions(fields.device.value, fields.vrf.value), preferred, "None");
    const sync = () => {
      const forward = fields.action.value === "forward";
      toggleField(form, "interface", forward);
      toggleField(form, "via", forward && fields.protocol.value !== "connected");
      fields.interface.required = forward && fields.protocol.value === "connected";
    };
    fields.device.addEventListener("change", () => updatePorts(fields.interface.value));
    fields.vrf.addEventListener("input", () => updatePorts(fields.interface.value));
    fields.protocol.addEventListener("change", () => {
      fields.distance.value = distances[fields.protocol.value];
      sync();
    });
    fields.action.addEventListener("change", sync);
    updatePorts(record.interface);
    sync();
  }
}

function newPosition() {
  if (page === "topology" && graph?.width && view.scale) {
    const center = {x: (graph.width / 2 - view.x) / view.scale, y: (graph.height / 2 - view.y) / view.scale};
    const nearby = list("devices").some(device => Math.abs(device.x - center.x) < 180 && Math.abs(device.y - center.y) < 72);
    if (!nearby) return {x: Math.round(center.x), y: Math.round(center.y)};
    for (const offset of [[185, 0], [-185, 0], [0, 100], [0, -100], [185, 100], [-185, 100]]) {
      const x = Math.round(center.x + offset[0]);
      const y = Math.round(center.y + offset[1]);
      if (!list("devices").some(device => Math.abs(device.x - x) < 180 && Math.abs(device.y - y) < 72)) return {x, y};
    }
  }
  const count = list("devices").length;
  const bounds = list("devices").reduce((result, device) => ({left: Math.min(result.left, device.x), bottom: Math.max(result.bottom, device.y)}),
    {left: Infinity, bottom: -Infinity});
  return count ? {x: bounds.left, y: bounds.bottom + 102} : {x: 450, y: 250};
}

function createId() {
  return "n-" + Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, "0")).join("");
}

function setModalError(error) {
  const area = dialog.querySelector(".form-error");
  if (area) {
    area.textContent = error.message;
    area.hidden = false;
  } else message(error.message, true);
}

function onSubmit(handler) {
  const form = dialog.querySelector("form");
  modalReady = form;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (form.dataset.pending) return;
    if (form.querySelector(".form-error")) form.querySelector(".form-error").hidden = true;
    const submit = form.querySelector('[type="submit"]');
    form.dataset.pending = "true";
    submit.disabled = true;
    try {
      await handler(form, new FormData(form));
    } catch (error) {
      if (modalReady === form && dialog.open) setModalError(error);
      else message(error.message, true);
    } finally {
      delete form.dataset.pending;
      submit.disabled = false;
    }
  });
}

function editRecord(kind, id, defaults = {}) {
  const original = id && row(kind, id);
  const record = original || defaults;
  if (kind === "links" && !list("devices").length) return showModal("Connect devices",
    `<p>Add a device first. You can create interfaces as you connect devices.</p><div class="form-actions">${button("Add device", "edit", {icon: "plus", style: "primary", attrs: {kind: "devices"}})}</div>`);
  if (["interfaces", "routes"].includes(kind) && !list("devices").length)
    return message("Add a device before creating interfaces or routes.", true);
  const label = pages[kind].single;
  const help = !original && kind === "links" ? '<p class="form-help">Choose both ends of the connection. Create an interface here if a port is missing.</p>' : "";
  showModal(`${original ? "Edit" : "Add"} ${label}`, help + formMarkup(editFields(kind, record), original ? "Save changes" : `Add ${label}`, {kind, id}));
  const form = dialog.querySelector("form");
  configureEdit(form, kind, record);
  onSubmit(async (currentForm, formData) => {
    const next = structuredClone(workspace);
    const current = id && row(kind, id);
    if (original && !current) throw new Error("This record no longer exists. Close this editor and try again.");
    const result = {...current, ...Object.fromEntries(formData), id: current?.id || createId()};
    if (kind === "devices") {
      delete result.preset;
      if (!original) Object.assign(result, newPosition());
    }
    if (kind === "interfaces") {
      result.native = formData.get("native") || "";
      result.vlan = formData.get("vlan") || "";
      result.tagged = formData.getAll("tagged");
      result.enabled = formData.has("enabled");
      result.addresses = result.addresses.split(/[\s,]+/).filter(Boolean);
    }
    if (kind === "links") {
      for (const side of ["a", "b"]) {
        if (result[side] === "@new") {
          const device = result[side + "Device"];
          const name = result[side + "Name"].trim();
          const existing = next.interfaces.find(port => port.device === device && port.name.toLowerCase() === name.toLowerCase());
          // The same newly entered port can be used only once per connection.
          if (existing) throw new Error(`The interface "${name}" already exists. Select it from the list.`);
          const port = {id: createId(), device, name, mode: "routed"};
          next.interfaces.push(port);
          result[side] = port.id;
        }
      }
    }
    if (kind === "vlans") result.vid = Number(result.vid);
    if (kind === "routes") {
      result.via = formData.get("via") || "";
      result.interface = formData.get("interface") || "";
      result.distance = Number(result.distance);
      result.metric = Number(result.metric);
    }
    if (original) next[kind][next[kind].findIndex(item => item.id === id)] = result;
    else next[kind].push(result);
    await save(next);
    if (page === "topology") {
      if (kind === "devices" || kind === "links") selection = {kind, id: result.id};
      if (kind === "devices" && !original) pendingFocus = result.id;
    }
    if (modalReady === currentForm && dialog.open) dialog.close();
    render();
    message(`${label[0].toUpperCase() + label.slice(1)} ${original ? "updated" : "added"}.`);
  });
}

function deleteRecord(kind, id) {
  const record = row(kind, id);
  if (!record) return;
  const baseRevision = revision;
  const next = structuredClone(workspace);
  next[kind] = next[kind].filter(item => item.id !== id);
  const detail = [];
  if (["devices", "interfaces"].includes(kind)) {
    const removedPorts = new Set(kind === "devices" ? ports(id).map(port => port.id) : [id]);
    if (kind === "devices") next.interfaces = next.interfaces.filter(port => !removedPorts.has(port.id));
    next.links = next.links.filter(link => !removedPorts.has(link.a) && !removedPorts.has(link.b));
    next.routes = next.routes.filter(route => !removedPorts.has(route.interface) && !(kind === "devices" && route.device === id));
    if (kind === "devices" && removedPorts.size) detail.push(numberLabel(removedPorts.size, "interface"));
    const links = list("links").length - next.links.length;
    const routes = list("routes").length - next.routes.length;
    if (links) detail.push(numberLabel(links, "connection"));
    if (routes) detail.push(numberLabel(routes, "route"));
  }
  if (kind === "vlans") {
    next.interfaces = next.interfaces.map(port => ({...port, native: port.native === id ? "" : port.native,
      vlan: port.vlan === id ? "" : port.vlan, tagged: port.tagged.filter(tag => tag !== id)}));
    next.prefixes = next.prefixes.map(prefix => prefix.vlan === id ? {...prefix, vlan: ""} : prefix);
    if (list("interfaces").some(port => modeVlanIds(port).includes(id)) || list("prefixes").some(prefix => prefix.vlan === id))
      detail.push("its interface and prefix assignments");
  }
  const label = record.name || record.label || record.cidr || record.destination || pages[kind].single;
  const explanation = detail.length ? ` This also removes ${detail.join(", ")}.` : "";
  confirmModal(`Delete ${pages[kind].single}?`, `“${label}” will be removed.${explanation}`, "Delete", async () => {
    await save(next, baseRevision);
    render();
    message("Record deleted.");
  });
}

function confirmModal(title, description, submitLabel, confirm) {
  showModal(title, `<p>${esc(description)}</p><form><div class="form-error" role="alert" hidden></div>
    <div class="form-actions">${button("Cancel", "close")}<button type="submit" class="button danger">${esc(submitLabel)}</button></div></form>`);
  onSubmit(async form => {
    await confirm();
    if (modalReady === form && dialog.open) dialog.close();
  });
}

function viewPorts(deviceId) {
  const device = row("devices", deviceId);
  if (!device) return;
  const rows = ports(deviceId).map(port => `<tr>
    <td>${rowButton(port.name, "port-detail", {id: port.id})}</td><td>${esc(modes[port.mode])}</td>
    <td><div class="chip-list">${modeVlanIds(port).map(id => vlanChip(row("vlans", id))).join("") || "—"}</div></td>
    <td>${port.addresses.map(address => value(address, true)).join("<br>") || "—"}</td>
    <td>${esc(port.vrf || "Global")}</td><td>${port.enabled ? "Enabled" : "Disabled"}</td>
    <td class="table-action">${button("Edit interface", "edit", {icon: "edit", iconOnly: true, attrs: {kind: "interfaces", id: port.id}})}</td></tr>`).join("");
  showModal(`${device.name} · Interfaces`, (rows ? `<div class="table-wrap"><table><thead><tr>
    <th scope="col">Interface</th><th scope="col">Mode</th><th scope="col">VLANs</th><th scope="col">Addresses</th><th scope="col">VRF</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th>
    </tr></thead><tbody>${rows}</tbody></table></div>` : "<p>This device has no interfaces yet.</p>") +
    `<div class="form-actions">${button("Add interface", "edit", {style: "primary", icon: "plus", attrs: {kind: "interfaces", device: deviceId}})}</div>`, {wide: true});
}

function viewPort(id) {
  const port = row("interfaces", id);
  if (!port) return;
  const related = portLinks(id);
  const vlanDetails = modeVlanIds(port).map(vlanId => {
    const vlan = row("vlans", vlanId);
    return `${vlan.name} (${interfaceVlanMode(port, vlan.id)})`;
  });
  showModal(`${deviceName(port.device)} · ${port.name}`,
    detailList([["Mode", value(modes[port.mode])], ["Status", value(port.enabled ? "Enabled" : "Disabled")], ["VRF", value(port.vrf || "Global")],
      ["IP addresses", value(port.addresses.join(", "), true)], ["VLANs", value(vlanDetails.join(", "))]]) +
    (port.notes ? `<p class="notes port-notes">${esc(port.notes)}</p>` : "") +
    (related.length ? `<div class="related-list">${related.map(link => `<button class="search-result" type="button"${data({action: "focus-link", id: link.id})}>
      ${icon("link")}<strong>${esc(endpoint(link.a === id ? link.b : link.a))}</strong><small>${media[link.type]}</small></button>`).join("")}</div>` : "") +
    `<div class="form-actions">${button("All interfaces", "ports", {attrs: {id: port.device}})}${button("Edit interface", "edit", {icon: "edit", style: "primary", attrs: {kind: "interfaces", id}})}</div>`);
}

function openLookup(deviceId = "") {
  if (!list("devices").length) return message("Add a device before looking up routes.", true);
  const first = deviceId || (list("routes")[0]?.device || list("devices")[0].id);
  showModal("Route lookup", `<p class="form-help">Pick a device and enter a destination IP. NetView compares documented routes and connected interface networks in that routing context.</p>
    <form><div class="fields">${deviceField(first)}${vrfField({})}
      ${field("Destination IP", "destination", "", {full: true, required: true, placeholder: "e.g. 10.50.1.12 or 2001:db8:20::10", max: 90})}
    </div><div class="form-error" role="alert" hidden></div>
    <div class="form-actions">${button("Close", "close")}<button type="submit" class="button primary">Look up route</button></div>
    </form><div class="lookup-result" aria-live="polite"></div>`, {wide: true});
  onSubmit(async (form, formData) => {
    const target = dialog.querySelector(".lookup-result");
    target.innerHTML = "";
    const result = await lookupRoute(revision, Object.fromEntries(formData));
    if (form !== modalReady) return;
    const {candidates, inactive, best} = result;
    const first = candidates[0];
    const summary = best === 0 ? "No eligible route matched this destination." : best > 1 ?
      `${numberLabel(best, "candidate")} share the best rank. Check the device for its actual forwarding behavior.` :
      first.action === "discard" ? `${first.destination} matches and is configured to discard traffic.` :
        `${first.destination} matches${first.via ? ` via ${first.via}` : ""}.`;
    const rows = [...candidates, ...inactive].map((route, i) => {
      const port = row("interfaces", route.interface);
      const rank = i < best ? chip(best > 1 ? "Tied best" : "Best match", "teal") :
        i < candidates.length ? chip("Alternative") : chip("Inactive", "amber");
      return `<tr${i < best ? ' class="best"' : ""}><td>${rank}</td><td>${value(route.destination, true)}</td>
        <td>${esc(protocols[route.protocol])}${route.derived ? '<small class="table-meta">From interface</small>' : ""}</td>
        <td>${route.action === "discard" ? chip("Discard", "rose") : value(route.via || port?.name, Boolean(route.via))}</td>
        <td>${route.distance}</td><td>${route.metric}</td></tr>`;
    }).join("");
    target.innerHTML = `<h3>Destination ${esc(result.target)}</h3><p>${esc(summary)}</p>` +
      (rows ? `<div class="table-wrap"><table><thead><tr><th scope="col">Decision</th><th scope="col">Prefix</th><th scope="col">Protocol</th>
        <th scope="col">Next hop / interface</th><th scope="col">Distance</th><th scope="col">Metric</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="port-notes">Ranking uses longest prefix, lowest administrative distance, and then lowest metric. A disabled outgoing interface or distance 255 makes a route inactive.</p>` : "");
  });
}

function openSearch() {
  showModal("Search workspace", `<label class="filter-input">${icon("search")}<input id="global-query" type="search" aria-label="Search devices, interfaces, VLANs, prefixes, and routes" placeholder="Name, port, IP address, or VLAN"></label>
    <div class="search-list" id="search-results" aria-live="polite"></div>`);
  function refresh() {
    const text = dialog.querySelector("#global-query").value;
    const results = [];
    for (const kind of ["devices", "interfaces", "links", "vlans", "prefixes", "routes"]) {
      for (const item of list(kind)) {
        if (results.length >= 18) break;
        if (!matchesSearch(kind, item, text)) continue;
        const label = kind === "interfaces" ? endpoint(item.id) : kind === "vlans" ? `${item.vid} · ${item.name}` :
          item.name || item.label || item.cidr || item.destination || endpoint(item.a);
        results.push(`<button class="search-result" type="button"${data({action: "open-result", kind, id: item.id})}>
          ${icon(pages[kind].icon)}<strong>${esc(label)}</strong><small>${pages[kind].nav}</small></button>`);
      }
    }
    const target = dialog.querySelector("#search-results");
    target.innerHTML = results.join("") || "<p class='form-help'>No matches.</p>";
    drawIcons(target);
  }
  dialog.querySelector("#global-query").addEventListener("input", refresh);
  refresh();
}

async function exportWorkspace() {
  try {
    const {workspace: saved} = await readWorkspace();
    const slug = saved.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
    const href = URL.createObjectURL(new Blob([JSON.stringify(saved) + "\n"], {type: "application/json"}));
    const link = document.createElement("a");
    link.href = href;
    link.download = `netview-${slug}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    message("Downloading workspace…");
  } catch (error) {
    message(error.message, true);
  }
}

function replaceView() {
  selection = null;
  view = {};
  overlay = false;
  vlanId = "";
  routeFilter = "";
  lastFilter = "";
  navigate("topology");
}

function openWorkspace() {
  const storageHelp = '<p class="form-help">Changes are saved in this browser. Export JSON to back up your map or move it to another device.</p>';
  showModal("Workspace settings", storageHelp + formMarkup(field("Workspace name", "name", workspace.name, {full: true, required: true, max: 80}),
    "Save name") + `<div class="workspace-tools">
      ${button("Getting started", "guide", {icon: "info"})}
      ${button("Export JSON", "export", {icon: "download"})}
      ${button("Import JSON", "import", {icon: "upload"})}
      ${button("Start blank", "blank", {icon: "plus"})}
    </div>`);
  onSubmit(async (form, formData) => {
    await save({...workspace, name: formData.get("name")});
    if (modalReady === form && dialog.open) dialog.close();
    render();
    message("Workspace renamed.");
  });
}

function openGuide() {
  showModal("Getting started", `<ol class="guide-list">
    <li><strong>Add your devices.</strong> Choose a preset for equipment or a platform such as a Mini PC, OPNsense, or Proxmox VE. You can set the hardware model and software separately.</li>
    <li><strong>Connect two devices.</strong> Use the Connect button on the map. Pick the interfaces at both ends or create them during this step.</li>
    <li><strong>Add network segments.</strong> Define VLANs and prefixes, then edit each interface to document its untagged and tagged VLANs.</li>
    <li><strong>Record routes and look them up.</strong> Open Routes, enter a device’s routes, and compare them with the networks assigned to its interfaces.</li>
    <li><strong>Keep a backup.</strong> Export the workspace as JSON. You can import it again from Workspace settings.</li>
    </ol><p>Device and link statuses are recorded manually. The example homelab uses fictional devices and addresses.</p>
    <div class="form-actions">${button("Close", "close")}${button("Add device", "edit", {icon: "plus", style: "primary", attrs: {kind: "devices"}})}</div>`);
}

async function importFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error("The workspace file must be 16 MiB or smaller.");
    const loaded = JSON.parse(await file.text());
    if (!loaded || loaded.version !== 1 || typeof loaded.name !== "string") throw new Error("Select a NetView version 1 workspace JSON file.");
    confirmModal("Replace this workspace?", `Importing “${loaded.name.slice(0, 80)}” will replace the current map. Export the current workspace first if you need a backup.`,
      "Replace and import", async () => {
        await save(loaded);
        replaceView();
        message("Workspace imported.");
      });
  } catch (error) {
    message(error instanceof SyntaxError ? "The file does not contain valid JSON." : error.message, true);
  }
}

function startBlank() {
  confirmModal("Start a blank workspace?", "This will replace the current map and all its records. Export the current workspace first if you need a backup.", "Start blank", async () => {
    await save({version: 1, name: "My Network", devices: [], interfaces: [], links: [], vlans: [], prefixes: [], routes: []});
    replaceView();
    message("Blank workspace ready.");
  });
}

async function arrange() {
  if (list("devices").length < 2) return;
  const next = structuredClone(workspace);
  const connections = new Map(next.devices.map(device => [device.id, new Set()]));
  for (const link of next.links) {
    const a = row("interfaces", link.a).device;
    const b = row("interfaces", link.b).device;
    if (a === b) continue;
    connections.get(a).add(b);
    connections.get(b).add(a);
  }
  const compare = (a, b) => a.name.localeCompare(b.name);
  const priority = ["cloud", "firewall", "router", "switch"];
  const ordered = [...next.devices].sort((a, b) => {
    const rank = device => priority.includes(device.type) ? priority.indexOf(device.type) : priority.length;
    return rank(a) - rank(b) || connections.get(b.id).size - connections.get(a.id).size || compare(a, b);
  });
  const position = new Map(next.devices.map(device => [device.id, device]));
  const seen = new Set();
  let currentY = 50;
  for (const root of ordered) {
    if (seen.has(root.id) || !connections.get(root.id).size) continue;
    let layer = [root];
    seen.add(root.id);
    while (layer.length) {
      const following = [];
      layer.forEach((device, i) => {
        device.x = 450 + (i - (layer.length - 1) / 2) * 190;
        device.y = currentY;
        for (const neighbor of connections.get(device.id)) {
          if (seen.has(neighbor)) continue;
          seen.add(neighbor);
          following.push(position.get(neighbor));
        }
      });
      currentY += 107;
      layer = following.sort(compare);
    }
    currentY += 25;
  }
  const isolated = next.devices.filter(device => !seen.has(device.id)).sort(compare);
  const columns = Math.min(6, Math.ceil(Math.sqrt(isolated.length)));
  isolated.forEach((device, i) => {
    device.x = 450 + (i % columns - (columns - 1) / 2) * 190;
    device.y = currentY + Math.floor(i / columns) * 107;
  });
  try {
    await save(next);
    view = {};
    render();
    message("Topology arranged.");
  } catch (error) {
    message(error.message, true);
  }
}

function focusLink(id) {
  if (dialog.open) dialog.close();
  select("links", id);
  if (page === "topology") graph?.fit();
  else navigate("topology");
}

const actions = {
  edit: ({kind, id, device}) => editRecord(kind, id, {device, aDevice: selection?.kind === "devices" ? selection.id : ""}),
  delete: ({kind, id}) => deleteRecord(kind, id),
  search: openSearch,
  workspace: openWorkspace,
  guide: openGuide,
  blank: startBlank,
  export: exportWorkspace,
  import: () => fileInput.click(),
  close: () => { if (!modalReady?.dataset.pending) dialog.close(); },
  menu: () => setMenu(!document.body.classList.contains("menu-open")),
  clear: () => select("", ""),
  physical: () => { overlay = false; render(); },
  overlay: () => { overlay = true; render(); },
  layout: arrange,
  fit: () => graph?.fit(),
  "expand-map": toggleExpandedMap,
  "inspector-page": ({tab}) => setInspectorPage(tab),
  "jump-inspector": () => jumpToRegion("inspector"),
  "jump-map": () => jumpToRegion("graph"),
  "zoom-in": () => graph?.zoom(1.2),
  "zoom-out": () => graph?.zoom(1 / 1.2),
  "focus-device": ({id}) => showDevice(id),
  "focus-link": ({id}) => focusLink(id),
  ports: ({id}) => viewPorts(id),
  "port-detail": ({id}) => viewPort(id),
  "show-vlan": ({id}) => {
    vlanId = id;
    overlay = true;
    if (dialog.open) dialog.close();
    navigate("topology");
  },
  "device-routes": ({id}) => { routeFilter = id; navigate("routes"); },
  lookup: ({device}) => openLookup(device),
  "open-result": ({kind, id}) => {
    if (kind === "devices") {
      dialog.close();
      showDevice(id);
    } else if (kind === "interfaces") viewPort(id);
    else if (kind === "links") focusLink(id);
    else editRecord(kind, id);
  },
  retry: load,
};

document.addEventListener("click", event => {
  const link = event.target.closest(".sidebar a[href]");
  if (link) {
    if (link.dataset.page === "routes") {
      routeFilter = "";
      if (page === "routes") render();
    }
    setMenu(false);
    window.scrollTo({top: 0});
    return;
  }
  if (document.body.classList.contains("menu-open") && !event.target.closest(".sidebar, .mobile-toggle"))
    setMenu(false);
  const element = event.target.closest("[data-action]");
  if (!element) return;
  const name = element.dataset.action;
  if (!workspace && !["retry", "menu"].includes(name)) return;
  actions[name]?.(element.dataset);
});

document.addEventListener("input", event => {
  if (event.target.id === "table-filter") {
    lastFilter = event.target.value;
    renderTable();
  }
});

document.addEventListener("change", event => {
  if (event.target.id === "vlan-picker") {
    vlanId = event.target.value;
    render();
    document.querySelector("#vlan-picker").focus();
  }
  if (event.target.id === "route-filter") {
    routeFilter = event.target.value;
    render();
    document.querySelector("#route-filter").focus();
  }
});

document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && workspace && !dialog.open) {
    event.preventDefault();
    openSearch();
  } else if (event.key === "Escape" && !dialog.open) {
    if (mapExpanded) toggleExpandedMap();
    else setMenu(false);
  }
});

dialog.addEventListener("cancel", event => {
  if (modalReady?.dataset.pending) event.preventDefault();
});
dialog.addEventListener("close", () => { modalReady = null; });
fileInput.addEventListener("change", importFile);
window.addEventListener("hashchange", render);

async function load() {
  try {
    acceptWorkspace(await readWorkspace());
    saveState("All changes saved", "saved");
    if (row("devices", "core")) selection = {kind: "devices", id: "core"};
    render();
  } catch (error) {
    saveState("Workspace unavailable", "error");
    main.setAttribute("aria-busy", "false");
    main.innerHTML = heading("Workspace unavailable", "NetView could not load the local workspace.",
      button("Retry", "retry", {style: "primary"})) + `<p class="form-error">${esc(error.message)}</p>`;
    drawIcons(main);
  }
}

drawIcons(document);
load();
