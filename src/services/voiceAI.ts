import type { AgentCore, AgentReply } from './agentCore.ts';

export interface VoiceTranscript {
  text: string;
  confidence?: number;
}

/** ASR seam：未来接小智 AI、本机 Whisper 或其它服务时只需换 Adapter。 */
export interface VoiceInput {
  available(): boolean;
  listen(locale?: string): Promise<VoiceTranscript>;
}

/** TTS seam：不认识在线模型，也不认识 Tool。 */
export interface VoiceOutput {
  available(): boolean;
  speak(text: string, locale?: string): Promise<void>;
  stop(): void;
}

export interface VoiceAgentResult {
  transcript: VoiceTranscript;
  reply: AgentReply;
}

/** ASR → Agent Core → Tool → TTS 的可替换编排层。 */
export class VoiceAgent {
  private readonly input: VoiceInput;
  private readonly output: VoiceOutput;
  private readonly agent: AgentCore;

  constructor(input: VoiceInput, output: VoiceOutput, agent: AgentCore) {
    this.input = input;
    this.output = output;
    this.agent = agent;
  }

  inputAvailable(): boolean { return this.input.available(); }

  async run(locale = 'zh-CN'): Promise<VoiceAgentResult> {
    if (!this.input.available()) throw new Error('当前设备没有可用的 ASR；语音接口已预留，可替换为小智 AI 或其它开源方案');
    const transcript = await this.input.listen(locale);
    const text = transcript.text.trim();
    if (!text) throw new Error('没有识别到语音内容');
    const reply = await this.agent.ask(text);
    if (this.output.available()) {
      const spoken = reply.confirmation ? '这项操作需要你在屏幕上确认。' : reply.content;
      await this.output.speak(spoken.slice(0, 500), locale);
    }
    return { transcript, reply };
  }
}

/** 零依赖默认 Adapter：WebView 支持 Web Speech API 时直接可用，不支持时明确降级。 */
export class BrowserSpeechInput implements VoiceInput {
  available(): boolean {
    const scope = typeof window === 'undefined' ? null : window as any;
    return !!(scope?.SpeechRecognition || scope?.webkitSpeechRecognition);
  }

  listen(locale = 'zh-CN'): Promise<VoiceTranscript> {
    const scope = typeof window === 'undefined' ? null : window as any;
    const Recognition = scope?.SpeechRecognition || scope?.webkitSpeechRecognition;
    if (!Recognition) return Promise.reject(new Error('当前 WebView 不支持语音识别'));
    return new Promise<VoiceTranscript>((resolve, reject) => {
      const recognition = new Recognition();
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        try { recognition.abort(); } catch { /* 已结束 */ }
        finish(() => reject(new Error('语音识别超时，请重试')));
      }, 15_000);
      recognition.lang = locale;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event: any) => {
        const result = event?.results?.[0]?.[0];
        finish(() => resolve({ text: String(result?.transcript || ''), confidence: Number(result?.confidence) || undefined }));
      };
      recognition.onerror = (event: any) => finish(() => reject(new Error(voiceErrorText(event?.error))));
      recognition.onnomatch = () => finish(() => reject(new Error('没有听清，请重试')));
      try { recognition.start(); }
      catch { finish(() => reject(new Error('无法启动语音识别'))); }
    });
  }
}

export class BrowserSpeechOutput implements VoiceOutput {
  available(): boolean { return typeof window !== 'undefined' && 'speechSynthesis' in window; }

  speak(text: string, locale = 'zh-CN'): Promise<void> {
    if (!this.available()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = locale;
      utterance.rate = 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    if (this.available()) window.speechSynthesis.cancel();
  }
}

function voiceErrorText(code: unknown): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') return '没有麦克风或语音服务权限';
  if (code === 'no-speech') return '没有听到语音，请重试';
  if (code === 'network') return '语音识别服务当前不可用';
  return '语音识别失败，请重试';
}
