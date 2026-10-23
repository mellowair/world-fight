import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STARTING_CHARACTERS } from "./characters.js";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

test("character selection and both ending states use the existing city panorama", () => {
  assert.match(css, /\.character-select-screen\s*\{[^}]*url\("assets\/city-night-pixel\.png"\)[^}]*cover/s);
  assert.match(css, /\.ending-screen\s*\{[^}]*url\("assets\/city-night-pixel\.png"\)[^}]*cover/s);
  assert.match(css, /\.ending-screen\.is-victory::before/);
  assert.match(css, /\.ending-screen\.is-defeat::before/);
  assert.match(app, /classList\.toggle\("is-victory", won\)/);
  assert.match(app, /classList\.toggle\("is-defeat", !won\)/);
  assert.doesNotMatch(css, /\.character-select-screen\s*\{[^}]*linear-gradient\(#9cdef0/s);
  assert.doesNotMatch(css, /\.ending-screen\s*\{[^}]*linear-gradient\(#a7e1f0/s);
});

test("all starter roles share bottom-aligned image framing and the PNG dimensions are unchanged", () => {
  assert.match(css, /\.starter-card img\s*\{[^}]*object-position:\s*center bottom/s);
  const png = readFileSync(new URL("./assets/city-night-pixel.png", import.meta.url));
  assert.equal(png.readUInt32BE(16), 1672);
  assert.equal(png.readUInt32BE(20), 941);
  for (const character of STARTING_CHARACTERS) {
    const path = new URL(`./${character.asset}`, import.meta.url);
    const svg = readFileSync(path, "utf8");
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /<rect[^>]+fill="#(?:54a76f|5ca66d|8dc878|79b86d)"/i);
  }
  assert.match(css, /\.starter-card\s*\{[^}]*box-shadow:\s*0 3px 0 rgba\(15,22,38/);
});

test("entry landing has no extended green strip or green landing dust", () => {
  assert.match(html, /class="entry-ground"/);
  assert.match(css, /\.entry-screen\s*\{[^}]*url\("assets\/city-night-pixel\.png"\)[^}]*cover/);
  assert.doesNotMatch(css, /\.entry-screen\s*\{[^}]*linear-gradient\(#9bdef1[^}]*#c9e8b7/s);
  assert.match(css, /\.entry-ground\s*\{[^}]*bottom:\s*35px[^}]*width:\s*42px[^}]*background:\s*rgba\(12,20,30/);
  assert.doesNotMatch(css, /\.entry-ground\s*\{[^}]*width:\s*88%/);
  assert.match(css, /\.entry-actor\.is-dropping::after\s*\{[^}]*background:\s*#a7a8a0/);
  assert.doesNotMatch(css, /\.entry-actor\.is-dropping::after\s*\{[^}]*background:\s*#4d8c60/);
});

test("unlearned skills keep the disabled style and use the 技 marker", () => {
  assert.match(app, /locked-skill[\s\S]*detail-skill-icon quiet">技/);
  assert.doesNotMatch(app, /detail-skill-icon quiet">锁/);
  assert.match(css, /\.detail-skill-row\.locked-skill\s*\{[^}]*opacity:\s*\.58[^}]*grayscale\(\.65\)/);
  assert.match(css, /\.detail-skill-icon\.quiet\s*\{[^}]*color:\s*#9ca69a/);
});

test("Boss distance marker follows route progress using selected art and the demon sign", () => {
  assert.match(html, /id="boss-distance-player" class="distance-portrait"/);
  assert.match(html, /class="boss-distance-icon" src="assets\/route-signs\/demon\.png"/);
  assert.doesNotMatch(html, /☠/);
  assert.match(app, /campaign\.runCharacterState\?\.characterId \?\? campaign\.playerId/);
  assert.match(app, /portrait\.src = character\.asset/);
  assert.match(app, /campaign\.step \/ 10/);
  assert.match(app, /portrait\.style\.left = `clamp\(10px,/);
  assert.doesNotMatch(css, /\.boss-distance-track\s*\{[^}]*overflow:\s*hidden/);
});

test("route signs are lowered to meet the grass foreground instead of hovering above it", () => {
  assert.match(css, /\.route-signs\s*\{[^}]*bottom:\s*21%/);
  assert.match(css, /\.route-sign-image\s*\{[^}]*object-position:\s*center bottom/);
  assert.match(css, /\.route-ground\s*\{[^}]*height:\s*26%/);
});
