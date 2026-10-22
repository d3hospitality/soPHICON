/** Phone dictation uses the same PCM16LE/16kHz endpoint as glasses. */
export class AphoricaRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
    this.context = new AudioContext();
    await this.context.resume();
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = e => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }
  async stop() {
    const rate = this.context?.sampleRate || 16000;
    this.processor?.disconnect(); this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    await this.context?.close().catch(() => {});
    const input = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of this.chunks) { input.set(c, offset); offset += c.length; }
    this.chunks = [];
    const count = Math.floor(input.length * 16000 / rate);
    const bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer);
    for (let i = 0; i < count; i++) {
      const pos = i * rate / 16000, left = Math.floor(pos);
      const sample = Math.max(-1, Math.min(1, input[left] + (input[Math.min(left + 1, input.length - 1)] - input[left]) * (pos - left)));
      view.setInt16(i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { audio: btoa(binary), seconds: count / 16000 };
  }
}
