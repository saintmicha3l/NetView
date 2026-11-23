import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {lookup, validate} from "../site/workspace-model.js";

const site = new URL("../site/", import.meta.url);
const read = name => readFileSync(new URL(name, site), "utf8");
const demo = () => JSON.parse(read("demo.json"));

test("publication contains the exact static assets and fictional demo", () => {
  const expected = [
    "app.js", "demo.json", "device-icons.webp", "favicon.png",
    "graph.js", "icons.js", "index.html", "schema.js", "styles.css",
    "workspace-model.js", "workspace-store.js",
  ];
  const entries = readdirSync(site, {withFileTypes: true});
  assert.deepEqual(entries.map(entry => entry.name).sort(), expected);
  assert.ok(entries.every(entry => entry.isFile()));
  for (const match of read("index.html").matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (match[1].startsWith("#")) continue;
    assert.ok(match[1].startsWith("./"), match[1]);
    assert.ok(expected.includes(match[1].slice(2)), match[1]);
  }
  assert.match(read("index.html"), /Browser storage/);
  assert.doesNotMatch(read("app.js") + read("workspace-store.js"), /\/api\//);
  assert.deepEqual(validate(demo()), demo());
});

test("route lookup prioritizes the longest prefix and the lowest administrative distance", () => {
  const result = lookup(validate(demo()), "gateway", "10.50.1.10");
  assert.equal(result.best, 1);
  assert.equal(result.candidates[0].destination, "10.50.0.0/16");
  assert.equal(result.candidates[0].via, "10.0.20.11");
  assert.equal(result.candidates.at(-1).destination, "0.0.0.0/0");
});

test("route lookup derives IPv6 connected prefixes and excludes disabled interfaces", () => {
  const connected = lookup(validate(demo()), "gateway", "2001:db8:20::10");
  assert.equal(connected.candidates[0].destination, "2001:db8:20::/64");
  assert.equal(connected.candidates[0].derived, true);
  const workspace = demo();
  workspace.interfaces.find(port => port.id === "fw-20").enabled = false;
  const result = lookup(validate(workspace), "gateway", "10.50.1.10");
  assert.equal(result.candidates[0].destination, "0.0.0.0/0");
  assert.equal(result.inactive.length, 2);
});

test("imports reject broken connections and VLAN assignments", () => {
  const broken = demo();
  broken.links[0].a = "missing";
  assert.throws(() => validate(broken), /First connection endpoint references a missing record/);
  const invalid = demo();
  invalid.interfaces.find(port => port.id === "core-pve").tagged = ["v40"];
  assert.throws(() => validate(invalid), /Tagged VLANs require trunk mode/);
});

test("workspace exports round-trip IPv4, IPv6, and Unicode data", () => {
  const workspace = demo();
  workspace.name = "Café lab 💻";
  workspace.devices[0].management = "::ffff:c000:201";
  workspace.interfaces[0].addresses = ["203.0.113.1/255.255.255.248", "2001:0DB8::1/64"];
  const canonical = validate(workspace);
  assert.equal(canonical.devices[0].management, "::ffff:192.0.2.1");
  assert.deepEqual(canonical.interfaces[0].addresses, ["203.0.113.1/29", "2001:db8::1/64"]);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(canonical))), canonical);
});
