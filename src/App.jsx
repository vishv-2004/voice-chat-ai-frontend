// ─── Imports ───────────────────────────────────────────────────
// useState  → lets us store data that can change (like messages, what the user typed, etc.)
// useRef    → lets us hold a reference to something (like the mic recorder or a DOM element) without causing a re-render
// useEffect → lets us run code when something changes (e.g., scroll down when a new message appears)
import { useState, useRef, useCallback, useEffect } from 'react';

// These are pre-built icon components from the "lucide-react" library.
// Instead of using images, we import them like components: <Send />, <Mic />, etc.
import {
  Send,           // arrow icon for the send button
  Loader2,        // spinning loader icon
  Mic,            // microphone icon
  Square,         // stop (square) icon for stopping recording
  Volume2,        // speaker icon (sound on)
  VolumeX,        // speaker-muted icon (sound off)
  MessageSquareText, // chat bubble icon for "text" mode tab
  AudioLines,     // sound wave icon for "speech" mode tab
  Copy,           // copy-to-clipboard icon
  ThumbsUp,       // 👍 feedback icon
  ThumbsDown,     // 👎 feedback icon
} from 'lucide-react';

// ─── Main App Component ───────────────────────────────────────
// This is the ENTIRE app. Everything you see on screen lives inside this one function.
export default function App() {

  // ─── State Variables (The App's Memory) ─────────────────────
  // Each useState gives us: [currentValue, functionToUpdateIt]
  // When we call the update function, React re-draws the screen with the new value.

  // Which input mode is active: 'text' (keyboard) or 'speech' (microphone)
  const [inputMode, setInputMode] = useState('text');

  // What the user is currently typing in the text box
  const [userMessage, setUserMessage] = useState('');

  // The full conversation — an array of message objects like:
  //   { role: 'user', text: 'Hello' }
  //   { role: 'assistant', text: 'Hi there!', model: 'llama-3.3-70b' }
  const [messages, setMessages] = useState([]);

  // Is the AI currently processing our message? (shows loading dots)
  const [isLoading, setIsLoading] = useState(false);

  // What stage of loading are we in? ('thinking', 'converting', or null)
  const [loadingStage, setLoadingStage] = useState(null);

  // ─── Recording State ────────────────────────────────────────
  // Is the microphone currently recording?
  const [isRecording, setIsRecording] = useState(false);

  // The recorded audio data (a "Blob" — think of it as a file in memory)
  const [audioBlob, setAudioBlob] = useState(null);

  // A reference to the MediaRecorder object (the browser's built-in audio recorder)
  const mediaRecorderRef = useRef(null);

  // Temporary storage for audio chunks as they come in while recording
  const chunksRef = useRef([]);

  // ─── Text-to-Speech (TTS) State ─────────────────────────────
  // Which message index is currently being spoken out loud (null = none)
  const [speakingIndex, setSpeakingIndex] = useState(null);

  // How far along the TTS conversion is (0 to 100)
  const [ttsProgress, setTtsProgress] = useState(0);

  // ─── Refs (references to things we need to access directly) ─
  // The audio player context (Web Audio API)
  const audioCtxRef = useRef(null);

  // Used to cancel an ongoing TTS request if user clicks "Stop"
  const abortControllerRef = useRef(null);

  // List of audio source nodes currently playing
  const sourceNodesRef = useRef([]);

  // A reference to an invisible div at the bottom of the chat — we scroll to it to auto-scroll down
  const bottomRef = useRef(null);

  // A reference to the chat container div
  const chatContainerRef = useRef(null);

  // ─── Suggestion Cards ───────────────────────────────────────
  // These are the clickable cards shown on the welcome screen when there are no messages yet.
  // Clicking one sends that text as a message to the AI.
  const suggestions = [
    { text: 'Create an AI learning roadmap', icon: '🗺️' },
    { text: 'Explain a complex coding concept', icon: '💡' },
    { text: 'Get tech career & placement advice', icon: '🎯' },
    { text: 'Why do skills beat degrees?', icon: '🏆' },
  ];

  // ─── detectTTSVoice(text) ────────────────────────────────────
  // PURPOSE: Automatically pick the right voice for text-to-speech.
  //   - If the text has Hindi characters (देवनागरी) or common Hindi words → use Hindi voice
  //   - If the text has 8+ English words → use English voice
  //   - Default → Hindi voice
  // This way the AI speaks in the same language the user/AI is using.
  const detectTTSVoice = useCallback((text) => {
    const input = String(text || '');

    // Check if text contains Hindi (Devanagari) script characters
    const hasDevanagari = /[\u0900-\u097F]/.test(input);

    // Check for common Hindi words written in English letters (like "kya", "hai", "aap")
    const hindiMarkers =
      /\b(haan|haanji|nahi|nahin|kya|kaise|kyu|kyon|aur|hai|hoon|main|tum|aap|ye|woh|isko|isse|samjho|samjha|samjhe)\b/i.test(
        input,
      );

    // Count how many English words are in the text
    const englishWordCount = (input.match(/\b[a-z]{3,}\b/gi) || []).length;

    // Decision: Hindi detected → Hindi voice, lots of English → English voice, otherwise Hindi
    if (hasDevanagari || hindiMarkers) return 'hi-IN-SwaraNeural';
    if (englishWordCount >= 8) return 'en-US-AriaNeural';
    return 'hi-IN-SwaraNeural';
  }, []);

  // ─── Auto-scroll to bottom ──────────────────────────────────
  // Every time the messages list changes or loading starts/stops,
  // smoothly scroll the chat down so the latest message is visible.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ─── stopTTS() ──────────────────────────────────────────────
  // PURPOSE: Stop any voice that is currently playing.
  // Called when: user clicks "Stop" button, or before playing a new voice.
  // What it does:
  //   1. Cancel any ongoing TTS network request
  //   2. Stop all audio that's currently playing
  //   3. Close the audio player
  //   4. Reset all speaking-related state back to "nothing is playing"
  const stopTTS = useCallback(() => {
    // Cancel the network request if one is in progress
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Stop all audio sources that are currently playing
    sourceNodesRef.current.forEach((n) => {
      try {
        n.stop();
      } catch (_) { }
    });
    sourceNodesRef.current = [];

    // Close the audio context (the browser's audio player)
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => { });
      audioCtxRef.current = null;
    }

    // Reset state: nothing is speaking, no loading, progress back to 0
    setSpeakingIndex(null);
    setLoadingStage(null);
    setTtsProgress(0);
  }, []);

  // When the App component is removed from screen (unmounts), stop any playing audio
  useEffect(() => () => stopTTS(), [stopTTS]);

  // ─── streamTTS(text, msgIndex) ──────────────────────────────
  // PURPOSE: Convert text to speech and play it out loud.
  // PARAMS:
  //   text     → the text to speak (e.g., the AI's reply)
  //   msgIndex → which message in the list is being spoken (so we can highlight it)
  // FLOW:
  //   1. Stop any currently playing audio
  //   2. Send the text to our TTS (text-to-speech) server
  //   3. Receive audio data back
  //   4. Play it through the browser's speakers
  const streamTTS = useCallback(
    async (text, msgIndex) => {
      // Step 1: Stop any audio that's already playing
      stopTTS();

      // Create an AbortController — this lets us cancel the request if needed
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Mark which message is being spoken and show "Converting to speech..." status
      setSpeakingIndex(msgIndex ?? null);
      setLoadingStage('converting');
      setTtsProgress(0);

      try {
        // Step 2: Pick the right voice (Hindi or English) based on the text
        const voice = detectTTSVoice(text);

        // Step 3: Send the text to our backend TTS API
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice }),
          signal: controller.signal, // allows us to cancel this request
        });

        if (!res.ok) throw new Error('TTS request failed');

        // Step 4: Get the audio data from the response
        const arrayBuffer = await res.arrayBuffer();

        // Step 5: Create an audio player (AudioContext) and decode the audio
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        // Audio is ready — hide the "converting" status
        setLoadingStage(null);
        setTtsProgress(100);

        // Step 6: Play the audio!
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(ctx.destination); // connect to speakers
        src.start(0); // start playing immediately
        sourceNodesRef.current.push(src);

        // When the audio finishes playing, clean up
        src.onended = () => {
          sourceNodesRef.current = [];
          abortControllerRef.current = null;
          setSpeakingIndex(null);
          setTtsProgress(0);
        };

        abortControllerRef.current = null;
      } catch (err) {
        // If the user manually cancelled, don't show an error
        if (err.name !== 'AbortError') console.error('TTS error:', err);
        setSpeakingIndex(null);
        setLoadingStage(null);
        setTtsProgress(0);
      }
    },
    [stopTTS, detectTTSVoice],
  );

  // ─── sendMessage(autoBlobOverride, prefillText) ─────────────
  // PURPOSE: This is the MAIN function — it sends the user's message to the AI and handles the response.
  // PARAMS:
  //   autoBlobOverride → optional audio blob (used when sending a voice recording)
  //   prefillText      → optional text (used when clicking a suggestion card)
  // FLOW:
  //   1. Add the user's message to the chat (text bubble or voice bubble)
  //   2. Show "Thinking..." loading animation
  //   3. Send the message + conversation history to the backend server
  //   4. Receive the AI's reply
  //   5. If voice was sent, update the voice bubble with the transcription
  //   6. Add the AI's reply to the chat
  //   7. Speak the reply out loud using TTS
  const sendMessage = useCallback(
    async (autoBlobOverride, prefillText) => {
      // Decide what to send: use the override if provided, otherwise use what's in state
      const blobToSend = autoBlobOverride ?? audioBlob;
      const textToSend = prefillText ?? userMessage;

      // Don't send if there's nothing to send (no text AND no audio)
      if (!textToSend?.trim() && !blobToSend) return;

      // Is this a voice-only message? (audio exists but no text was typed)
      const isVoiceOnly = !!blobToSend && !textToSend?.trim();

      // ── Step 1: Add the user's message to the chat immediately ──
      if (isVoiceOnly) {
        // For voice messages, show a special voice bubble with waveform animation
        // text is empty for now — it gets filled in later when the server transcribes it
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: '', isVoice: true },
        ]);
      } else if (textToSend?.trim()) {
        // For text messages, show a normal text bubble
        setMessages((prev) => [...prev, { role: 'user', text: textToSend }]);
      }

      // ── Step 2: Show loading state ──
      setIsLoading(true);
      setLoadingStage('thinking');
      setUserMessage(''); // clear the text input box

      // ── Step 3: Prepare the data to send to the server ──
      // FormData is like a form you fill out — it can hold both text and files
      const formData = new FormData();
      if (textToSend?.trim()) formData.append('message', textToSend);
      if (blobToSend) formData.append('audio', blobToSend, 'recording.webm');

      // ── Step 3b: Include conversation history ──
      // We send ALL previous messages so the AI knows the full context.
      // Example: if you asked "What is JS?" then "Give me an example",
      // the AI needs to know the first question to understand what "example" means.
      const history = messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text,
      }));
      formData.append('history', JSON.stringify(history));

      try {
        // ── Step 4: Send to the backend and wait for the AI's reply ──
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/groq`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        // data = { response: "AI's answer...", model: "llama-3.3-70b", transcription: "..." }

        if (!res.ok)
          throw new Error(data.error || data.details || 'An error occurred');

        // ── Step 5: If it was a voice message, update the bubble with what the user said ──
        // The server transcribed the audio into text (speech-to-text)
        if (data.transcription && isVoiceOnly) {
          setMessages((prev) => {
            const updated = [...prev];
            // Find the last voice message from the user and fill in the transcription
            for (let idx = updated.length - 1; idx >= 0; idx--) {
              if (updated[idx].role === 'user' && updated[idx].isVoice) {
                updated[idx] = {
                  ...updated[idx],
                  text: data.transcription, // now the voice bubble shows what you said!
                };
                break;
              }
            }
            return updated;
          });
        }

        // ── Step 6: Add the AI's reply to the chat ──
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: data.response, model: data.model },
        ]);

        // ── Step 7: Speak the AI's reply out loud ──
        const assistantIndex = messages.length + 1;
        streamTTS(data.response, assistantIndex);

        // Clear the audio blob since we've already sent it
        setAudioBlob(null);
      } catch (error) {
        // If something went wrong, show an error message in the chat
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
        // Whether it succeeded or failed, we're done loading
        setIsLoading(false);
      }
    },
    [userMessage, audioBlob, streamTTS, messages],
  );

  // ─── startRecording() ───────────────────────────────────────
  // PURPOSE: Start recording audio from the user's microphone.
  // FLOW:
  //   1. Ask the browser for microphone access (a popup will appear the first time)
  //   2. Create a MediaRecorder to capture the audio
  //   3. As audio data comes in, save it to chunks[]
  //   4. When recording stops, combine all chunks into one audio Blob and send it
  const startRecording = async () => {
    try {
      // Ask the browser for access to the microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create a recorder from the mic stream
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = []; // reset the chunks storage

      // Every time a chunk of audio is available, save it
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // When the recording stops, combine all chunks into one file and send it
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        sendMessage(blob); // automatically send the voice message!
      };

      // Start recording!
      mediaRecorder.start();
      setIsRecording(true); // mic button turns red
    } catch {
      alert('Could not access microphone.');
    }
  };

  // ─── stopRecording() ────────────────────────────────────────
  // PURPOSE: Stop the microphone recording.
  // When stopped, the mediaRecorder.onstop callback (above) fires automatically,
  // which creates the audio blob and calls sendMessage().
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();      // triggers onstop callback
      setIsRecording(false);                // mic button goes back to normal
      // Stop the actual microphone hardware
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
  };

  // ─── getLoadingText() ───────────────────────────────────────
  // PURPOSE: Returns the right loading message based on what stage we're in.
  const getLoadingText = () => {
    if (loadingStage === 'thinking') return 'Thinking...';
    if (loadingStage === 'converting') return 'Converting to speech...';
    return 'Processing...';
  };

  // ─── copyText(text) ─────────────────────────────────────────
  // PURPOSE: Copy the AI's reply to the clipboard so you can paste it somewhere else.
  const copyText = (text) => navigator.clipboard.writeText(text);

  // ─── handleFeedback(index, type) ────────────────────────────
  // PURPOSE: Toggle thumbs-up or thumbs-down on an AI message.
  //   - If you click 👍 and it's already liked → removes the like (toggle off)
  //   - If you click 👍 and it's not liked → adds the like (toggle on)
  //   - Same logic for 👎
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

  // ─── Helper Variables ───────────────────────────────────────
  // Is there at least one message? (used to decide: show welcome screen OR chat)
  const hasMessages = messages.length > 0;

  // Is this the most recent message? (can be used to highlight the latest one)
  const isActiveMessage = (i) => i === messages.length - 1;

  // Shared CSS classes for the action buttons (Copy, Replay, ThumbsUp, ThumbsDown)
  const actionBtn =
    'inline-flex items-center gap-[5px] px-2 py-[5px] rounded-md text-[13px] text-[#8e8ea0] bg-transparent border-none cursor-pointer transition-colors hover:bg-[#ececec] hover:text-[#6e6e80]';

  // ═══════════════════════════════════════════════════════════════
  // ─── JSX: What Gets Rendered on Screen ─────────────────────────
  // ═══════════════════════════════════════════════════════════════
  // The UI has 3 main sections stacked vertically:
  //   1. HEADER   — logo + "Online" status (always at the top)
  //   2. CHAT AREA — messages or welcome screen (scrollable, fills the middle)
  //   3. INPUT AREA — text box or mic button (always at the bottom)
  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* ── SECTION 1: Header (always visible at the top) ── */}
      {/* Shows the app logo and a green "Online" indicator */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-[10px] border-b border-[#ebebeb] bg-white z-10">
        <button className="flex items-center gap-[10px] px-3 py-[6px] rounded-lg text-[15px] font-semibold text-[#0d0d0d] cursor-pointer transition-colors hover:bg-[#ececec] border-none bg-transparent">
          <img
            src="/logo.webp"
            alt="Vneviks AI"
            className="w-[35px] h-[35px] object-contain rounded-full"
          />
          <span>Vneviks AI</span>
        </button>
        {/* Green pulsing dot + "Online" text */}
        <div className="flex items-center gap-[6px] text-xs text-[#10a37f] font-medium">
          <span
            className="w-[6px] h-[6px] rounded-full bg-[#10a37f]"
            style={{ animation: 'pulse-dot 2s ease-in-out infinite' }}
          />
          <span>Online</span>
        </div>
      </header>

      {/* ── SECTION 2: Chat Area (the scrollable middle section) ── */}
      {/* If there are no messages yet → show the Welcome screen */}
      {/* If there are messages → show the conversation */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto">
        {!hasMessages && !isLoading ? (
          /* ── Welcome Screen ── */
          /* Shown when the conversation is empty. Has a logo, greeting, and suggestion cards. */
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
            {/* Suggestion cards — clicking one sends that text as a message */}
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
          /* ── Message List ── */
          /* Loop through every message in the messages[] array and render a bubble for each */
          <div className="flex flex-col py-2">
            {messages.map((msg, i) => (
              <div key={i} className="py-5 flex justify-center">
                <div className="w-full max-w-[768px] px-6 flex gap-4 max-md:px-4 max-md:gap-3 max-sm:px-3 max-sm:gap-[10px]">
                  {/* Avatar — shows the AI logo for assistant messages, person icon for user */}
                  <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden mt-[2px]">
                    <img
                      src={
                        msg.role === 'assistant' ? '/logo.webp' : '/people.png'
                      }
                      alt={msg.role}
                      className="w-full h-full object-contain rounded-full"
                    />
                  </div>

                  {/* Message Body — what gets shown depends on the message type */}
                  <div className="flex-1 min-w-0">
                    {/* CASE 1: Normal text message from the user */}
                    {msg.role === 'user' && !msg.isVoice && (
                      <div className="text-[15px] leading-[1.7] text-[#0d0d0d] whitespace-pre-wrap break-words">
                        {msg.text}
                      </div>
                    )}

                    {/* CASE 2: Voice message from the user — shows a waveform + transcription */}
                    {msg.role === 'user' && msg.isVoice && (
                      <div className="voice-bubble">
                        <div className="voice-bubble-header">
                          <div className="voice-icon-wrapper">
                            <Mic size={16} className="voice-icon" />
                          </div>
                          {/* Animated waveform bars (24 bars with different heights) */}
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
                        {/* Once the server transcribes the audio, show what was said */}
                        {msg.text && (
                          <div className="voice-transcription">
                            <span className="voice-transcription-label">Transcription:</span>
                            <span className="voice-transcription-text">{msg.text}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* CASE 3: Error message from the AI (shown in red) */}
                    {msg.role === 'assistant' && msg.isError && (
                      <div className="text-[15px] leading-[1.7] text-[#ef4444] whitespace-pre-wrap break-words">
                        ⚠️ {msg.text}
                      </div>
                    )}

                    {/* CASE 4: Normal AI reply — shown in a grey rounded card */}
                    {/* Inside this card we show: voice status + action buttons */}
                    {msg.role === 'assistant' && !msg.isError && (
                      <div className="flex flex-col gap-[10px] px-5 py-4 bg-[#f7f7f8] border border-[#e5e5e5] rounded-2xl max-sm:px-3 max-sm:py-[10px]">
                        {/* Voice Status 1: "Generating voice..." — TTS is converting text to audio */}
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

                        {/* Voice Status 2: "Playing voice..." — audio is playing through speakers */}
                        {/* Shows animated green bars + a Stop button to silence it */}
                        {speakingIndex === i && !loadingStage && (
                          <div className="flex items-center gap-3 flex-wrap">
                            {/* Animated green equalizer bars */}
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

                        {/* Voice Status 3: Idle — not currently playing this message */}
                        {/* Just shows a static "🔊 Voice response" label */}
                        {speakingIndex !== i && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-[#6e6e80]">
                              🔊 Voice response
                            </span>
                          </div>
                        )}

                        {/* ── Action Buttons Row ── */}
                        {/* Replay (re-speak), Copy, Thumbs Up, Thumbs Down */}
                        <div className="flex items-center gap-[2px] flex-wrap">
                          {/* Replay button — only shown when this message isn't currently playing */}
                          {speakingIndex !== i && (
                            <button
                              onClick={() => streamTTS(msg.text, i)}
                              className={actionBtn}
                            >
                              <Volume2 size={14} />
                              <span>Replay</span>
                            </button>
                          )}
                          {/* Copy button — copies the AI's text to clipboard */}
                          <button
                            onClick={() => copyText(msg.text)}
                            className={actionBtn}
                          >
                            <Copy size={14} />
                            <span>Copy</span>
                          </button>
                          {/* Thumbs Up — toggles "liked" feedback on this message */}
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
                          {/* Thumbs Down — toggles "disliked" feedback on this message */}
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

            {/* ── "Thinking..." animation ── */}
            {/* Shown while the AI is processing. 3 bouncing dots next to the bot avatar. */}
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
                  {/* Three animated dots (●●●) that pulse up and down */}
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

            {/* Invisible div at the very bottom — we scroll to this to auto-scroll the chat */}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── SECTION 3: Input Area (always at the bottom) ── */}
      <div
        className="flex-shrink-0 border-t border-[#ebebeb] bg-white px-4 pt-3 pb-4 flex flex-col items-center gap-[10px]"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        {/* ── Mode Switch Toggle ── */}
        {/* Two tabs: "Text" and "Speech". Clicking one sets inputMode to that value. */}
        {/* The active tab gets a white background, the inactive one is transparent. */}
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

        {/* ── Text Input Mode ── */}
        {/* Shown when inputMode === 'text'. Contains a text area + send button. */}
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
            {/* The text input area where the user types their message */}
            <textarea
              rows={1}
              placeholder="Message Vneviks AI…"
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)} // update userMessage as user types
              onKeyDown={(e) => {
                // Press Enter (without Shift) to send the message
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              className="flex-1 bg-transparent border-none resize-none text-[15px] text-[#0d0d0d] leading-[1.5] outline-none min-h-6 max-h-[200px] placeholder-[#b4b4b4]"
            />
            {/* Send button — disabled when loading or when text box is empty */}
            <button
              onClick={() => sendMessage()}
              disabled={isLoading || !userMessage.trim()}
              className="w-8 h-8 rounded-full border-none cursor-pointer flex items-center justify-center flex-shrink-0 transition-all bg-[#0d0d0d] hover:bg-[#2b2b2b] disabled:bg-[#e5e5e5] disabled:cursor-not-allowed"
            >
              {/* Show spinner while loading, otherwise show send arrow */}
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

        {/* ── Speech Input Mode ── */}
        {/* Shown when inputMode === 'speech'. Shows a mic button with 3 states: */}
        {/*   1. Idle: "Tap to record" button */}
        {/*   2. Recording: red pulsing "Tap to stop & send" button */}
        {/*   3. Loading: spinner with status text */}
        {inputMode === 'speech' && (
          <div className="flex flex-col items-center gap-[14px] py-4 w-full max-w-[768px]">
            {/* State 1: Not recording, not loading → show "Tap to record" */}
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
            {/* State 2: Currently recording → show red pulsing stop button */}
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
            {/* State 3: Loading (after recording stopped) → show spinner */}
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

        {/* Disclaimer text at the very bottom */}
        <p className="text-xs text-[#8e8ea0] text-center">
          Vneviks AI can make mistakes. Consider checking important information.
        </p>
      </div>
    </div>
  );
}
