import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EmailBodyPreview, PaigeConfirmCard } from "./PaigeConfirmCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });
function mount(node: React.ReactElement) {
  const host = document.createElement("div");document.body.appendChild(host);
  const root = createRoot(host);act(() => root.render(node));
  cleanup.push(() => { act(() => root.unmount());host.remove(); });return host;
}
const email = {kind:"email" as const,to_address:"client@example.invalid",from_address:"owner@example.invalid",subject:"Original saved email",body_text:"Welcome. Read the offer.",
  body_html:'<p><strong>Welcome.</strong> <a href="https://offer.example.invalid/terms">Read the offer.</a></p><img src="https://tracking.example.invalid/pixel">'};

describe("same original email body in approval cards and the inline check", () => {
  it.each(["shared card", "body reused by inline check"])("%s shows structure and inert destinations without resources", surface => {
    const host = mount(surface === "shared card"
      ? <PaigeConfirmCard actions={[{summary:"Review original email",fingerprint:"0123456789abcdef",preview:email}]} onApprove={()=>{}} onDeny={()=>{}} />
      : <EmailBodyPreview email={email} />);
    expect(host.querySelector("strong")?.textContent).toBe("Welcome.");
    expect(host.textContent).toContain("https://offer.example.invalid/terms");
    expect(host.querySelector("[data-email-rich-review] a,img,iframe,object")).toBeNull();
    expect(host.textContent).toContain("Images are hidden");
  });
  it("historical plain text remains literal and does not acquire rich-content notices", () => {
    const host = mount(<EmailBodyPreview email={{body_text:'<img src="https://tracking.example.invalid"> literal words'}} />);
    expect(host.textContent).toContain("<img");expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).not.toContain("Images are hidden");
  });
  it("the existing expansion remains keyboard reachable and controls its own body region", () => {
    const host = mount(<EmailBodyPreview email={{...email,body_text:"A long saved email.\n".repeat(40)}} />);
    const button = [...host.querySelectorAll("button")].find(b=>b.textContent==="Show full email")!;
    expect(button).toBeTruthy();act(()=>button.click());
    const region = host.querySelector('[role="region"]');expect(region?.id).toBe(button.getAttribute("aria-controls"));
    expect(region?.getAttribute("tabindex")).toBe("0");expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});
