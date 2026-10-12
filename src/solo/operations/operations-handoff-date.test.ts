import { afterEach, expect, it } from "vitest";
import { resolveHandoffLocalDeadline } from "./operations-handoff-date";
const original=process.env.TZ;
afterEach(()=>{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;});
it("refuses the nonexistent spring-forward hour rather than confirming a different deadline",()=>{
 process.env.TZ="America/New_York";expect(new Date("2026-03-08T02:30").getHours()).toBe(3);expect(resolveHandoffLocalDeadline("2026-03-08T02:30")).toBeNull();
});
it("shows the same resolved instant and timezone that will be submitted",()=>{
 process.env.TZ="America/New_York";const result=resolveHandoffLocalDeadline("2026-03-08T03:30");expect(result?.iso).toBe("2026-03-08T07:30:00.000Z");expect(result?.label).toMatch(/EDT|GMT-4/);
});
it.each(["2026-02-30T12:00","2026-10-09T24:00","2026-10-09T12:60","invalid","2026-10-09"])("refuses invalid local date %s",value=>expect(resolveHandoffLocalDeadline(value)).toBeNull());
it("repeated fall-back times display the chosen offset for explicit review",()=>{
 process.env.TZ="America/New_York";const result=resolveHandoffLocalDeadline("2026-11-01T01:30");expect(result?.iso).toBe("2026-11-01T05:30:00.000Z");expect(result?.label).toMatch(/EDT|GMT-4/);
});
