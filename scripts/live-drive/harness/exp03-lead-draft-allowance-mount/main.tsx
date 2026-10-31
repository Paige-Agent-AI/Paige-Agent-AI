// One read-only framework-native prototype, reusing the actual canonical inbox host.
// Server filing/worker execution is independently tested; these are post-worker fixtures.
import "../exp03-composer-inline-check-mount/main";

const params = new URLSearchParams(location.search);
const controls = document.createElement("aside");
controls.setAttribute("aria-label", "Prototype review controls");
controls.style.cssText = "position:fixed;z-index:9999;left:8px;top:4px;background:#fff;color:#15112c;padding:6px;border:1px solid #777;font:12px sans-serif;max-width:90vw";
const label = document.createElement("label");
label.textContent = "Synthetic prototype · no sends · post-worker fixture: ";
const select = document.createElement("select");
select.setAttribute("aria-label", "Eligibility scenario");
for (const [value, text] of Object.entries({ eligible: "101st eligible draft", hourly: "20/hour abuse hold", contact: "repeat contact hold", optout: "form not opted in", member: "member cannot approve", foreign: "other tenant draft excluded", error: "queue unavailable", malformed: "draft incomplete" })) {
  const option = document.createElement("option"); option.value = value; option.textContent = text; select.append(option);
}
select.value = params.get("draft") ?? "eligible";
select.onchange = () => { params.set("draft", select.value); location.search = params.toString(); };
label.append(select); controls.append(label); document.body.append(controls);
