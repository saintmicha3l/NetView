// Interface icons share a rounded 24-unit grid and use a tint on device and navigation tiles.
const paths = {
  brand: "M5.6 8.8 10 11m4 0 4.4-2.2M12 14.1v3.3M2.7 7.5l3-1.7 3 1.7v3.3l-3 1.7-3-1.7zm12.6 0 3-1.7 3 1.7v3.3l-3 1.7-3-1.7zM9 18.6l3-1.7 3 1.7v3.3l-3 1.7-3-1.7zm3-8.3 2.3 1.3v2.5L12 15.4l-2.3-1.3v-2.5z",
  workspace: "M5 6h5l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm3 8h8",
  topology: "M12 8v4m-6 4v-3h12v3M12 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 18a3 3 0 1 1 6 0 3 3 0 0 1-6 0zm12 0a3 3 0 1 1 6 0 3 3 0 0 1-6 0z",
  layers: "m12 3 9 5-9 5-9-5 9-5zm-9 9 8.2 4.6q.8.4 1.6 0L21 12M3 16l8.2 4.6q.8.4 1.6 0L21 16",
  device: "M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM8 20h8m-4-3.5V20",
  link: "M10 13a4 4 0 0 0 6 .4l4-4a4 4 0 0 0-5.7-5.7L12 6M14 11a4 4 0 0 0-6-.4l-4 4a4 4 0 0 0 5.7 5.7L12 18",
  grid: "M5 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm10 0h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM5 14h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zm10 0h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z",
  route: "M5.5 8.5V15a4 4 0 0 0 4 4H16a3 3 0 1 0 0-6h-2.5a3 3 0 1 1 0-6H21m-3-3 3 3-3 3M5.5 4a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5z",
  search: "M10 4a6 6 0 1 0 0 12 6 6 0 1 0 0-12zm5 11 5 5",
  chevron: "m9 6 6 6-6 6",
  chevrons: "m9 9 3-3 3 3m-6 6 3 3 3-3",
  down: "m6 9 6 6 6-6",
  settings: "M9.7 3h4.6l.5 2.7 2 .9 2.4-1.1 2.3 4-2 1.8v2.3l2 1.8-2.3 4-2.5-1-2 .9-.4 2.7H9.7l-.4-2.7-2-.9-2.5 1-2.3-4 2-1.8v-2.3l-2-1.8 2.3-4 2.4 1.1 2-.9.5-2.7zM12 9a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  cloud: "M7 18a4.5 4.5 0 1 1 .5-9 5.6 5.6 0 0 1 10.9 1.3 3.9 3.9 0 0 1-.4 7.7z",
  router: "M5 12h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zm2 0V7m10 5V7m-6-2a3 3 0 0 1 2 0M7 16h.1m3.4 0h.1m4.4 0h3",
  shield: "M12 3 4.5 6v5c0 4.5 3.2 8.3 7.5 10 4.3-1.7 7.5-5.5 7.5-10V6zM9 12l2 2 4-4",
  switch: "M4.5 6.5h15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zm2 4h3V14h-3zm7 0h3V14h-3zm5.8 1.7h.1",
  server: "M4 4.5h16v6H4zm0 9h16v6H4zm3-6h.1m-.1 9h.1m5-9h5m-5 9h5",
  mini: "M6.2 6.5h11.6a2 2 0 0 1 1.8 1.1l2 4.2v5.4a2.3 2.3 0 0 1-2.3 2.3H4.7a2.3 2.3 0 0 1-2.3-2.3v-5.4l2-4.2a2 2 0 0 1 1.8-1.1zm-3.8 5.7h19.2m-14.8 3.6h.1m3.9 0h3m3.5 0h.1",
  board: "M5 5h14v14H5zm4 4h6v6H9zM8 2v3m4-3v3m4-3v3M8 19v3m4-3v3m4-3v3M2 8h3m-3 4h3m-3 4h3M19 8h3m-3 4h3m-3 4h3",
  virtual: "M3 4h18v13H3zm4 16h10m-5-3v3m0-13 4 2.3v4.4l-4 2.3-4-2.3V9.3zm0 4.6 4-2.3m-4 2.3-4-2.3m4 2.3V16",
  container: "M3 6h18v12H3zM7 9v6m3-6v6m4-6v6m3-6v6",
  modem: "M4 10h16v9H4zm4 6h.1m4 0h.1m4 0h.1M9 7a4 4 0 0 1 6 0M6 4a8.5 8.5 0 0 1 12 0",
  patch: "M2 7h20v10H2zm3 3h2v4H5zm4 0h2v4H9zm4 0h2v4h-2zm4 0h2v4h-2z",
  camera: "M4 7h11v10H4zm11 4 5-3v8l-5-3",
  storage: "M5 7c0-2 3.1-3.5 7-3.5S19 5 19 7s-3.1 3.5-7 3.5S5 9 5 7zm0 0v10c0 2 3.1 3.5 7 3.5s7-1.5 7-3.5V7M5 12c0 2 3.1 3.5 7 3.5s7-1.5 7-3.5",
  wifi: "M3 8.5a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0m-9 3.3a5 5 0 0 1 6 0m-3 3.6h.1",
  laptop: "M5 5h14v11H5zm0 11-2.5 3h19L19 16",
  cube: "m12 3 8 4.5v9L12 21l-8-4.5v-9zm0 9 8-4.5M12 12 4 7.5m8 4.5v9",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  download: "M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4",
  upload: "M12 16V4M8 8l4-4 4 4M5 16v4h14v-4",
  edit: "m4 16-1 5 5-1L20 8l-4-4zm10-10 4 4",
  close: "m6 6 12 12M18 6 6 18",
  fit: "M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5",
  expand: "M14 4h6v6m0-6-7 7m-3 9H4v-6m0 6 7-7",
  collapse: "M20 4l-7 7m0-5v5h5M4 20l7-7m0 5v-5H6",
  inspect: "M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zm8.5 0v15m3-10h1.5m-1.5 4h1.5",
  hand: "M8 13V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v6c0 4-2.5 6-6 6h-1c-3 0-4.3-1.2-6-3.5l-3.2-4.4a1.6 1.6 0 0 1 2.4-2.1L8 13z",
  more: "M5 12h.1m6.9 0h.1m6.9 0h.1",
  port: "M5.5 5.5h13A1.5 1.5 0 0 1 20 7v8a1.5 1.5 0 0 1-1.5 1.5H15V19H9v-2.5H5.5A1.5 1.5 0 0 1 4 15V7a1.5 1.5 0 0 1 1.5-1.5zM8 9v3m4-3v3m4-3v3",
  pin: "M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zm0-13a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  layout: "M4 4h16v16H4zm0 5h16M9 9v11",
  table: "M4 5h16v14H4zm0 5h16m-16 4h16m-11-4v9",
  check: "m5 12 4 4L19 6",
  trash: "M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5",
  menu: "M4 6h16M4 12h16M4 18h16",
  filter: "M4 5h16l-6 7v6l-4 2v-8z",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v5m0-8h.1",
  bolt: "m13 3-8 11h6l-1 7 9-12h-6z",
  sort: "M8 20V4m-4 4 4-4 4 4m4-4v16m-4-4 4 4 4-4",
};

const fills = {
  brand: "M2.7 7.5l3-1.7 3 1.7v3.3l-3 1.7-3-1.7zm12.6 0 3-1.7 3 1.7v3.3l-3 1.7-3-1.7zM9 18.6l3-1.7 3 1.7v3.3l-3 1.7-3-1.7z",
  workspace: "M5 6h5l2 2h7q2 0 2 2v7q0 2-2 2H5q-2 0-2-2V8q0-2 2-2z",
  topology: "M12 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 18a3 3 0 1 1 6 0 3 3 0 0 1-6 0zm12 0a3 3 0 1 1 6 0 3 3 0 0 1-6 0z",
  layers: "m12 3 9 5-9 5-9-5 9-5z",
  device: "M5 4.5h14q2 0 2 2v8q0 2-2 2H5q-2 0-2-2v-8q0-2 2-2z",
  cloud: paths.cloud,
  router: "M5 12h14q2 0 2 2v4q0 2-2 2H5q-2 0-2-2v-4q0-2 2-2z",
  shield: "M12 3 4.5 6v5c0 4.5 3.2 8.3 7.5 10 4.3-1.7 7.5-5.5 7.5-10V6z",
  switch: "M4.5 6.5h15q2 0 2 2v7q0 2-2 2h-15q-2 0-2-2v-7q0-2 2-2z",
  mini: "M6.2 6.5h11.6q1.3 0 1.8 1.1l2 4.2H2.4l2-4.2q.6-1.1 1.8-1.1z",
  board: "M5 5h14v14H5z",
  storage: "M5 7c0-2 3.1-3.5 7-3.5S19 5 19 7s-3.1 3.5-7 3.5S5 9 5 7z",
  laptop: "M5 5h14v11H5z",
  bolt: paths.bolt,
};
const compiled = new Map();

export const deviceIcon = {
  cloud: "cloud", modem: "modem", router: "router", firewall: "shield", switch: "switch", "patch-panel": "patch",
  server: "server", "mini-pc": "mini", sbc: "board", hypervisor: "layers", vm: "virtual",
  container: "container", service: "bolt", storage: "storage", wireless: "wifi", client: "laptop",
  camera: "camera", iot: "cube", other: "device",
};

// The 19 silhouettes occupy consecutive slots in a five-column, four-row atlas.
const deviceArt = new Map([
  "mini-pc", "firewall", "switch", "storage", "wireless",
  "client", "cloud", "sbc", "server", "modem",
  "router", "camera", "patch-panel", "hypervisor", "vm",
  "container", "service", "iot", "other",
].map((kind, index) => [kind, index]));

const atlas = new Image();
atlas.addEventListener("load", () => document.documentElement.classList.add("has-device-artwork"), {once: true});
atlas.src = new URL("./device-icons.webp", import.meta.url);

function addDeviceArt(element) {
  const slot = deviceArt.get(element.dataset.deviceArt);
  if (slot === undefined || element.querySelector(".device-art")) return;
  const art = document.createElement("span");
  art.className = "device-art";
  art.style.setProperty("--art-x", `${slot % 5 * 25}%`);
  art.style.setProperty("--art-y", `${Math.floor(slot / 5) * 100 / 3}%`);
  element.append(art);
}

export function drawIcons(root) {
  for (const element of root.querySelectorAll("[data-icon]")) {
    if (element.dataset.deviceArt) addDeviceArt(element);
    const name = element.dataset.icon;
    if (!Object.hasOwn(paths, name)) continue;
    if (!compiled.has(name)) {
      compiled.set(name, {stroke: new Path2D(paths[name]), tint: fills[name] ? new Path2D(fills[name]) : null});
    }
    const {stroke, tint} = compiled.get(name);
    const existing = element.querySelector(":scope > canvas.icon");
    const canvas = existing || document.createElement("canvas");
    const resolution = Math.max(48, Math.ceil(devicePixelRatio * 24));
    canvas.width = canvas.height = resolution;
    canvas.className = "icon";
    canvas.setAttribute("aria-hidden", "true");
    const context = canvas.getContext("2d");
    context.scale(resolution / 24, resolution / 24);
    const color = getComputedStyle(element).color;
    if (tint) {
      context.fillStyle = color;
      context.globalAlpha = name === "brand" ? .42 : .17;
      context.fill(tint);
      context.globalAlpha = 1;
    }
    context.strokeStyle = color;
    context.lineWidth = name === "more" ? 3 : name === "brand" ? 1.35 : 1.65;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(stroke);
    if (!existing) element.prepend(canvas);
  }
}
