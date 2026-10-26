import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    const filePath = resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(root + sep)) throw new Error("Invalid path");
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": types[extname(filePath)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

function isPrivateIPv4(address) {
  return address.startsWith("10.") || address.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

const lanAddresses = Object.values(networkInterfaces()).flat()
  .filter((item) => item && item.family === "IPv4" && !item.internal && isPrivateIPv4(item.address))
  .map((item) => item.address);

server.listen(8000, "0.0.0.0", () => {
  const localUrl = "http://127.0.0.1:8000";
  console.log(`Prototype ready at ${localUrl}`);
  if (lanAddresses.length) {
    console.log("Phone on the same Wi-Fi:");
    for (const address of lanAddresses) console.log(`  http://${address}:8000`);
  } else {
    console.log("No private LAN IPv4 address found. Connect to Wi-Fi and restart the server.");
  }
  console.log("Press Ctrl+C to stop the server.");
  if (process.argv.includes("--open") && process.platform === "win32") {
    const browser = spawn("cmd.exe", ["/c", "start", "", localUrl], { detached: true, stdio: "ignore" });
    browser.unref();
  }
});
