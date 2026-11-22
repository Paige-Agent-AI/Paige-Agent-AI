import { afterEach, describe, expect, it, vi } from "vitest";
describe("shared output pause/resume", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("Hold wins over an unresolved Resume and never fetches another voice", async () => {
    vi.resetModules();
    const audio = { paused: true, currentTime: 0, src: "", play: vi.fn(async () => { audio.paused = false; }), pause: vi.fn(() => { audio.paused = true; }) };
    vi.stubGlobal("Audio", function () { return audio; });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { messageTts } = await import("./messageTts");
    const fetchAudio = vi.fn(async () => new Blob(["test"]));
    await messageTts.toggle("one", fetchAudio);
    messageTts.pause();
    let finish!: () => void;
    audio.play.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const resuming = messageTts.resume();
    messageTts.pause();
    finish();
    await resuming;
    expect(messageTts.getSnapshot().status).toBe("paused");
    expect(audio.paused).toBe(true);
    await messageTts.toggle("one", fetchAudio);
    expect(messageTts.getSnapshot().status).toBe("playing");
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    messageTts.stop();
  });

  it("advances a spoken sequence only when the current audio ends naturally", async () => {
    vi.resetModules();
    const audio = { onended: () => {}, pause() {}, play: vi.fn(async () => {}) };
    vi.stubGlobal("Audio", function () { return audio; });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { messageTts } = await import("./messageTts");
    const done = vi.fn();
    const clip = async () => new Blob(["test"]);
    await messageTts.toggle("greeting", clip, undefined, done);
    audio.onended();
    expect(done).toHaveBeenCalledOnce();
    await messageTts.toggle("question", clip, undefined, done);
    messageTts.stop();
    audio.onended();
    expect(done).toHaveBeenCalledOnce();
  });
});
