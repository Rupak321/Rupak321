// Draws assets/activity.svg from the GitHub API: the last twelve months of
// contributions, a few counts, and the languages by real bytes.
//   GITHUB_TOKEN=... LOGIN=Rupak321 node .github/stats/activity.mjs
//
// Runs daily from .github/workflows/activity.yml. No dependencies: the old
// stats cards came from a shared service that went down and took the profile
// with it, so this one is drawn here and committed as a plain file.
import { readFileSync, writeFileSync } from "node:fs";

const LOGIN = process.env.LOGIN ?? "Rupak321";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const here = new URL(".", import.meta.url);
const font = (n) => readFileSync(new URL(`fonts/${n}.woff2`, here)).toString("base64");

const query = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
      totalCount
      nodes {
        name
        stargazerCount
        languages(first: 20) { edges { size node { name } } }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query, variables: { login: LOGIN } }),
});
const json = await res.json();
if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
const user = json.data.user;
const cal = user.contributionsCollection.contributionCalendar;
const repos = user.repositories.nodes;

// --- the numbers ---------------------------------------------------------------------
const days = cal.weeks.flatMap((w) => w.contributionDays);
let longest = 0, run = 0;
for (const d of days) {
  run = d.contributionCount > 0 ? run + 1 : 0;
  longest = Math.max(longest, run);
}
const stars = repos.reduce((a, r) => a + r.stargazerCount, 0);

// A Flutter repo reports C++, CMake, Swift and HTML from its platform folders:
// true bytes, but a lie about what was built. If a repo has Dart in it, only
// the Dart counts.
const bytes = new Map();
for (const r of repos) {
  let edges = r.languages.edges;
  if (edges.some((e) => e.node.name === "Dart")) edges = edges.filter((e) => e.node.name === "Dart");
  for (const e of edges) bytes.set(e.node.name, (bytes.get(e.node.name) ?? 0) + e.size);
}
const total = [...bytes.values()].reduce((a, b) => a + b, 0) || 1;
const ranked = [...bytes.entries()].sort((a, b) => b[1] - a[1]);
const TOP = 6;
const langs = ranked.slice(0, TOP).map(([name, b]) => ({ name, share: b / total }));
const rest = ranked.slice(TOP).reduce((a, [, b]) => a + b, 0) / total;
if (rest > 0.005) langs.push({ name: "other", share: rest });

// --- drawing ---------------------------------------------------------------------------
const C = {
  ink: "#0b0b0d", inkHi: "#15151a", inkLine: "#2b2b33", bone: "#ece6d9", boneDim: "#8f8a80",
  signal: "#a83226", signalHi: "#c9412f",
};
const LEVEL = { NONE: "#1b1b21", FIRST_QUARTILE: "#43191a", SECOND_QUARTILE: "#76241c", THIRD_QUARTILE: "#a83226", FOURTH_QUARTILE: "#e0573f" };
const W = 1200, L = 48, R = W - 48;
const fmt = (n) => n.toLocaleString("en-US");
const pct = (s) => (s * 100 >= 10 ? Math.round(s * 100) : (s * 100).toFixed(1)) + "%";

const stats = [
  [fmt(cal.totalContributions), "contributions · 12 months"],
  [fmt(longest), "longest streak · days"],
  [fmt(user.repositories.totalCount), "public repositories"],
  [fmt(stars), "stars"],
];
const colW = (R - L) / stats.length;
const statSvg = stats
  .map(([n, label], i) => {
    const x = L + i * colW;
    return `<g class="rise" style="animation-delay:${(0.2 + i * 0.1).toFixed(2)}s">
  <text x="${x}" y="142" class="mb" font-size="50" fill="${i === 0 ? C.signalHi : C.bone}">${n}</text>
  <text x="${x + 2}" y="166" class="m tr" font-size="11" fill="${C.boneDim}">${label.toUpperCase()}</text>
</g>`;
  })
  .join("");

// The year, a column a week. Each column lands as the scan line passes it.
const GY = 222, P = (R - L) / cal.weeks.length, CELL = Math.min(16, P - 4);
let months = "", lastMonth = -1;
const grid = cal.weeks
  .map((w, c) => {
    const x = L + c * P;
    const first = new Date(w.contributionDays[0].date + "T00:00:00Z");
    if (first.getUTCMonth() !== lastMonth && first.getUTCDate() <= 7 && c < cal.weeks.length - 2) {
      lastMonth = first.getUTCMonth();
      months += `<text x="${x.toFixed(1)}" y="${GY - 10}" class="m" font-size="10" fill="${C.boneDim}">${first.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toLowerCase()}</text>`;
    }
    const cells = w.contributionDays
      .map((d) => {
        const r = new Date(d.date + "T00:00:00Z").getUTCDay();
        return `<rect x="${x.toFixed(1)}" y="${(GY + r * P).toFixed(1)}" width="${CELL.toFixed(1)}" height="${CELL.toFixed(1)}" rx="3" fill="${LEVEL[d.contributionLevel] ?? LEVEL.NONE}"><title>${d.date}: ${d.contributionCount}</title></rect>`;
      })
      .join("");
    return `<g class="col" style="animation-delay:${(0.6 + c * 0.022).toFixed(3)}s">${cells}</g>`;
  })
  .join("");
const gridH = 7 * P;
const sweep = 0.6 + cal.weeks.length * 0.022;

// Languages: one band, cut where each language ends. Red leads, bone follows.
const BY = GY + gridH + 58, BH = 12, GAP = 3;
let bx = L;
const usable = R - L - GAP * (langs.length - 1);
const bands = langs
  .map((l, i) => {
    const w = Math.max(2, l.share * usable);
    const fill = i === 0 ? C.signalHi : C.bone;
    const op = i === 0 ? 1 : Math.max(0.16, 0.85 - i * 0.13);
    const seg = `<rect x="${bx.toFixed(1)}" y="${BY}" width="${w.toFixed(1)}" height="${BH}" rx="2" fill="${fill}" fill-opacity="${op.toFixed(2)}" class="band" style="animation-delay:${(sweep + 0.1 + i * 0.08).toFixed(2)}s"/>`;
    bx += w + GAP;
    return seg;
  })
  .join("");
let lx = L;
const legend = langs
  .map((l, i) => {
    const label = `${l.name} ${pct(l.share)}`;
    const x = lx;
    lx += 26 + label.length * 13 * 0.6 + 18;
    const fill = i === 0 ? C.signalHi : C.bone;
    const op = i === 0 ? 1 : Math.max(0.16, 0.85 - i * 0.13);
    return `<rect x="${x}" y="${BY + 30}" width="10" height="10" rx="2" fill="${fill}" fill-opacity="${op.toFixed(2)}"/><text x="${x + 18}" y="${BY + 39.5}" class="m" font-size="13" fill="${C.bone}">${l.name} <tspan fill="${C.boneDim}">${pct(l.share)}</tspan></text>`;
  })
  .join("");

const H = BY + 74;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">${LOGIN} on GitHub: ${fmt(cal.totalContributions)} contributions in the last 12 months, longest streak ${longest} days, ${user.repositories.totalCount} public repositories. Languages: ${langs.map((l) => `${l.name} ${pct(l.share)}`).join(", ")}.</title>
<style>
@font-face{font-family:J;src:url(data:font/woff2;base64,${font("mono-400")}) format("woff2");font-weight:400}
@font-face{font-family:J;src:url(data:font/woff2;base64,${font("mono-700")}) format("woff2");font-weight:700}
.m{font-family:J,ui-monospace,Menlo,Consolas,monospace;font-weight:400}
.mb{font-family:J,ui-monospace,Menlo,Consolas,monospace;font-weight:700}
.tr{letter-spacing:.18em}
.fade{animation:fade .7s ease-out both}
@keyframes fade{from{opacity:0}}
.rise{animation:rise .9s cubic-bezier(.16,1,.3,1) both}
@keyframes rise{from{opacity:0;transform:translateY(18px)}}
.col{animation:col .5s ease-out both}
@keyframes col{from{opacity:0}}
.scan{animation:scan ${(sweep - 0.4).toFixed(2)}s linear .6s both}
@keyframes scan{0%{transform:translateX(0);opacity:0}6%{opacity:1}92%{opacity:1}100%{transform:translateX(${R - L}px);opacity:0}}
.band{transform-box:fill-box;transform-origin:0 50%;animation:band .8s cubic-bezier(.16,1,.3,1) both}
@keyframes band{from{transform:scaleX(0)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.scan{display:none}}
</style>
<defs><clipPath id="card"><rect width="${W}" height="${H}" rx="22"/></clipPath></defs>
<g clip-path="url(#card)">
<rect width="${W}" height="${H}" fill="${C.ink}"/>
<g class="fade">
  <text x="${L}" y="44" class="m" font-size="14" fill="${C.bone}"><tspan fill="${C.signalHi}">$</tspan> git log --author=${LOGIN.toLowerCase()} --since=1.year</text>
  <text x="${R}" y="44" class="m tr" font-size="11" fill="${C.boneDim}" text-anchor="end">REDRAWN DAILY</text>
  <line x1="${L}" y1="62" x2="${R}" y2="62" stroke="${C.inkLine}"/>
</g>
${statSvg}
<g class="fade" style="animation-delay:.5s">${months}</g>
${grid}
<rect x="${L - 2}" y="${GY - 6}" width="2" height="${gridH + 8}" fill="${C.signalHi}" class="scan"/>
<g class="fade" style="animation-delay:${sweep.toFixed(2)}s">
  <text x="${L}" y="${BY - 14}" class="m tr" font-size="11" fill="${C.boneDim}">LANGUAGES · BY BYTES · A FLUTTER REPO COUNTS AS DART</text>
  ${legend}
</g>
${bands}
</g>
</svg>`;

writeFileSync(new URL("../../assets/activity.svg", here), svg);
console.log(`activity.svg: ${cal.totalContributions} contributions, streak ${longest}, ${user.repositories.totalCount} repos, ${langs.map((l) => l.name + " " + pct(l.share)).join(", ")}`);
