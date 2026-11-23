// Workspace validation and route selection shared by the editor and JSON imports.
import {folds, schema} from "./schema.js";

const idPattern = new RegExp(`^(?:${schema.idPattern})(?![\\s\\S])`);
const casefold = text => [...text].map(character => folds[character] ?? character).join("");
const whitespace = new RegExp(`^[${schema.whitespace}]+|[${schema.whitespace}]+$`, "gu");
const strip = text => text.replace(whitespace, "");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const identity = (...parts) => JSON.stringify(parts);

function require(condition, message) {
  if (!condition) throw Object.assign(new Error(message), {status: 400});
}

function string(item, field, label, {required = false, limit = 180} = {}) {
  const raw = Object.hasOwn(item, field) ? item[field] : "";
  require(typeof raw === "string", `${label} must be text.`);
  const value = strip(raw);
  require(!required || value, `${label} is required.`);
  require(value.length <= limit || [...value].length <= limit, `${label} must be at most ${limit} characters.`);
  require(!/[\uD800-\uDFFF]/u.test(value), `${label} contains invalid Unicode.`);
  return value;
}

function number(value, label, low, high, integer = false) {
  require(Number.isFinite(value) && (!integer || Number.isInteger(value)) && value >= low && value <= high,
    `${label} must be ${integer ? "a whole number" : "a number"} from ${low} to ${high}.`);
  return value;
}

function choice(item, field, label, choices, fallback) {
  const value = Object.hasOwn(item, field) ? item[field] : fallback;
  require(choices.includes(value), `Choose a valid ${label}.`);
  return value;
}

function ref(item, field, collection, label, optional = false) {
  const value = string(item, field, label);
  require((optional && !value) || collection.has(value), `${label} references a missing record.`);
  return value;
}

const notes = item => string(item, "notes", "Notes", {limit: 4000});

function ipv4(raw) {
  if (/[^0-9.]/.test(raw)) return null;
  const parts = raw.split(".");
  if (parts.length !== 4 || !parts.every(part => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)) {
    return null;
  }
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv6(raw) {
  // The bracketed URL host invokes the browser's standards-based IPv6 parser.
  if (/[^a-fA-F0-9:.]/.test(raw) || !raw.includes(":")) return null;
  let text;
  try {
    text = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const [head, tail] = text.split("::");
  const leading = head ? head.split(":") : [];
  const trailing = tail ? tail.split(":") : [];
  const groups = tail === undefined ? leading :
    [...leading, ...Array(8 - leading.length - trailing.length).fill("0"), ...trailing];
  const value = groups.reduce((result, digit) => (result << 16n) | BigInt(`0x${digit}`), 0n);
  if ((value >> 32n) === 65535n) {
    text = `::ffff:${formatAddress(value & 4294967295n, 4)}`;
  }
  return {value, text, version: 6, bits: 128};
}

function address(raw, label) {
  require(!raw.includes("%"), `${label} must use an IP address without an IPv6 zone suffix.`);
  if (raw.includes(":")) {
    const parsed = ipv6(raw);
    require(parsed, `${label} is invalid: ${raw}.`);
    return parsed;
  }
  const value = ipv4(raw);
  require(value !== null, `${label} is invalid: ${raw}.`);
  return {value, text: raw, version: 4, bits: 32};
}

function prefixLength(raw, bits) {
  if (raw && !/[^0-9]/.test(raw)) {
    const length = Number(raw);
    if (length <= bits) return length;
  }
  if (bits !== 32) return null;
  const dotted = ipv4(raw);
  if (dotted === null) return null;
  const binary = dotted.toString(2).padStart(32, "0");
  if (/^1*0*$/.test(binary)) return binary.lastIndexOf("1") + 1;
  if (/^0+1+$/.test(binary)) return binary.indexOf("1");
  return null;
}

function formatAddress(value, version) {
  if (version === 4) return [24n, 16n, 8n, 0n].map(shift => String((value >> shift) & 255n)).join(".");
  const groups = Array.from({length: 8}, (_, i) => ((value >> BigInt(112 - 16 * i)) & 65535n).toString(16));
  return ipv6(groups.join(":")).text;
}

function prefix(raw, label, strict = true) {
  const [host, suffix, extra] = raw.split("/");
  require(extra === undefined && suffix !== undefined, `${label} is invalid: ${raw}.`);
  const addr = address(host, label);
  const length = prefixLength(suffix, addr.bits);
  require(length !== null, `${label} is invalid: ${raw}.`);
  const shift = BigInt(addr.bits - length);
  const network = (addr.value >> shift) << shift;
  require(!strict || network === addr.value, `${label} is invalid: ${raw}.`);
  return {...addr, host: addr.text, network, shift, length, text: `${formatAddress(network, addr.version)}/${length}`};
}

function contains(network, addr) {
  return network.version === addr.version && ((addr.value >> network.shift) << network.shift) === network.network;
}

export function validate(data) {
  require(object(data) && data.version === schema.version, "This workspace format is unsupported. Import a NetView workspace with version 1.");
  const output = {version: schema.version, name: string(data, "name", "Workspace name", {required: true, limit: 80})};
  const raw = {};
  for (const collection of schema.collections) {
    const records = data[collection];
    require(Array.isArray(records) && records.length <= schema.maxRecords,
      `${collection} must contain at most ${schema.maxRecords.toLocaleString("en-US")} records.`);
    const index = new Map();
    for (const record of records) {
      require(object(record), `Each ${collection} record must be an object.`);
      const id = record.id;
      require(typeof id === "string" && idPattern.test(id), `Invalid ID in ${collection}.`);
      require(!index.has(id), `Duplicate ID in ${collection}: ${id}.`);
      index.set(id, record);
    }
    raw[collection] = index;
  }

  output.devices = [...raw.devices].map(([id, item]) => {
    const management = string(item, "management", "Management IP");
    return {
      id, name: string(item, "name", "Device name", {required: true}),
      type: choice(item, "type", "device type", schema.deviceTypes, "other"),
      status: choice(item, "status", "device status", schema.deviceStates, "unknown"),
      site: string(item, "site", "Site"), model: string(item, "model", "Model"),
      platform: string(item, "platform", "Platform"), management: management ? address(management, "Management IP").text : "",
      x: number(item.x, "Horizontal position", -1_000_000, 1_000_000),
      y: number(item.y, "Vertical position", -1_000_000, 1_000_000), notes: notes(item),
    };
  });

  const vlanKeys = new Set();
  output.vlans = [...raw.vlans].map(([id, item]) => {
    const vid = number(item.vid, "VLAN ID", 1, 4094, true);
    const domain = string(item, "domain", "VLAN domain", {limit: 80}) || "Default";
    const key = identity(casefold(domain), vid);
    require(!vlanKeys.has(key), `VLAN ${vid} already exists in ${domain}.`);
    vlanKeys.add(key);
    return {id, vid, domain, name: string(item, "name", "VLAN name", {required: true}),
      color: choice(item, "color", "VLAN color", schema.vlanColors, "blue"), notes: notes(item)};
  });
  const vlans = new Map(output.vlans.map(vlan => [vlan.id, vlan]));

  const interfaceNames = new Set();
  output.interfaces = [...raw.interfaces].map(([id, item]) => {
    const device = ref(item, "device", raw.devices, "Interface device");
    const name = string(item, "name", "Interface name", {required: true});
    const key = identity(device, casefold(name));
    require(!interfaceNames.has(key), `Interface ${name} already exists on this device.`);
    interfaceNames.add(key);
    const mode = choice(item, "mode", "interface mode", schema.interfaceModes, "routed");
    const native = ref(item, "native", vlans, `${name} untagged VLAN`, true);
    const vlan = ref(item, "vlan", vlans, `${name} virtual VLAN`, true);
    const tagged = Object.hasOwn(item, "tagged") ? item.tagged : [];
    require(Array.isArray(tagged) && tagged.length <= 4094 && tagged.every(tag => vlans.has(tag)),
      `${name} references a missing tagged VLAN.`);
    require(new Set(tagged).size === tagged.length && !tagged.includes(native), `${name} must list each VLAN once.`);
    require(mode === "trunk" || !tagged.length, `Tagged VLANs require trunk mode on ${name}.`);
    require(["access", "trunk"].includes(mode) || !native, `Untagged VLANs require access or trunk mode on ${name}.`);
    require(mode === "virtual" || !vlan, `A virtual VLAN requires virtual mode on ${name}.`);
    const domains = new Set([native, ...tagged].filter(Boolean).map(tag => casefold(vlans.get(tag).domain)));
    require(domains.size <= 1, `All VLANs on ${name} must belong to the same domain.`);
    const supplied = Object.hasOwn(item, "addresses") ? item.addresses : [];
    require(Array.isArray(supplied) && supplied.length <= 128 &&
      supplied.every(value => typeof value === "string" && value.length <= 90 && value.includes("/")),
    `${name} addresses must be CIDRs, such as 192.0.2.1/24.`);
    const addresses = supplied.map(value => {
      const parsed = prefix(value, `${name} address`, false);
      return `${parsed.host}/${parsed.length}`;
    });
    require(new Set(addresses).size === addresses.length, `${name} contains duplicate addresses.`);
    const enabled = Object.hasOwn(item, "enabled") ? item.enabled : true;
    require(typeof enabled === "boolean", `${name} enabled state must be true or false.`);
    return {id, device, name, mode, native, tagged, vlan, addresses, enabled,
      vrf: string(item, "vrf", "VRF", {limit: 80}), notes: notes(item)};
  });
  const interfaces = new Map(output.interfaces.map(port => [port.id, port]));

  const wiredPorts = new Set();
  const linkPairs = new Set();
  output.links = [...raw.links].map(([id, item]) => {
    const a = ref(item, "a", interfaces, "First connection endpoint");
    const b = ref(item, "b", interfaces, "Second connection endpoint");
    require(a !== b, "A connection needs two distinct interfaces.");
    const pair = identity(...[a, b].sort());
    require(!linkPairs.has(pair), "These interfaces already have a connection.");
    linkPairs.add(pair);
    const type = choice(item, "type", "connection medium", schema.linkTypes, "copper");
    if (type === "copper" || type === "fiber") {
      require(!wiredPorts.has(a) && !wiredPorts.has(b), "A wired interface can have only one copper or fiber connection.");
      wiredPorts.add(a);
      wiredPorts.add(b);
    }
    return {id, a, b, type, status: choice(item, "status", "connection status", schema.linkStates, "active"),
      label: string(item, "label", "Connection label"), speed: string(item, "speed", "Connection speed"), notes: notes(item)};
  });

  const prefixKeys = new Set();
  output.prefixes = [...raw.prefixes].map(([id, item]) => {
    const cidr = string(item, "cidr", "Prefix", {required: true});
    require(cidr.includes("/"), "An IP prefix requires a CIDR length.");
    const network = prefix(cidr, "Network prefix (use the network address)");
    const vrf = string(item, "vrf", "VRF", {limit: 80});
    const key = identity(network.text, casefold(vrf));
    require(!prefixKeys.has(key), `Prefix ${network.text} already exists in this VRF.`);
    prefixKeys.add(key);
    const supplied = string(item, "gateway", "Gateway");
    const gateway = supplied && address(supplied, "Gateway");
    require(!gateway || contains(network, gateway), `Gateway ${gateway?.text} must belong to ${network.text}.`);
    return {id, cidr: network.text, name: string(item, "name", "Prefix name", {required: true}), vrf,
      gateway: gateway ? gateway.text : "", vlan: ref(item, "vlan", vlans, "Prefix VLAN", true), notes: notes(item)};
  });

  output.routes = [...raw.routes].map(([id, item]) => {
    const device = ref(item, "device", raw.devices, "Route device");
    const destination = string(item, "destination", "Route destination", {required: true});
    require(destination.includes("/"), "A route destination requires a CIDR length.");
    const network = prefix(destination, "Route destination (use the network address)");
    const protocol = choice(item, "protocol", "route protocol", Object.keys(schema.protocolDistances), "static");
    const supplied = string(item, "via", "Next-hop IP");
    const via = supplied && address(supplied, "Next-hop IP");
    require(!via || via.version === network.version, "The route and its next hop must use the same IP version.");
    const outgoing = ref(item, "interface", interfaces, "Outgoing interface", true);
    const vrf = string(item, "vrf", "VRF", {limit: 80});
    if (outgoing) {
      const port = interfaces.get(outgoing);
      require(port.device === device, "The outgoing interface must belong to the route device.");
      require(casefold(port.vrf) === casefold(vrf), "The route and interface must use the same VRF.");
    }
    const action = choice(item, "action", "route action", ["forward", "discard"], "forward");
    if (action === "discard") require(!via && !outgoing, "Discard routes cannot have a next hop or outgoing interface.");
    else if (protocol === "connected") require(outgoing && !via, "A connected route requires an interface and no next hop.");
    else require(via || outgoing, "A forwarding route requires a next hop or outgoing interface.");
    return {id, device, destination: network.text, vrf, protocol, via: via ? via.text : "", interface: outgoing, action,
      distance: number(Object.hasOwn(item, "distance") ? item.distance : schema.protocolDistances[protocol], "Administrative distance", 0, 255, true),
      metric: number(Object.hasOwn(item, "metric") ? item.metric : 0, "Route metric", 0, 4_294_967_295, true),
      notes: notes(item)};
  });
  return output;
}

function ranking(left, right) {
  return right.length - left.length || left.distance - right.distance || left.metric - right.metric;
}

export function lookup(workspace, device, destination, vrf = "") {
  require(typeof device === "string" && workspace.devices.some(item => item.id === device), "Select a device in the workspace.");
  require(typeof destination === "string" && destination.length > 0 && destination.length <= 90, "Enter a destination IP address.");
  require(typeof vrf === "string" && (vrf.length <= 80 || [...vrf].length <= 80), "Enter a valid VRF.");
  const target = address(strip(destination), "Destination IP");
  const table = casefold(strip(vrf));
  const interfaces = new Map(workspace.interfaces.filter(port => port.device === device).map(port => [port.id, port]));
  const candidates = [];
  const inactive = [];
  for (const route of workspace.routes) {
    if (route.device !== device || casefold(route.vrf) !== table) continue;
    const network = prefix(route.destination, "Route destination");
    if (!contains(network, target)) continue;
    const port = interfaces.get(route.interface);
    const collection = (port && !port.enabled) || route.distance === 255 ? inactive : candidates;
    collection.push({...route, length: network.length, derived: false});
  }
  const connected = new Set(candidates.filter(route => route.protocol === "connected" && route.action === "forward")
    .map(route => identity(route.interface, route.destination)));
  for (const port of interfaces.values()) {
    if (!port.enabled || casefold(port.vrf) !== table) continue;
    for (const ip of port.addresses) {
      const network = prefix(ip, "Interface address", false);
      const key = identity(port.id, network.text);
      if (contains(network, target) && !connected.has(key)) {
        connected.add(key);
        candidates.push({id: "", device, destination: network.text, vrf: port.vrf, protocol: "connected",
          via: "", interface: port.id, action: "forward", distance: 0, metric: 0, length: network.length, derived: true});
      }
    }
  }
  candidates.sort(ranking);
  inactive.sort(ranking);
  const best = candidates.filter(route => ranking(route, candidates[0]) === 0).length;
  return {target: target.text, candidates, inactive, best};
}
