import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioRecorder } from "./VoiceAudio";
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const audio = {
    events: [] as string[],
    contexts: [] as FakeContext[],
    gesture: true,
    captureAllowed: false,
    rejectTarget: false,
    resumeError: null as Error | null,
    resumeWait: null as ReturnType<typeof deferred<void>> | null,
};
class FakeContext {
    state = "suspended";
    sampleRate: number;
    destination = {};
    close = vi.fn(async () => {
        this.state = "closed";
    });
    source = { connect: vi.fn(), disconnect: vi.fn() };
    processor = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null as ((event: {
            inputBuffer: {
                getChannelData: (channel: number) => Float32Array;
            };
        }) => void) | null,
    };
    constructor(options?: AudioContextOptions) {
        audio.events.push(options ? "context:target" : "context:native");
        if (options && audio.rejectTarget)
            throw new DOMException("Unsupported rate", "NotSupportedError");
        this.sampleRate = options?.sampleRate ?? 48000;
        audio.contexts.push(this);
    }
    resume = vi.fn(() => {
        audio.events.push("resume");
        if (!audio.gesture && !audio.captureAllowed)
            return Promise.reject(new DOMException("Needs original tap", "NotAllowedError"));
        if (audio.resumeError)
            return Promise.reject(audio.resumeError);
        if (audio.resumeWait)
            return audio.resumeWait.promise.then(() => {
                if (this.state !== "closed")
                    this.state = "running";
            });
        this.state = "running";
        return Promise.resolve();
    });
    createMediaStreamSource = vi.fn(() => {
        audio.events.push("source");
        return this.source;
    });
    createScriptProcessor = vi.fn(() => this.processor);
}
let permission: ReturnType<typeof deferred<MediaStream>>, stopTrack: ReturnType<typeof vi.fn>, stream: MediaStream;
beforeEach(() => {
    audio.events = [];
    audio.contexts = [];
    audio.gesture = true;
    audio.captureAllowed = false;
    audio.rejectTarget = false;
    audio.resumeError = null;
    audio.resumeWait = null;
    permission = deferred<MediaStream>();
    stopTrack = vi.fn();
    stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("navigator", {
        mediaDevices: {
            getUserMedia: vi.fn(() => {
                audio.events.push("permission");
                audio.gesture = false;
                return permission.promise;
            }),
        },
    });
    vi.spyOn(console, "error").mockImplementation(() => { });
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
describe("original shared recorder mobile startup", () => {
    it("starts and resumes its audio context inside the original tap before permission resolves", async () => {
        const recorder = new AudioRecorder(vi.fn(), 16000);
        const starting = recorder.start();
        const beforeGrant = [...audio.events];
        permission.resolve(stream);
        await starting;
        expect(beforeGrant).toEqual(["context:target", "resume", "permission"]);
        expect(audio.contexts[0].state).toBe("running");
        expect(audio.contexts[0].source.connect).toHaveBeenCalledOnce();
        recorder.stop();
    });
    it("falls back only for an unsupported context rate and resamples native PCM to the existing16k contract", async () => {
        audio.rejectTarget = true;
        const frames = vi.fn();
        const recorder = new AudioRecorder(frames, 16000);
        const starting = recorder.start();
        permission.resolve(stream);
        await expect(starting).resolves.toBeUndefined();
        const context = audio.contexts[0];
        expect(context.sampleRate).toBe(48000);
        context.processor.onaudioprocess!({
            inputBuffer: { getChannelData: () => new Float32Array(480).fill(0.5) },
        });
        expect(frames).toHaveBeenCalledOnce();
        expect(frames.mock.calls[0][0]).toHaveLength(160);
        expect(frames.mock.calls[0][0][0]).toBe(0.5);
        recorder.stop();
    });
    it("does not retry an unrelated AudioContext constructor failure", async () => {
        const failure = new Error("device unavailable");
        vi.stubGlobal("AudioContext", class {
            constructor() {
                throw failure;
            }
        });
        const recorder = new AudioRecorder(vi.fn(), 16000);
        permission.resolve(stream);
        await expect(recorder.start()).rejects.toBe(failure);
        expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    });
    it("propagates resume failure and closes the acquired microphone and context", async () => {
        const failure = new Error("audio startup failed");
        audio.resumeError = failure;
        const recorder = new AudioRecorder(vi.fn(), 16000);
        const starting = recorder.start();
        permission.resolve(stream);
        await expect(starting).rejects.toBe(failure);
        expect(stopTrack).toHaveBeenCalledOnce();
        expect(audio.contexts[0].close).toHaveBeenCalledOnce();
        expect(audio.contexts[0].createMediaStreamSource).not.toHaveBeenCalled();
    });
    it("closes a primed context when permission is denied without opening an audio graph", async () => {
        const denied = new DOMException("Denied", "NotAllowedError");
        const recorder = new AudioRecorder(vi.fn(), 16000);
        const starting = recorder.start();
        permission.reject(denied);
        await expect(starting).rejects.toBe(denied);
        expect(audio.contexts).toHaveLength(1);
        expect(audio.contexts[0].close).toHaveBeenCalledOnce();
        expect(audio.contexts[0].createMediaStreamSource).not.toHaveBeenCalled();
    });
    it("stops a late permission grant after cancellation without restarting capture", async () => {
        const recorder = new AudioRecorder(vi.fn(), 16000);
        const starting = recorder.start();
        recorder.stop();
        permission.resolve(stream);
        await starting;
        expect(stopTrack).toHaveBeenCalledOnce();
        expect(audio.contexts).toHaveLength(1);
        expect(audio.contexts[0].close).toHaveBeenCalledOnce();
        expect(audio.contexts[0].createMediaStreamSource).not.toHaveBeenCalled();
    });
    it("cancels while resume is pending and never reconnects after it resolves", async () => {
        audio.resumeWait = deferred<void>();
        const recorder = new AudioRecorder(vi.fn(), 16000);
        const starting = recorder.start();
        permission.resolve(stream);
        await Promise.resolve();
        recorder.stop();
        audio.resumeWait.resolve();
        await starting;
        expect(stopTrack).toHaveBeenCalledOnce();
        expect(audio.contexts[0].close).toHaveBeenCalledOnce();
        expect(audio.contexts[0].createMediaStreamSource).not.toHaveBeenCalled();
    });
    it("ignores a queued audio frame after stop", async () => {
        const frames = vi.fn();
        const recorder = new AudioRecorder(frames, 16000);
        const starting = recorder.start();
        permission.resolve(stream);
        await starting;
        const callback = audio.contexts[0].processor.onaudioprocess!;
        recorder.stop();
        callback?.({
            inputBuffer: { getChannelData: () => new Float32Array([0.5]) },
        });
        expect(frames).not.toHaveBeenCalled();
    });
    it("preserves an asynchronous relay start when granted capture permits audio resume", async () => {
        audio.gesture = false;
        const recorder = new AudioRecorder(vi.fn(), 16000);
        const starting = recorder.start();
        audio.captureAllowed = true;
        permission.resolve(stream);
        await starting;
        expect(audio.contexts[0].resume).toHaveBeenCalledTimes(2);
        expect(audio.contexts[0].state).toBe("running");
        expect(audio.contexts[0].createMediaStreamSource).toHaveBeenCalledOnce();
        recorder.stop();
    });
    it("still refuses capture when the browser refuses resume after microphone permission", async () => {
        audio.gesture = false;
        const recorder = new AudioRecorder(vi.fn(), 16000);
        const starting = recorder.start();
        permission.resolve(stream);
        await expect(starting).rejects.toMatchObject({ name: "NotAllowedError" });
        expect(audio.contexts[0].resume).toHaveBeenCalledTimes(2);
        expect(stopTrack).toHaveBeenCalledOnce();
        expect(audio.contexts[0].close).toHaveBeenCalledOnce();
        expect(audio.contexts[0].createMediaStreamSource).not.toHaveBeenCalled();
    });
});
