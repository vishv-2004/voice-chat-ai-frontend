import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Send,
  Loader2,
  Mic,
  Square,
  Volume2,
  VolumeX,
  MessageSquareText,
  AudioLines,
  Copy,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';

export default function App() {
  const [inputMode, setInputMode] = useState('text');
  const [userMessage, setUserMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(null);

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const [speakingIndex, setSpeakingIndex] = useState(null);
  const [ttsProgress, setTtsProgress] = useState(0);

  const audioCtxRef = useRef(null);
  const abortControllerRef = useRef(null);
  const sourceNodesRef = useRef([]);
  const bottomRef = useRef(null);
  const chatContainerRef = useRef(null);

  const suggestions = [
    { text: 'Create an AI learning roadmap', icon: '🗺️' },
    { text: 'Explain a complex coding concept', icon: '💡' },
    { text: 'Get tech career & placement advice', icon: '🎯' },
    { text: 'Why do skills beat degrees?', icon: '🏆' },
  ];

  const detectTTSVoice = useCallback((text) => {
    const input = String(text || '');
    const hasDevanagari = /[\u0900-\u097F]/.test(input);
    const hindiMarkers =
      /\b(haan|haanji|nahi|nahin|kya|kaise|kyu|kyon|aur|hai|hoon|main|tum|aap|ye|woh|isko|isse|samjho|samjha|samjhe)\b/i.test(
        input,
      );
    const englishWordCount = (input.match(/\b[a-z]{3,}\b/gi) || []).length;

    if (hasDevanagari || hindiMarkers) return 'hi-IN-SwaraNeural';
    if (englishWordCount >= 8) return 'en-US-AriaNeural';
    return 'hi-IN-SwaraNeural';
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const stopTTS = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    sourceNodesRef.current.forEach((n) => {
      try {
        n.stop();
      } catch (_) { }
    });
    sourceNodesRef.current = [];
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => { });
      audioCtxRef.current = null;
    }
    setSpeakingIndex(null);
    setLoadingStage(null);
    setTtsProgress(0);
  }, []);

  useEffect(() => () => stopTTS(), [stopTTS]);

  const streamTTS = useCallback(
    async (text, msgIndex) => {
      stopTTS();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setSpeakingIndex(msgIndex ?? null);
      setLoadingStage('converting');
      setTtsProgress(0);
      try {
        const voice = detectTTSVoice(text);
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('TTS request failed');
        const arrayBuffer = await res.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        setLoadingStage(null);
        setTtsProgress(100);
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(ctx.destination);
        src.start(0);
        sourceNodesRef.current.push(src);
        src.onended = () => {
          sourceNodesRef.current = [];
          abortControllerRef.current = null;
          setSpeakingIndex(null);
          setTtsProgress(0);
        };
        abortControllerRef.current = null;
      } catch (err) {
        if (err.name !== 'AbortError') console.error('TTS error:', err);
        setSpeakingIndex(null);
        setLoadingStage(null);
        setTtsProgress(0);
      }
    },
    [stopTTS, detectTTSVoice],
  );

  const sendMessage = useCallback(
    async (autoBlobOverride, prefillText) => {
      const blobToSend = autoBlobOverride ?? audioBlob;
      const textToSend = prefillText ?? userMessage;
      if (!textToSend?.trim() && !blobToSend) return;

      const isVoiceOnly = !!blobToSend && !textToSend?.trim();

      if (isVoiceOnly) {
        // Show a voice message bubble immediately
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: '', isVoice: true },
        ]);
      } else if (textToSend?.trim()) {
        setMessages((prev) => [...prev, { role: 'user', text: textToSend }]);
      }

      setIsLoading(true);
      setLoadingStage('thinking');
      setUserMessage('');
      const formData = new FormData();
      if (textToSend?.trim()) formData.append('message', textToSend);
      if (blobToSend) formData.append('audio', blobToSend, 'recording.webm');

      // Send conversation history so the model has full context
      const history = messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text,
      }));
      formData.append('history', JSON.stringify(history));
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/groq`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.error || data.details || 'An error occurred');

        // If backend returned a transcription, update the voice message with it
        if (data.transcription && isVoiceOnly) {
          setMessages((prev) => {
            const updated = [...prev];
            // Find the last voice message from user and update it
            for (let idx = updated.length - 1; idx >= 0; idx--) {
              if (updated[idx].role === 'user' && updated[idx].isVoice) {
                updated[idx] = {
                  ...updated[idx],
                  text: data.transcription,
                };
                break;
              }
            }
            return updated;
          });
        }

        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: data.response, model: data.model },
        ]);
        const assistantIndex = messages.length + 1;
        streamTTS(data.response, assistantIndex);
        setAudioBlob(null);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: error.message || 'Unknown error',
            isError: true,
          },
        ]);
        setLoadingStage(null);
      } finally {
        setIsLoading(false);
      }
    },
    [userMessage, audioBlob, streamTTS, messages],
  );

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        sendMessage(blob);
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      alert('Could not access microphone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
  };

  const getLoadingText = () => {
    if (loadingStage === 'thinking') return 'Thinking...';
    if (loadingStage === 'converting') return 'Converting to speech...';
    return 'Processing...';
  };

  const copyText = (text) => navigator.clipboard.writeText(text);

  const handleFeedback = (index, type) => {
    setMessages((prev) => {
      const newMsgs = [...prev];
      newMsgs[index] = {
        ...newMsgs[index],
        feedback: newMsgs[index].feedback === type ? null : type,
      };
      return newMsgs;
    });
  };

  const hasMessages = messages.length > 0;
  const isActiveMessage = (i) => i === messages.length - 1;

  const actionBtn =
    'inline-flex items-center gap-[5px] px-2 py-[5px] rounded-md text-[13px] text-[#8e8ea0] bg-transparent border-none cursor-pointer transition-colors hover:bg-[#ececec] hover:text-[#6e6e80]';

  return (
    /* 
      KEY FIX: 
      - Outer div: h-screen overflow-hidden (fixed height, no scroll on body)
      - Inner layout: flex-col h-full
      - Chat area: flex-1 overflow-y-auto (only this scrolls)
    */
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* ── Header (fixed at top) ── */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-[10px] border-b border-[#ebebeb] bg-white z-10">
        <button className="flex items-center gap-[10px] px-3 py-[6px] rounded-lg text-[15px] font-semibold text-[#0d0d0d] cursor-pointer transition-colors hover:bg-[#ececec] border-none bg-transparent">
          <img
            src="/logo.webp"
            alt="Vneviks AI"
            className="w-[35px] h-[35px] object-contain rounded-full"
          />
          <span>Vneviks AI</span>
        </button>
        <div className="flex items-center gap-[6px] text-xs text-[#10a37f] font-medium">
          <span
            className="w-[6px] h-[6px] rounded-full bg-[#10a37f]"
            style={{ animation: 'pulse-dot 2s ease-in-out infinite' }}
          />
          <span>Online</span>
        </div>
      </header>

      {/* ── Chat Area (this is the ONLY scrollable zone) ── */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto">
        {!hasMessages && !isLoading ? (
          /* ── Welcome: full height centered ── */
          <div
            className="flex flex-col items-center justify-center gap-5 px-6 py-10"
            style={{ minHeight: '100%' }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
            >
              <img
                src="/logo.webp"
                alt="Vneviks AI"
                className="w-full h-full object-contain rounded-full"
              />
            </div>
            <h2 className="text-[22px] font-semibold text-[#0d0d0d] text-center">
              How can I help you today?
            </h2>
            <div className="grid grid-cols-2 gap-[10px] w-full max-w-[768px] max-sm:grid-cols-1">
              {suggestions.map((s) => (
                <button
                  key={s.text}
                  onClick={() => sendMessage(undefined, s.text)}
                  className="flex items-center gap-[10px] px-4 py-[14px] border border-[#e5e5e5] rounded-2xl bg-white cursor-pointer text-sm text-[#0d0d0d] transition-colors hover:bg-[#f7f7f8] hover:border-[#ebebeb] text-left leading-[1.4]"
                >
                  <span style={{ fontSize: 18 }}>{s.icon}</span>
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── Messages ── */
          <div className="flex flex-col py-2">
            {messages.map((msg, i) => (
              <div key={i} className="py-5 flex justify-center">
                <div className="w-full max-w-[768px] px-6 flex gap-4 max-md:px-4 max-md:gap-3 max-sm:px-3 max-sm:gap-[10px]">
                  {/* Avatar */}
                  <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden mt-[2px]">
                    <img
                      src={
                        msg.role === 'assistant' ? '/logo.webp' : '/people.png'
                      }
                      alt={msg.role}
                      className="w-full h-full object-contain rounded-full"
                    />
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    {msg.role === 'user' && !msg.isVoice && (
                      <div className="text-[15px] leading-[1.7] text-[#0d0d0d] whitespace-pre-wrap break-words">
                        {msg.text}
                      </div>
                    )}

                    {msg.role === 'user' && msg.isVoice && (
                      <div className="voice-bubble">
                        <div className="voice-bubble-header">
                          <div className="voice-icon-wrapper">
                            <Mic size={16} className="voice-icon" />
                          </div>
                          <div className="voice-waveform">
                            {[...Array(24)].map((_, j) => (
                              <span
                                key={j}
                                className="voice-bar"
                                style={{
                                  animationDelay: `${j * 0.06}s`,
                                  height: `${4 + Math.sin(j * 0.8) * 10 + ((j * 7 + 3) % 6)}px`,
                                }}
                              />
                            ))}
                          </div>
                          <span className="voice-label">Voice message</span>
                        </div>
                        {msg.text && (
                          <div className="voice-transcription">
                            <span className="voice-transcription-label">Transcription:</span>
                            <span className="voice-transcription-text">{msg.text}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {msg.role === 'assistant' && msg.isError && (
                      <div className="text-[15px] leading-[1.7] text-[#ef4444] whitespace-pre-wrap break-words">
                        ⚠️ {msg.text}
                      </div>
                    )}

                    {msg.role === 'assistant' && !msg.isError && (
                      <div className="flex flex-col gap-[10px] px-5 py-4 bg-[#f7f7f8] border border-[#e5e5e5] rounded-2xl max-sm:px-3 max-sm:py-[10px]">
                        {/* Generating voice */}
                        {speakingIndex === i &&
                          loadingStage === 'converting' && (
                            <div className="flex items-center gap-2 opacity-80">
                              <Loader2
                                size={15}
                                className="text-[#8e8ea0]"
                                style={{ animation: 'spin 1s linear infinite' }}
                              />
                              <span className="text-[13px] font-medium text-[#6e6e80]">
                                Generating voice...
                              </span>
                            </div>
                          )}

                        {/* Playing */}
                        {speakingIndex === i && !loadingStage && (
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-end gap-[3px] h-[22px]">
                              {[...Array(7)].map((_, j) => (
                                <span
                                  key={j}
                                  className="w-1 rounded-full bg-[#10a37f]"
                                  style={{
                                    animation:
                                      'audioBarLarge 0.7s ease-in-out infinite alternate',
                                    animationDelay: `${j * 0.1}s`,
                                  }}
                                />
                              ))}
                            </div>
                            <span className="text-sm font-medium text-[#6e6e80]">
                              Playing voice…
                            </span>
                            <button
                              onClick={stopTTS}
                              className={actionBtn + ' hover:text-[#ef4444]'}
                            >
                              <VolumeX size={14} />
                              <span>Stop</span>
                            </button>
                          </div>
                        )}

                        {/* Idle */}
                        {speakingIndex !== i && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-[#6e6e80]">
                              🔊 Voice response
                            </span>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-[2px] flex-wrap">
                          {speakingIndex !== i && (
                            <button
                              onClick={() => streamTTS(msg.text, i)}
                              className={actionBtn}
                            >
                              <Volume2 size={14} />
                              <span>Replay</span>
                            </button>
                          )}
                          <button
                            onClick={() => copyText(msg.text)}
                            className={actionBtn}
                          >
                            <Copy size={14} />
                            <span>Copy</span>
                          </button>
                          <button
                            className={`thumbs-up-btn ${actionBtn} ${msg.feedback === 'up' ? 'active-feedback' : ''}`}
                            onClick={() => handleFeedback(i, 'up')}
                          >
                            <ThumbsUp
                              size={14}
                              className={
                                msg.feedback === 'up' ? 'icon-pop' : ''
                              }
                            />
                          </button>
                          <button
                            className={`thumbs-down-btn ${actionBtn} ${msg.feedback === 'down' ? 'active-feedback' : ''}`}
                            onClick={() => handleFeedback(i, 'down')}
                          >
                            <ThumbsDown
                              size={14}
                              className={
                                msg.feedback === 'down' ? 'icon-pop' : ''
                              }
                            />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Thinking dots */}
            {isLoading && (
              <div className="py-5 flex justify-center">
                <div className="max-w-[768px] px-6 flex gap-4 w-full max-md:px-4 max-sm:px-3">
                  <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden mt-[2px]">
                    <img
                      src="/logo.webp"
                      alt="Bot"
                      className="w-full h-full object-contain rounded-full"
                    />
                  </div>
                  <div className="flex items-center gap-1 pt-[6px]">
                    {['-0.32s', '-0.16s', '0s'].map((delay, idx) => (
                      <span
                        key={idx}
                        className="w-[7px] h-[7px] rounded-full bg-[#8e8ea0] inline-block"
                        style={{
                          animation: 'dotPulse 1.4s infinite ease-in-out both',
                          animationDelay: delay,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Input Area (fixed at bottom) ── */}
      <div
        className="flex-shrink-0 border-t border-[#ebebeb] bg-white px-4 pt-3 pb-4 flex flex-col items-center gap-[10px]"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        {/* Mode Switch */}
        <div className="flex gap-[2px] bg-[#f7f7f8] p-[3px] rounded-lg">
          {['text', 'speech'].map((mode) => (
            <button
              key={mode}
              onClick={() => setInputMode(mode)}
              className={`flex items-center gap-[5px] px-[14px] py-[6px] rounded-md text-[13px] font-medium border-none cursor-pointer transition-all capitalize ${inputMode === mode
                ? 'bg-white text-[#0d0d0d] shadow-sm'
                : 'bg-transparent text-[#8e8ea0] hover:text-[#6e6e80]'
                }`}
            >
              {mode === 'text' ? (
                <MessageSquareText size={14} />
              ) : (
                <AudioLines size={14} />
              )}
              <span>{mode}</span>
            </button>
          ))}
        </div>

        {/* Text Composer */}
        {inputMode === 'text' && (
          <div
            className="w-full max-w-[768px] border border-[#e5e5e5] rounded-[28px] bg-white px-[14px] py-[10px] flex items-end gap-2 transition-all"
            style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
            onFocus={(e) =>
            (e.currentTarget.style.boxShadow =
              '0 0 0 2px rgba(16,163,127,0.15)')
            }
            onBlur={(e) =>
              (e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)')
            }
          >
            <textarea
              rows={1}
              placeholder="Message Vneviks AI…"
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              className="flex-1 bg-transparent border-none resize-none text-[15px] text-[#0d0d0d] leading-[1.5] outline-none min-h-6 max-h-[200px] placeholder-[#b4b4b4]"
            />
            <button
              onClick={() => sendMessage()}
              disabled={isLoading || !userMessage.trim()}
              className="w-8 h-8 rounded-full border-none cursor-pointer flex items-center justify-center flex-shrink-0 transition-all bg-[#0d0d0d] hover:bg-[#2b2b2b] disabled:bg-[#e5e5e5] disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2
                  size={16}
                  className="text-white"
                  style={{ animation: 'spin 1s linear infinite' }}
                />
              ) : (
                <Send size={16} className="text-white" />
              )}
            </button>
          </div>
        )}

        {/* Speech */}
        {inputMode === 'speech' && (
          <div className="flex flex-col items-center gap-[14px] py-4 w-full max-w-[768px]">
            {!isRecording && !isLoading && (
              <button
                onClick={startRecording}
                className="flex flex-col items-center gap-[10px] bg-transparent border-none cursor-pointer"
              >
                <div className="w-16 h-16 rounded-full flex items-center justify-center bg-[#f7f7f8] border-2 border-[#e5e5e5] hover:border-[#8e8ea0] hover:bg-[#ececec] transition-all">
                  <Mic size={22} className="text-[#6e6e80]" />
                </div>
                <span className="text-[13px] text-[#8e8ea0]">
                  Tap to record
                </span>
              </button>
            )}
            {isRecording && (
              <button
                onClick={stopRecording}
                className="flex flex-col items-center gap-[10px] bg-transparent border-none cursor-pointer"
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center bg-[rgba(239,68,68,0.08)] border-2 border-[#ef4444] transition-all"
                  style={{ animation: 'pulse-ring 1.5s ease-in-out infinite' }}
                >
                  <Square size={18} className="text-[#ef4444]" />
                </div>
                <span className="text-[13px] text-[#ef4444] font-medium">
                  Tap to stop & send
                </span>
              </button>
            )}
            {isLoading && (
              <div className="flex flex-col items-center gap-2">
                <Loader2
                  size={26}
                  className="text-[#8e8ea0]"
                  style={{ animation: 'spin 1s linear infinite' }}
                />
                <span className="text-[13px] text-[#8e8ea0]">
                  {getLoadingText()}
                </span>
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-[#8e8ea0] text-center">
          Vneviks AI can make mistakes. Consider checking important information.
        </p>
      </div>
    </div>
  );
}
