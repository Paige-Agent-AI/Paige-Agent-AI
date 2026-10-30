import "../exp03-composer-inline-check-mount/main";
// Review controls sit outside product chrome; all data and effects are deterministic mocks.
const controls=document.createElement("aside");controls.setAttribute("aria-label","Prototype review controls");
controls.style.cssText="position:fixed;z-index:9999;left:8px;top:4px;background:#fff;color:#15112c;padding:6px;border:1px solid #777;font:12px sans-serif;max-width:90vw";
const label=document.createElement("label");label.textContent="Synthetic prototype · no live sends · ";
const select=document.createElement("select");select.setAttribute("aria-label","Door scenario");
for(const value of ["ok","suppressed","noconsent","nosender","noemail","member","unknown","hang","expire"]){const option=document.createElement("option");option.value=value;option.textContent=value;select.append(option);}
const params=new URLSearchParams(location.search);select.value=params.get("door")??"ok";
select.onchange=()=>{params.set("door",select.value);location.search=params.toString();};label.append(select);controls.append(label);document.body.append(controls);
